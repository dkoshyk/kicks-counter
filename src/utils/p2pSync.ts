import Peer, { type DataConnection } from 'peerjs';
import { db, addManualSession, deleteSession, type Session, type Kick } from '../db';

export type Role = 'master' | 'slave' | 'none';

export interface LiveSessionState {
  isCounting: boolean;
  kickCount: number;
  targetKicks: number;
  elapsedMs: number;
  startTime: number;
}

export interface P2PPayload {
  type: 'PAIR_ACCEPT' | 'LIVE_SESSION_UPDATE' | 'SESSION_COMPLETED' | 'SESSION_DELETED' | 'REQUEST_HISTORY' | 'HISTORY_RESPONSE' | 'DISCONNECT' | 'PING' | 'PONG';
  senderRole: Role;
  liveState?: LiveSessionState;
  completedSession?: {
    session: Session;
    kicks: Kick[];
  };
  historySessions?: Session[];
  deletedStartTime?: number;
}

class P2PSyncManager {
  private peer: Peer | null = null;
  private role: Role = 'none';
  private connections: Map<string, DataConnection> = new Map();
  private connectionLastSeen: Map<string, number> = new Map();
  private roomId: string = '';
  private reconnectInterval: any = null;
  private heartbeatInterval: any = null;
  
  // Callbacks
  private onLiveUpdateCb: ((state: LiveSessionState | null) => void) | null = null;
  private onStatusChangeCb: ((status: string, connectedCount: number) => void) | null = null;
  private onSessionReceivedCb: ((message: string) => void) | null = null;

