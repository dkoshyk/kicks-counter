import Dexie, { type Table } from 'dexie';

export interface Session {
  id?: number;
  startTime: number; // Timestamp in milliseconds
  endTime?: number;  // Timestamp in milliseconds
  kickCount: number;
  targetKicks: number;
  status: 'active' | 'completed' | 'cancelled';
  note?: string;
}

export interface Kick {
  id?: number;
  sessionId: number;
  timestamp: number; // Timestamp in milliseconds
}

export interface Contraction {
  id?: number;
  startTime: number;       // Timestamp початку перейми (ms)
  endTime?: number;        // Timestamp кінця перейми (ms)
  duration: number;        // Тривалість у секундах
  interval?: number;       // Секунди від початку попередньої перейми
  restDuration?: number;   // Секунди від кінця попередньої перейми
  intensity?: 'mild' | 'moderate' | 'strong';
  notes?: string;
  isFalseAlarm?: boolean;
}

export interface HospitalBag {
  id?: number;
  name: string;        // 'Сумка на пологи (в родзал) — M', 'Післяпологова для мами — L', 'Післяпологова для малюка — S'
  code: string;        // 'labor', 'mom', 'baby'
  size: 'M' | 'L' | 'S';
  icon: string;
  color: string;
  order: number;
}

export interface BagItem {
  id?: number;
  bagId: number;
  name: string;
  quantity: number;
  unit?: string;
  isPacked: boolean;
  notes?: string;
  shoppingUrl?: string;
  order: number;
}

export interface ShoppingItem {
  id?: number;
  url: string;
  domain: string;
  title: string;
  description?: string;
  imageUrl?: string;
  price?: number;
  currency: string;
  isBought: boolean;
  status?: 'planned' | 'ordered' | 'bought'; // 'planned' (планується), 'ordered' (замовлено/в дорозі), 'bought' (куплено/отримано)
  orderPlace?: string;                       // Де замовлено: напр. "Instagram @shop", "Rozetka", "Епіцентр"
  depositAmount?: number;                    // Сума завдатку / передоплати
  priority: 'high' | 'medium' | 'low';
  category?: string;
  linkedBagItemId?: number;
  notes?: string;
  createdAt: number;
}

export interface BackupData {
  version: number;
  appName: string;
  exportedAt: string;
  sessions: Session[];
  kicks: Kick[];
  contractions?: Contraction[];
  hospitalBags?: HospitalBag[];
  bagItems?: BagItem[];
  shoppingItems?: ShoppingItem[];
}

export class KickCounterDB extends Dexie {
  sessions!: Table<Session>;
  kicks!: Table<Kick>;
  contractions!: Table<Contraction>;
  hospitalBags!: Table<HospitalBag>;
  bagItems!: Table<BagItem>;
  shoppingItems!: Table<ShoppingItem>;

  constructor() {
    super('KickCounterDB');
    this.version(1).stores({
      sessions: '++id, startTime, endTime, kickCount, targetKicks, status, note',
      kicks: '++id, sessionId, timestamp'
    });

    this.version(2).stores({
      sessions: '++id, startTime, endTime, kickCount, targetKicks, status, note',
      kicks: '++id, sessionId, timestamp',
      contractions: '++id, startTime, endTime, duration, interval, intensity',
      hospitalBags: '++id, name, code, size, order',
      bagItems: '++id, bagId, name, isPacked, order',
      shoppingItems: '++id, url, domain, title, isBought, priority, createdAt'
    });
  }
}

export const db = new KickCounterDB();

/**
 * Starts a new kick counting session
 */
export async function startSession(targetKicks = 10): Promise<number> {
  const now = Date.now();
  const sessionId = await db.sessions.add({
    startTime: now,
    kickCount: 0,
    targetKicks,
    status: 'active'
  });
  return sessionId as number;
}

/**
 * Records a single kick in the current session
 */
export async function recordKick(sessionId: number): Promise<{ count: number; reachedGoal: boolean }> {
  const session = await db.sessions.get(sessionId);
  if (!session || session.status !== 'active') {
    throw new Error('Active session not found');
  }

  const now = Date.now();
  await db.kicks.add({
    sessionId,
    timestamp: now
  });

  const newCount = session.kickCount + 1;
  const reachedGoal = newCount >= session.targetKicks;

  await db.sessions.update(sessionId, {
    kickCount: newCount
  });

  return { count: newCount, reachedGoal };
}

/**
 * Removes the most recent kick in the session
 */
