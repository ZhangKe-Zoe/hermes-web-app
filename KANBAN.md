# 🎲 Rubik's Cube Trainer - Kanban Board

## ✅ Done (21)

| # | Task | Commit | Status |
|:--|:-----|:-------|:-------|
| 1 | BLE move matching fix (stale closure) | `6092e68` | ✅ |
| 2 | iOS BLE support (Bluefy banner) | `d7c34d4` | ✅ |
| 3 | Light theme background | `1308b72` | ✅ |
| 4 | Smart guidance auto-load formula | `6deca84` | ✅ |
| 5 | Cube 3D proportions fix | `d66bd7e` | ✅ |
| 6 | MAC address config panel | `d66bd7e` | ✅ |
| 7 | Mobile responsive layout | `2a04602` | ✅ |
| 8 | Complete CFOP formula library (57 OLL + 21 PLL + 41 F2L) | `0d9ae21` | ✅ |
| 9 | Practice history & localStorage persistence | `7d94336` | ✅ |
| 10 | Scramble generator (WCA-style 20 moves) | `0d9ae21` | ✅ |
| 11 | Timer mode (space bar, AO5/AO12) | `230374c` | ✅ |
| 12 | Export/import data (JSON) | `230374c` | ✅ |
| 13 | F2/U2/R2 double-move BLE recognition | `bfe9757` | ✅ |
| 14 | M/r/x/y/z undetectable move auto-skip | `bfe9757` | ✅ |
| 15 | Duplicate settings button fix | `3ec7c50` | ✅ |
| 16 | Formula notation guide (❓ symbol) | `3ec7c50` | ✅ |
| 17 | Formula search/filter | `67d40a2` | ✅ |
| 18 | Sound feedback (match/wrong/complete) | `67d40a2` | ✅ |
| 19 | Fullscreen practice mode | `67d40a2` | ✅ |
| 20 | Keyboard shortcuts (F/Space/Esc) | `41abd6b` | ✅ |
| 21 | Dark/light theme toggle | `41abd6b` | ✅ |
| 22 | Drill mode (×5/×10/×20 sequential) | `58c71e1` | ✅ |
| 23 | Personalized recommendations | `b2e4b42` | ✅ |
| 24 | 3D cube React.memo optimization | `pending` | ✅ |

## 🔄 In Progress

| # | Task | Priority | Est. |
|:--|:-----|:---------|:-----|
| 25 | OLL/PLL case recognition system | 🔴 High | 2h |

## 📋 Todo — Phase 1: Core Experience (2h)

| # | Task | Priority | Est. |
|:--|:-----|:---------|:-----|
| 26 | Formula visual diagram — SVG mini-cube showing before/after state | 🔴 High | 1h |
| 27 | Wrong move correction — auto-pause on error, highlight expected move | 🔴 High | 30m |
| 28 | Practice mode: timed drill — best time per formula, PB tracking | 🟡 Med | 30m |

## 📋 Todo — Phase 2: Solve Analysis (2h)

| # | Task | Priority | Est. |
|:--|:-----|:---------|:-----|
| 29 | Solve reconstruction — track full solve from BLE state changes | 🔴 High | 1h |
| 30 | Phase timing breakdown — cross/F2L/OLL/PLL time per solve | 🔴 High | 30m |
| 31 | Solve statistics dashboard — charts for solve times, accuracy trends | 🟡 Med | 30m |

## 📋 Todo — Phase 3: Learning System (2h)

| # | Task | Priority | Est. |
|:--|:-----|:---------|:-----|
| 32 | Learn mode — animated step-by-step demo on 3D cube | 🔴 High | 1.5h |
| 33 | Case recognition training — show cube pattern, user picks formula | 🟡 Med | 30m |

## 📋 Todo — Phase 4: Polish & Extras (2h)

| # | Task | Priority | Est. |
|:--|:-----|:---------|:-----|
| 34 | Cube color scheme presets (standard/competition/custom) | 🟡 Med | 30m |
| 35 | Competitive mode — compare with global averages per formula | 🟢 Low | 30m |
| 36 | Mobile drill mode buttons (currently desktop only) | 🟡 Med | 15m |
| 37 | Full dark mode — update all card/text colors for theme | 🟡 Med | 30m |
| 38 | Code cleanup — extract shared types, deduplicate expand logic | 🟡 Med | 30m |

---

## 🏗️ Architecture Notes

- **BLE Protocol**: QiYi QY-QYSC-S-CC3E, service `fff0`, char `fff6`, AES-128-ECB
- **Move bytes**: 0x01-0x0C only (L/L'/R/R'/U/U'/D/D'/F/F'/B/B'), no double/slice/wide moves
- **Formula expansion**: `expandSteps()` converts U2→[U,U], skips M/r/x/y/z
- **Framework**: Next.js 15, no Tailwind (inline styles), Vercel deploy
- **State**: React hooks + localStorage for persistence
- **3D**: CSS `transform-style: preserve-3d` with 27 cubies

## 🔗 Links

- **Live**: https://hermes-web-app.vercel.app/rubik-cube
- **Repo**: https://github.com/ZhangKe-Zoe/hermes-web-app
- **BLE Protocol**: https://codeberg.org/Flying-Toast/qiyi_smartcube_protocol

---
*Last updated: 2026-06-04 — 24 done, 1 in progress, 13 todo*
