import Peer, { type DataConnection } from 'peerjs';
import {
  db,
  deleteSession,
  deduplicateSessions,
  type Session,
  type Kick,
  type Contraction,
  type BagItem,
  type ShoppingItem
} from '../db';

export type Role = 'master' | 'slave' | 'none';

export interface LiveSessionState {
  isCounting: boolean;
  kickCount: number;
  targetKicks: number;
  elapsedMs: number;
  startTime: number;
}

export interface P2PPayload {
  type:
    | 'PAIR_ACCEPT'
    | 'LIVE_SESSION_UPDATE'
    | 'SESSION_COMPLETED'
    | 'SESSION_DELETED'
    | 'REQUEST_HISTORY'
    | 'HISTORY_RESPONSE'
    | 'CONTRACTION_SYNC'
    | 'CONTRACTION_DELETED'
    | 'BAG_ITEM_SYNC'
    | 'BAG_ITEM_DELETED'
    | 'SHOPPING_ITEM_SYNC'
    | 'SHOPPING_ITEM_DELETED'
    | 'DISCONNECT'
    | 'PING'
    | 'PONG';
  senderRole: Role;
  liveState?: LiveSessionState;
  completedSession?: {
    session: Session;
    kicks: Kick[];
  };
  historySessions?: Session[];
  historyContractions?: Contraction[];
  historyBagItems?: BagItem[];
  historyShoppingItems?: ShoppingItem[];
  deletedStartTime?: number;
  contraction?: Contraction;
  deletedContractionStartTime?: number;
  bagItem?: BagItem;
  deletedBagItemName?: string;
  shoppingItem?: ShoppingItem;
  deletedShoppingItemTitle?: string;
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
    try {
      await deduplicateSessions();
    } catch (_) {}

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
            // Deduplication check: check within 60s window and matching kickCount
            const existingCount = await db.sessions
              .where('startTime')
              .between(session.startTime - 60000, session.startTime + 60000)
              .filter(s => s.kickCount === session.kickCount)
              .count();

            if (existingCount > 0) {
              return; // Skip duplicate!
            }

