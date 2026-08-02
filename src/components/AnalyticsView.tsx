import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, formatDuration } from '../db';
import { BarChart3, Clock, CheckCircle2, Activity, Sun, Moon, Sunrise, Sunset } from 'lucide-react';

export const AnalyticsView: React.FC = () => {
  const completedSessions = useLiveQuery(async () => {
    return await db.sessions
      .where('status')
      .equals('completed')
      .sortBy('startTime');
  }, []);

  const allSessions = useLiveQuery(async () => {
    return await db.sessions.toArray();
  }, []);

  // Compute analytics
  const totalSessionsCount = allSessions?.length || 0;
  const completedCount = completedSessions?.length || 0;
  const completionRate = totalSessionsCount > 0
    ? Math.round((completedCount / totalSessionsCount) * 100)
    : 0;

  // Average time to reach target
  let avgDurationMs = 0;
  if (completedSessions && completedSessions.length > 0) {
    const totalMs = completedSessions.reduce((acc, s) => {
      if (s.endTime && s.startTime) {
        return acc + (s.endTime - s.startTime);
      }
      return acc;
    }, 0);
    avgDurationMs = totalMs / completedSessions.length;
  }

  // Total kicks recorded
  const totalKicksRecorded = completedSessions
    ? completedSessions.reduce((acc, s) => acc + s.kickCount, 0)
    : 0;

  // Last 7 days chart data
  const getLast7DaysData = () => {
    const days: { label: string; count: number; avgMinutes: number }[] = [];
    const now = new Date();

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const dateStr = d.toDateString();
      const dayLabel = i === 0 ? 'Сьогодні' : d.toLocaleDateString('uk-UA', { weekday: 'short' });

      const daySessions = completedSessions?.filter(
        (s) => new Date(s.startTime).toDateString() === dateStr
      ) || [];

      const totalMs = daySessions.reduce((acc, s) => acc + ((s.endTime || s.startTime) - s.startTime), 0);
      const avgMinutes = daySessions.length > 0 ? Math.round(totalMs / 1000 / 60) : 0;

      days.push({
        label: dayLabel,
        count: daySessions.length,
        avgMinutes
      });
    }

    return days;
  };

  const weeklyData = getLast7DaysData();
  const maxAvgMinutes = Math.max(...weeklyData.map((d) => d.avgMinutes), 1);

  // Time of day breakdown (Morning 6-12, Afternoon 12-18, Evening 18-24, Night 0-6)
  const getTimeOfDayBreakdown = () => {
    const buckets = { morning: 0, afternoon: 0, evening: 0, night: 0 };

    if (completedSessions) {
      completedSessions.forEach((s) => {
        const hour = new Date(s.startTime).getHours();
        if (hour >= 6 && hour < 12) buckets.morning++;
        else if (hour >= 12 && hour < 18) buckets.afternoon++;
        else if (hour >= 18 && hour < 24) buckets.evening++;
        else buckets.night++;
      });
    }
    return buckets;
  };

  const timeBuckets = getTimeOfDayBreakdown();

  return (
    <div className="w-full max-w-md mx-auto pb-8 px-4 space-y-6">
      {/* Header */}
      <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center">
        <BarChart3 className="w-5 h-5 text-rose-500 mr-2" />
        Аналітика активності
      </h2>

      {/* Primary KPI Cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white dark:bg-[#1C1C1E] p-4 rounded-2xl border border-gray-100 dark:border-zinc-800/80 shadow-sm space-y-1">
          <div className="flex items-center text-xs font-semibold text-gray-400">
            <Clock className="w-4 h-4 text-rose-500 mr-1.5" />
            Сер. час цілі
          </div>
          <p className="text-xl font-extrabold text-gray-900 dark:text-white">
            {avgDurationMs > 0 ? formatDuration(avgDurationMs) : '-'}
          </p>
          <p className="text-[11px] text-gray-400">для досягнення 10 поштовхів</p>
        </div>

        <div className="bg-white dark:bg-[#1C1C1E] p-4 rounded-2xl border border-gray-100 dark:border-zinc-800/80 shadow-sm space-y-1">
          <div className="flex items-center text-xs font-semibold text-gray-400">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 mr-1.5" />
            Завершено сесій
          </div>
          <p className="text-xl font-extrabold text-gray-900 dark:text-white">
            {completedCount} <span className="text-xs font-normal text-gray-400">({completionRate}%)</span>
          </p>
          <p className="text-[11px] text-gray-400">всього зафіксовано: {totalKicksRecorded}</p>
        </div>
      </div>

      {/* Weekly Chart */}
      <div className="bg-white dark:bg-[#1C1C1E] p-5 rounded-3xl border border-gray-100 dark:border-zinc-800/80 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center">
            <Activity className="w-4 h-4 text-rose-500 mr-2" />
            Тривалість сесій (останні 7 днів)
          </h3>
          <span className="text-xs text-gray-400 font-medium">хвилини</span>
        </div>

        {/* Bar chart representation */}
        <div className="h-36 flex items-end justify-between pt-6 px-1 gap-2">
          {weeklyData.map((day, idx) => {
            const barHeightPercent = day.avgMinutes > 0
              ? Math.max(12, Math.round((day.avgMinutes / maxAvgMinutes) * 100))
              : 6;

            return (
              <div key={idx} className="flex-1 flex flex-col items-center h-full justify-end group">
                {/* Value tooltip label */}
                <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400 mb-1">
                  {day.avgMinutes > 0 ? `${day.avgMinutes}м` : ''}
                </span>

                {/* Bar element */}
                <div
                  style={{ height: `${barHeightPercent}%` }}
                  className={`w-full max-w-[28px] rounded-t-xl transition-all duration-500 ${
                    day.avgMinutes > 0
                      ? 'bg-gradient-to-t from-rose-500 to-pink-400 shadow-sm shadow-rose-500/20'
                      : 'bg-gray-100 dark:bg-zinc-800'
                  }`}
                />

                {/* Day label */}
                <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mt-2 capitalize">
                  {day.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Time of Day Distribution */}
      <div className="bg-white dark:bg-[#1C1C1E] p-5 rounded-3xl border border-gray-100 dark:border-zinc-800/80 shadow-sm space-y-4">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">
          Пікова активність за часом доби
        </h3>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-gray-50 dark:bg-zinc-800/60 rounded-2xl flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-amber-100 dark:bg-amber-950/40 text-amber-500">
              <Sunrise className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-gray-400 font-medium">Ранок (6-12)</p>
              <p className="text-sm font-bold text-gray-800 dark:text-gray-100">
                {timeBuckets.morning} сесій
              </p>
            </div>
          </div>

          <div className="p-3 bg-gray-50 dark:bg-zinc-800/60 rounded-2xl flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-orange-100 dark:bg-orange-950/40 text-orange-500">
              <Sun className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-gray-400 font-medium">День (12-18)</p>
              <p className="text-sm font-bold text-gray-800 dark:text-gray-100">
                {timeBuckets.afternoon} сесій
              </p>
            </div>
          </div>

          <div className="p-3 bg-gray-50 dark:bg-zinc-800/60 rounded-2xl flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-rose-100 dark:bg-rose-950/40 text-rose-500">
              <Sunset className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-gray-400 font-medium">Вечір (18-24)</p>
              <p className="text-sm font-bold text-gray-800 dark:text-gray-100">
                {timeBuckets.evening} сесій
              </p>
            </div>
          </div>

          <div className="p-3 bg-gray-50 dark:bg-zinc-800/60 rounded-2xl flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-indigo-100 dark:bg-indigo-950/40 text-indigo-400">
              <Moon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-gray-400 font-medium">Ніч (0-6)</p>
              <p className="text-sm font-bold text-gray-800 dark:text-gray-100">
                {timeBuckets.night} сесій
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
