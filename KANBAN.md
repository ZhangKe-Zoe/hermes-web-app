# 🎲 Rubik's Cube Trainer - Kanban Board

## ✅ Done (33)

| # | Task | Commit | Status |
|:--|:-----|:-------|:-------|
| 1-24 | (Previous tasks from first sprint) | various | ✅ |
| 25 | Enhanced OLL/PLL case recognition | `734402d` | ✅ |
| 26 | Mobile drill mode buttons | `b5cf6d1` | ✅ |
| 27 | Wrong move correction (auto-pause) | `d632b18` | ✅ |
| 28 | Personal Best (PB) tracking | `6253657` | ✅ |
| 29 | Solve reconstruction + phase timing | `108df17` | ✅ |
| 30 | Statistics dashboard with charts | `51b21fe` | ✅ |
| 31 | Learn mode (animated demo) | `7f21aa6` | ✅ |
| 32 | Cube color scheme presets | `71a0f84` | ✅ |
| 33 | Learn mode UI optimization | `cc67d81` | ✅ |

## 📋 Todo (5 remaining)

| # | Task | Priority | Est. |
|:--|:-----|:---------|:-----|
| 34 | Case recognition training game | 🟢 Low | 30m |
| 35 | Competitive mode — global averages | 🟢 Low | 30m |
| 36 | Full dark mode polish | 🟢 Low | 30m |
| 37 | Formula visual diagram (SVG) | 🟡 Med | 1h |
| 38 | Code cleanup & deduplication | 🟡 Med | 30m |

---

## 🏗️ Architecture Summary

**BLE Protocol (QiYi Smart Cube)**:
- Service: `0000fff0-0000-1000-8000-00805f9b34fb`
- Char: `0000fff6` (read+write+notify)
- AES-128-ECB key: `57b1f9abcd5ae8a79cb98ce7578c5108`
- Move bytes: `0x01-0x0C` only

**Color Schemes**: standard, competition, pastel, neon

**Practice Modes**:
- Single formula practice
- Drill mode (×5/×10/×20)
- Timer mode (AO5/AO12)
- Learn mode (animated demo)
- Fullscreen immersive

**Recognition**:
- OLL: dot, L-shape, line, cross, fish patterns
- PLL: H, Z, Ua, Ub, T, Y, V, Na patterns

## 🔗 Links

- **Live**: https://hermes-web-app.vercel.app/rubik-cube
- **Repo**: https://github.com/ZhangKe-Zoe/hermes-web-app

---

*Last updated: 2026-06-04 — Sprint 2 Progress: 33 done, 5 remaining*