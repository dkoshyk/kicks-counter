import { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import confetti from 'canvas-confetti';
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
  X,
  Baby,
  Sparkles,
  HelpCircle,
  RotateCcw,
  CheckCircle2,
  ShoppingBag,
  Activity
} from 'lucide-react';
import {
  db,
  startContraction,
  stopContraction,
  updateContraction,
  deleteContraction,
  exportContractionsCSV,
  addManualContraction
} from '../db';
import { p2pSyncManager } from '../utils/p2pSync';

interface ContractionTimerViewProps {
  onCallHospital?: () => void;
  onOpenBags?: () => void;
}

export function ContractionTimerView({ onCallHospital, onOpenBags }: ContractionTimerViewProps) {
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

  // Labor mode: 'tracking' | 'in_labor' | 'born'
  const [laborStatus, setLaborStatus] = useState<'tracking' | 'in_labor' | 'born'>(() => {
    const saved = localStorage.getItem('poshtovhy_labor_status');
    if (saved === 'in_labor' || saved === 'born') return saved;
    return 'tracking';
  });

  const [laborStartedAt, setLaborStartedAt] = useState<number | null>(() => {
    const saved = localStorage.getItem('poshtovhy_labor_start_time');
    return saved ? parseInt(saved, 10) : null;
  });

  const [babyBornAt, setBabyBornAt] = useState<number | null>(() => {
    const saved = localStorage.getItem('poshtovhy_baby_birth_time');
    return saved ? parseInt(saved, 10) : null;
  });

  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [restSeconds, setRestSeconds] = useState<number>(0);
  const [laborDurationSeconds, setLaborDurationSeconds] = useState<number>(0);

  const [showManualModal, setShowManualModal] = useState(false);
  const [showFalseLaborModal, setShowFalseLaborModal] = useState(false);
  const [showLaborConfirmModal, setShowLaborConfirmModal] = useState(false);
  const [showBornModal, setShowBornModal] = useState(false);

  const [manualDuration, setManualDuration] = useState('60');
  const [manualMinutesAgo, setManualMinutesAgo] = useState('5');
  const [manualIntensity, setManualIntensity] = useState<'mild' | 'moderate' | 'strong'>('moderate');
  const [manualIsFalse, setManualIsFalse] = useState(false);
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

  // Live timer for active labor phase
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (laborStatus === 'in_labor' && laborStartedAt) {
      const updateLaborTime = () => {
        const secs = Math.max(0, Math.floor((Date.now() - laborStartedAt) / 1000));
        setLaborDurationSeconds(secs);
      };
      updateLaborTime();
      interval = setInterval(updateLaborTime, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [laborStatus, laborStartedAt]);

  // Rest timer (time since last contraction ended)
  const lastCompleted = useMemo(() => {
    if (!contractions || contractions.length === 0) return null;
    return contractions.find(c => c.endTime);
  }, [contractions]);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (!isContracting && lastCompleted?.endTime && laborStatus === 'tracking') {
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
  }, [isContracting, lastCompleted, laborStatus]);

  // Medical 5-1-1 Rule Analysis for the last 60 minutes (excluding user-marked false contractions)
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
    // Exclude contractions marked as false alarms from the 5-1-1 emergency check
    const recent = contractions.filter(c => c.startTime >= oneHourAgo && c.endTime && !c.isFalseAlarm);

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

  // Medical False Labor (Braxton Hicks / Брекстона-Гікса) Detector
  const falseLaborAnalysis = useMemo(() => {
    if (!contractions || contractions.length < 3) {
      return { isLikelyFalse: false, confidence: 'none' as 'none' | 'possible' | 'high', reasons: [] as string[] };
    }

    // Take the last 5 completed contractions
    const sample = contractions.filter(c => c.endTime).slice(0, 5);
    if (sample.length < 3) {
      return { isLikelyFalse: false, confidence: 'none' as const, reasons: [] };
    }

    const reasons: string[] = [];

    // 1. Check interval regularity (Standard Deviation / Mean -> Coefficient of Variation)
    const validIntervals = sample.filter(c => c.interval && c.interval > 0).map(c => c.interval!);
    if (validIntervals.length >= 2) {
      const mean = validIntervals.reduce((a, b) => a + b, 0) / validIntervals.length;
      const variance = validIntervals.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / validIntervals.length;
      const stdDev = Math.sqrt(variance);
      const cov = stdDev / mean; // High coefficient of variation means irregular

      // If interval variance is > 35%, intervals are erratic
      if (cov > 0.35) {
        reasons.push('Інтервали нерегулярні (розкид часу між переймами значний)');
      }
    }

    // 2. Check duration stability (short and non-progressing < 35 sec)
    const avgDur = sample.reduce((sum, c) => sum + c.duration, 0) / sample.length;
    if (avgDur < 35) {
      reasons.push('Коротка тривалість (менше 35 секунд)');
    }

    // 3. Check intensity lack of progression (mostly mild)
    const mildCount = sample.filter(c => c.intensity === 'mild').length;
    if (mildCount >= Math.ceil(sample.length * 0.7)) {
      reasons.push('Інтенсивність переважно слабка, без відчутного наростання');
    }

    const isLikelyFalse = reasons.length >= 2 && !analysis511.meets511;
    const confidence = reasons.length >= 2 ? ('high' as const) : reasons.length === 1 ? ('possible' as const) : ('none' as const);

    return {
      isLikelyFalse,
      confidence,
      reasons
    };
  }, [contractions, analysis511.meets511]);

  // Overall session statistics for summary and labor mode
  const sessionStats = useMemo(() => {
    if (!contractions || contractions.length === 0) {
      return { total: 0, trueCount: 0, falseCount: 0, firstTime: null, lastTime: null, totalSpanMins: 0 };
    }
    const completed = contractions.filter(c => c.endTime);
    const trueCount = completed.filter(c => !c.isFalseAlarm).length;
    const falseCount = completed.filter(c => c.isFalseAlarm).length;
    const first = completed[completed.length - 1];
    const last = completed[0];
    const firstTime = first ? first.startTime : null;
    const lastTime = last ? last.endTime || last.startTime : null;
    const totalSpanMins = firstTime && lastTime ? Math.max(1, Math.round((lastTime - firstTime) / 60000)) : 0;

    return {
      total: completed.length,
      trueCount,
      falseCount,
      firstTime,
      lastTime,
      totalSpanMins
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
  const handleStop = async (
    intensity: 'mild' | 'moderate' | 'strong' = 'moderate',
    isFalseAlarm: boolean = false
  ) => {
    if ('vibrate' in navigator) navigator.vibrate([60]);
    if (activeContractionId) {
      await stopContraction(activeContractionId, intensity, undefined, isFalseAlarm);
      const c = await db.contractions.get(activeContractionId);
      if (c) p2pSyncManager.broadcastContraction(c);
    }
    setActiveContractionId(null);
    setActiveStartTime(null);
    localStorage.removeItem('poshtovhy_active_contraction_id');
    localStorage.removeItem('poshtovhy_active_contraction_start');
  };

  // Toggle false contraction flag on an existing contraction
  const handleToggleFalseAlarm = async (cId: number, currentVal?: boolean) => {
    if ('vibrate' in navigator) navigator.vibrate(30);
    const newVal = !currentVal;
    await updateContraction(cId, { isFalseAlarm: newVal });
    const c = await db.contractions.get(cId);
    if (c) p2pSyncManager.broadcastContraction(c);
  };

  // Switch into Active Labor Mode (stops active stopwatch and records labor status)
  const handleEnterLaborMode = () => {
    if (isContracting) {
      handleStop('strong', false);
    }
    const now = Date.now();
    setLaborStatus('in_labor');
    setLaborStartedAt(now);
    localStorage.setItem('poshtovhy_labor_status', 'in_labor');
    localStorage.setItem('poshtovhy_labor_start_time', now.toString());
    setShowLaborConfirmModal(false);
    if ('vibrate' in navigator) navigator.vibrate([100, 50, 100]);
  };

  // Celebrate baby birth
  const handleBabyBorn = () => {
    const now = Date.now();
    setLaborStatus('born');
    setBabyBornAt(now);
    localStorage.setItem('poshtovhy_labor_status', 'born');
    localStorage.setItem('poshtovhy_baby_birth_time', now.toString());
    setShowBornModal(false);

    // Launch celebratory confetti
    confetti({
      particleCount: 150,
      spread: 80,
      origin: { y: 0.6 }
    });
    if ('vibrate' in navigator) navigator.vibrate([100, 100, 200, 100, 300]);
  };

  // Reset or resume contraction timer from labor mode
  const handleResumeTracking = () => {
    setLaborStatus('tracking');
    localStorage.removeItem('poshtovhy_labor_status');
    localStorage.removeItem('poshtovhy_labor_start_time');
    localStorage.removeItem('poshtovhy_baby_birth_time');
    setLaborStartedAt(null);
    setBabyBornAt(null);
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
      intensity: manualIntensity,
      isFalseAlarm: manualIsFalse
    });

    const c = await db.contractions.get(id);
    if (c) p2pSyncManager.broadcastContraction(c);

    setShowManualModal(false);
    setManualIsFalse(false);
  };

  // Quick share / copy report for doctor or messenger
  const handleShareReport = async () => {
    const list = contractions || [];
    if (list.length === 0) return;

    const lastHour = list.filter(c => c.startTime >= Date.now() - 3600000 && !c.isFalseAlarm);
    const falseCount = list.filter(c => c.isFalseAlarm).length;
    const text = `📊 Звіт про перейми (додаток «Поштовхи»):\n` +
      `• За останню годину: ${lastHour.length} справжніх переймів\n` +
      `• Сер. тривалість: ${analysis511.avgDuration} с\n` +
      `• Сер. інтервал: ${analysis511.avgInterval ? Math.floor(analysis511.avgInterval / 60) + ' хв ' + (analysis511.avgInterval % 60) + ' с' : '—'}\n` +
      (falseCount > 0 ? `• Позначено тренувальних (Брекстона-Гікса): ${falseCount}\n` : '') +
      `• Статус: ${
        laborStatus === 'in_labor'
          ? '🏥 В АКТИВНИХ ПОЛОГАХ / В РОДЗАЛІ'
          : laborStatus === 'born'
          ? '🎉 МАЛЮК НАРОДИВСЯ!'
          : analysis511.meets511
          ? '🚨 ПРАВИЛО 5-1-1 (Пора їхати в пологовий!)'
          : 'Спостереження'
      }`;

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

  const formatDurationHMS = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) {
      return `${h} год ${m} хв`;
    }
    return `${m} хв ${s} с`;
  };

  return (
    <div className="max-w-md mx-auto px-4 space-y-5">
      {/* 1. CELEBRATORY BORN CARD */}
      {laborStatus === 'born' ? (
        <div className="p-5 rounded-3xl bg-gradient-to-tr from-pink-500 via-rose-500 to-amber-400 text-white shadow-xl shadow-rose-500/30 text-center space-y-3 relative overflow-hidden">
          <div className="w-16 h-16 mx-auto rounded-full bg-white/20 flex items-center justify-center backdrop-blur-xs">
            <Sparkles className="w-9 h-9 text-amber-100 animate-spin" style={{ animationDuration: '6s' }} />
          </div>
          <div>
            <span className="inline-block px-3 py-1 rounded-full bg-white/25 text-xs font-extrabold uppercase tracking-wider mb-1">
              Вітаємо з народженням дитини!
            </span>
            <h2 className="text-2xl font-black tracking-tight">Малюк уже з нами! 👶🎉</h2>
            {babyBornAt && (
              <span className="inline-block mt-1 px-3 py-0.5 rounded-full bg-black/15 text-[11px] font-mono font-bold text-white">
                Час народження: {new Date(babyBornAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}, {new Date(babyBornAt).toLocaleDateString('uk-UA')}
              </span>
            )}
            <p className="text-xs text-rose-100 mt-1 max-w-xs mx-auto">
              Відлік переймів завершено. Бажаємо мамі швидкого відновлення, смачного молочка та спокійних ночей!
            </p>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                confetti({ particleCount: 100, spread: 70 });
              }}
              className="w-full sm:w-auto px-4 py-2.5 bg-white text-rose-600 font-bold text-xs rounded-xl shadow active:scale-95 transition"
            >
              🎉 Салют конфеті
            </button>
            <button
              type="button"
              onClick={handleResumeTracking}
              className="w-full sm:w-auto px-4 py-2.5 bg-white/20 hover:bg-white/30 text-white font-semibold text-xs rounded-xl transition flex items-center justify-center space-x-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Повернути відлік переймів</span>
            </button>
          </div>
        </div>
      ) : laborStatus === 'in_labor' ? (
        /* 2. ACTIVE LABOR MODE CARD (TIMER STOPPED FOR BIRTH) */
        <div className="p-5 rounded-3xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-xl shadow-teal-500/25 space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 rounded-2xl bg-white/20">
                <Baby className="w-6 h-6 text-white" />
              </div>
              <div>
                <span className="text-[11px] uppercase tracking-wider font-extrabold text-teal-100 block">
                  Активна фаза
                </span>
                <h3 className="font-extrabold text-lg leading-tight">Пологи в процесі 🏥</h3>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-white/20 text-xs font-mono font-bold">
              {formatDurationHMS(laborDurationSeconds)}
            </span>
          </div>

          <p className="text-xs text-teal-50 leading-relaxed">
            Відлік переймів зупинено, щоб не відволікати маму. Ви перебуваєте під наглядом лікарів або в пологовому залі.
          </p>

          {/* Quick labor summary stats */}
          <div className="grid grid-cols-3 gap-2 pt-1 text-center">
            <div className="p-2 rounded-xl bg-black/15">
              <span className="text-[10px] text-teal-100 block">Всього переймів</span>
              <span className="text-base font-bold text-white">{sessionStats.trueCount}</span>
            </div>
            <div className="p-2 rounded-xl bg-black/15">
              <span className="text-[10px] text-teal-100 block">Період переймів</span>
              <span className="text-base font-bold text-white">{sessionStats.totalSpanMins} хв</span>
            </div>
            <div className="p-2 rounded-xl bg-black/15">
              <span className="text-[10px] text-teal-100 block">Сер. тривалість</span>
              <span className="text-base font-bold text-white">{analysis511.avgDuration || 0} с</span>
            </div>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row items-center gap-2">
            <button
              type="button"
              onClick={() => setShowBornModal(true)}
              className="w-full flex-1 py-2.5 bg-white text-teal-700 font-extrabold text-xs rounded-xl shadow active:scale-95 transition flex items-center justify-center space-x-1.5"
            >
              <Sparkles className="w-4 h-4 text-amber-500" />
              <span>Малюк народився! 🎉</span>
            </button>

            {onOpenBags && (
              <button
                type="button"
                onClick={onOpenBags}
                className="w-full sm:w-auto px-3 py-2.5 bg-white/20 hover:bg-white/30 text-white font-semibold text-xs rounded-xl transition flex items-center justify-center space-x-1"
              >
                <ShoppingBag className="w-4 h-4" />
                <span>Сумка в родзал</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleResumeTracking}
              className="w-full sm:w-auto px-3 py-2.5 bg-black/20 hover:bg-black/30 text-white font-medium text-xs rounded-xl transition flex items-center justify-center space-x-1"
              title="Помилково увімкнули? Відновити таймер"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Відновити відлік</span>
            </button>
          </div>
        </div>
      ) : (
        /* 3. STANDARD TRACKING MODE BANNERS */
        <>
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
                  <div className="mt-3 flex items-center space-x-2 flex-wrap gap-y-2">
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
                    <button
                      type="button"
                      onClick={() => setShowLaborConfirmModal(true)}
                      className="px-3 py-1.5 bg-black/20 hover:bg-black/30 text-white font-semibold text-xs rounded-lg active:scale-95 transition-transform inline-flex items-center space-x-1"
                    >
                      <Baby className="w-3.5 h-3.5" />
                      <span>Вже в пологовому / Роди</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : analysis511.phase === 'active' ? (
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200 flex items-center justify-between space-x-3">
              <div className="flex items-center space-x-2.5">
                <Info className="w-5 h-5 text-amber-500 shrink-0" />
                <p className="text-xs font-medium leading-relaxed">
                  Перейми стають регулярнішими (~{Math.floor(analysis511.avgInterval / 60)} хв). Перевірте сумки та будьте готові до виїзду.
                </p>
              </div>
              {onOpenBags && (
                <button
                  type="button"
                  onClick={onOpenBags}
                  className="px-2.5 py-1 text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-500/20 rounded-lg shrink-0 active:scale-95 transition"
                >
                  Сумки 👜
                </button>
              )}
            </div>
          ) : null}

          {/* FALSE LABOR / BRAXTON HICKS DETECTION CARD */}
          {falseLaborAnalysis.isLikelyFalse && (
            <div className="p-3.5 rounded-2xl bg-purple-500/10 border border-purple-500/30 dark:bg-purple-950/20 text-purple-900 dark:text-purple-200 space-y-2">
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-2">
                  <Activity className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
                  <h4 className="text-xs font-extrabold text-purple-900 dark:text-purple-100">
                    Схоже на тренувальні перейми (Брекстона-Гікса)
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => setShowFalseLaborModal(true)}
                  className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:underline flex items-center space-x-0.5 shrink-0"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                  <span>Шпаргалка</span>
                </button>
              </div>
              <ul className="text-[11px] text-purple-800 dark:text-purple-300 list-disc list-inside space-y-0.5 pl-1">
                {falseLaborAnalysis.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              <p className="text-[11px] text-purple-700 dark:text-purple-400 italic pt-0.5">
                Порада: випийте склянку теплої води 💧, змініть положення тіла або прийміть теплий душ. Хибні перейми зазвичай стихають у спокої.
              </p>
            </div>
          )}
        </>
      )}

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

        {/* Intensity quick bar and False alarm marking */}
        {isContracting ? (
          <div className="mt-4 flex flex-col items-center space-y-2 w-full">
            <div className="flex items-center justify-center space-x-2">
              <span className="text-xs text-gray-500 font-medium">Інтенсивність:</span>
              <button
                type="button"
                onClick={() => handleStop('mild', false)}
                className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 active:scale-95 transition"
              >
                Легка 🟢
              </button>
              <button
                type="button"
                onClick={() => handleStop('moderate', false)}
                className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 active:scale-95 transition"
              >
                Середня 🟡
              </button>
              <button
                type="button"
                onClick={() => handleStop('strong', false)}
                className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 active:scale-95 transition"
              >
                Сильна 🔴
              </button>
            </div>
            <button
              type="button"
              onClick={() => handleStop('mild', true)}
              className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/40 hover:bg-purple-100 px-3 py-1 rounded-full transition flex items-center space-x-1"
            >
              <span>Позначити як тренувальну (Брекстона-Гікса)</span>
            </button>
          </div>
        ) : (
          /* When idle: quick button to record labor mode or view educational guide */
          <div className="mt-4 flex items-center justify-center space-x-3 text-xs">
            <button
              type="button"
              onClick={() => setShowFalseLaborModal(true)}
              className="text-purple-600 dark:text-purple-400 font-medium hover:underline flex items-center space-x-1"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Як відрізнити хибні перейми?</span>
            </button>
            <span className="text-gray-300 dark:text-zinc-700">•</span>
            <button
              type="button"
              onClick={() => setShowLaborConfirmModal(true)}
              className="text-teal-600 dark:text-teal-400 font-bold hover:underline flex items-center space-x-1"
            >
              <Baby className="w-3.5 h-3.5" />
              <span>Почалися пологи</span>
            </button>
          </div>
        )}
      </div>

      {/* METRICS & 1-HOUR STATS */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white dark:bg-zinc-900 p-3.5 rounded-2xl border border-gray-100 dark:border-zinc-800 text-center">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block">Справжні (1г)</span>
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
        <div className="flex items-center justify-between px-1">
          <h4 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
            Історія переймів
          </h4>
          {sessionStats.falseCount > 0 && (
            <span className="text-[10px] font-medium text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/50 px-2 py-0.5 rounded-full">
              {sessionStats.falseCount} тренувальних
            </span>
          )}
        </div>

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
              className={`bg-white dark:bg-zinc-900 p-3.5 rounded-2xl border transition ${
                c.isFalseAlarm
                  ? 'border-purple-200 dark:border-purple-900/50 opacity-80'
                  : 'border-gray-100 dark:border-zinc-800'
              } flex items-center justify-between`}
            >
              <div className="flex items-center space-x-3">
                <div
                  className={`w-10 h-10 rounded-xl flex flex-col items-center justify-center font-mono font-bold text-xs ${
                    c.isFalseAlarm
                      ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400'
                      : 'bg-rose-50 dark:bg-zinc-800 text-rose-600 dark:text-rose-400'
                  }`}
                >
                  <span>{timeStr}</span>
                </div>
                <div>
                  <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                    <span className="font-bold text-sm text-gray-900 dark:text-white">
                      {c.duration} сек
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${intensityColor}`}>
                      {c.intensity === 'strong' ? 'Сильна' : c.intensity === 'mild' ? 'Легка' : 'Середня'}
                    </span>
                    {c.isFalseAlarm && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-purple-500 text-white">
                        Хибна (Брекстон-Гікс)
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    {c.interval ? `Інтервал: ${intervalMins} хв ${intervalSecs} с` : 'Перша перейма'}
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-1">
                {/* Toggle False / Braxton-Hicks button */}
                <button
                  type="button"
                  onClick={() => c.id && handleToggleFalseAlarm(c.id, c.isFalseAlarm)}
                  className={`p-2 rounded-lg text-xs transition active:scale-95 ${
                    c.isFalseAlarm
                      ? 'text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/40'
                      : 'text-gray-400 hover:text-purple-600 hover:bg-purple-50/50 dark:hover:bg-purple-950/20'
                  }`}
                  title={c.isFalseAlarm ? 'Зняти позначку хибної' : 'Позначити як тренувальну'}
                >
                  <Activity className="w-4 h-4" />
                </button>

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
            </div>
          );
        })}
      </div>

      {/* 4. FALSE LABOR (BRAXTON HICKS) EDUCATIONAL MODAL */}
      {showFalseLaborModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 w-full max-w-sm border border-gray-100 dark:border-zinc-800 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-zinc-800 pb-3">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 rounded-xl bg-purple-100 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400">
                  <Activity className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-base text-gray-900 dark:text-white">Справжні vs Тренувальні</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowFalseLaborModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs leading-relaxed text-gray-600 dark:text-gray-300">
              {/* True Labor block */}
              <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 space-y-1.5">
                <h4 className="font-bold text-rose-700 dark:text-rose-300 flex items-center space-x-1.5">
                  <Flame className="w-4 h-4" />
                  <span>Справжні перейми (пологи)</span>
                </h4>
                <ul className="list-disc list-inside space-y-1 text-rose-950 dark:text-rose-200 pl-0.5">
                  <li><strong>Регулярні</strong> — повторюються через однаковий час і інтервал поступово скорочується.</li>
                  <li><strong>Довгі</strong> — тривають від 45 до 60+ секунд і стають тривалішими.</li>
                  <li><strong>Наростають</strong> — біль стає інтенсивнішим, охоплює живіт і поперек.</li>
                  <li><strong>Не проходять</strong> — продовжуються навіть під час зміни пози, спокою чи теплого душу.</li>
                </ul>
              </div>

              {/* False Labor block */}
              <div className="p-3 rounded-2xl bg-purple-50 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-900/30 space-y-1.5">
                <h4 className="font-bold text-purple-700 dark:text-purple-300 flex items-center space-x-1.5">
                  <Activity className="w-4 h-4" />
                  <span>Тренувальні (Брекстона-Гікса)</span>
                </h4>
                <ul className="list-disc list-inside space-y-1 text-purple-950 dark:text-purple-200 pl-0.5">
                  <li><strong>Нерегулярні</strong> — хаотичні проміжки (то 15 хв, то 4 хв, то 25 хв).</li>
                  <li><strong>Короткі</strong> — зазвичай 15–30 секунд, не нарощують тривалість.</li>
                  <li><strong>Без прогресу</strong> — відчуваються як напруження чи стискання передньої частини живота без наростання болю.</li>
                  <li><strong>Стихають</strong> — якщо випити склянку води, змінити позу, прилягти або прийняти душ.</li>
                </ul>
              </div>

              {/* Rule of thumb */}
              <div className="p-3 rounded-2xl bg-blue-50 dark:bg-blue-950/20 text-blue-950 dark:text-blue-200 text-[11px] flex items-start space-x-2">
                <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <p>
                  Якщо у вас відійшли навколоплідні води, зʼявилися кровʼянисті виділення або перейми регулярні з інтервалом менше 5 хв — негайно звʼяжіться з лікарем або вирушайте в пологовий будинок!
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowFalseLaborModal(false)}
              className="w-full py-2.5 rounded-xl bg-purple-600 text-white font-bold text-xs shadow-md shadow-purple-600/20 active:scale-95 transition"
            >
              Зрозуміло
            </button>
          </div>
        </div>
      )}

      {/* 5. CONFIRM LABOR START MODAL (STOP TIMER FOR BIRTH) */}
      {showLaborConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 w-full max-w-sm border border-gray-100 dark:border-zinc-800 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 rounded-2xl bg-teal-100 dark:bg-teal-950/50 text-teal-600 dark:text-teal-400">
                <Baby className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-extrabold text-base text-gray-900 dark:text-white">Почалися пологи? 🏥</h3>
                <p className="text-xs text-gray-500">Зупинити відлік секундоміра</p>
              </div>
            </div>

            <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
              Це переведе додаток у режим <strong>«В пологах»</strong>: активний секундомір буде зупинено, щоб мама та партнер могли сконцентруватися на пологах. Дані переймів збережуться для історії або звіту лікарю.
            </p>

            <div className="pt-2 flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setShowLaborConfirmModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300 font-bold text-xs"
              >
                Скасувати
              </button>
              <button
                type="button"
                onClick={handleEnterLaborMode}
                className="flex-1 py-2.5 rounded-xl bg-teal-600 text-white font-bold text-xs shadow-md shadow-teal-600/20 active:scale-95 transition flex items-center justify-center space-x-1"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Так, ми в родзалі</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. BABY BORN MODAL */}
      {showBornModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 w-full max-w-sm border border-gray-100 dark:border-zinc-800 shadow-2xl space-y-4 text-center">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-100 dark:bg-rose-950/50 text-rose-600 flex items-center justify-center">
              <Baby className="w-8 h-8" />
            </div>

            <div>
              <h3 className="font-extrabold text-lg text-gray-900 dark:text-white">Малюк народився? 👶✨</h3>
              <p className="text-xs text-gray-500 mt-1">
                Зафіксувати момент народження та підбити підсумок передпологових переймів!
              </p>
            </div>

            <div className="pt-2 flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setShowBornModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300 font-bold text-xs"
              >
                Ще ні
              </button>
              <button
                type="button"
                onClick={handleBabyBorn}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-rose-500 text-white font-bold text-xs shadow-md shadow-rose-500/20 active:scale-95 transition flex items-center justify-center space-x-1"
              >
                <Sparkles className="w-4 h-4 text-amber-200" />
                <span>Так! Народили! 🎉</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. MANUAL ENTRY MODAL */}
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

              {/* False alarm toggle for manual entry */}
              <div className="pt-1">
                <label className="flex items-center space-x-2.5 p-2.5 rounded-xl bg-purple-50 dark:bg-purple-950/30 border border-purple-100 dark:border-purple-900/30 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={manualIsFalse}
                    onChange={(e) => setManualIsFalse(e.target.checked)}
                    className="rounded text-purple-600 focus:ring-purple-500 w-4 h-4"
                  />
                  <div className="text-xs">
                    <span className="font-bold text-purple-900 dark:text-purple-200 block">
                      Тренувальна (Брекстона-Гікса)
                    </span>
                    <span className="text-[10px] text-purple-600 dark:text-purple-400">
                      Не враховувати в розрахунок правила 5-1-1
                    </span>
                  </div>
                </label>
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