export async function undoKick(sessionId: number): Promise<number> {
  const session = await db.sessions.get(sessionId);
  if (!session) return 0;

  // Find the last kick for this session
  const lastKick = await db.kicks
    .where('sessionId')
    .equals(sessionId)
    .reverse()
    .sortBy('timestamp')
    .then(kicks => kicks[0]);

  if (lastKick && lastKick.id) {
    await db.kicks.delete(lastKick.id);
    const newCount = Math.max(0, session.kickCount - 1);
    await db.sessions.update(sessionId, {
      kickCount: newCount
    });
    return newCount;
  }

  return session.kickCount;
}

/**
 * Finishes a session (completed or manual finish) with an optional note
 */
export async function finishSession(sessionId: number, note?: string): Promise<void> {
  const session = await db.sessions.get(sessionId);
  if (!session) return;

  await db.sessions.update(sessionId, {
    endTime: Date.now(),
    status: 'completed',
    note: note?.trim() || session.note || undefined
  });
}

/**
 * Cancels an active session
 */
export async function cancelSession(sessionId: number): Promise<void> {
  const session = await db.sessions.get(sessionId);
  if (!session) return;

  await db.sessions.update(sessionId, {
    endTime: Date.now(),
    status: 'cancelled'
  });
}

/**
 * Adds a manual past session with date, start time, duration, kick count and note
 */
export async function addManualSession(params: {
  dateStr: string; // YYYY-MM-DD
  timeStr: string; // HH:MM
  durationMinutes: number;
  kickCount: number;
  targetKicks: number;
  note?: string;
}): Promise<number> {
  const { dateStr, timeStr, durationMinutes, kickCount, targetKicks, note } = params;

  // Parse YYYY-MM-DD and HH:MM into timestamp
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);

  const startTimestamp = new Date(year, month - 1, day, hours, minutes).getTime();
  const endTimestamp = startTimestamp + durationMinutes * 60 * 1000;

  return await db.transaction('rw', db.sessions, db.kicks, async () => {
    const sessionId = await db.sessions.add({
      startTime: startTimestamp,
      endTime: endTimestamp,
      kickCount,
      targetKicks,
      status: 'completed',
      note: note?.trim() || undefined
    });

    // Evenly distribute kick timestamps across duration
    if (kickCount > 0) {
      const stepMs = (durationMinutes * 60 * 1000) / (kickCount + 1);
      for (let i = 1; i <= kickCount; i++) {
        await db.kicks.add({
          sessionId: sessionId as number,
          timestamp: Math.round(startTimestamp + i * stepMs)
        });
      }
    }

    return sessionId as number;
  });
}

/**
 * Deletes a session and its associated kicks
 */
export async function deleteSession(sessionId: number): Promise<void> {
  await db.transaction('rw', db.sessions, db.kicks, async () => {
    await db.kicks.where('sessionId').equals(sessionId).delete();
    await db.sessions.delete(sessionId);
  });
}

/**
 * Clears all data from the database
 */
export async function clearAllData(): Promise<void> {
  await db.transaction('rw', db.sessions, db.kicks, async () => {
    await db.kicks.clear();
    await db.sessions.clear();
  });
}

/**
 * Deduplicates sessions in local IndexedDB database by identifying entries
 * with identical or near-identical start times (within 60s) and matching kick counts.
 */
export async function deduplicateSessions(): Promise<number> {
  return await db.transaction('rw', db.sessions, db.kicks, async () => {
    const allSessions = await db.sessions.toArray();
    allSessions.sort((a, b) => a.startTime - b.startTime);
    const toDeleteIds: number[] = [];
    const seen: Session[] = [];

    for (const session of allSessions) {
      if (!session.id) continue;
      
      const duplicate = seen.find(s => 
        Math.abs(s.startTime - session.startTime) < 60000 &&
        s.kickCount === session.kickCount
      );

      if (duplicate) {
        toDeleteIds.push(session.id);
      } else {
        seen.push(session);
      }
    }

    for (const id of toDeleteIds) {
      await db.kicks.where('sessionId').equals(id).delete();
      await db.sessions.delete(id);
    }

    return toDeleteIds.length;
  });
}

/**
 * Formats duration in milliseconds into a readable Ukrainian string (e.g. "12 хв 45 с")
 */