  constructor() {
    // Listen to network online event
    window.addEventListener('online', () => {
      this.autoReconnect();
    });

    // Listen to app foregrounding (unlocking phone screen after long periods)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.autoReconnect();
      }
    });

    // Auto-reconnect on startup if previously paired
    setTimeout(() => {
      this.autoReconnect();
    }, 1000);

    // Start periodic background keep-alive check
    this.startHeartbeat();
  }

  /**
   * Keep-alive check: ping signaling server & WebRTC peer connections
   */
  private startHeartbeat() {
    if (this.heartbeatInterval) return;
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();

      // 1. Ensure signaling server connection is alive
      if (this.peer && !this.peer.destroyed) {
        if (this.peer.disconnected) {
          console.warn('Signaling server disconnected. Reconnecting...');
          this.peer.reconnect();
        }
      } else if (this.role !== 'none') {
        this.autoReconnect();
      }

      // 2. Ping active WebRTC data connections & clean up dead ones
      this.connections.forEach((conn, peerId) => {
        if (!conn.open) {
          this.cleanupConnection(peerId);
          return;
        }

        const lastSeen = this.connectionLastSeen.get(peerId) || now;
        if (now - lastSeen > 45000) {
          console.warn(`Connection to ${peerId} timed out. Closing...`);
          conn.close();
          this.cleanupConnection(peerId);
        } else {
          this.sendPayload(conn, { type: 'PING', senderRole: this.role });
        }
      });
    }, 15000);
  }

  /**
   * Auto-reconnect from saved localStorage settings
   */
  public async autoReconnect() {
    const savedRole = (localStorage.getItem('poshtovhy_p2p_role') as Role) || 'none';
    const savedRoomId = localStorage.getItem('poshtovhy_p2p_room_id') || '';

    if (savedRole === 'master' && savedRoomId) {
      this.role = 'master';
      if (!this.peer || this.peer.destroyed) {
        try {
          await this.initMaster(savedRoomId);
        } catch (_) {}
      } else if (this.peer.disconnected) {
        this.peer.reconnect();
      }
    } else if (savedRole === 'slave' && savedRoomId) {
      this.role = 'slave';
      if (this.peer && this.peer.disconnected && !this.peer.destroyed) {
        this.peer.reconnect();
      }
      if (this.connections.size === 0) {
        this.updateStatus('Відновлення звʼязку з мамою... 🟡', 0);
        try {
          await this.connectAsSlave(savedRoomId);
        } catch (_) {
          this.scheduleReconnect();
        }
      }
    }
  }

  /**
   * Schedule automatic retry loop for slave
   */
  private scheduleReconnect() {
    if (this.reconnectInterval) return;
    this.reconnectInterval = setInterval(async () => {
      const savedRole = localStorage.getItem('poshtovhy_p2p_role');
      const savedRoomId = localStorage.getItem('poshtovhy_p2p_room_id');

      if (savedRole === 'slave' && savedRoomId && this.connections.size === 0) {
        try {
          await this.connectAsSlave(savedRoomId);
          if (this.reconnectInterval) {
            clearInterval(this.reconnectInterval);
            this.reconnectInterval = null;
          }
        } catch (_) {}
      } else {
        if (this.reconnectInterval) {
          clearInterval(this.reconnectInterval);
          this.reconnectInterval = null;
        }
      }
    }, 5000);
  }

  /**
   * Initialize Mother as Master
   */
  public async initMaster(customRoomId?: string): Promise<string> {
    this.role = 'master';
    this.roomId = customRoomId || Math.random().toString(36).substring(2, 8).toUpperCase();
    
    localStorage.setItem('poshtovhy_p2p_role', 'master');
    localStorage.setItem('poshtovhy_p2p_room_id', this.roomId);

    if (this.peer && !this.peer.destroyed) {
      this.peer.destroy();
    }

    return new Promise((resolve, reject) => {
      this.peer = new Peer(this.roomId, {
        debug: 1
      });

      this.peer.on('open', (id) => {
        this.roomId = id;
        this.updateStatus(
          this.connections.size > 0 ? `Підключено пристроїв: ${this.connections.size}` : 'Майстер активний (Очікування підключення)',
          this.connections.size
        );
        resolve(id);
      });

      this.peer.on('connection', (conn) => {
        this.setupConnection(conn);
      });

      this.peer.on('disconnected', () => {
        console.warn('Master disconnected from PeerJS signaling server. Reconnecting...');
        if (this.peer && !this.peer.destroyed) {
          this.peer.reconnect();
        }
      });

      this.peer.on('error', (err) => {
        console.error('PeerJS Master Error:', err);
        if (err.type === 'unavailable-id') {
          if (this.peer && !this.peer.destroyed) {
            this.peer.reconnect();
          }
        }
        this.updateStatus(`Помилка підключення: ${err.message}`, this.connections.size);
        reject(err);
      });
    });
  }

  /**
   * Connect Father as Slave to Mother's Room ID
   */
  public async connectAsSlave(targetRoomId: string): Promise<boolean> {
    this.role = 'slave';
    const cleanRoomId = targetRoomId.trim().toUpperCase();
    this.roomId = cleanRoomId;
    
    localStorage.setItem('poshtovhy_p2p_role', 'slave');
    localStorage.setItem('poshtovhy_p2p_room_id', cleanRoomId);

    const slavePeerId = `slave-${Math.random().toString(36).substring(2, 8)}`;

    if (this.peer && !this.peer.destroyed) {
      this.peer.destroy();
    }

    return new Promise((resolve, reject) => {
      this.peer = new Peer(slavePeerId, {
        debug: 1
      });

      this.peer.on('open', () => {
        if (!this.peer) return;
        const conn = this.peer.connect(cleanRoomId, {
          reliable: true
        });

        conn.on('open', () => {
          this.setupConnection(conn);
          this.updateStatus('Підключено до мами 🟢', 1);

          if (this.reconnectInterval) {
            clearInterval(this.reconnectInterval);
            this.reconnectInterval = null;
          }

          // Request full history upon initial pair
          this.sendPayload(conn, {
            type: 'REQUEST_HISTORY',
            senderRole: 'slave'
          });

          resolve(true);
        });

        conn.on('error', (err) => {
          console.error('Connection error:', err);
          this.updateStatus('Відновлення звʼязку з мамою... 🟡', 0);
          this.scheduleReconnect();
          reject(err);
        });
      });

      this.peer.on('disconnected', () => {
        console.warn('Slave disconnected from PeerJS signaling server. Reconnecting...');
        if (this.peer && !this.peer.destroyed) {
          this.peer.reconnect();
        }
      });

      this.peer.on('error', (err) => {
        console.error('PeerJS Slave Error:', err);
        this.updateStatus('Відновлення звʼязку з мамою... 🟡', 0);
        this.scheduleReconnect();
        reject(err);
      });
    });
  }

  /**
   * Setup connection handlers
   */
  private setupConnection(conn: DataConnection) {
    this.connections.set(conn.peer, conn);
    this.connectionLastSeen.set(conn.peer, Date.now());

    this.updateStatus(
      this.role === 'master' ? `Підключено пристроїв: ${this.connections.size}` : 'Підключено до мами 🟢',
      this.connections.size
    );

    conn.on('data', async (data) => {
      this.connectionLastSeen.set(conn.peer, Date.now());
      const payload = data as P2PPayload;
      await this.handleIncomingPayload(conn, payload);
    });

    conn.on('close', () => {
      this.cleanupConnection(conn.peer);
    });

    conn.on('error', (err) => {
      console.error(`DataConnection error (${conn.peer}):`, err);
      this.cleanupConnection(conn.peer);
    });
  }

  private cleanupConnection(peerId: string) {
    this.connections.delete(peerId);
    this.connectionLastSeen.delete(peerId);

    const isSlave = this.role === 'slave';
    this.updateStatus(
      this.role === 'master'
        ? (this.connections.size > 0 ? `Підключено пристроїв: ${this.connections.size}` : 'Майстер активний (Очікування підключення)')
        : 'Відновлення звʼязку... 🟡',
      this.connections.size
    );

    if (isSlave) {
      if (this.onLiveUpdateCb) {
        this.onLiveUpdateCb(null);
      }
      this.scheduleReconnect();
    }
  }

  /**
   * Handle incoming payloads
   */
  private async handleIncomingPayload(conn: DataConnection, payload: P2PPayload) {
    switch (payload.type) {
      case 'PING':
        this.sendPayload(conn, { type: 'PONG', senderRole: this.role });
        break;

      case 'PONG':
        // Connection activity timestamp already updated in 'data' listener
        break;

      case 'LIVE_SESSION_UPDATE':
        if (this.role === 'slave' && this.onLiveUpdateCb) {
          this.onLiveUpdateCb(payload.liveState || null);
        }
        break;

      case 'SESSION_COMPLETED':
        if (this.role === 'slave' && payload.completedSession) {
          const { session } = payload.completedSession;
          try {
            // Deduplication check: verify if session with same startTime already exists
            const existingCount = await db.sessions
              .where('startTime')
              .between(session.startTime - 2000, session.startTime + 2000)
              .count();

            if (existingCount > 0) {
              return; // Skip duplicate!
            }

            const startDate = new Date(session.startTime);
            const durationMins = session.endTime
              ? Math.max(1, Math.round((session.endTime - session.startTime) / 60000))
              : 20;

            await addManualSession({
              dateStr: startDate.toISOString().slice(0, 10),
              timeStr: startDate.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
              durationMinutes: durationMins,
              kickCount: session.kickCount,
              targetKicks: session.targetKicks,
              note: `${session.note ? session.note + ' • ' : ''}Синхронізовано від мами 🌸`
            });

            if (this.onSessionReceivedCb) {
              this.onSessionReceivedCb(`Отримано нову сесію від мами (${session.kickCount} поштовхів)!`);
            }
          } catch (err) {
            console.error('Failed to import synced session:', err);
          }
        }
        break;

      case 'SESSION_DELETED':
        if (this.role === 'slave' && payload.deletedStartTime) {
          try {
            const matchingSessions = await db.sessions
              .where('startTime')
              .between(payload.deletedStartTime - 2000, payload.deletedStartTime + 2000)
              .toArray();

            for (const s of matchingSessions) {
              if (s.id) {
                await deleteSession(s.id);
              }
            }
          } catch (err) {
            console.error('Failed to delete synced session:', err);
          }
        }
        break;

      case 'REQUEST_HISTORY':
        if (this.role === 'master') {
          const completedSessions = await db.sessions
            .where('status')
            .equals('completed')
            .toArray();

          this.sendPayload(conn, {
            type: 'HISTORY_RESPONSE',
            senderRole: 'master',
            historySessions: completedSessions
          });
        }
        break;

      case 'HISTORY_RESPONSE':
        if (this.role === 'slave' && payload.historySessions) {
          let addedCount = 0;
          for (const sess of payload.historySessions) {
            try {
              // Deduplication check: verify if session with same startTime already exists
              const existingCount = await db.sessions
                .where('startTime')
                .between(sess.startTime - 2000, sess.startTime + 2000)
                .count();

              if (existingCount > 0) {
                continue; // Skip duplicate!
              }

              const startDate = new Date(sess.startTime);
              const durationMins = sess.endTime
                ? Math.max(1, Math.round((sess.endTime - sess.startTime) / 60000))
                : 20;

              await addManualSession({
                dateStr: startDate.toISOString().slice(0, 10),
                timeStr: startDate.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
                durationMinutes: durationMins,
                kickCount: sess.kickCount,
                targetKicks: sess.targetKicks,
                note: `${sess.note ? sess.note + ' • ' : ''}Історія мами 🌸`
              });
              addedCount++;
            } catch (_) {}
          }
          if (this.onSessionReceivedCb && addedCount > 0) {
            this.onSessionReceivedCb(`Синхронізовано ${addedCount} нових сесій з історії мами!`);
          }
        }
        break;

      case 'DISCONNECT':
        conn.close();
        this.cleanupConnection(conn.peer);
        break;
    }
  }

  /**
   * Broadcast real-time live session update (Mother to Father)
   */
  public broadcastLiveSession(liveState: LiveSessionState | null) {
    if (this.role !== 'master') return;

    this.broadcast({
      type: 'LIVE_SESSION_UPDATE',
      senderRole: 'master',
      liveState: liveState || undefined
    });
  }

  /**
   * Broadcast completed session (Mother to Father)
   */
  public broadcastCompletedSession(session: Session, kicks: Kick[]) {
    if (this.role !== 'master') return;

    this.broadcast({
      type: 'SESSION_COMPLETED',
      senderRole: 'master',
      completedSession: { session, kicks }
    });
  }

  /**
   * Broadcast deleted session (Mother to Father)
   */
  public broadcastDeletedSession(startTime: number) {
    if (this.role !== 'master') return;

    this.broadcast({
      type: 'SESSION_DELETED',
      senderRole: 'master',
      deletedStartTime: startTime
    });
  }

  /**
   * Broadcast payload to all connected peers
   */
  private broadcast(payload: P2PPayload) {
    this.connections.forEach((conn) => {
      this.sendPayload(conn, payload);
    });
  }

  /**
   * Send payload to specific connection
   */
  private sendPayload(conn: DataConnection, payload: P2PPayload) {
    if (conn && conn.open) {
      conn.send(payload);
    }
  }

  /**
   * Master disconnects specific peer or all peers & clears storage
   */
  public disconnectAll() {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    localStorage.removeItem('poshtovhy_p2p_role');
    localStorage.removeItem('poshtovhy_p2p_room_id');

    this.connections.forEach((conn) => {
      this.sendPayload(conn, { type: 'DISCONNECT', senderRole: this.role });
      conn.close();
    });
    this.connections.clear();
    this.connectionLastSeen.clear();
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.role = 'none';
    this.updateStatus('Відключено', 0);
  }

  /**
   * Request manual sync from Slave side
   */
  public requestManualSync() {
    if (this.role !== 'slave') return;
    this.connections.forEach((conn) => {
      this.sendPayload(conn, {
        type: 'REQUEST_HISTORY',
        senderRole: 'slave'
      });
    });
  }

  // Event Listeners
  public setOnLiveUpdate(cb: (state: LiveSessionState | null) => void) {
    this.onLiveUpdateCb = cb;
  }

  public setOnStatusChange(cb: (status: string, connectedCount: number) => void) {
    this.onStatusChangeCb = cb;
  }

  public setOnSessionReceived(cb: (message: string) => void) {
    this.onSessionReceivedCb = cb;
  }

  private updateStatus(status: string, count: number) {
    if (this.onStatusChangeCb) {
      this.onStatusChangeCb(status, count);
    }
  }

  public getRole(): Role {
    return this.role;
  }

  public getRoomId(): string {
    return this.roomId;
  }

  public getConnectedCount(): number {
    return this.connections.size;
  }
}

export const p2pSyncManager = new P2PSyncManager();

