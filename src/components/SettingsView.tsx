import React, { useState, useRef, useEffect } from 'react';
import QRCode from 'qrcode';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { exportCSV, exportBackupJSON, importBackupJSON, clearAllData } from '../db';
import { requestNotificationPermission, getNotificationPermissionState, triggerKickReminderNotification } from '../utils/notifications';
import { p2pSyncManager } from '../utils/p2pSync';
import { Settings, Download, Upload, Trash2, ShieldCheck, HeartHandshake, Moon, Sun, Heart, Sparkles, Bell, CheckCircle2, AlertCircle, User, Users, QrCode, Camera, RefreshCw, X, Radio, Copy } from 'lucide-react';

interface SettingsViewProps {
  defaultTargetKicks: number;
  onUpdateDefaultTarget: (newTarget: number) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  userName: string;
  onUpdateUserName: (name: string) => void;
  isDedicatedMode: boolean;
  onToggleDedicatedMode: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  defaultTargetKicks,
  onUpdateDefaultTarget,
  darkMode,
  onToggleDarkMode,
  userName,
  onUpdateUserName,
  isDedicatedMode,
  onToggleDedicatedMode
}) => {
  const [targetInput, setTargetInput] = useState<number>(defaultTargetKicks);
  const [nameInput, setNameInput] = useState<string>(userName);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // P2P State
  const [p2pRole, setP2pRole] = useState<'master' | 'slave' | 'none'>(p2pSyncManager.getRole());
  const [p2pStatus, setP2pStatus] = useState<string>('Не підключено');
  const [connectedCount, setConnectedCount] = useState<number>(0);
  const [showMasterQrModal, setShowMasterQrModal] = useState<boolean>(false);
  const [masterQrDataUrl, setMasterQrDataUrl] = useState<string>('');
  const [showScannerModal, setShowScannerModal] = useState<boolean>(false);
  const [manualRoomInput, setManualRoomInput] = useState<string>('');
  const [copiedRoomCode, setCopiedRoomCode] = useState<boolean>(false);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  // Notification state
  const [reminderEnabled, setReminderEnabled] = useState<boolean>(() => {
    return localStorage.getItem('kick_counter_reminder_enabled') === 'true';
  });
  const [reminderTime, setReminderTime] = useState<string>(() => {
    return localStorage.getItem('kick_counter_reminder_time') || '09:00';
  });
  const [permissionState, setPermissionState] = useState<string>(getNotificationPermissionState());

  useEffect(() => {
    p2pSyncManager.setOnStatusChange((status, count) => {
      setP2pStatus(status);
      setConnectedCount(count);
      setP2pRole(p2pSyncManager.getRole());
    });

    p2pSyncManager.setOnSessionReceived((msg) => {
      setExportMessage(msg);
      setTimeout(() => setExportMessage(null), 4000);
    });
  }, []);

  // Cleanup scanner on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(() => {});
      }
    };
  }, []);

  const handleStartMasterMode = async () => {
    try {
      const roomId = await p2pSyncManager.initMaster();
      const qrUrl = await QRCode.toDataURL(roomId, {
        width: 360,
        margin: 4,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#FFFFFF' }
      });
      setMasterQrDataUrl(qrUrl);
      setShowMasterQrModal(true);
      setP2pRole('master');
    } catch (err) {
      alert('Помилка створення P2P кімнати');
    }
  };

  const handleStartScanner = () => {
    setShowScannerModal(true);
    setTimeout(() => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(() => {});
      }
      const scanner = new Html5QrcodeScanner(
        'p2p-qr-reader',
        {
          fps: 15,
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            const minDim = Math.min(viewfinderWidth, viewfinderHeight);
            return { width: Math.floor(minDim * 0.8), height: Math.floor(minDim * 0.8) };
          },
          aspectRatio: 1.0,
          showTorchButtonIfSupported: true
        },
        false
      );

      scanner.render(
        async (decodedText) => {
          scanner.clear().catch(() => {});
          setShowScannerModal(false);
          await connectToRoom(decodedText);
        },
        () => {}
      );

      scannerRef.current = scanner;
    }, 300);
  };

  const connectToRoom = async (roomId: string) => {
    try {
      setExportMessage(`Підключення до кімнати ${roomId}...`);
      await p2pSyncManager.connectAsSlave(roomId.trim());
      setP2pRole('slave');
      setExportMessage('Успішно підключено до мами! 🌸');
      setTimeout(() => setExportMessage(null), 4000);
    } catch (err) {
      alert('Не вдалося підключитися до кімнати. Перевірте код або спробуйте ще раз.');
      setExportMessage(null);
    }
  };

  const handleDisconnectP2P = () => {
    p2pSyncManager.disconnectAll();
    setP2pRole('none');
    setShowMasterQrModal(false);
  };

  const handleManualSyncRequest = () => {
    p2pSyncManager.requestManualSync();
    setExportMessage('Запит синхронізації відправлено мамі...');
    setTimeout(() => setExportMessage(null), 3000);
  };

  const handleCopyRoomCode = () => {
    const code = p2pSyncManager.getRoomId();
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopiedRoomCode(true);
    setTimeout(() => setCopiedRoomCode(false), 3000);
  };

  const handleToggleReminder = async () => {
    if (!reminderEnabled) {
      setReminderEnabled(true);
      if ('Notification' in window) {
        await requestNotificationPermission();
      }
      setPermissionState(getNotificationPermissionState());
    } else {
      setReminderEnabled(false);
    }
  };

  const handleTestNotification = async () => {
    if ('Notification' in window && Notification.permission !== 'granted') {
      await requestNotificationPermission();
      setPermissionState(getNotificationPermissionState());
    }
    triggerKickReminderNotification(userName || 'Мама');
    setExportMessage('Тестове сповіщення відправлено!');
    setTimeout(() => setExportMessage(null), 3000);
  };

  const handleSaveTarget = (val: number) => {
    setTargetInput(val);
    onUpdateDefaultTarget(val);
  };

  const handleSaveName = (val: string) => {
    setNameInput(val);
    onUpdateUserName(val);
  };

  const handleExportCSV = async () => {
    try {
      setIsExporting(true);
      const csvStr = await exportCSV();

      const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const filename = `fetal_kicks_report_${new Date().toISOString().slice(0, 10)}.csv`;

      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setExportMessage('Файл CSV для лікаря успішно збережено!');
      setTimeout(() => setExportMessage(null), 4000);
    } catch (err) {
      console.error(err);
      alert('Помилка при експорті CSV');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportBackupJSON = async () => {
    try {
      const jsonStr = await exportBackupJSON();
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const filename = `poshtovhy_backup_${new Date().toISOString().slice(0, 10)}.json`;

      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setExportMessage('Резервна копія (JSON) успішно завантажена!');
      setTimeout(() => setExportMessage(null), 4000);
    } catch (err) {
      console.error(err);
      alert('Помилка при створенні резервної копії');
    }
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const confirmImport = window.confirm(
        'Бажаєте імпортувати дані з цієї резервної копії? Існучі сесії будуть доповнені новими даними.'
      );
      if (!confirmImport) return;

      const result = await importBackupJSON(text, 'merge');
      setImportMessage(
        `Успішно імпортовано: ${result.importedSessionsCount} сесій (${result.importedKicksCount} поштовхів)`
      );
      setTimeout(() => setImportMessage(null), 5000);
    } catch (err) {
      console.error(err);
      alert('Помилка імпорту: неочікуваний формат файлу');
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleClearData = async () => {
    const confirm1 = window.confirm(
      'УВАГА: Ви дійсно бажаєте видалити ВІСЬ журнал та історію поштовхів? Цю дію неможливо скасувати.'
    );
    if (!confirm1) return;

    const confirm2 = window.prompt('Напишіть "ВИДАЛИТИ" для підтвердження:');
    if (confirm2?.trim().toUpperCase() === 'ВИДАЛИТИ') {
      await clearAllData();
      alert('Усі дані успішно очищено.');
    }
  };

  return (
    <div className="w-full max-w-md mx-auto pb-8 px-4 space-y-6">
      {/* Header */}
      <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center">
        <Settings className="w-5 h-5 text-rose-500 mr-2" />
        Налаштування
      </h2>

      {/* Dedication Banner for Wife Dianka if Dedicated Mode is ON */}
      {isDedicatedMode && (
        <div className="w-full bg-gradient-to-r from-rose-500/15 via-pink-500/20 to-purple-500/15 dark:from-rose-950/50 dark:via-pink-950/40 dark:to-purple-950/50 p-4 rounded-3xl border border-pink-200 dark:border-rose-800/40 shadow-sm relative overflow-hidden">
          <div className="flex items-center space-x-3.5 z-10 relative">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-rose-500 to-pink-500 flex items-center justify-center text-white shrink-0 shadow-lg shadow-rose-500/30 animate-pulse">
              <Heart className="w-6 h-6 fill-white" />
            </div>
            <div>
              <div className="flex items-center space-x-1 text-xs font-bold text-rose-600 dark:text-rose-300">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>З ніжністю та любовʼю</span>
              </div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white mt-0.5 leading-snug">
                Створено спеціально для найдорожчої дружини <strong className="text-rose-600 dark:text-rose-400">{nameInput || 'Діанки'}</strong> 💕
              </p>
            </div>
          </div>
        </div>
      )}

      {/* FAMILY P2P LOCAL SYNC CARD (MOTHER & FATHER) */}
      <div className="bg-white dark:bg-[#1C1C1E] p-5 rounded-3xl border border-gray-100 dark:border-zinc-800/80 shadow-sm space-y-4">
        <div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center justify-between">
            <span className="flex items-center">
              <Users className="w-4 h-4 text-rose-500 mr-2" />
              Сімейний доступ P2P (Мама + Тато)
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/50 text-rose-500 border border-rose-100 dark:border-rose-900/40">
              Wi-Fi P2P
            </span>
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Синхронізація сесій між мамою (Майстер) та татом (Отримувач) через QR-код.
          </p>
        </div>

        {/* P2P Status Indicator */}
        <div className="flex items-center justify-between p-3 rounded-2xl bg-gray-50 dark:bg-zinc-800/60 border border-gray-100 dark:border-zinc-800 text-xs">
          <div className="flex items-center space-x-2">
            <Radio className={`w-4 h-4 ${p2pRole !== 'none' ? 'text-emerald-500 animate-pulse' : 'text-gray-400'}`} />
            <span className="font-semibold text-gray-800 dark:text-gray-200">
              {p2pStatus}
            </span>
          </div>
          {p2pRole !== 'none' && (
            <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
              {p2pRole === 'master' ? 'Мама (Майстер)' : 'Тато (Клієнт)'}
            </span>
          )}
        </div>

        {/* Actions for Master & Slave */}
        <div className="space-y-2">
          {p2pRole === 'none' && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleStartMasterMode}
                className="py-3 px-3 bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs rounded-xl shadow-md shadow-rose-500/20 flex items-center justify-center space-x-1.5 transition-all active:scale-95"
              >
                <QrCode className="w-4 h-4" />
                <span>Мама: Показати QR</span>
              </button>

              <button
                type="button"
                onClick={handleStartScanner}
                className="py-3 px-3 bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-800 dark:text-gray-200 font-bold text-xs rounded-xl border border-gray-200 dark:border-zinc-700 flex items-center justify-center space-x-1.5 transition-all active:scale-95"
              >
                <Camera className="w-4 h-4 text-rose-500" />
                <span>Тато: Зчитати QR</span>
              </button>
            </div>
          )}

          {/* Master Controls */}
          {p2pRole === 'master' && (
            <div className="space-y-2">
              <div className="flex space-x-2">
                <button
                  type="button"
                  onClick={() => setShowMasterQrModal(true)}
                  className="w-1/2 py-2.5 bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs rounded-xl shadow-sm flex items-center justify-center space-x-1"
                >
                  <QrCode className="w-4 h-4" />
                  <span>Показати QR ще раз</span>
                </button>
                <button
                  type="button"
                  onClick={handleDisconnectP2P}
                  className="w-1/2 py-2.5 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 text-red-600 dark:text-red-400 font-semibold text-xs rounded-xl border border-red-200 dark:border-red-900/50"
                >
                  Закрити доступ
                </button>
              </div>
            </div>
          )}

          {/* Slave Controls */}
          {p2pRole === 'slave' && (
            <div className="space-y-2">
              <div className="flex space-x-2">
                <button
                  type="button"
                  onClick={handleManualSyncRequest}
                  className="w-1/2 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs rounded-xl shadow-sm flex items-center justify-center space-x-1"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Синхронізувати</span>
                </button>
                <button
                  type="button"
                  onClick={handleDisconnectP2P}
                  className="w-1/2 py-2.5 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 text-red-600 dark:text-red-400 font-semibold text-xs rounded-xl border border-red-200 dark:border-red-900/50"
                >
                  Від'єднатися
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* User Name & Personalization Settings */}
      <div className="bg-white dark:bg-[#1C1C1E] p-5 rounded-3xl border border-gray-100 dark:border-zinc-800/80 shadow-sm space-y-4">
        <div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center">
            <User className="w-4 h-4 text-rose-500 mr-2" />
            Персоналізація профілю
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Налаштуйте імʼя мами для сповіщень та привітань.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block mb-1">
              Імʼя вагітної / мами:
            </label>
            <input
              type="text"
              value={nameInput}
              onChange={(e) => handleSaveName(e.target.value)}
              placeholder="Введіть імʼя..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-sm font-medium text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-gray-100 dark:border-zinc-800">
            <div>
              <p className="text-xs font-bold text-gray-800 dark:text-gray-200">
                Режим присвячення від чоловіка 💕
              </p>
              <p className="text-[11px] text-gray-400">
                {isDedicatedMode ? 'Увімкнено романтичні підписи' : 'Стандартний медичний режим'}
              </p>
            </div>

            <button
              type="button"
              onClick={onToggleDedicatedMode}
              className={`w-12 h-7 flex items-center rounded-full p-1 transition-colors duration-300 ${
                isDedicatedMode ? 'bg-rose-500' : 'bg-gray-300 dark:bg-zinc-700'
              }`}
            >
              <div
                className={`bg-white w-5 h-5 rounded-full shadow-md transform transition-transform duration-300 ${
                  isDedicatedMode ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Daily Notification Reminder Settings */}
      <div className="bg-white dark:bg-[#1C1C1E] p-5 rounded-3xl border border-gray-100 dark:border-zinc-800/80 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-500">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                Щоденне нагадування
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Сповіщення про початок відліку
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleToggleReminder}
            className={`w-12 h-7 flex items-center rounded-full p-1 transition-colors duration-300 ${
              reminderEnabled ? 'bg-rose-500' : 'bg-gray-300 dark:bg-zinc-700'
            }`}
          >
            <div
              className={`bg-white w-5 h-5 rounded-full shadow-md transform transition-transform duration-300 ${
                reminderEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {reminderEnabled && (
          <div className="pt-2 border-t border-gray-100 dark:border-zinc-800 space-y-3 animate-fade-in">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                Час сповіщення:
              </label>
              <input
                type="time"
                value={reminderTime}
                onChange={(e) => setReminderTime(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
            </div>

            <div className="flex items-center justify-between text-xs pt-1">
              <span className="text-gray-500 dark:text-gray-400 flex items-center">
                {permissionState === 'granted' ? (
                  <span className="text-emerald-500 flex items-center font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Дозвіл надано
                  </span>
                ) : (
                  <span className="text-rose-500 flex items-center font-medium">
                    <AlertCircle className="w-3.5 h-3.5 mr-1" /> Нагадування активне
                  </span>
                )}
              </span>

              <button
                type="button"
                onClick={handleTestNotification}
                className="text-xs text-rose-500 hover:text-rose-600 font-bold underline"
              >
                Надіслати тест
              </button>
            </div>

            <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed bg-gray-50 dark:bg-zinc-800/50 p-2.5 rounded-xl">
              🌸 <strong>Нагадування активовано!</strong> Додаток показуватиме сповіщення та картку нагадування для {nameInput || 'вас'} кожного дня.
            </p>
          </div>
        )}
      </div>

      {/* Target Kicks Setting */}
      <div className="bg-white dark:bg-[#1C1C1E] p-5 rounded-3xl border border-gray-100 dark:border-zinc-800/80 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">
              Ціль за замовчуванням
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Стандартна цільова кількість поштовхів
            </p>
          </div>
          <span className="text-lg font-extrabold text-rose-500">
            {targetInput}
          </span>
        </div>

        <div className="grid grid-cols-4 gap-2 pt-1">
          {[5, 10, 15, 20].map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => handleSaveTarget(num)}
              className={`py-2 rounded-xl text-xs font-bold transition-all ${
                targetInput === num
                  ? 'bg-rose-500 text-white shadow-md shadow-rose-500/20'
                  : 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200'
              }`}
            >
              {num} поштовхів
            </button>
          ))}
        </div>
      </div>

      {/* Theme Toggle */}
      <div className="bg-white dark:bg-[#1C1C1E] p-5 rounded-3xl border border-gray-100 dark:border-zinc-800/80 shadow-sm flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-500">
            {darkMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">
              Тема оформлення
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {darkMode ? 'Темний режим iOS' : 'Світлий режим iOS'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleDarkMode}
          className={`w-12 h-7 flex items-center rounded-full p-1 transition-colors duration-300 ${
            darkMode ? 'bg-rose-500' : 'bg-gray-300'
          }`}
        >
          <div
            className={`bg-white w-5 h-5 rounded-full shadow-md transform transition-transform duration-300 ${
              darkMode ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Backup & Restore (JSON) & CSV Export for Doctor */}
      <div className="bg-white dark:bg-[#1C1C1E] p-5 rounded-3xl border border-gray-100 dark:border-zinc-800/80 shadow-sm space-y-4">
        <div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center">
            <Download className="w-4 h-4 text-rose-500 mr-2" />
            Резервне копіювання та перенос даних
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Зберігайте та переносьте всі записи між смартфонами без втрати історії.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2.5">
          {/* JSON Export */}
          <button
            type="button"
            onClick={handleExportBackupJSON}
            className="w-full py-3 px-4 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 text-rose-600 dark:text-rose-300 font-bold text-xs rounded-xl border border-rose-100 dark:border-rose-900/40 shadow-sm active:scale-95 transition-all flex items-center justify-center space-x-2"
          >
            <Download className="w-4 h-4" />
            <span>Зберегти резервну копію (JSON)</span>
          </button>

          {/* JSON Import */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full py-3 px-4 bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-800 dark:text-gray-200 font-bold text-xs rounded-xl border border-gray-200 dark:border-zinc-700 active:scale-95 transition-all flex items-center justify-center space-x-2"
          >
            <Upload className="w-4 h-4 text-rose-500" />
            <span>Імпортувати / Відновити з файлу (JSON)</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileImport}
            className="hidden"
          />

          {/* Doctor CSV Export */}
          <button
            type="button"
            onClick={handleExportCSV}
            disabled={isExporting}
            className="w-full py-3 px-4 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs rounded-xl shadow-md shadow-emerald-500/20 active:scale-95 transition-all flex items-center justify-center space-x-2"
          >
            <Download className="w-4 h-4" />
            <span>Завантажити CSV для лікаря</span>
          </button>
        </div>

        {exportMessage && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium text-center animate-fade-in">
            ✓ {exportMessage}
          </p>
        )}

        {importMessage && (
          <p className="text-xs text-rose-600 dark:text-rose-400 font-semibold text-center animate-fade-in">
            ✓ {importMessage}
          </p>
        )}
      </div>

      {/* Information & Privacy */}
      <div className="bg-white dark:bg-[#1C1C1E] p-5 rounded-3xl border border-gray-100 dark:border-zinc-800/80 shadow-sm space-y-3">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center">
          <ShieldCheck className="w-4 h-4 text-rose-500 mr-2" />
          Конфіденційність та збереження
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          Всі ваші записи зберігаються <strong>виключно на вашому пристрої</strong> (в памʼяті браузера IndexedDB). Додаток працює повністю офлайн і не передає ваші медичні дані на зовнішні сервери.
        </p>
      </div>

      {/* Medical Info standard */}
      <div className="bg-rose-50 dark:bg-rose-950/30 p-5 rounded-3xl border border-rose-100 dark:border-rose-900/30 space-y-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300 flex items-center">
          <HeartHandshake className="w-4 h-4 mr-1.5" />
          Медична порада
        </h4>
        <p className="text-xs text-rose-900 dark:text-rose-200 leading-relaxed">
          Якщо ви помітили значне зменшення активності плоду (менше 10 поштовхів за 2 години) або відсутність рухів у зазвичай активний період, негайно зверніться до вашого лікаря або пологового будинку!
        </p>
      </div>

      {/* Clear All Data */}
      <div className="pt-2">
        <button
          type="button"
          onClick={handleClearData}
          className="w-full py-3 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 text-red-600 dark:text-red-400 font-semibold text-xs rounded-2xl border border-red-200 dark:border-red-900/50 flex items-center justify-center space-x-1.5 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          <span>Очистити всі збережені дані</span>
        </button>
      </div>

      {/* Footer Version & Love Dedication */}
      <div className="text-center pt-2 space-y-1">
        {isDedicatedMode && (
          <p className="text-xs font-medium text-rose-500 dark:text-rose-400 flex items-center justify-center">
            Створено для {userName || 'Діанки'} з любовʼю ❤️
          </p>
        )}
        <p className="text-[11px] text-gray-400 dark:text-gray-600">
          «Поштовхи» v1.5.0 • P2P Family Sync
        </p>
      </div>

      {/* MASTER QR MODAL (MOTHER) */}
      {showMasterQrModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="w-full max-w-sm bg-white dark:bg-[#1C1C1E] rounded-3xl p-6 shadow-2xl border border-gray-100 dark:border-zinc-800 text-center space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center">
                <Users className="w-4 h-4 text-rose-500 mr-1.5" />
                QR-код кімнати мами
              </h3>
              <button
                type="button"
                onClick={() => setShowMasterQrModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-gray-200 dark:border-zinc-700 flex flex-col items-center justify-center space-y-2">
              {masterQrDataUrl ? (
                <img
                  src={masterQrDataUrl}
                  alt="P2P Room QR Code"
                  className="w-60 h-60 rounded-xl shadow-md border-4 border-white"
                />
              ) : (
                <div className="w-60 h-60 flex items-center justify-center text-xs text-gray-400">
                  Генерація QR-коду...
                </div>
              )}
              
              <div className="flex items-center justify-center space-x-2 pt-1">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Код: <strong className="font-mono text-rose-600 dark:text-rose-400">{p2pSyncManager.getRoomId()}</strong>
                </span>
                <button
                  type="button"
                  onClick={handleCopyRoomCode}
                  className="px-2 py-1 bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 text-rose-600 dark:text-rose-300 text-[11px] font-bold rounded-lg border border-rose-200 dark:border-rose-900/40 flex items-center space-x-1"
                >
                  <Copy className="w-3 h-3" />
                  <span>{copiedRoomCode ? 'Скопійовано!' : 'Копіювати'}</span>
                </button>
              </div>

              <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed pt-1">
                Попросіть тата відкрити додатчок та натиснути <strong>«Тато: Зчитати QR»</strong>
              </p>
            </div>

            <div className="flex items-center justify-between text-xs px-2">
              <span className="text-gray-500 dark:text-gray-400">
                Підключено пристроїв: <strong>{connectedCount}</strong>
              </span>
              <button
                type="button"
                onClick={handleDisconnectP2P}
                className="text-red-500 font-bold hover:underline"
              >
                Закрити доступ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SLAVE SCANNER MODAL (FATHER) */}
      {showScannerModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="w-full max-w-sm bg-white dark:bg-[#1C1C1E] rounded-3xl p-6 shadow-2xl border border-gray-100 dark:border-zinc-800 text-center space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center">
                <Camera className="w-4 h-4 text-rose-500 mr-1.5" />
                Зчитати QR-код мами
              </h3>
              <button
                type="button"
                onClick={() => {
                  if (scannerRef.current) {
                    scannerRef.current.clear().catch(() => {});
                  }
                  setShowScannerModal(false);
                }}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Camera scanner element */}
            <div className="w-full bg-black rounded-2xl overflow-hidden min-h-[260px] flex items-center justify-center relative">
              <div id="p2p-qr-reader" className="w-full text-white text-xs"></div>
            </div>

            {/* Manual Room ID Input Fallback */}
            <div className="pt-2 border-t border-gray-100 dark:border-zinc-800 space-y-2">
              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 block text-left">
                Або введіть код кімнати вручну:
              </label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={manualRoomInput}
                  onChange={(e) => setManualRoomInput(e.target.value)}
                  placeholder="poshtovhy-room-..."
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-xs font-mono text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (manualRoomInput) {
                      setShowScannerModal(false);
                      connectToRoom(manualRoomInput);
                    }
                  }}
                  className="px-3 py-2 bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs rounded-xl shadow-sm"
                >
                  Зʼєднати
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