export function formatDuration(durationMs: number): string {
  if (durationMs < 0) return '0 с';
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours} год ${minutes} хв`;
  }
  if (minutes > 0) {
    return `${minutes} хв ${seconds} с`;
  }
  return `${seconds} с`;
}

/**
 * Exports all completed/logged sessions to a UTF-8 CSV with Ukrainian headers
 */
export async function exportCSV(): Promise<string> {
  const sessions = await db.sessions
    .where('status')
    .equals('completed')
    .sortBy('startTime');

  const headers = ['Дата', 'Початок', 'Тривалість', 'Кількість поштовхів', 'Нотатка'];
  
  const rows = sessions.map(session => {
    const startDate = new Date(session.startTime);
    const dateStr = startDate.toLocaleDateString('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    const timeStr = startDate.toLocaleTimeString('uk-UA', {
      hour: '2-digit',
      minute: '2-digit'
    });
    const duration = session.endTime ? formatDuration(session.endTime - session.startTime) : '-';
    const noteStr = session.note ? `"${session.note.replace(/"/g, '""')}"` : '';

    return [dateStr, timeStr, duration, session.kickCount, noteStr].join(',');
  });

  // \uFEFF is UTF-8 Byte Order Mark for Excel compatibility
  const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
  return csvContent;
}

/**
 * Exports all DB data (sessions, kicks, contractions, hospital bags, shopping) as JSON backup file string
 */
export async function exportBackupJSON(): Promise<string> {
  const sessions = await db.sessions.toArray();
  const kicks = await db.kicks.toArray();
  const contractions = await db.contractions.toArray();
  const hospitalBags = await db.hospitalBags.toArray();
  const bagItems = await db.bagItems.toArray();
  const shoppingItems = await db.shoppingItems.toArray();

  const backup: BackupData = {
    version: 2,
    appName: 'Поштовхи',
    exportedAt: new Date().toISOString(),
    sessions,
    kicks,
    contractions,
    hospitalBags,
    bagItems,
    shoppingItems
  };

  return JSON.stringify(backup, null, 2);
}

/**
 * Imports backup JSON data into IndexedDB
 */
export async function importBackupJSON(
  jsonContent: string,
  mode: 'replace' | 'merge' = 'replace'
): Promise<{ importedSessionsCount: number; importedKicksCount: number }> {
  const data: BackupData = JSON.parse(jsonContent);

  if (!data || !Array.isArray(data.sessions) || !Array.isArray(data.kicks)) {
    throw new Error('Невалідний формат файлу резервної копії');
  }

  return await db.transaction(
    'rw',
    [db.sessions, db.kicks, db.contractions, db.hospitalBags, db.bagItems, db.shoppingItems],
    async () => {
      if (mode === 'replace') {
        await db.sessions.clear();
        await db.kicks.clear();
        if (data.contractions) await db.contractions.clear();
        if (data.hospitalBags) await db.hospitalBags.clear();
        if (data.bagItems) await db.bagItems.clear();
        if (data.shoppingItems) await db.shoppingItems.clear();
      }

      let importedSessions = 0;
      let importedKicks = 0;

      for (const session of data.sessions) {
        const oldId = session.id;
        const { id: _, ...sessionData } = session;

        // Add session to DB
        const newSessionId = await db.sessions.add(sessionData as Session);
        importedSessions++;

        // Find kicks belonging to this session
        const matchingKicks = data.kicks.filter(k => k.sessionId === oldId);
        for (const kick of matchingKicks) {
          const { id: __, ...kickData } = kick;
          await db.kicks.add({
            ...kickData,
            sessionId: newSessionId as number
          });
          importedKicks++;
        }
      }

      // Import contractions
      if (data.contractions && Array.isArray(data.contractions)) {
        for (const c of data.contractions) {
          const { id: _, ...cData } = c;
          await db.contractions.add(cData as Contraction);
        }
      }

      // Import bags & bagItems
      if (data.hospitalBags && Array.isArray(data.hospitalBags)) {
        for (const b of data.hospitalBags) {
          const oldBagId = b.id;
          const { id: _, ...bagData } = b;
          const newBagId = (await db.hospitalBags.add(bagData as HospitalBag)) as number;

          if (data.bagItems && Array.isArray(data.bagItems)) {
            const matchingItems = data.bagItems.filter(i => i.bagId === oldBagId);
            for (const item of matchingItems) {
              const { id: __, ...itemData } = item;
              await db.bagItems.add({
                ...itemData,
                bagId: newBagId
              } as BagItem);
            }
          }
        }
      }

      // Import shopping items
      if (data.shoppingItems && Array.isArray(data.shoppingItems)) {
        for (const s of data.shoppingItems) {
          const { id: _, ...sData } = s;
          await db.shoppingItems.add(sData as ShoppingItem);
        }
      }

      return { importedSessionsCount: importedSessions, importedKicksCount: importedKicks };
    }
  );
}

