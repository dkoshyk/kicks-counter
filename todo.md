# Instructions for AI Agent: Build Ukrainian Kick Counter iOS PWA

Act as a Senior Frontend Developer. Create a modern, offline-first Progressive Web App (PWA) called **"Поштовхи"** (Fetal Kick Counter) designed specifically for iOS devices following Apple Human Interface Guidelines (HIG).

---

## 🛠️ Stack & Dependencies
- **Framework:** React + Vite + TypeScript
- **Styling:** Tailwind CSS (configured for iOS safe areas and Apple SF system fonts)
- **Database:** Dexie.js (`dexie` and `dexie-react-hooks` for IndexedDB)
- **Icons:** `lucide-react`
- **Effects:** `canvas-confetti` (for completion celebration)
- **Language:** Ukrainian (`uk-UA` locale)

---

## 🎨 Design & UI Requirements (Apple HIG Style)
1. **iOS Native Aesthetic:**
   - Backgrounds: iOS grouped background `#F2F2F7` (Light) / `#000000` (Dark).
   - Cards: White `#FFFFFF` (Light) / `#1C1C1E` (Dark) with `rounded-2xl` corners.
   - Headers & Nav Bar: Translucent frosted glass effect using `backdrop-blur-md bg-white/80 dark:bg-black/80`.
   - Typography: San Francisco system fonts (`-apple-system`, `SF Pro Display`).
   - Tactile Feel: Button press animations (`active:scale-95 transition-transform`).

2. **iOS Safe Area & Notch Handling:**
   - Add `viewport-fit=cover` to meta viewport in `index.html`.
   - Apply `padding-top: env(safe-area-inset-top)` to top header.
   - Apply `padding-bottom: env(safe-area-inset-bottom)` to bottom navigation tab bar.

---

## 🗄️ Database Schema (`src/db.ts`)
Implement local IndexedDB storage using **Dexie**:

- **Table `sessions`:** `++id, startTime, endTime, kickCount, targetKicks, status, note`
  - `status`: `'active' | 'completed' | 'cancelled'`
- **Table `kicks`:** `++id, sessionId, timestamp`

**Required Database Helper Functions:**
- `startSession(target = 10)`
- `recordKick(sessionId)`
- `undoKick(sessionId)`
- `finishSession(sessionId, note)`
- `exportCSV()` (Generates UTF-8 CSV with Ukrainian column headers: *Дата, Початок, Тривалість, Кількість поштовхів, Нотатка*).

---

## 📱 Application Structure & Screens

### 1. Root Shell (`src/App.tsx`)
- Frosted top header displaying the app title **"Поштовхи"** and current Ukrainian date (e.g., *"1 серпня"*).
- Frosted bottom navigation bar with 4 tabs:
  - **Сесія** (`Activity` icon)
  - **Історія** (`Calendar` icon)
  - **Аналітика** (`BarChart3` icon)
  - **Налаштування** (`Settings` icon)

### 2. Main Session Screen (`src/components/SessionView.tsx`)
- **Idle State:** Show "Розпочати відлік" button and goal selector (default: 10 kicks).
- **Active Session State:**
  - Large main button **"+1 ПОШТОВХ"** with haptic feedback (`navigator.vibrate([50])`).
  - Real-time counter display (e.g., **"7 з 10"**).
  - Elapsed session timer clock (`MM:SS`).
  - Control buttons: **"Скасувати"** (Undo last tap) and **"Завершити"** (Finish session early).
- **Completion State:**
  - When goal is reached, trigger confetti animation.
  - Show modal with input for optional note (e.g., *"Після обіду"*, *"Солодощі"*) and save button.

### 3. History Screen (`src/components/HistoryView.tsx`)
- Group sessions by day (*Сьогодні*, *Учора*, *31 липня*).
- Display duration, start time, total count, and attached notes for each session.

### 4. Analytics Screen (`src/components/AnalyticsView.tsx`)
- Display key metrics:
  - Average time to reach 10 kicks.
  - Total sessions logged.
  - Simple weekly chart showing session length distribution.

### 5. Settings Screen (`src/components/SettingsView.tsx`)
- Target kick count adjustment (default: 10).
- Button **"Завантажити CSV для лікаря"** to export log data.
- Clear all data option with confirmation prompt.

---

## 🚀 Step-by-Step Task Sequence for AI
1. Initialize Vite React project and configure `tailwind.config.js` with iOS colors and safe area utilities.
2. Update `index.html` with iOS PWA meta tags (`apple-mobile-web-app-capable`, `black-translucent`, `viewport-fit=cover`).
3. Build `src/db.ts` database manager using Dexie.
4. Implement UI components step-by-step starting with `SessionView`, followed by `HistoryView`, `AnalyticsView`, and `SettingsView`.
5. Add local PWA Service Worker configuration.