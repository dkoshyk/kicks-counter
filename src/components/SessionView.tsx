import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import confetti from 'canvas-confetti';
import { db, startSession, recordKick, undoKick, finishSession, cancelSession, formatDuration } from '../db';
import { p2pSyncManager, type LiveSessionState } from '../utils/p2pSync';
import { Play, Plus, RotateCcw, CheckCircle2, Heart, Clock, Target, Info, Sparkles, Award, Bell } from 'lucide-react';

interface SessionViewProps {
  defaultTargetKicks: number;
  userName?: string;
}

export const SessionView: React.FC<SessionViewProps> = ({ defaultTargetKicks, userName = 'Діанка' }) => {
  const [targetKicks, setTargetKicks] = useState<number>(defaultTargetKicks);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const [note, setNote] = useState<string>('');
  const [showCompletionModal, setShowCompletionModal] = useState<boolean>(false);
  const [completedSessionId, setCompletedSessionId] = useState<number | null>(null);

  // Real-time live P2P state (Father's side)
  const [liveP2PState, setLiveP2PState] = useState<LiveSessionState | null>(null);

  const [quickNotes] = useState<string[]>([
    'Після обіду',
    'Солодощі',
    'Ввечері у ліжку',
    'Після прогулянки',
    'Активні рухи',
    'Спокійні поштовхи'
  ]);

  // Listen to P2P Live Updates
  useEffect(() => {
    p2pSyncManager.setOnLiveUpdate((state) => {
      setLiveP2PState(state);
    });
  }, []);

  // Fetch active session from Dexie
  const activeSession = useLiveQuery(async () => {
    return await db.sessions.where('status').equals('active').first();
  }, []);

  // Fetch kicks for active session
  const kicks = useLiveQuery(async () => {
    if (!activeSession?.id) return [];
    return await db.kicks
      .where('sessionId')
      .equals(activeSession.id)
      .reverse()
      .sortBy('timestamp');
  }, [activeSession?.id]);

  // Broadcast live session state when Mother is counting
  useEffect(() => {
    if (activeSession) {
      p2pSyncManager.broadcastLiveSession({
        isCounting: true,
        kickCount: activeSession.kickCount,
        targetKicks: activeSession.targetKicks,
        elapsedMs: elapsedTime,
        startTime: activeSession.startTime
      });
    } else {
      p2pSyncManager.broadcastLiveSession(null);
    }
  }, [activeSession, activeSession?.kickCount, elapsedTime]);

  // Timer effect for active session
  useEffect(() => {
    if (!activeSession) {
      setElapsedTime(0);
      return;
    }

    const updateTimer = () => {
      const ms = Date.now() - activeSession.startTime;
      setElapsedTime(ms);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [activeSession]);

  // Update targetKicks if defaultTargetKicks changes when idle
  useEffect(() => {
    if (!activeSession) {
      setTargetKicks(defaultTargetKicks);
    }
  }, [defaultTargetKicks, activeSession]);

  const handleStartSession = async () => {
    if ('vibrate' in navigator) {
      try { navigator.vibrate(40); } catch (_) {}
    }
    await startSession(targetKicks);
  };

  const handleRecordKick = async () => {
    if (!activeSession?.id) return;

    if ('vibrate' in navigator) {
      try { navigator.vibrate([60]); } catch (_) {}
    }

    const { reachedGoal } = await recordKick(activeSession.id);

    if (reachedGoal) {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#FF2D55', '#FF9500', '#5856D6', '#34C759', '#AF52DE']
      });

      setCompletedSessionId(activeSession.id);
      setShowCompletionModal(true);
    }
  };

  const handleUndoKick = async () => {
    if (!activeSession?.id) return;
    if ('vibrate' in navigator) {
      try { navigator.vibrate(30); } catch (_) {}
    }
    await undoKick(activeSession.id);
  };

  const handleOpenFinishEarly = () => {
    if (!activeSession?.id) return;
    setCompletedSessionId(activeSession.id);
    setShowCompletionModal(true);
  };

  const handleSaveCompletedSession = async () => {
    if (!completedSessionId) return;
    await finishSession(completedSessionId, note);
    const sessionObj = await db.sessions.get(completedSessionId);
    
    setShowCompletionModal(false);
    setNote('');
    setCompletedSessionId(null);

    // Broadcast completed session to Father over P2P DataChannel
    if (sessionObj) {
      const kicksList = await db.kicks.where('sessionId').equals(completedSessionId).toArray();
      p2pSyncManager.broadcastCompletedSession(sessionObj, kicksList);
    }
  };

  const handleCancelSession = async () => {
    if (!activeSession?.id) return;
    if (window.confirm('Ви впевнені, що хочете скасувати поточну сесію?')) {
      await cancelSession(activeSession.id);
      p2pSyncManager.broadcastLiveSession(null);
    }
  };

  // Format timer text (MM:SS or HH:MM:SS)
  const formatTimer = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;

    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${remMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const currentCount = activeSession?.kickCount || 0;
  const currentTarget = activeSession?.targetKicks || targetKicks;
  const progressPercent = Math.min(100, Math.round((currentCount / currentTarget) * 100));

  return (
    <div className="flex flex-col items-center justify-between min-h-[calc(100vh-140px)] pb-6 px-4">
      {/* IDLE STATE */}
      {!activeSession && (
        <div className="w-full max-w-md my-auto flex flex-col items-center text-center space-y-5">
          {/* Read-Only Real-Time Live Sync Counter for Father */}
          {liveP2PState && liveP2PState.isCounting && (
            <div className="w-full bg-gradient-to-r from-purple-500/15 via-pink-500/20 to-rose-500/15 dark:from-purple-950/40 dark:via-pink-950/40 dark:to-rose-950/40 p-4 rounded-3xl border border-pink-200 dark:border-pink-800/40 shadow-sm text-left flex items-center justify-between animate-pulse">
              <div className="flex items-center space-x-3">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-rose-500 to-pink-500 flex items-center justify-center text-white shrink-0 shadow-md">
                  <Heart className="w-6 h-6 fill-white" />
                </div>
                <div>
                  <div className="flex items-center space-x-1 text-xs font-bold text-rose-600 dark:text-rose-300">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    <span>Пряма трансляція від мами 🌸</span>
                  </div>
                  <p className="text-sm font-extrabold text-gray-900 dark:text-white mt-0.5">
                    {liveP2PState.kickCount} з {liveP2PState.targetKicks} поштовхів
                  </p>
                </div>
              </div>

              <div className="text-right">
                <span className="text-[10px] uppercase tracking-wider font-extrabold text-rose-600 dark:text-rose-300 bg-rose-100 dark:bg-rose-950/70 px-2.5 py-1 rounded-full border border-rose-200 dark:border-rose-800">
                  Режим перегляду
                </span>
              </div>
            </div>
          )}

          <div className="relative">
            <div className="w-32 h-32 rounded-full bg-gradient-to-tr from-rose-400 to-pink-500 flex items-center justify-center shadow-lg shadow-rose-500/25 animate-heart-pulse">
              <Heart className="w-16 h-16 text-white fill-white" />
            </div>
            <div className="absolute -bottom-1 -right-1 bg-white dark:bg-zinc-800 p-2 rounded-full shadow">
              <Sparkles className="w-5 h-5 text-amber-500" />
            </div>
          </div>

          <div>
            <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
              Розпочати сесію відліку
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Рекомендована ціль: 10 поштовхів протягом 1–2 годин
            </p>
          </div>

          {/* Daily Reminder Banner if Enabled */}
          {localStorage.getItem('kick_counter_reminder_enabled') === 'true' && (
            <div className="w-full bg-gradient-to-r from-rose-50 to-pink-50 dark:from-rose-950/40 dark:to-pink-950/30 p-3.5 rounded-2xl border border-rose-100 dark:border-rose-900/40 text-left flex items-start space-x-3 shadow-sm">
              <Bell className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-rose-900 dark:text-rose-200">
                  Щоденне нагадування ✨
                </p>
                <p className="text-[11px] text-rose-700 dark:text-rose-300 mt-0.5 leading-relaxed">
                  Доброго дня, <strong>{userName}</strong>! Памʼятайте зафіксувати сьогоднішню сесію активності малюка.
                </p>
              </div>
            </div>
          )}

          {/* Goal Selector */}
          <div className="w-full bg-white dark:bg-[#1C1C1E] p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-800/80">
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-400 block text-left mb-3">
              Цільова кількість поштовхів
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[5, 10, 15, 20].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => setTargetKicks(num)}
                  className={`py-2.5 rounded-xl font-semibold text-sm transition-all duration-150 active:scale-95 ${
                    targetKicks === num
                      ? 'bg-pink-500 text-white shadow-md shadow-pink-500/20'
                      : 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-zinc-700'
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>

          {/* Start Button */}
          <button
            type="button"
            onClick={handleStartSession}
            className="w-full py-4 bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700 text-white font-bold text-lg rounded-2xl shadow-lg shadow-rose-500/30 active:scale-95 transition-all duration-150 flex items-center justify-center space-x-2"
          >
            <Play className="w-6 h-6 fill-white" />
            <span>Розпочати відлік</span>
          </button>

          {/* Info Card */}
          <div className="w-full bg-rose-50 dark:bg-rose-950/30 p-4 rounded-2xl text-left flex items-start space-x-3 border border-rose-100 dark:border-rose-900/30">
            <Info className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
            <p className="text-xs text-rose-800 dark:text-rose-300 leading-relaxed">
              <strong>Як рахувати?</strong> Оберіть зручну позу (на боку або напівлежачи). Фіксуйте кожен рух або серію поштовхів як один поштовх.
            </p>
          </div>
        </div>
      )}

      {/* ACTIVE SESSION STATE */}
      {activeSession && (
        <div className="w-full max-w-md flex flex-col items-center justify-between my-auto space-y-6">
          {/* Timer & Target header */}
          <div className="w-full bg-white dark:bg-[#1C1C1E] p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-800/80 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Clock className="w-5 h-5 text-rose-500" />
              <span className="font-mono text-xl font-bold tracking-tight text-gray-800 dark:text-gray-100">
                {formatTimer(elapsedTime)}
              </span>
            </div>
            <div className="flex items-center space-x-1 text-xs font-semibold px-3 py-1 bg-rose-100 dark:bg-rose-950/50 text-rose-600 dark:text-rose-300 rounded-full">
              <Target className="w-3.5 h-3.5 mr-1" />
              Ціль: {activeSession.targetKicks}
            </div>
          </div>

          {/* Big Counter Ring & Button */}
          <div className="relative my-4 flex flex-col items-center justify-center">
            <div className="relative w-64 h-64 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="44"
                  className="text-gray-100 dark:text-zinc-800 stroke-current"
                  strokeWidth="8"
                  fill="transparent"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="44"
                  className="text-rose-500 stroke-current transition-all duration-300 ease-out"
                  strokeWidth="8"
                  strokeDasharray={276.46}
                  strokeDashoffset={276.46 - (276.46 * progressPercent) / 100}
                  strokeLinecap="round"
                  fill="transparent"
                />
              </svg>

              <button
                type="button"
                onClick={handleRecordKick}
                className="absolute w-48 h-48 rounded-full bg-gradient-to-tr from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white shadow-xl shadow-rose-500/35 active:scale-90 transition-all duration-150 flex flex-col items-center justify-center p-2 focus:outline-none"
              >
                <Plus className="w-8 h-8 mb-1" />
                <span className="text-3xl font-extrabold tracking-tight">
                  {currentCount} з {currentTarget}
                </span>
                <span className="text-xs font-semibold uppercase tracking-wider opacity-90 mt-1">
                  +1 Поштовх
                </span>
              </button>
            </div>
          </div>

          {/* Controls: Undo & Finish / Cancel */}
          <div className="w-full grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleUndoKick}
              disabled={currentCount === 0}
              className={`py-3 px-4 rounded-xl font-semibold text-sm flex items-center justify-center space-x-2 transition-all duration-150 active:scale-95 border ${
                currentCount === 0
                  ? 'bg-gray-100 dark:bg-zinc-800/50 text-gray-400 dark:text-gray-600 border-transparent cursor-not-allowed'
                  : 'bg-white dark:bg-[#1C1C1E] text-gray-700 dark:text-gray-200 border-gray-200 dark:border-zinc-800 hover:bg-gray-50'
              }`}
            >
              <RotateCcw className="w-4 h-4" />
              <span>Скасувати</span>
            </button>

            <button
              type="button"
              onClick={handleOpenFinishEarly}
              className="py-3 px-4 rounded-xl font-semibold text-sm bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm flex items-center justify-center space-x-2 transition-all duration-150 active:scale-95"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Завершити</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleCancelSession}
            className="text-xs text-red-500 hover:text-red-600 font-medium py-1 active:opacity-75"
          >
            Перервати сесію
          </button>

          {/* Recent Kicks Log preview */}
          {kicks && kicks.length > 0 && (
            <div className="w-full bg-white dark:bg-[#1C1C1E] p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-800/80">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 block mb-2">
                Останні поштовхи
              </span>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {kicks.map((kick, index) => {
                  const kickTime = new Date(kick.timestamp).toLocaleTimeString('uk-UA', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  });
                  return (
                    <span
                      key={kick.id || index}
                      className="px-2.5 py-1 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 font-mono text-xs rounded-lg border border-rose-100 dark:border-rose-900/40"
                    >
                      #{kicks.length - index} • {kickTime}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* COMPLETION MODAL */}
      {showCompletionModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="w-full max-w-sm bg-white dark:bg-[#1C1C1E] rounded-3xl p-6 shadow-2xl border border-gray-100 dark:border-zinc-800 text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-500">
              <Award className="w-10 h-10" />
            </div>

            <div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                Чудова робота! 🎉
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Сесія завершена. Час: <strong className="text-gray-800 dark:text-gray-200">{formatDuration(elapsedTime)}</strong> ({currentCount} поштовхів).
              </p>
            </div>

            {/* Note input */}
            <div className="text-left space-y-2">
              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 block">
                Додати нотатку (необовʼязково):
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="напр. Після солодощів, під час відпочинку..."
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
              />

              {/* Quick suggestions */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {quickNotes.map((qNote) => (
                  <button
                    key={qNote}
                    type="button"
                    onClick={() => setNote(qNote)}
                    className="text-[11px] px-2.5 py-1 bg-gray-100 dark:bg-zinc-800 hover:bg-rose-100 dark:hover:bg-rose-950/50 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
                  >
                    + {qNote}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-2 flex space-x-2">
              <button
                type="button"
                onClick={handleSaveCompletedSession}
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl shadow-md active:scale-95 transition-transform"
              >
                Зберегти сесію
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