// ==========================================
// CONTRACTIONS (ПЕРЕЙМИ) HELPERS
// ==========================================

/**
 * Starts recording a contraction
 */
export async function startContraction(): Promise<number> {
  const now = Date.now();
  const lastContraction = await db.contractions.orderBy('startTime').last();

  let interval: number | undefined;
  let restDuration: number | undefined;

  if (lastContraction) {
    interval = Math.max(0, Math.floor((now - lastContraction.startTime) / 1000));
    if (lastContraction.endTime) {
      restDuration = Math.max(0, Math.floor((now - lastContraction.endTime) / 1000));
    }
  }

  const id = await db.contractions.add({
    startTime: now,
    duration: 0,
    interval,
    restDuration,
    intensity: 'moderate'
  });

  return id as number;
}

/**
 * Stops an active contraction
 */
export async function stopContraction(
  id: number,
  intensity?: 'mild' | 'moderate' | 'strong',
  notes?: string,
  isFalseAlarm?: boolean
): Promise<void> {
  const contraction = await db.contractions.get(id);
  if (!contraction) return;

  const now = Date.now();
  const duration = Math.max(1, Math.floor((now - contraction.startTime) / 1000));

  await db.contractions.update(id, {
    endTime: now,
    duration,
    intensity: intensity || contraction.intensity || 'moderate',
    notes: notes?.trim() || undefined,
    ...(isFalseAlarm !== undefined ? { isFalseAlarm } : {})
  });
}

/**
 * Adds a manual contraction entry
 */
export async function addManualContraction(params: {
  startTime: number;
  durationSeconds: number;
  intensity?: 'mild' | 'moderate' | 'strong';
  notes?: string;
  isFalseAlarm?: boolean;
}): Promise<number> {
  const endTime = params.startTime + params.durationSeconds * 1000;
  
  // Find nearest earlier contraction for interval calculation
  const previous = await db.contractions
    .where('startTime')
    .below(params.startTime)
    .reverse()
    .sortBy('startTime')
    .then(res => res[0]);

  let interval: number | undefined;
  let restDuration: number | undefined;

  if (previous) {
    interval = Math.max(0, Math.floor((params.startTime - previous.startTime) / 1000));
    if (previous.endTime) {
      restDuration = Math.max(0, Math.floor((params.startTime - previous.endTime) / 1000));
    }
  }

  const id = await db.contractions.add({
    startTime: params.startTime,
    endTime,
    duration: params.durationSeconds,
    interval,
    restDuration,
    intensity: params.intensity || 'moderate',
    notes: params.notes?.trim() || undefined,
    isFalseAlarm: params.isFalseAlarm
  });

  return id as number;
}

export async function updateContraction(id: number, changes: Partial<Contraction>): Promise<void> {
  await db.contractions.update(id, changes);
}

export async function deleteContraction(id: number): Promise<void> {
  await db.contractions.delete(id);
}

export async function clearAllContractions(): Promise<void> {
  await db.contractions.clear();
}

/**
 * Exports contractions to CSV
 */
export async function exportContractionsCSV(): Promise<string> {
  const list = await db.contractions.orderBy('startTime').toArray();
  const headers = ['Дата', 'Час початку', 'Тривалість (сек)', 'Інтервал (хв)', 'Інтенсивність', 'Тип перейми', 'Нотатки'];

  const rows = list.map(c => {
    const d = new Date(c.startTime);
    const dateStr = d.toLocaleDateString('uk-UA');
    const timeStr = d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const duration = `${c.duration} с`;
    const interval = c.interval ? `${Math.floor(c.interval / 60)} хв ${c.interval % 60} с` : '-';
    const intensityMap = { mild: 'Легка', moderate: 'Середня', strong: 'Сильна' };
    const intensity = c.intensity ? intensityMap[c.intensity] : '-';
    const typeStr = c.isFalseAlarm ? 'Хибна (Брекстон-Гікс)' : 'Справжня';
    const note = c.notes ? `"${c.notes.replace(/"/g, '""')}"` : '';

    return [dateStr, timeStr, duration, interval, intensity, typeStr, note].join(',');
  });

  return '\uFEFF' + [headers.join(','), ...rows].join('\n');
}

