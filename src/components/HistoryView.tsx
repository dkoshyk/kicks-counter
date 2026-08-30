import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, deleteSession, addManualSession, formatDuration, type Session } from '../db';
import { p2pSyncManager } from '../utils/p2pSync';
import { Calendar, Clock, Trash2, Tag, ChevronRight, CheckCircle2, XCircle, Plus, X, ArrowLeft } from 'lucide-react';

interface HistoryViewProps {
  onBack?: () => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({ onBack }) => {
  const [filter, setFilter] = useState<'all' | 'completed' | 'cancelled'>('all');
  const [expandedSessionId, setExpandedSessionId] = useState<number | null>(null);
  const [showManualModal, setShowManualModal] = useState<boolean>(false);

  // Form state for manual session
  const getTodayISO = () => new Date().toISOString().slice(0, 10);
  const [manualDate, setManualDate] = useState<string>(getTodayISO());
  const [manualTime, setManualTime] = useState<string>('14:00');
  const [manualDuration, setManualDuration] = useState<number>(20);
  const [manualKickCount, setManualKickCount] = useState<number>(10);
  const [manualTarget, setManualTarget] = useState<number>(10);
  const [manualNote, setManualNote] = useState<string>('');

  // Fetch all completed/cancelled sessions sorted by startTime desc
  const sessions = useLiveQuery(async () => {
    let collection = db.sessions.where('status').notEqual('active');
    if (filter === 'completed') {
      collection = db.sessions.where('status').equals('completed');
    } else if (filter === 'cancelled') {
      collection = db.sessions.where('status').equals('cancelled');
    }
    return await collection.reverse().sortBy('startTime');
  }, [filter]);

  // Fetch kicks for expanded session
  const expandedKicks = useLiveQuery(async () => {
    if (!expandedSessionId) return [];
    return await db.kicks
      .where('sessionId')
      .equals(expandedSessionId)
      .sortBy('timestamp');
  }, [expandedSessionId]);

  const handleDelete = async (e: React.MouseEvent, id?: number) => {
    e.stopPropagation();
    if (!id) return;
    if (window.confirm('Видалити запис цієї сесії з історії?')) {
      try {
        const sess = await db.sessions.get(id);
        if (sess) {
          p2pSyncManager.broadcastDeletedSession(sess.startTime);
        }
      } catch (_) {}
      await deleteSession(id);
    }
  };

  const handleSaveManualSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualDate || !manualTime) {
      alert('Будь ласка, вкажіть дату та час');
      return;
    }

