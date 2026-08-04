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

export interface BackupData {
  version: number;
  appName: string;
  exportedAt: string;
  sessions: Session[];
  kicks: Kick[];
}

export class KickCounterDB extends Dexie {
  sessions!: Table<Session>;
  kicks!: Table<Kick>;

  constructor() {
    super('KickCounterDB');
    this.version(1).stores({
      sessions: '++id, startTime, endTime, kickCount, targetKicks, status, note',
      kicks: '++id, sessionId, timestamp'
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
 * Exports all DB data (sessions and kicks) as JSON backup file string
 */
export async function exportBackupJSON(): Promise<string> {
  const sessions = await db.sessions.toArray();
  const kicks = await db.kicks.toArray();

  const backup: BackupData = {
    version: 1,
    appName: 'Поштовхи',
    exportedAt: new Date().toISOString(),
    sessions,
    kicks
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

  return await db.transaction('rw', db.sessions, db.kicks, async () => {
    if (mode === 'replace') {
      await db.sessions.clear();
      await db.kicks.clear();
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

    return { importedSessionsCount: importedSessions, importedKicksCount: importedKicks };
  });
}