// ==========================================
// HOSPITAL BAGS (СУМКИ В ПОЛОГОВИЙ) HELPERS
// ==========================================

export const DEFAULT_BAGS: Array<{
  name: string;
  code: string;
  size: 'M' | 'L' | 'S';
  icon: string;
  color: string;
  order: number;
  items: Array<{ name: string; quantity: number; unit?: string; notes?: string }>;
}> = [
  {
    name: 'Сумка на пологи (в родзал) — M',
    code: 'labor',
    size: 'M',
    icon: 'Sparkles',
    color: 'from-amber-500 to-rose-500',
    order: 1,
    items: [
      { name: 'Документи (паспорт, код, обмінна карта, поліс/договір)', quantity: 1, unit: 'пакет', notes: 'Зверху або в окремій кишені' },
      { name: 'Пляшка води (1.5 л)', quantity: 1, unit: 'шт', notes: 'Бажано зі спортивним носиком' },
      { name: 'Гумові миючі капці', quantity: 1, unit: 'пара' },
      { name: 'Нічна сорочка №1 для пологів', quantity: 1, unit: 'шт' },
      { name: 'Шкарпетки', quantity: 1, unit: 'пара', notes: 'Теплі бавовняні' },
      { name: 'Зволожуючий бальзам для губ', quantity: 1, unit: 'шт' },
      { name: 'Паперові рушники', quantity: 1, unit: 'рулон' },
      { name: 'Одноразові пелюшки 60×90', quantity: 8, unit: 'шт', notes: '5–10 шт у родзал' },
      { name: 'Перший комплект дитячого одягу', quantity: 1, unit: 'компл', notes: 'Бодік, чоловічок, шапочка, шкарпетки' },
      { name: 'Дитячий пледик', quantity: 1, unit: 'шт' },
      { name: 'Тканинні пелюшки (ситцева + байкова)', quantity: 2, unit: 'шт' },
      { name: 'Підгузки для новонародженого', quantity: 3, unit: 'шт', notes: 'Розмір 0 або 1' },
      { name: 'Дитячі вологі серветки', quantity: 1, unit: 'уп' }
    ]
  },
  {
    name: 'Післяпологова для мами — L',
    code: 'mom',
    size: 'L',
    icon: 'Heart',
    color: 'from-rose-500 to-pink-500',
    order: 2,
    items: [
      { name: 'Халат для палати', quantity: 1, unit: 'шт' },
      { name: 'Друга нічна сорочка для годування', quantity: 1, unit: 'шт' },
      { name: 'Великий банний рушник для душу', quantity: 1, unit: 'шт' },
      { name: 'Рушник для рук та обличчя', quantity: 1, unit: 'шт' },
      { name: 'Одноразові пелюшки 60×90 (основний запас)', quantity: 12, unit: 'шт', notes: 'Основний запас із пачки' },
      { name: 'Післяпологові/урологічні прокладки', quantity: 20, unit: 'шт', notes: 'Максимальне поглинання' },
      { name: 'Одноразові трусики-сіточка', quantity: 5, unit: 'шт' },
      { name: 'Звичайні мʼякі капці та шкарпетки', quantity: 2, unit: 'пари' },
      { name: 'Бюстгальтери для годування', quantity: 2, unit: 'шт' },
      { name: 'Одноразові лактаційні прокладки для грудей', quantity: 1, unit: 'уп' },
      { name: 'Крем для сосків (100% чистий ланолін, Purelan)', quantity: 1, unit: 'тюбик' },
      { name: 'Засоби гігієни (паста, щітка, шампунь, гель, гребінець)', quantity: 1, unit: 'набір' },
      { name: 'Вологий туалетний папір', quantity: 1, unit: 'уп' },
      { name: 'Особистий посуд (чашка, ложка, тарілка)', quantity: 1, unit: 'набір' },
      { name: 'Залишок паперових рушників', quantity: 1, unit: 'рулон' },
      { name: 'Зарядні пристрої та подовжувач', quantity: 1, unit: 'компл' }
    ]
  },
  {
    name: 'Післяпологова для малюка — S',
    code: 'baby',
    size: 'S',
    icon: 'Baby',
    color: 'from-sky-500 to-indigo-500',
    order: 3,
    items: [
      { name: 'Змінні комплекти одягу на 3–4 доби', quantity: 4, unit: 'компл', notes: 'Випрані дитячим засобом та попрасовані' },
      { name: 'Тканинні пелюшки ситцеві', quantity: 4, unit: 'шт' },
      { name: 'Тканинні пелюшки байкові', quantity: 4, unit: 'шт' },
      { name: 'Основний запас підгузків (розмір 1)', quantity: 1, unit: 'пачка', notes: '24–40 шт' },
      { name: 'Залишок вологих серветок для немовлят', quantity: 1, unit: 'пачка', notes: 'На водній основі 99% води' },
      { name: 'Електронний термометр із мʼяким кінцем', quantity: 1, unit: 'шт' },
      { name: 'Стерильна вата та ватні диски', quantity: 1, unit: 'уп' },
      { name: 'Дитячі ножиці з закругленими кінчиками', quantity: 1, unit: 'шт' },
      { name: 'Крем під підгузок із цинком', quantity: 1, unit: 'шт' }
    ]
  }
];