    try {
      await addManualSession({
        dateStr: manualDate,
        timeStr: manualTime,
        durationMinutes: Number(manualDuration) || 20,
        kickCount: Number(manualKickCount) || 10,
        targetKicks: Number(manualTarget) || 10,
        note: manualNote
      });

      setShowManualModal(false);
      setManualNote('');
    } catch (err) {
      console.error(err);
      alert('Помилка при збереженні сесії');
    }
  };

  const formatDayGroupHeader = (timestamp: number) => {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Сьогодні';
    }
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Учора';
    }
    return date.toLocaleDateString('uk-UA', {
      day: 'numeric',
      month: 'long',
      year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
    });
  };

  // Group sessions by date string
  const groupedSessions = sessions ? sessions.reduce((acc, session) => {
    const header = formatDayGroupHeader(session.startTime);
    if (!acc[header]) acc[header] = [];
    acc[header].push(session);
    return acc;
  }, {} as Record<string, Session[]>) : {};

  return (
    <div className="w-full max-w-md mx-auto pb-8 px-4 space-y-6">
      {/* Header & Actions */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="p-1.5 -ml-1 text-gray-500 hover:text-gray-900 dark:hover:text-white rounded-xl hover:bg-gray-100 dark:hover:bg-zinc-800 transition"
                title="Назад до відліку"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center">
              <Calendar className="w-5 h-5 text-rose-500 mr-2" />
              Історія сесій
            </h2>
          </div>

          <button
            type="button"
            onClick={() => setShowManualModal(true)}
            className="px-3 py-1.5 bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold rounded-xl shadow-sm shadow-rose-500/20 active:scale-95 transition-all flex items-center space-x-1"
          >
            <Plus className="w-4 h-4" />
            <span>Додати вручну</span>
          </button>
        </div>

        {/* Filter pill selector */}
        <div className="flex bg-gray-200 dark:bg-zinc-800 p-1 rounded-xl text-xs font-semibold w-fit">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-3 py-1 rounded-lg transition-all ${
              filter === 'all'
                ? 'bg-white dark:bg-zinc-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            Усі
          </button>
          <button
            type="button"
            onClick={() => setFilter('completed')}
            className={`px-3 py-1 rounded-lg transition-all ${
              filter === 'completed'
                ? 'bg-white dark:bg-zinc-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            Успішні
          </button>
        </div>
      </div>

      {/* Empty State */}
      {(!sessions || sessions.length === 0) && (
        <div className="bg-white dark:bg-[#1C1C1E] p-8 rounded-3xl text-center space-y-3 border border-gray-100 dark:border-zinc-800/80 my-8">
          <div className="w-12 h-12 mx-auto rounded-full bg-rose-50 dark:bg-rose-950/40 flex items-center justify-center text-rose-400">
            <Clock className="w-6 h-6" />
          </div>
          <h3 className="font-semibold text-gray-800 dark:text-gray-200">
            Записів поки немає
          </h3>
          <p className="text-xs text-gray-400 dark:text-gray-500 max-w-xs mx-auto">
            Ви можете завершити активну сесію або додати записи за минулі дні вручну.
          </p>
          <button
            type="button"
            onClick={() => setShowManualModal(true)}
            className="px-4 py-2 bg-rose-500 text-white text-xs font-bold rounded-xl shadow-sm active:scale-95 transition-all inline-flex items-center space-x-1"
          >
            <Plus className="w-4 h-4 mr-1" />
            Додати перший запис
          </button>
        </div>
      )}

      {/* Grouped Sessions List */}
      {Object.entries(groupedSessions).map(([groupTitle, groupItems]) => (
        <div key={groupTitle} className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 px-1">
            {groupTitle}
          </h3>

          <div className="space-y-2.5">
            {groupItems.map((session) => {
              const startDate = new Date(session.startTime);
              const timeStr = startDate.toLocaleTimeString('uk-UA', {
                hour: '2-digit',
                minute: '2-digit'
              });
              const durationStr = session.endTime
                ? formatDuration(session.endTime - session.startTime)
                : '-';
              const isExpanded = expandedSessionId === session.id;

              return (
                <div
                  key={session.id}
                  onClick={() => setExpandedSessionId(isExpanded ? null : session.id || null)}
                  className="bg-white dark:bg-[#1C1C1E] p-4 rounded-2xl border border-gray-100 dark:border-zinc-800/80 shadow-sm hover:border-gray-200 dark:hover:border-zinc-700 transition-all cursor-pointer space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div
                        className={`w-9 h-9 rounded-full flex items-center justify-center ${
                          session.status === 'completed'
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-500'
                            : 'bg-amber-50 dark:bg-amber-950/40 text-amber-500'
                        }`}
                      >
                        {session.status === 'completed' ? (
                          <CheckCircle2 className="w-5 h-5" />
                        ) : (
                          <XCircle className="w-5 h-5" />
                        )}
                      </div>

                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-gray-900 dark:text-white text-base">
                            {session.kickCount} з {session.targetKicks} поштовхів
                          </span>
                        </div>
                        <div className="flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          <span>Початок: {timeStr}</span>
                          <span>•</span>
                          <span>Тривалість: {durationStr}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-1.5">
                      <button
                        type="button"
                        onClick={(e) => handleDelete(e, session.id)}
                        className="p-2 text-gray-400 hover:text-red-500 rounded-xl hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
                        title="Видалити"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>

                      <ChevronRight
                        className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
                          isExpanded ? 'transform rotate-90' : ''
                        }`}
                      />
                    </div>
                  </div>

                  {/* Optional Note */}
                  {session.note && (
                    <div className="flex items-start space-x-1.5 text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-zinc-800/60 p-2.5 rounded-xl border border-gray-100 dark:border-zinc-800">
                      <Tag className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                      <span>{session.note}</span>
                    </div>
                  )}

                  {/* Expanded Kick Detail Timestamps */}
                  {isExpanded && (
                    <div className="pt-2 border-t border-gray-100 dark:border-zinc-800 space-y-2 animate-fade-in">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 block">
                        Деталізація поштовхів за часом:
                      </span>
                      {expandedKicks && expandedKicks.length > 0 ? (
                        <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto">
                          {expandedKicks.map((k, idx) => (
                            <div
                              key={k.id || idx}
                              className="text-[11px] font-mono p-1.5 bg-gray-50 dark:bg-zinc-800 rounded-lg text-gray-600 dark:text-gray-300 flex justify-between"
                            >
                              <span className="text-rose-500 font-bold">#{idx + 1}</span>
                              <span>
                                {new Date(k.timestamp).toLocaleTimeString('uk-UA', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit'
                                })}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 italic">Немає збережених інтервалів</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* MANUAL ENTRY MODAL */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="w-full max-w-sm bg-white dark:bg-[#1C1C1E] rounded-3xl p-6 shadow-2xl border border-gray-100 dark:border-zinc-800 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center">
                <Calendar className="w-5 h-5 text-rose-500 mr-2" />
                Додати сесію вручну
              </h3>
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveManualSession} className="space-y-3.5">
              {/* Date & Time */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 block mb-1">
                    Дата:
                  </label>
                  <input
                    type="date"
                    required
                    value={manualDate}
                    onChange={(e) => setManualDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-xs font-medium text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 block mb-1">
                    Час початку:
                  </label>
                  <input
                    type="time"
                    required
                    value={manualTime}
                    onChange={(e) => setManualTime(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-xs font-medium text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>
              </div>

              {/* Duration & Kick count */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 block mb-1">
                    Тривалість (хвилин):
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={360}
                    required
                    value={manualDuration}
                    onChange={(e) => setManualDuration(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-xs font-medium text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 block mb-1">
                    Кількість поштовхів:
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    required
                    value={manualKickCount}
                    onChange={(e) => setManualKickCount(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-xs font-medium text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>
              </div>

              {/* Target & Note */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 block mb-1">
                    Цільова кількість:
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    required
                    value={manualTarget}
                    onChange={(e) => setManualTarget(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-xs font-medium text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 block mb-1">
                    Нотатка:
                  </label>
                  <input
                    type="text"
                    placeholder="напр. Після обіду"
                    value={manualNote}
                    onChange={(e) => setManualNote(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-xs font-medium text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>
              </div>

              <div className="pt-2 flex space-x-2">
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="w-1/2 py-2.5 bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 text-gray-700 dark:text-gray-300 font-semibold text-xs rounded-xl"
                >
                  Скасувати
                </button>
                <button
                  type="submit"
                  className="w-1/2 py-2.5 bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs rounded-xl shadow-md active:scale-95 transition-transform"
                >
                  Зберегти
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
