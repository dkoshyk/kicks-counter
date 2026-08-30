import { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Flame,
  Clock,
  Square,
  Plus,
  Trash2,
  Share2,
  AlertTriangle,
  HeartPulse,
  Info,
  X
} from 'lucide-react';
import {
  db,
  startContraction,
  stopContraction,
  deleteContraction,
  exportContractionsCSV,
  addManualContraction
} from '../db';
import { p2pSyncManager } from '../utils/p2pSync';

interface ContractionTimerViewProps {
  onCallHospital?: () => void;
}

export function ContractionTimerView({ onCallHospital }: ContractionTimerViewProps) {
  // Live query for all contractions, sorted latest first
  const contractions = useLiveQuery(
    () => db.contractions.orderBy('startTime').reverse().toArray(),
    []
  );

  // Active contraction ID (stored in localStorage for resilience against page reloads)
  const [activeContractionId, setActiveContractionId] = useState<number | null>(() => {
    const saved = localStorage.getItem('poshtovhy_active_contraction_id');
    return saved ? parseInt(saved, 10) : null;
  });

  const [activeStartTime, setActiveStartTime] = useState<number | null>(() => {
    const saved = localStorage.getItem('poshtovhy_active_contraction_start');
    return saved ? parseInt(saved, 10) : null;
  });

  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [restSeconds, setRestSeconds] = useState<number>(0);
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualDuration, setManualDuration] = useState('60');
  const [manualMinutesAgo, setManualMinutesAgo] = useState('5');
  const [manualIntensity, setManualIntensity] = useState<'mild' | 'moderate' | 'strong'>('moderate');
  const [copiedNotification, setCopiedNotification] = useState(false);

  const isContracting = activeContractionId !== null;

  // Active contraction live stopwatch
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isContracting && activeStartTime) {
      const updateElapsed = () => {
        const secs = Math.max(0, Math.floor((Date.now() - activeStartTime) / 1000));
        setElapsedSeconds(secs);
      };
      updateElapsed();
      interval = setInterval(updateElapsed, 500);
    } else {
      setElapsedSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isContracting, activeStartTime]);

  // Rest timer (time since last contraction ended)
  const lastCompleted = useMemo(() => {
    if (!contractions || contractions.length === 0) return null;
    return contractions.find(c => c.endTime);
  }, [contractions]);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (!isContracting && lastCompleted?.endTime) {
      const updateRest = () => {
        const secs = Math.max(0, Math.floor((Date.now() - lastCompleted.endTime!) / 1000));
        setRestSeconds(secs);
      };
      updateRest();
      interval = setInterval(updateRest, 1000);
    } else {
      setRestSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isContracting, lastCompleted]);

  // Medical 5-1-1 Rule Analysis for the last 60 minutes
  const analysis511 = useMemo(() => {
    if (!contractions || contractions.length < 3) {
      return {
        count: contractions?.length || 0,
        avgDuration: 0,
        avgInterval: 0,
        meets511: false,
        phase: 'early' as 'early' | 'active' | 'hospital'
      };
    }

    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recent = contractions.filter(c => c.startTime >= oneHourAgo && c.endTime);

    if (recent.length === 0) {
      return { count: 0, avgDuration: 0, avgInterval: 0, meets511: false, phase: 'early' as const };
    }

    const totalDuration = recent.reduce((sum, c) => sum + c.duration, 0);
    const avgDuration = Math.round(totalDuration / recent.length);

    const intervals = recent.filter(c => c.interval && c.interval > 0).map(c => c.interval!);
    const avgInterval = intervals.length > 0 ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length) : 0;

    // 5-1-1 Check: Average interval <= 5 mins (300s), avg duration >= 45s, count >= 6 in the last hour
    const meets511 = recent.length >= 6 && avgInterval > 0 && avgInterval <= 330 && avgDuration >= 45;
    const isApproaching = recent.length >= 4 && avgInterval > 0 && avgInterval <= 420;

    const phase = meets511 ? 'hospital' : isApproaching ? 'active' : 'early';

    return {
      count: recent.length,
      avgDuration,
      avgInterval,
      meets511,
      phase
    };
  }, [contractions]);

  // Start contraction
  const handleStart = async () => {
    if ('vibrate' in navigator) navigator.vibrate([40, 30, 40]);
    const now = Date.now();
    const id = await startContraction();
    setActiveContractionId(id);
    setActiveStartTime(now);
    localStorage.setItem('poshtovhy_active_contraction_id', id.toString());
    localStorage.setItem('poshtovhy_active_contraction_start', now.toString());
  };

  // Stop contraction
  const handleStop = async (intensity: 'mild' | 'moderate' | 'strong' = 'moderate') => {
    if ('vibrate' in navigator) navigator.vibrate([60]);
    if (activeContractionId) {
      await stopContraction(activeContractionId, intensity);
      const c = await db.contractions.get(activeContractionId);
      if (c) p2pSyncManager.broadcastContraction(c);
    }
    setActiveContractionId(null);
    setActiveStartTime(null);
    localStorage.removeItem('poshtovhy_active_contraction_id');
    localStorage.removeItem('poshtovhy_active_contraction_start');
  };

  // Add manual
  const handleAddManual = async (e: React.FormEvent) => {
    e.preventDefault();
    const minsAgo = parseInt(manualMinutesAgo, 10) || 5;
    const durSecs = parseInt(manualDuration, 10) || 60;
    const startTime = Date.now() - minsAgo * 60 * 1000;

    const id = await addManualContraction({
      startTime,
      durationSeconds: durSecs,
      intensity: manualIntensity
    });

    const c = await db.contractions.get(id);
    if (c) p2pSyncManager.broadcastContraction(c);

    setShowManualModal(false);
  };

  // Quick share / copy report for doctor or messenger
  const handleShareReport = async () => {
    const list = contractions || [];
    if (list.length === 0) return;

    const lastHour = list.filter(c => c.startTime >= Date.now() - 3600000);
    const text = `📊 Звіт про перейми (додаток «Поштовхи»):\n` +
      `• За останню годину: ${lastHour.length} переймів\n` +
      `• Сер. тривалість: ${analysis511.avgDuration} с\n` +
      `• Сер. інтервал: ${analysis511.avgInterval ? Math.floor(analysis511.avgInterval / 60) + ' хв ' + (analysis511.avgInterval % 60) + ' с' : '—'}\n` +
      `• Статус: ${analysis511.meets511 ? '🚨 ПРАВИЛО 5-1-1 (Пора їхати в пологовий!)' : 'Спостереження'}`;

    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setCopiedNotification(true);
        setTimeout(() => setCopiedNotification(false), 2500);
      }
    } catch {
      alert(text);
    }
  };

  const handleExportCSV = async () => {
    const csv = await exportContractionsCSV();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `perejmy_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="max-w-md mx-auto px-4 space-y-5">
      {/* 5-1-1 RULE ALERT BANNER */}
      {analysis511.meets511 ? (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-red-600 to-rose-600 text-white shadow-lg shadow-rose-500/25 animate-pulse">
          <div className="flex items-start space-x-3">
            <div className="p-2 rounded-xl bg-white/20">
              <AlertTriangle className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="font-extrabold text-base leading-snug">Час вирушати до пологового! 🏥</h3>
              <p className="text-xs text-rose-100 mt-1 leading-relaxed">
                Спрацювало медичне правило 5-1-1: перейми кожні 5 хв тривалістю ~1 хв понад годину.
              </p>
              <div className="mt-3 flex items-center space-x-2">
                <a
                  href="tel:103"
                  className="px-3 py-1.5 bg-white text-rose-700 font-bold text-xs rounded-lg shadow active:scale-95 transition-transform inline-flex items-center space-x-1"
                >
                  <HeartPulse className="w-3.5 h-3.5" />
                  <span>Викликати 103</span>
                </a>
                {onCallHospital && (
                  <button
                    type="button"
                    onClick={onCallHospital}
                    className="px-3 py-1.5 bg-white/20 text-white font-semibold text-xs rounded-lg active:scale-95 transition-transform"
                  >
                    Зателефонувати лікарю
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : analysis511.phase === 'active' ? (
        <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200 flex items-center space-x-3">
          <Info className="w-5 h-5 text-amber-500 shrink-0" />
          <p className="text-xs font-medium leading-relaxed">
            Перейми стають регулярнішими (інтервал ~{Math.floor(analysis511.avgInterval / 60)} хв). Перевірте зібрані сумки та тримайте звʼязок із партнером.
          </p>
        </div>
      ) : null}

      {/* MAIN TIMER CONTROLLER CARD */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-zinc-800 flex flex-col items-center text-center relative overflow-hidden">
        {/* Rest indicator when not contracting */}
        {!isContracting && lastCompleted && (
          <div className="mb-4 inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
            <Clock className="w-3.5 h-3.5" />
            <span>Відпочинок: {formatSeconds(restSeconds)}</span>
          </div>
        )}

        {/* Big Action Button */}
        <div className="relative my-2">
          {isContracting ? (
            <button
              type="button"
              onClick={() => handleStop('moderate')}
              className="w-52 h-52 rounded-full bg-gradient-to-tr from-rose-500 to-pink-500 text-white flex flex-col items-center justify-center shadow-2xl shadow-rose-500/40 active:scale-95 transition-all animate-heart-pulse cursor-pointer select-none"
            >
              <Square className="w-10 h-10 mb-2 fill-white" />
              <span className="text-3xl font-extrabold tracking-tight font-mono">
                {formatSeconds(elapsedSeconds)}
              </span>
              <span className="text-xs uppercase tracking-wider font-semibold mt-1 opacity-90">
                Завершити перейму
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStart}
              className="w-52 h-52 rounded-full bg-gradient-to-tr from-rose-500 via-pink-500 to-rose-600 text-white flex flex-col items-center justify-center shadow-xl shadow-rose-500/25 active:scale-95 hover:scale-102 transition-all cursor-pointer select-none"
            >
              <Flame className="w-12 h-12 mb-2 text-white animate-pulse" />
              <span className="text-xl font-bold tracking-tight">Почалась перейма</span>
              <span className="text-[11px] font-medium opacity-80 mt-1">Торкніться для відліку</span>
            </button>
          )}
        </div>

        {/* Intensity quick bar after stop */}
        {isContracting && (
          <div className="mt-4 flex items-center space-x-2">
            <span className="text-xs text-gray-500 font-medium">Інтенсивність:</span>
            <button
              type="button"
              onClick={() => handleStop('mild')}
              className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 active:scale-95"
            >
              Легка 🟢
            </button>
            <button
              type="button"
              onClick={() => handleStop('moderate')}
              className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 active:scale-95"
            >
              Середня 🟡
            </button>
            <button
              type="button"
              onClick={() => handleStop('strong')}
              className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 active:scale-95"
            >
              Сильна 🔴
            </button>
          </div>
        )}
      </div>

      {/* METRICS & 1-HOUR STATS */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white dark:bg-zinc-900 p-3.5 rounded-2xl border border-gray-100 dark:border-zinc-800 text-center">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block">За 1 год</span>
          <span className="text-lg font-bold text-gray-800 dark:text-gray-100 mt-0.5 block">
            {analysis511.count}
          </span>
          <span className="text-[10px] text-gray-400">переймів</span>
        </div>

        <div className="bg-white dark:bg-zinc-900 p-3.5 rounded-2xl border border-gray-100 dark:border-zinc-800 text-center">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block">Сер. тривалість</span>
          <span className="text-lg font-bold text-rose-500 mt-0.5 block">
            {analysis511.avgDuration ? `${analysis511.avgDuration}с` : '—'}
          </span>
          <span className="text-[10px] text-gray-400">довжина</span>
        </div>

        <div className="bg-white dark:bg-zinc-900 p-3.5 rounded-2xl border border-gray-100 dark:border-zinc-800 text-center">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block">Сер. інтервал</span>
          <span className="text-lg font-bold text-gray-800 dark:text-gray-100 mt-0.5 block">
            {analysis511.avgInterval ? `${Math.floor(analysis511.avgInterval / 60)}хв` : '—'}
          </span>
          <span className="text-[10px] text-gray-400">частота</span>
        </div>
      </div>

      {/* ACTIONS BAR */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setShowManualModal(true)}
            className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-zinc-700 transition flex items-center space-x-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Додати вручну</span>
          </button>

          <button
            type="button"
            onClick={handleShareReport}
            className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 hover:bg-rose-100 transition flex items-center space-x-1"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>{copiedNotification ? 'Скопійовано! ✓' : 'Звіт лікарю'}</span>
          </button>
        </div>

        {contractions && contractions.length > 0 && (
          <button
            type="button"
            onClick={handleExportCSV}
            className="text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            CSV
          </button>
        )}
      </div>

      {/* RECENT CONTRACTIONS LIST */}
      <div className="space-y-2">
        <h4 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-1">
          Історія переймів
        </h4>

        {(!contractions || contractions.length === 0) && (
          <div className="p-8 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 text-gray-400 text-sm">
            Ще немає зафіксованих переймів. Торкніться кнопки для першого запису!
          </div>
        )}

        {contractions?.map((c) => {
          const startDate = new Date(c.startTime);
          const timeStr = startDate.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
          const intervalMins = c.interval ? Math.floor(c.interval / 60) : 0;
          const intervalSecs = c.interval ? c.interval % 60 : 0;

          const intensityColor =
            c.intensity === 'strong'
              ? 'bg-rose-500 text-white'
              : c.intensity === 'mild'
              ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
              : 'bg-amber-500/20 text-amber-700 dark:text-amber-300';

          return (
            <div
              key={c.id}
              className="bg-white dark:bg-zinc-900 p-3.5 rounded-2xl border border-gray-100 dark:border-zinc-800 flex items-center justify-between"
            >
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-zinc-800 flex flex-col items-center justify-center text-rose-600 dark:text-rose-400 font-mono font-bold text-xs">
                  <span>{timeStr}</span>
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-sm text-gray-900 dark:text-white">
                      {c.duration} сек
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${intensityColor}`}>
                      {c.intensity === 'strong' ? 'Сильна' : c.intensity === 'mild' ? 'Легка' : 'Середня'}
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    {c.interval ? `Інтервал: ${intervalMins} хв ${intervalSecs} с` : 'Перша перейма'}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={async () => {
                  if (c.id) {
                    p2pSyncManager.broadcastDeletedContraction(c.startTime);
                    await deleteContraction(c.id);
                  }
                }}
                className="p-2 text-gray-300 hover:text-rose-500 transition active:scale-95"
                title="Видалити запис"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>

      {/* MANUAL ENTRY MODAL */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 w-full max-w-sm border border-gray-100 dark:border-zinc-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-zinc-800 pb-3">
              <h3 className="font-bold text-base text-gray-900 dark:text-white">Додати перейму вручну</h3>
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddManual} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Скільки хвилин тому почалася?
                </label>
                <input
                  type="number"
                  min="0"
                  max="720"
                  value={manualMinutesAgo}
                  onChange={(e) => setManualMinutesAgo(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-sm font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Тривалість (у секундах):
                </label>
                <input
                  type="number"
                  min="5"
                  max="300"
                  value={manualDuration}
                  onChange={(e) => setManualDuration(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-sm font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Інтенсивність:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['mild', 'moderate', 'strong'] as const).map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setManualIntensity(lvl)}
                      className={`py-1.5 text-xs font-bold rounded-xl border transition ${
                        manualIntensity === lvl
                          ? 'border-rose-500 bg-rose-500 text-white'
                          : 'border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-gray-600 dark:text-gray-300'
                      }`}
                    >
                      {lvl === 'mild' ? 'Легка' : lvl === 'moderate' ? 'Середня' : 'Сильна'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300 font-bold text-xs"
                >
                  Скасувати
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-rose-500 text-white font-bold text-xs shadow-md shadow-rose-500/20 active:scale-95 transition"
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
}
