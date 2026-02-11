# Titan Chess FREE

Open-source chess analysis extension for [chess.com](https://chess.com).  
Powered by Stockfish WASM — runs entirely in your browser, no server needed.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Manifest V3](https://img.shields.io/badge/manifest-v3-green)
![Engine](https://img.shields.io/badge/engine-Stockfish%20WASM-orange)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

---

## Overview

Titan Chess FREE is a browser extension that overlays move suggestions on chess.com games using a local Stockfish engine. Everything runs client-side — no accounts, no servers, no data collection.

### Key Features

- **Local Stockfish Engine** — Runs Stockfish via WebAssembly in a Blob Worker, fully offline
- **9 ELO Levels** — Bronze (1000) through Expert (1900) with calibrated skill/depth settings
- **Combat Mode** — Higher depth and skill for each ELO level when you need an edge
- **Queue Mode** — Pre-analyzes during opponent's turn for faster suggestions
- **Arrow & Highlight Modes** — Visual move suggestions with customizable colors
- **5 Themes** — Dark, Light, Purple, Green, Orange
- **Draggable Widget** — Floating dashboard with tabbed interface
- **Settings Persistence** — All preferences saved via `chrome.storage`

## Installation

### Chrome / Edge / Brave

1. Download or clone this repository
2. Open `chrome://extensions` (or `edge://extensions`)
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked**
5. Select the `Titan_Chess_FREE` folder
6. Navigate to [chess.com](https://chess.com) and start a game

### Mobile (Android)

See [MOBILE_GUIDE.md](MOBILE_GUIDE.md) for installation on Kiwi Browser and Lemur Browser.

## Project Structure

```
Titan_Chess_FREE/
├── manifest.json              # Extension config (MV3)
├── background/
│   └── service-worker.js      # Background script
├── content/
│   ├── state.js               # Shared runtime state (window.TitanState)
│   ├── board.js               # Board detection & FEN parser
│   ├── drawing.js             # Canvas arrow/highlight rendering
│   ├── engine.js              # Stockfish WASM engine wrapper
│   ├── widget.js              # Floating widget UI & event handlers
│   ├── content.js             # Main loop, message handler, boot sequence
│   └── widget.css             # Widget styles with CSS custom properties
├── engine/
│   ├── stockfish.js           # Stockfish JS (compiled from C++)
│   └── stockfish.wasm         # Stockfish WebAssembly binary
├── popup/
│   ├── popup.html             # Extension popup page
│   ├── popup.js               # Popup logic
│   └── popup.css              # Popup styles
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Module Load Order

Files are loaded in this exact order (defined in `manifest.json`):

```
state.js → board.js → drawing.js → engine.js → widget.js → content.js
```

All modules share state through `window.TitanState`. If you add a new module, register it in the correct position in the manifest and expose its API on `window.Titan*`.

## Architecture

### How It Works

1. **Board Detection** (`board.js`) — Scrapes chess.com's DOM to find the board element, reads piece positions, and builds a FEN string
2. **Monitor Loop** (`content.js`) — Polls the board every 100ms, detects position changes and new games
3. **Engine Analysis** (`engine.js`) — Sends the FEN to Stockfish, receives best move, applies ELO-based error rate
4. **Rendering** (`drawing.js`) — Draws arrows or highlights on a full-viewport canvas overlay
5. **Widget** (`widget.js`) — Provides the floating dashboard for user interaction

### Blob Worker Pattern

Chrome MV3 content scripts can't create Workers from `chrome-extension://` URLs. We work around this by:

1. Fetching `stockfish.js` and `stockfish.wasm` as raw data
2. Wrapping the JS in a Blob with WASM fetch interception
3. Creating the Worker from `URL.createObjectURL(blob)`

This is the only pattern that works reliably in MV3 content scripts. Don't try to simplify it.

## Configuration

### ELO Levels

Defined in `engine.js`. Each level maps to a Stockfish config:

| Level | Label | Skill | Depth | UCI ELO | Error Rate |
|-------|-------|-------|-------|---------|------------|
| 1000 | BRONZE | 1 | 6 | 1000 | 25% |
| 1200 | BRONZE+ | 4 | 8 | 1200 | 20% |
| 1300 | SILVER | 7 | 10 | 1300 | 15% |
| 1400 | SILVER+ | 10 | 12 | 1400 | 12% |
| 1500 | SILVER++ | 13 | 14 | 1500 | 10% |
| 1600 | GOLD | 15 | 16 | 1600 | 8% |
| 1700 | GOLD+ | 17 | 18 | 1700 | 6% |
| 1800 | GOLD++ | 18 | 20 | 1800 | 4% |
| 1900 | EXPERT | 19 | 22 | 1900 | 3% |

**Error Rate** = probability the engine intentionally skips a move (makes lower levels feel more human).

To add a new level, update `ELO_LEVELS`, `ELO_LABELS`, and `ELO_CONFIG` in `engine.js`. Keep them in sync.

### Combat Mode

Same ELO keys but with higher depth, skill, and lower error rates. Defined in `COMBAT_CONFIG` in `engine.js`.

## Contributing

The codebase is modular and well-commented. Each file has a block header explaining what it does, what's safe to change, and what you should leave alone.

### Quick Guide for Contributors

- **Want to adjust ELO strength?** → Edit `ELO_CONFIG` / `COMBAT_CONFIG` in `engine.js`
- **Want to change arrow appearance?** → Edit `drawArrowShape()` / `drawKnightArrow()` in `drawing.js`
- **Want to add a new tab?** → Add HTML in `widget.js`, the tab handler is generic
- **Want to add a new setting?** → Save in the relevant handler, restore in `loadWidgetSettings()` in `widget.js`
- **Board detection broken?** → Update selectors in `findBoard()` / `getFen()` in `board.js`

### Things to Watch Out For

- **chess.com DOM changes** — They update their markup periodically. Board selectors in `board.js` may need updating.
- **CSS conflicts** — chess.com's styles are aggressive. Use `!important` and inline styles as needed in `widget.css`.
- **Blob Worker** — Don't change the Worker creation pattern in `engine.js`. It's the only way that works in MV3.
- **Load order** — Modules depend on each other. `state.js` must be first, `content.js` must be last.

## Comparison: FREE vs Premium

| Feature | FREE | Premium |
|---------|------|---------|
| Engine | Stockfish (local) | Titan_Chess + Stockfish (VPS) |
| ELO Range | 1000 — 1900 | 1000 — 2500 |
| Combat Mode | ✅ | ✅ |
| Threat Detection | Basic | Advanced (piece analysis) |
| Queue Mode | ✅ | ✅ |
| Eval Bar | ❌ | ✅ |
| Play Styles | ❌ | Aggressive, Defensive, etc. |
| Themes | 5 themes | 5 themes |
| Account System | ❌ | ✅ (license-based) |
| Server Required | No | Yes (VPS backend) |

Interested in Premium? Visit [titanchess.store](https://titanchess.store).

## Tech Stack

- **Runtime**: Chrome Extension Manifest V3
- **Engine**: Stockfish 16 (compiled to WASM)
- **UI**: Vanilla JS + CSS Custom Properties
- **Storage**: `chrome.storage.local`
- **Build Tools**: None — zero dependencies, no bundler

## License

MIT — free to use, modify, and distribute.

---

Built with ♟️ by the Titan Chess team
