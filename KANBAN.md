# 🎲 Rubik's Cube Trainer - Kanban Board

## ✅ Done (27)

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
| 25 | Enhanced OLL/PLL case recognition | `734402d` | ✅ |
| 26 | Mobile drill mode buttons | `b5cf6d1` | ✅ |
| 27 | Kanban board management | `dbc707b` | ✅ |

## 📋 Todo (11 remaining)

| # | Task | Priority | Est. |
|:--|:-----|:---------|:-----|
| 28 | Formula visual diagram — SVG mini-cube | 🟡 Med | 1h |
| 29 | Wrong move correction — auto-pause on error | 🔴 High | 30m |
| 30 | Timed drill — best time per formula, PB tracking | 🟡 Med | 30m |
| 31 | Solve reconstruction — track full solve | 🔴 High | 1h |
| 32 | Phase timing breakdown (cross/F2L/OLL/PLL) | 🟡 Med | 30m |
| 33 | Solve statistics dashboard — charts | 🟡 Med | 30m |
| 34 | Learn mode — animated 3D demo | 🟡 Med | 1.5h |
| 35 | Case recognition training game | 🟢 Low | 30m |
| 36 | Cube color scheme presets | 🟢 Low | 30m |
| 37 | Competitive mode — global averages | 🟢 Low | 30m |
| 38 | Full dark mode polish | 🟢 Low | 30m |

---

## 🏗️ Architecture Summary

**BLE Protocol (QiYi Smart Cube)**:
- Service: `0000fff0-0000-1000-8000-00805f9b34fb`
- Char: `0000fff6` (read+write+notify)
- AES-128-ECB key: `57b1f9abcd5ae8a79cb98ce7578c5108`
- Move bytes: `0x01-0x0C` (L/L'/R/R'/U/U'/D/D'/F/F'/B/B')

**Formula Expansion Engine**:
- `expandSteps()`: U2→[U,U], R2→[R,R], etc.
- Auto-skip: M, r, x, y, z (BLE undetectable)

**Case Recognition**:
- `recognizeOLLCase()`: dot, L-shape, line, cross, fish patterns
- `recognizePLLCase()`: H, Z, Ua, Ub, T, Y, V, Na patterns

**Practice Modes**:
- Single formula practice
- Drill mode (×5/×10/×20 random formulas)
- Timer mode (space bar, AO5/AO12)
- Fullscreen immersive mode

## 🔗 Links

- **Live**: https://hermes-web-app.vercel.app/rubik-cube
- **Repo**: https://github.com/ZhangKe-Zoe/hermes-web-app
- **BLE Protocol**: https://codeberg.org/Flying-Toast/qiyi_smartcube_protocol

---
*Last updated: 2026-06-04 — 27 done, 11 remaining*
