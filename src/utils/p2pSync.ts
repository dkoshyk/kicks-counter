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
  
  // Callbacks & listeners
  private onLiveUpdateCb: ((state: LiveSessionState | null) => void) | null = null;
  private onStatusChangeCb: ((status: string, connectedCount: number) => void) | null = null;
  private onSessionReceivedCb: ((message: string) => void) | null = null;
  private sessionReceivedListeners: Set<(message: string) => void> = new Set();

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
   * Broadcast a toast notification to all listeners
   */
  public notifySessionReceived(message: string) {
    if (this.onSessionReceivedCb) {
      this.onSessionReceivedCb(message);
    }
    this.sessionReceivedListeners.forEach((listener) => {
      try {
        listener(message);
      } catch (_) {}
    });
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

        conn.on('open', async () => {
          this.setupConnection(conn);
          this.updateStatus('Підключено до мами 🟢', 1);

          if (this.reconnectInterval) {
            clearInterval(this.reconnectInterval);
            this.reconnectInterval = null;
          }

          // Request full history from Mom and send Dad's local wishlist & bag items
          try {
            const [localShopping, localBags, localContractions] = await Promise.all([
              db.shoppingItems.toArray(),
              db.bagItems.toArray(),
              db.contractions.toArray()
            ]);

            this.sendPayload(conn, {
              type: 'REQUEST_HISTORY',
              senderRole: 'slave',
              historyShoppingItems: localShopping,
              historyBagItems: localBags,
              historyContractions: localContractions
            });
          } catch (_) {
            this.sendPayload(conn, {
              type: 'REQUEST_HISTORY',
              senderRole: 'slave'
            });
          }

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
   * Safe DB merger for Shopping Items (Two-Way Mom <-> Dad)
   */
  public async syncShoppingItemIntoDb(si: ShoppingItem): Promise<{ action: 'added' | 'updated' | 'none'; title: string }> {
    if (!si.title || !si.title.trim()) return { action: 'none', title: '' };
    const cleanTitle = si.title.trim();

    try {
      let existing = await db.shoppingItems.where('title').equalsIgnoreCase(cleanTitle).first();
      if (!existing && si.url && si.url !== '#') {
        existing = await db.shoppingItems.where('url').equals(si.url).first();
      }

      if (existing?.id) {
        await db.shoppingItems.update(existing.id, {
          title: cleanTitle,
          isBought: Boolean(si.isBought),
          status: si.status || (si.isBought ? 'bought' : 'planned'),
          orderPlace: si.orderPlace !== undefined ? si.orderPlace : (existing.orderPlace || ''),
          depositAmount: typeof si.depositAmount === 'number' && !isNaN(si.depositAmount) ? si.depositAmount : existing.depositAmount,
          price: typeof si.price === 'number' && !isNaN(si.price) ? si.price : existing.price,
          currency: si.currency || existing.currency || 'UAH',
          imageUrl: si.imageUrl !== undefined ? si.imageUrl : existing.imageUrl,
          notes: si.notes !== undefined ? si.notes : (existing.notes || ''),
          priority: si.priority || existing.priority || 'medium',
          url: si.url || existing.url || '',
          domain: si.domain || existing.domain || '',
          description: si.description !== undefined ? si.description : existing.description
        });
        return { action: 'updated', title: cleanTitle };
      } else {
        await db.shoppingItems.add({
          url: si.url || '',
          domain: si.domain || '',
          title: cleanTitle,
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
        return { action: 'added', title: cleanTitle };
      }
    } catch (err) {
      console.error('Failed to sync shopping item into DB:', err);
      return { action: 'none', title: cleanTitle };
    }
  }

  /**
   * Safe DB merger for Hospital Bag Items (Two-Way Mom <-> Dad)
   */
  public async syncBagItemIntoDb(bi: BagItem): Promise<{ action: 'added' | 'updated' | 'none'; name: string }> {
    if (!bi.name || !bi.name.trim()) return { action: 'none', name: '' };
    const cleanName = bi.name.trim();

    try {
      const existing = await db.bagItems.where('name').equalsIgnoreCase(cleanName).first();
      if (existing?.id) {
        await db.bagItems.update(existing.id, {
          isPacked: Boolean(bi.isPacked),
          quantity: typeof bi.quantity === 'number' ? bi.quantity : (Number(bi.quantity) || 1),
          notes: bi.notes !== undefined ? bi.notes : existing.notes,
          bagId: typeof bi.bagId === 'number' ? bi.bagId : existing.bagId
        });
        return { action: 'updated', name: cleanName };
      } else {
        const bagIdNum = typeof bi.bagId === 'number' ? bi.bagId : (Number(bi.bagId) || 1);
        await db.bagItems.add({
          bagId: bagIdNum,
          name: cleanName,
          isPacked: Boolean(bi.isPacked),
          quantity: typeof bi.quantity === 'number' ? bi.quantity : (Number(bi.quantity) || 1),
          notes: bi.notes || undefined,
          order: typeof bi.order === 'number' ? bi.order : Date.now()
        });
        return { action: 'added', name: cleanName };
      }
    } catch (err) {
      console.error('Failed to sync bag item into DB:', err);
      return { action: 'none', name: cleanName };
    }
  }

  /**
   * Safe DB merger for Contractions (Two-Way Mom <-> Dad)
   */
  public async syncContractionIntoDb(c: Contraction): Promise<{ action: 'added' | 'updated' | 'none' }> {
    if (!c.startTime) return { action: 'none' };

    try {
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
        return { action: 'added' };
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
        return { action: 'updated' };
      }
      return { action: 'none' };
    } catch (err) {
      console.error('Failed to sync contraction into DB:', err);
      return { action: 'none' };
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
        // 1. If incoming request has local data from Slave (Dad), merge it into Master (Mom)
        if (payload.historyShoppingItems) {
          for (const si of payload.historyShoppingItems) {
            await this.syncShoppingItemIntoDb(si);
          }
        }
        if (payload.historyBagItems) {
          for (const bi of payload.historyBagItems) {
            await this.syncBagItemIntoDb(bi);
          }
        }
        if (payload.historyContractions) {
          for (const c of payload.historyContractions) {
            await this.syncContractionIntoDb(c);
          }
        }

        // 2. Fetch current master database and reply to Slave
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

          if (payload.historyShoppingItems && payload.historyShoppingItems.length > 0) {
            this.notifySessionReceived('Синхронізовано список покупок від тата! 🛒');
          }
        }
        break;

      case 'HISTORY_RESPONSE':
        {
          let addedSessionsCount = 0;

          // 1. Sync Kick Sessions (Mother to Father)
          if (this.role === 'slave' && payload.historySessions) {
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
                addedSessionsCount++;
              } catch (_) {}
            }
            await deduplicateSessions();
          }

          // 2. Sync Contractions (Two-Way)
          if (payload.historyContractions) {
            for (const c of payload.historyContractions) {
              await this.syncContractionIntoDb(c);
            }
          }

          // 3. Sync Hospital Bags (Two-Way)
          if (payload.historyBagItems) {
            for (const bi of payload.historyBagItems) {
              await this.syncBagItemIntoDb(bi);
            }
          }

          // 4. Sync Shopping Wishlist (Two-Way)
          if (payload.historyShoppingItems) {
            for (const si of payload.historyShoppingItems) {
              await this.syncShoppingItemIntoDb(si);
            }
          }

          const partnerLabel = payload.senderRole === 'master' ? 'мами' : 'тата';
          if (this.role === 'slave' && addedSessionsCount > 0) {
            this.notifySessionReceived(`Синхронізовано повні дані вагітності від ${partnerLabel}! 🌸`);
          } else if (payload.historyShoppingItems && payload.historyShoppingItems.length > 0) {
            this.notifySessionReceived(`Синхронізовано список покупок від ${partnerLabel}! 🛍️`);
          }
        }
        break;

      case 'CONTRACTION_SYNC':
        if (payload.contraction) {
          await this.syncContractionIntoDb(payload.contraction);

          // Relay to other peers if master
          if (this.role === 'master') {
            this.connections.forEach((c, peerId) => {
              if (peerId !== conn.peer) {
                this.sendPayload(c, payload);
              }
            });
          }

          const senderName = payload.senderRole === 'master' ? 'мами' : 'тата';
          this.notifySessionReceived(`⏱️ Оновлено перейми від ${senderName}!`);
        }
        break;

      case 'CONTRACTION_DELETED':
        if (payload.deletedContractionStartTime) {
          try {
            const c = await db.contractions
              .where('startTime')
              .equals(payload.deletedContractionStartTime)
              .first();
            if (c?.id) {
              await db.contractions.delete(c.id);
            }
          } catch (_) {}

          if (this.role === 'master') {
            this.connections.forEach((c, peerId) => {
              if (peerId !== conn.peer) {
                this.sendPayload(c, payload);
              }
            });
          }
        }
        break;

      case 'BAG_ITEM_SYNC':
        if (payload.bagItem) {
          await this.syncBagItemIntoDb(payload.bagItem);

          if (this.role === 'master') {
            this.connections.forEach((c, peerId) => {
              if (peerId !== conn.peer) {
                this.sendPayload(c, payload);
              }
            });
          }

          const senderName = payload.senderRole === 'master' ? 'Мама' : 'Тато';
          const bi = payload.bagItem;
          const statusText = bi.isPacked ? 'зібрав(ла) ✅' : 'зняв(ла) позначку 🎒';
          this.notifySessionReceived(`🎒 ${senderName} ${statusText} «${bi.name}»`);
        }
        break;

      case 'BAG_ITEM_DELETED':
        if (payload.deletedBagItemName) {
          try {
            const existing = await db.bagItems.where('name').equalsIgnoreCase(payload.deletedBagItemName.trim()).first();
            if (existing?.id) {
              await db.bagItems.delete(existing.id);
            }
          } catch (_) {}

          if (this.role === 'master') {
            this.connections.forEach((c, peerId) => {
              if (peerId !== conn.peer) {
                this.sendPayload(c, payload);
              }
            });
          }

          const senderName = payload.senderRole === 'master' ? 'Мама' : 'Тато';
          this.notifySessionReceived(`🗑️ ${senderName} видалив(ла) «${payload.deletedBagItemName}» із сумок`);
        }
        break;

      case 'SHOPPING_ITEM_SYNC':
        if (payload.shoppingItem) {
          const res = await this.syncShoppingItemIntoDb(payload.shoppingItem);

          // Relay to other peers if master
          if (this.role === 'master') {
            this.connections.forEach((c, peerId) => {
              if (peerId !== conn.peer) {
                this.sendPayload(c, payload);
              }
            });
          }

          const senderName = payload.senderRole === 'master' ? 'Мама' : 'Тато';
          const si = payload.shoppingItem;
          let statusDesc = '';
          if (si.status === 'bought' || si.isBought) {
            statusDesc = ' (Куплено 🎉)';
          } else if (si.status === 'ordered') {
            statusDesc = ' (Замовлено 🚚)';
          } else if (si.status === 'planned') {
            statusDesc = ' (У планах 📝)';
          }

          const actionVerb = res.action === 'added' ? 'додав(ла)' : 'оновив(ла)';
          this.notifySessionReceived(`🛍️ ${senderName} ${actionVerb} «${si.title}»${statusDesc}`);
        }
        break;

      case 'SHOPPING_ITEM_DELETED':
        if (payload.deletedShoppingItemTitle) {
          try {
            const cleanTitle = payload.deletedShoppingItemTitle.trim();
            const existing = await db.shoppingItems.where('title').equalsIgnoreCase(cleanTitle).first();
            if (existing?.id) {
              await db.shoppingItems.delete(existing.id);
            }
          } catch (_) {}

          if (this.role === 'master') {
            this.connections.forEach((c, peerId) => {
              if (peerId !== conn.peer) {
                this.sendPayload(c, payload);
              }
            });
          }

          const senderName = payload.senderRole === 'master' ? 'Мама' : 'Тато';
          this.notifySessionReceived(`🗑️ ${senderName} видалив(ла) «${payload.deletedShoppingItemTitle}»`);
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
   * Request manual sync from either Master or Slave side (Two-Way)
   */
  public async requestManualSync() {
    const [localShopping, localBags, localContractions] = await Promise.all([
      db.shoppingItems.toArray(),
      db.bagItems.toArray(),
      db.contractions.toArray()
    ]);

    if (this.role === 'slave') {
      this.connections.forEach((conn) => {
        this.sendPayload(conn, {
          type: 'REQUEST_HISTORY',
          senderRole: 'slave',
          historyShoppingItems: localShopping,
          historyBagItems: localBags,
          historyContractions: localContractions
        });
      });
    } else if (this.role === 'master') {
      const completedSessions = await db.sessions.where('status').equals('completed').toArray();
      this.connections.forEach((conn) => {
        this.sendPayload(conn, {
          type: 'HISTORY_RESPONSE',
          senderRole: 'master',
          historySessions: completedSessions,
          historyContractions: localContractions,
          historyBagItems: localBags,
          historyShoppingItems: localShopping
        });
      });
    }
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

  public addSessionReceivedListener(cb: (message: string) => void) {
    this.sessionReceivedListeners.add(cb);
  }

  public removeSessionReceivedListener(cb: (message: string) => void) {
    this.sessionReceivedListeners.delete(cb);
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

