import { useState, useEffect } from 'react';
import { Activity, Calendar, BarChart3, Settings, Heart } from 'lucide-react';
import { SessionView } from './components/SessionView';
import { HistoryView } from './components/HistoryView';
import { AnalyticsView } from './components/AnalyticsView';
import { SettingsView } from './components/SettingsView';

export type TabType = 'session' | 'history' | 'analytics' | 'settings';

export function App() {
  const [activeTab, setActiveTab] = useState<TabType>('session');
  const [defaultTargetKicks, setDefaultTargetKicks] = useState<number>(() => {
    const saved = localStorage.getItem('kick_counter_default_target');
    return saved ? parseInt(saved, 10) : 10;
  });

  const [userName, setUserName] = useState<string>(() => {
    return localStorage.getItem('kick_counter_user_name') || 'Діанка';
  });

  const [isDedicatedMode, setIsDedicatedMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('kick_counter_dedicated_mode');
    return saved !== null ? saved === 'true' : true;
  });

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('kick_counter_theme');
    if (saved) return saved === 'dark';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // Handle dark mode class on <html>
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('kick_counter_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('kick_counter_theme', 'light');
    }
  }, [darkMode]);

  const handleUpdateDefaultTarget = (newTarget: number) => {
    setDefaultTargetKicks(newTarget);
    localStorage.setItem('kick_counter_default_target', newTarget.toString());
  };

  const handleUpdateUserName = (newName: string) => {
    setUserName(newName);
    localStorage.setItem('kick_counter_user_name', newName);
  };

  const handleToggleDedicatedMode = () => {
    const nextVal = !isDedicatedMode;
    setIsDedicatedMode(nextVal);
    localStorage.setItem('kick_counter_dedicated_mode', nextVal ? 'true' : 'false');
  };

  // Format today's Ukrainian date string (e.g. "1 серпня")
  const getFormattedDate = () => {
    const today = new Date();
    return today.toLocaleDateString('uk-UA', {
      day: 'numeric',
      month: 'long'
    });
  };

  return (
    <div className="min-h-screen bg-[#F2F2F7] dark:bg-black text-gray-900 dark:text-gray-100 flex flex-col font-sans selection:bg-pink-500 selection:text-white">
      {/* FROSTED TOP HEADER */}
      <header className="sticky top-0 z-40 w-full pt-safe ios-glass dark:ios-glass-dark border-b border-gray-200/60 dark:border-zinc-800/60">
        <div className="max-w-md mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-rose-500 to-pink-500 flex items-center justify-center shadow-md shadow-rose-500/20">
              <Heart className="w-4 h-4 text-white fill-white" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold tracking-tight bg-gradient-to-r from-gray-900 via-rose-950 to-rose-700 dark:from-white dark:via-rose-100 dark:to-rose-400 bg-clip-text text-transparent leading-none">
                Поштовхи
              </h1>
              {isDedicatedMode ? (
                <span className="text-[10px] font-semibold text-rose-500 dark:text-rose-400 block leading-tight mt-0.5">
                  для {userName || 'вас'} ❤️
                </span>
              ) : (
                <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 block leading-tight mt-0.5">
                  {userName ? `Кабінет: ${userName}` : 'Лічильник поштовхів'}
                </span>
              )}
            </div>
          </div>

          <div className="text-xs font-semibold px-3 py-1 rounded-full bg-gray-100 dark:bg-zinc-800/80 text-gray-600 dark:text-gray-300 border border-gray-200/50 dark:border-zinc-700/50">
            {getFormattedDate()}
          </div>
        </div>
      </header>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 w-full pt-4 pb-24">
        {activeTab === 'session' && (
          <SessionView
            defaultTargetKicks={defaultTargetKicks}
            userName={userName}
          />
        )}
        {activeTab === 'history' && <HistoryView />}
        {activeTab === 'analytics' && <AnalyticsView />}
        {activeTab === 'settings' && (
          <SettingsView
            defaultTargetKicks={defaultTargetKicks}
            onUpdateDefaultTarget={handleUpdateDefaultTarget}
            darkMode={darkMode}
            onToggleDarkMode={() => setDarkMode(!darkMode)}
            userName={userName}
            onUpdateUserName={handleUpdateUserName}
            isDedicatedMode={isDedicatedMode}
            onToggleDedicatedMode={handleToggleDedicatedMode}
          />
        )}
      </main>

      {/* FROSTED BOTTOM TAB BAR */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 pb-safe ios-glass dark:ios-glass-dark border-t border-gray-200/60 dark:border-zinc-800/60">
        <div className="max-w-md mx-auto h-16 grid grid-cols-4 px-2">
          <button
            type="button"
            onClick={() => setActiveTab('session')}
            className={`flex flex-col items-center justify-center space-y-1 transition-transform duration-150 active:scale-95 ${
              activeTab === 'session'
                ? 'text-rose-500 font-bold'
                : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 font-medium'
            }`}
          >
            <Activity className="w-5 h-5" />
            <span className="text-[11px]">Сесія</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`flex flex-col items-center justify-center space-y-1 transition-transform duration-150 active:scale-95 ${
              activeTab === 'history'
                ? 'text-rose-500 font-bold'
                : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 font-medium'
            }`}
          >
            <Calendar className="w-5 h-5" />
            <span className="text-[11px]">Історія</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('analytics')}
            className={`flex flex-col items-center justify-center space-y-1 transition-transform duration-150 active:scale-95 ${
              activeTab === 'analytics'
                ? 'text-rose-500 font-bold'
                : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 font-medium'
            }`}
          >
            <BarChart3 className="w-5 h-5" />
            <span className="text-[11px]">Аналітика</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`flex flex-col items-center justify-center space-y-1 transition-transform duration-150 active:scale-95 ${
              activeTab === 'settings'
                ? 'text-rose-500 font-bold'
                : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 font-medium'
            }`}
          >
            <Settings className="w-5 h-5" />
            <span className="text-[11px]">Налаштування</span>
          </button>
        </div>
      </nav>
    </div>
  );
}

export default App;
