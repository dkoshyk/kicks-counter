---
name: poshtovhy-development
description: >-
  Expert guide and workflows for developing, styling, debugging, and extending the
  "Поштовхи" (Kick Counter & Pregnancy Companion) iOS PWA. Use this skill when
  implementing new modules (Contraction Timer, Hospital Bag Checklist, Shopping Wishlist
  with Link Preview), modifying Dexie IndexedDB schemas, handling WebRTC P2P sync
  between partners, or adhering to Apple Human Interface Guidelines (HIG) and Tailwind styling.
---

# Poshtovhy PWA Development Skill

This skill guides the agent through maintaining, extending, and testing the **Поштовхи** iOS Progressive Web App (PWA).

---

## 🛠️ Stack & Architecture Overview

- **Runtime & UI:** React 19 + TypeScript + Vite 8
- **Styling:** Tailwind CSS v4 + Apple HIG iOS native styling (`#F2F2F7` light / `#000000` dark, `backdrop-blur-md`, safe areas `pt-safe`, `pb-safe`)
- **Storage:** Dexie.js (IndexedDB wrapper with reactive hooks)
- **Networking & Sync:** PeerJS (WebRTC P2P mesh for partner sync)
- **Icons & Effects:** `lucide-react`, `canvas-confetti`
- **Linting & Verification:** `oxlint`, `tsc -b && vite build`

---

## 📂 Core Workflows & Guidelines

### 1. Database Schema Extensions (`src/db.ts`)
When introducing or modifying tables in Dexie:
1. Increment the database schema version if altering existing stores.
2. Define TypeScript interfaces for every entity (`Contraction`, `HospitalBag`, `BagItem`, `ShoppingItem`).
3. Add helper CRUD functions with comprehensive error handling.
4. Update `BackupData` export/import logic to preserve full database dumps.
5. Export data to Ukrainian CSV format with proper UTF-8 BOM (`\uFEFF`) to ensure Excel compatibility on macOS and Windows.

### 2. Apple HIG & iOS Safari PWA Guidelines
1. **Safe Area Insets:** Always respect `pt-safe` on sticky headers and `pb-safe` on sticky bottom tab bars and floating action buttons.
2. **Tactile Feedback:** Use `navigator.vibrate?.([30])` on primary interactive elements (kick count, checklist toggling, timer start/stop).
3. **Background & Lock Screen Resilience:** Never rely solely on `setInterval` for timers. Always store the wall-clock `Date.now()` timestamp and compute elapsed duration dynamically `Math.floor((Date.now() - startTime) / 1000)` upon wake/re-render.
4. **Frosted Glass:** Use `backdrop-blur-md bg-white/80 dark:bg-zinc-900/80` for header and navigation components.

### 3. WebRTC P2P Partner Sync (`src/utils/p2pSync.ts`)
When synchronizing new data between devices:
1. Extend `P2PPayload['type']` with new message types.
2. Keep payload sizes minimal; prefer incremental delta updates over full database re-transmissions.
3. Prevent duplicate merges by deduplicating against timestamps or client-generated unique IDs.
4. Auto-reconnect on browser `online` and `visibilitychange` events.

### 4. Link Metadata Scraping (Shopping Wishlist)
1. In-browser client requests cannot bypass CORS for direct HTML scraping.
2. Use the primary metadata endpoint (`https://api.microlink.io?url=...`).
3. Provide a fallback proxy (`https://api.allorigins.win/get?url=...`) parsing OpenGraph (`og:image`, `og:title`, `og:description`, `product:price:amount`).
4. Always provide an inline manual editor in the UI for cases where websites block automated scrapers.

---

## 📋 Verification Checklist

Before finishing any change:
1. Run `npm run lint` to check for Oxlint errors.
2. Run `npm run build` (`tsc -b && vite build`) to ensure type safety and build validity.
3. Verify both Light Mode and Dark Mode rendering.