/**
 * Populates initial default hospital bags if empty or deduplicates them
 */
export async function seedDefaultBags(): Promise<void> {
  await db.transaction('rw', db.hospitalBags, db.bagItems, async () => {
    const existingBags = await db.hospitalBags.toArray();

    // If there are duplicate bags with identical codes, keep only the first one and reassign or clean items
    if (existingBags.length > 3) {
      const seenCodes = new Set<string>();
      const bagsToKeep: HospitalBag[] = [];
      const bagsToDeleteIds: number[] = [];

      for (const b of existingBags) {
        if (!b.id) continue;
        if (seenCodes.has(b.code)) {
          bagsToDeleteIds.push(b.id);
        } else {
          seenCodes.add(b.code);
          bagsToKeep.push(b);
        }
      }

      for (const delId of bagsToDeleteIds) {
        await db.bagItems.where('bagId').equals(delId).delete();
        await db.hospitalBags.delete(delId);
      }
      return;
    }

    if (existingBags.length > 0) return;

    for (const bag of DEFAULT_BAGS) {
      const { items, ...bagData } = bag;
      const bagId = (await db.hospitalBags.add(bagData)) as number;

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        await db.bagItems.add({
          bagId,
          name: it.name,
          quantity: it.quantity,
          unit: it.unit,
          isPacked: false,
          notes: it.notes,
          order: i + 1
        });
      }
    }
  });
}

/**
 * Resets hospital bags to standard template
 */
export async function resetBagsToDefault(): Promise<void> {
  await db.transaction('rw', db.hospitalBags, db.bagItems, async () => {
    await db.bagItems.clear();
    await db.hospitalBags.clear();
    for (const bag of DEFAULT_BAGS) {
      const { items, ...bagData } = bag;
      const bagId = (await db.hospitalBags.add(bagData)) as number;

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        await db.bagItems.add({
          bagId,
          name: it.name,
          quantity: it.quantity,
          unit: it.unit,
          isPacked: false,
          notes: it.notes,
          order: i + 1
        });
      }
    }
  });
}

export async function toggleBagItemPacked(itemId: number): Promise<boolean> {
  const item = await db.bagItems.get(itemId);
  if (!item) return false;
  const next = !item.isPacked;
  await db.bagItems.update(itemId, { isPacked: next });
  return next;
}

export async function addBagItem(item: Omit<BagItem, 'id'>): Promise<number> {
  const id = await db.bagItems.add(item);
  return id as number;
}

export async function updateBagItem(id: number, changes: Partial<BagItem>): Promise<void> {
  await db.bagItems.update(id, changes);
}

export async function deleteBagItem(id: number): Promise<void> {
  await db.bagItems.delete(id);
}

// ==========================================
// SHOPPING ITEMS (ПОКУПКИ) HELPERS
// ==========================================

export async function addShoppingItem(item: Omit<ShoppingItem, 'id' | 'createdAt'>): Promise<number> {
  const id = await db.shoppingItems.add({
    ...item,
    createdAt: Date.now()
  });
  return id as number;
}

export async function toggleShoppingItemBought(id: number): Promise<boolean> {
  const item = await db.shoppingItems.get(id);
  if (!item) return false;
  const next = !item.isBought;
  await db.shoppingItems.update(id, { isBought: next });
  return next;
}

export async function updateShoppingItem(id: number, changes: Partial<ShoppingItem>): Promise<void> {
  await db.shoppingItems.update(id, changes);
}

export async function deleteShoppingItem(id: number): Promise<void> {
  await db.shoppingItems.delete(id);
}