            await db.sessions.add({
              startTime: session.startTime,
              endTime: session.endTime,
              kickCount: session.kickCount,
              targetKicks: session.targetKicks,
              status: 'completed',
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
              .between(payload.deletedStartTime - 60000, payload.deletedStartTime + 60000)
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

          const contractions = await db.contractions.toArray();
          const bagItems = await db.bagItems.toArray();
          const shoppingItems = await db.shoppingItems.toArray();

          this.sendPayload(conn, {
            type: 'HISTORY_RESPONSE',
            senderRole: 'master',
            historySessions: completedSessions,
            historyContractions: contractions,
            historyBagItems: bagItems,
            historyShoppingItems: shoppingItems
          });
        }
        break;

      case 'HISTORY_RESPONSE':
        if (this.role === 'slave') {
          let addedCount = 0;

          // 1. Sync Kick Sessions
          if (payload.historySessions) {
            for (const sess of payload.historySessions) {
              try {
                const existingCount = await db.sessions
                  .where('startTime')
                  .between(sess.startTime - 60000, sess.startTime + 60000)
                  .filter(s => s.kickCount === sess.kickCount)
                  .count();

                if (existingCount > 0) continue;

                await db.sessions.add({
                  startTime: sess.startTime,
                  endTime: sess.endTime,
                  kickCount: sess.kickCount,
                  targetKicks: sess.targetKicks,
                  status: 'completed',
                  note: `${sess.note ? sess.note + ' • ' : ''}Історія мами 🌸`
                });
                addedCount++;
              } catch (_) {}
            }
            await deduplicateSessions();
          }

          // 2. Sync Contractions
          if (payload.historyContractions) {
            for (const c of payload.historyContractions) {
              try {
                const existing = await db.contractions
                  .where('startTime')
                  .equals(c.startTime)
                  .first();
                if (!existing) {
                  await db.contractions.add({
                    startTime: c.startTime,
                    endTime: c.endTime,
                    duration: c.duration,
                    interval: c.interval,
                    restDuration: c.restDuration,
                    intensity: c.intensity,
                    notes: c.notes,
                    isFalseAlarm: c.isFalseAlarm
                  });
                } else if (existing.id) {
                  await db.contractions.update(existing.id, {
                    endTime: c.endTime,
                    duration: c.duration,
                    interval: c.interval,
                    restDuration: c.restDuration,
                    intensity: c.intensity,
                    notes: c.notes,
                    isFalseAlarm: c.isFalseAlarm
                  });
                }
              } catch (_) {}
            }
          }

          // 3. Sync Hospital Bags
          if (payload.historyBagItems) {
            for (const bi of payload.historyBagItems) {
              try {
                const existing = await db.bagItems
                  .where('name')
                  .equals(bi.name)
                  .first();
                if (existing?.id) {
                  await db.bagItems.update(existing.id, {
                    isPacked: bi.isPacked,
                    quantity: bi.quantity,
                    notes: bi.notes
                  });
                }
              } catch (_) {}
            }
          }

          // 4. Sync Shopping Wishlist
          if (payload.historyShoppingItems) {
            for (const si of payload.historyShoppingItems) {
              try {
                if (!si.title) continue;
                const existing = await db.shoppingItems
                  .where('title')
                  .equals(si.title)
                  .first();
                if (!existing) {
                  await db.shoppingItems.add({
                    url: si.url || '',
                    domain: si.domain || '',
                    title: si.title,
                    description: si.description || undefined,
                    imageUrl: si.imageUrl || undefined,
                    price: typeof si.price === 'number' && !isNaN(si.price) ? si.price : undefined,
                    currency: si.currency || 'UAH',
                    isBought: Boolean(si.isBought),
                    status: si.status || (si.isBought ? 'bought' : 'planned'),
                    orderPlace: si.orderPlace || '',
                    depositAmount: typeof si.depositAmount === 'number' && !isNaN(si.depositAmount) ? si.depositAmount : undefined,
                    priority: si.priority || 'medium',
                    notes: si.notes || '',
                    createdAt: typeof si.createdAt === 'number' && !isNaN(si.createdAt) ? si.createdAt : Date.now()
                  });
                } else if (existing.id) {
                  await db.shoppingItems.update(existing.id, {
                    isBought: Boolean(si.isBought),
                    status: si.status || (si.isBought ? 'bought' : 'planned'),
                    orderPlace: si.orderPlace || '',
                    depositAmount: typeof si.depositAmount === 'number' && !isNaN(si.depositAmount) ? si.depositAmount : undefined,
                    price: typeof si.price === 'number' && !isNaN(si.price) ? si.price : undefined,
                    currency: si.currency || existing.currency || 'UAH',
                    imageUrl: si.imageUrl || existing.imageUrl,
                    notes: si.notes || existing.notes,
                    priority: si.priority || existing.priority || 'medium'
                  });
                }
              } catch (_) {}
            }
          }

          if (this.onSessionReceivedCb && addedCount > 0) {
            this.onSessionReceivedCb(`Синхронізовано повні дані вагітності від мами! 🌸`);
          }
        }
        break;

      case 'CONTRACTION_SYNC':
        if (this.role === 'slave' && payload.contraction) {
          try {
            const c = payload.contraction;
            const existing = await db.contractions.where('startTime').equals(c.startTime).first();
            if (!existing) {
              await db.contractions.add({
                startTime: c.startTime,
                endTime: c.endTime,
                duration: c.duration,
                interval: c.interval,
                restDuration: c.restDuration,
                intensity: c.intensity,
                notes: c.notes,
                isFalseAlarm: c.isFalseAlarm
              });
              if (this.onSessionReceivedCb) {
                this.onSessionReceivedCb(`Оновлено дані переймів від мами! ⏱️`);
              }
            } else if (existing.id) {
              await db.contractions.update(existing.id, {
                endTime: c.endTime,
                duration: c.duration,
                interval: c.interval,
                restDuration: c.restDuration,
                intensity: c.intensity,
                notes: c.notes,
                isFalseAlarm: c.isFalseAlarm
              });
            }
          } catch (_) {}
        }
        break;

      case 'CONTRACTION_DELETED':
        if (this.role === 'slave' && payload.deletedContractionStartTime) {
          try {
            const c = await db.contractions
              .where('startTime')
              .equals(payload.deletedContractionStartTime)
              .first();
            if (c?.id) {
              await db.contractions.delete(c.id);
            }
          } catch (_) {}
        }
        break;

      case 'BAG_ITEM_SYNC':
        if (payload.bagItem) {
          try {
            const bi = payload.bagItem;
            if (bi.name) {
              const existing = await db.bagItems.where('name').equals(bi.name).first();
              if (existing?.id) {
                await db.bagItems.update(existing.id, {
                  isPacked: Boolean(bi.isPacked),
                  quantity: typeof bi.quantity === 'number' ? bi.quantity : (Number(bi.quantity) || 1),
                  notes: bi.notes || undefined,
                  bagId: typeof bi.bagId === 'number' ? bi.bagId : existing.bagId
                });
              } else {
                const bagIdNum = typeof bi.bagId === 'number' ? bi.bagId : (Number(bi.bagId) || 1);
                await db.bagItems.add({
                  bagId: bagIdNum,
                  name: bi.name,
                  isPacked: Boolean(bi.isPacked),
                  quantity: typeof bi.quantity === 'number' ? bi.quantity : (Number(bi.quantity) || 1),
                  notes: bi.notes || undefined,
                  order: typeof bi.order === 'number' ? bi.order : Date.now()
                });
              }
            }
          } catch (err) {
            console.error('Failed to sync bag item:', err);
          }
        }
        break;

      case 'BAG_ITEM_DELETED':
        if (payload.deletedBagItemName) {
          try {
            const existing = await db.bagItems.where('name').equals(payload.deletedBagItemName).first();
            if (existing?.id) {
              await db.bagItems.delete(existing.id);
            }
          } catch (_) {}
        }
        break;

      case 'SHOPPING_ITEM_SYNC':
        if (payload.shoppingItem) {
          try {
            const si = payload.shoppingItem;
            if (si.title) {
              const existing = await db.shoppingItems.where('title').equals(si.title).first();
              if (existing?.id) {
                await db.shoppingItems.update(existing.id, {
                  isBought: Boolean(si.isBought),
                  status: si.status || (si.isBought ? 'bought' : 'planned'),
                  orderPlace: si.orderPlace || '',
                  depositAmount: typeof si.depositAmount === 'number' && !isNaN(si.depositAmount) ? si.depositAmount : undefined,
                  price: typeof si.price === 'number' && !isNaN(si.price) ? si.price : undefined,
                  currency: si.currency || existing.currency || 'UAH',
                  imageUrl: si.imageUrl || existing.imageUrl,
                  notes: si.notes || '',
                  priority: si.priority || existing.priority || 'medium'
                });
              } else {
                await db.shoppingItems.add({
                  url: si.url || '',
                  domain: si.domain || '',
                  title: si.title,
                  description: si.description || undefined,
                  imageUrl: si.imageUrl || undefined,
                  price: typeof si.price === 'number' && !isNaN(si.price) ? si.price : undefined,
                  currency: si.currency || 'UAH',
                  isBought: Boolean(si.isBought),
                  status: si.status || (si.isBought ? 'bought' : 'planned'),
                  orderPlace: si.orderPlace || '',
                  depositAmount: typeof si.depositAmount === 'number' && !isNaN(si.depositAmount) ? si.depositAmount : undefined,
                  priority: si.priority || 'medium',
                  notes: si.notes || '',
                  createdAt: typeof si.createdAt === 'number' && !isNaN(si.createdAt) ? si.createdAt : Date.now()
                });
              }
            }
          } catch (err) {
            console.error('Failed to sync shopping item:', err);
          }
        }
        break;

      case 'SHOPPING_ITEM_DELETED':
        if (payload.deletedShoppingItemTitle) {
          try {
            const existing = await db.shoppingItems.where('title').equals(payload.deletedShoppingItemTitle).first();
            if (existing?.id) {
              await db.shoppingItems.delete(existing.id);
            }
          } catch (_) {}
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
   * Broadcast new or completed contraction
   */
  public broadcastContraction(contraction: Contraction) {
    this.broadcast({
      type: 'CONTRACTION_SYNC',
      senderRole: this.role,
      contraction
    });
  }

  /**
   * Broadcast deleted contraction
   */
  public broadcastDeletedContraction(startTime: number) {
    this.broadcast({
      type: 'CONTRACTION_DELETED',
      senderRole: this.role,
      deletedContractionStartTime: startTime
    });
  }

  /**
   * Broadcast bag item change (packed, quantity, added)
   */
  public broadcastBagItem(bagItem: BagItem) {
    this.broadcast({
      type: 'BAG_ITEM_SYNC',
      senderRole: this.role,
      bagItem
    });
  }

  /**
   * Broadcast deleted bag item
   */
  public broadcastDeletedBagItem(name: string) {
    this.broadcast({
      type: 'BAG_ITEM_DELETED',
      senderRole: this.role,
      deletedBagItemName: name
    });
  }

  /**
   * Broadcast shopping item change (bought, added, edited)
   */
  public broadcastShoppingItem(shoppingItem: ShoppingItem) {
    this.broadcast({
      type: 'SHOPPING_ITEM_SYNC',
      senderRole: this.role,
      shoppingItem
    });
  }

  /**
   * Broadcast deleted shopping item
   */
  public broadcastDeletedShoppingItem(title: string) {
    this.broadcast({
      type: 'SHOPPING_ITEM_DELETED',
      senderRole: this.role,
      deletedShoppingItemTitle: title
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

