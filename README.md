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
- **14 ELO Levels** — Bronze (1000) through Stockfish (3000) with calibrated skill/depth settings
- **Combat Mode** — Higher depth and skill for each ELO level when you need an edge
- **Queue Mode** — Pre-analyzes during opponent's turn for faster suggestions
- **Arrow & Highlight Modes** — Visual move suggestions via DOM injection (works on desktop and mobile)
- **5 Themes** — Dark, Light, Purple, Green, Orange
- **Draggable Widget** — Floating dashboard with tabbed interface
- **Settings Persistence** — All preferences saved via `chrome.storage`
- **Hash Table Caching** — 16MB/32MB transposition table for faster repeated analysis
- **Smart Time Management** — High ELO levels use movetime caps to balance quality and speed
- **Castling Tracking** — Detects when king/rook have moved to generate accurate FEN castling rights
- **Mobile Compatible** — Works on mobile browsers that support extensions (e.g. Lemur Browser)

## Installation

### Chrome / Edge / Brave / Lemur (Android)

1. Download or clone this repository
2. Open `chrome://extensions` (or `edge://extensions`)
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked**
5. Select the project folder
6. Navigate to [chess.com](https://chess.com) and start a game

## Project Structure

```
├── manifest.json              # Extension config (MV3)
├── background/
│   └── service-worker.js      # Background script (settings relay)
├── content/
│   ├── state.js               # Shared runtime state (window.TitanState)
│   ├── board.js               # Board detection, FEN parser, castling tracking
│   ├── drawing.js             # DOM-injected arrow/highlight rendering
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
    ├── icon.svg
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Module Load Order

Files are loaded in this exact order (defined in `manifest.json`):

```
state.js → board.js → drawing.js → engine.js → widget.js → content.js
```

All modules share state through `window.TitanState`. Each module exposes its API on `window.Titan*` (e.g. `window.TitanEngine`, `window.TitanBoard`).

## Architecture

### How It Works

1. **Board Detection** (`board.js`) — Scrapes chess.com's DOM to find the board element, reads piece positions via CSS classes (`.piece.wk.square-51`), and builds a FEN string. Side-to-move is guessed from last-move highlight squares. Castling rights are tracked by monitoring king/rook movement throughout the game.
2. **Monitor Loop** (`content.js`) — Polls the board every 100ms, detects position changes and new games. Only triggers analysis on the player's turn. Clears arrows on opponent's turn. Resets castling tracking on new game.
3. **Engine Analysis** (`engine.js`) — Sends the FEN to Stockfish via a Blob Worker. Levels 1000-2800 use `UCI_LimitStrength = true` to cap engine strength. Level 3000 disables this for full, unrestricted Stockfish power.
4. **Rendering** (`drawing.js`) — Injects highlight divs and SVG arrows directly into the chess.com board DOM element. Uses the same percentage-based CSS transform system as chess.com's pieces, so positioning is pixel-perfect on both desktop and mobile.
5. **Widget** (`widget.js`) — Floating dashboard with tabs (Engine, Info, Style, Arrow, Eval), draggable header, theme switching, and settings persistence.

### DOM Injection Rendering

Previous versions used a canvas overlay, which had alignment issues on mobile due to viewport scaling and DPR differences. The current approach injects elements directly into the board:

- **Highlight mode**: Colored `div` elements positioned with `transform: translate(X%, Y%)` — the same coordinate system chess.com uses for pieces
- **Arrow mode**: SVG elements with an 800×800 viewBox (8 squares × 100 units each), with glow effect and arrowhead markers
- **No pixel math needed** — elements inherit the board's layout automatically
- **Works identically on desktop and mobile**

### Blob Worker Pattern

Chrome MV3 content scripts can't create Workers from `chrome-extension://` URLs. We work around this by:

1. Fetching `stockfish.js` and `stockfish.wasm` as raw data
2. Wrapping the JS in a Blob with WASM fetch interception
3. Creating the Worker from `URL.createObjectURL(blob)`

This is the only pattern that works reliably in MV3 content scripts. Don't try to simplify it.

### Analysis Flow

```
Position change detected (monitor loop)
  → Is it my turn?
    → Yes: analyze(fen) → stockfish worker → bestmove → showMove() → draw arrow
    → No + queue mode: preAnalyze(fen) at reduced depth → store in pendingArrows
    → No + no queue: skip (wait for my turn)
  → My turn + pendingArrows exist: restore arrows from pending
  → My turn + no arrows + not analyzing: trigger analyze()
```

### Abort & Retry

When a new position arrives while analysis is in progress:
- `stop` is sent to the worker to abort the current search
- The resulting bestmove from `stop` is discarded via `ignoreNextBestmove` counter
- A fresh analysis starts immediately for the new position

### Watchdog Timer

A safety timeout prevents permanently stuck analysis:
- Timeout scales with config: `movetime + 5s` if movetime is set, otherwise `15s + 1.5s per depth above 10`
- On timeout: resets `analyzing` flag, sends `stop`, increments `ignoreNextBestmove`

### Castling Rights Tracking

FEN castling rights are determined by tracking king and rook movement throughout the game:
- Each king/rook starting square is monitored every poll cycle
- Once a piece leaves its starting square, castling is permanently disabled for that side
- Flags are reset on new game detection
- This prevents illegal castling suggestions when a king/rook has moved and returned to its original square

## Configuration

### ELO Levels (Normal Mode)

Defined in `ELO_CONFIG` in `engine.js`:

| Level | Label | Skill | Depth | UCI ELO | Error Rate | Movetime |
|-------|-------|-------|-------|---------|------------|----------|
| 1000 | BRONZE | 1 | 5 | 800 | 30% | — |
| 1200 | BRONZE+ | 3 | 7 | 1100 | 22% | — |
| 1300 | SILVER | 5 | 8 | 1250 | 18% | — |
| 1400 | SILVER+ | 7 | 9 | 1350 | 14% | — |
| 1500 | SILVER++ | 9 | 10 | 1450 | 10% | — |
| 1600 | GOLD | 11 | 11 | 1550 | 8% | — |
| 1700 | GOLD+ | 13 | 12 | 1650 | 6% | — |
| 1800 | GOLD++ | 15 | 13 | 1750 | 4% | — |
| 1900 | EXPERT | 17 | 14 | 1850 | 3% | — |
| 2000 | MASTER | 18 | 16 | 2000 | 2% | — |
| 2200 | IM | 19 | 18 | 2200 | 1% | — |
| 2500 | GM | 20 | 20 | 2500 | 0.5% | 5s |
| 2800 | SUPER GM | 20 | 20 | 2800 | 0% | 6s |
| 3000 | STOCKFISH | 20 | 22 | — | 0% | 3s |

### UCI_LimitStrength

This is the key mechanism that controls engine strength:

- **Levels 1000-2800**: `UCI_LimitStrength = true`, `UCI_Elo = <target>`. Stockfish artificially weakens itself to play at the target rating. Combined with Skill Level and error rate for human-like play.
- **Level 3000**: `UCI_LimitStrength = false`. No artificial cap — Stockfish plays at full, unrestricted strength. Hash table is bumped to 32MB, `Contempt 50` (anti-draw bias). This is raw Stockfish, the strongest possible play in browser WASM.

### Combat Mode

Same ELO keys but cranked up — higher depth, higher skill, lower error rates. Defined in `COMBAT_CONFIG` in `engine.js`. Combat mode 3000 uses depth 25 with a 5s movetime cap and full unlimited Stockfish strength (`UCI_LimitStrength = false`, hash 32MB, `Contempt 50`).

### Performance Optimizations

- **Hash table** (16MB / 32MB): Stockfish caches evaluated positions in a transposition table. Mode 3000 uses 32MB for deeper search caching; all other levels use 16MB.
- **No `ucinewgame` per move**: The hash table is only reset on new game detection, not on every analysis call. This preserves cached positions across moves.
- **Movetime caps**: High ELO levels use `go depth X movetime Y` — Stockfish searches as deep as possible within the time limit.
- **Contempt 50** (mode 3000 only): Makes Stockfish play aggressively and avoid draws.

To add a new ELO level, update `ELO_LEVELS`, `ELO_LABELS`, `ELO_CONFIG`, and `COMBAT_CONFIG` in `engine.js`. Keep them in sync.

### Desktop vs Mobile

The extension works on any browser that supports Chrome extensions (MV3):
- **Desktop** (Chrome, Edge, Brave): Full performance, Stockfish reaches higher depths within movetime
- **Mobile** (Lemur Browser on Android): Functional but slower — mobile CPUs are weaker, so the same movetime yields lower search depth. Arrow/highlight rendering is identical thanks to DOM injection.

Stockfish WASM in the browser is inherently weaker than desktop Stockfish due to:
- Single thread only (WASM Worker limitation)
- Limited hash table (32MB max vs 1GB+ on desktop)
- ~50-70% of native C++ calculation speed

## Contributing

The codebase is modular and well-commented. Each file has a block header explaining what it does, what's safe to change, and what you should leave alone.

### Quick Guide

- **Adjust ELO strength** → Edit `ELO_CONFIG` / `COMBAT_CONFIG` in `engine.js`
- **Change arrow/highlight appearance** → Edit `createArrowSvg()` / `createHighlightEl()` in `drawing.js`
- **Add a new widget tab** → Add HTML in `widget.js`, the tab handler is generic
- **Add a new setting** → Save in the relevant handler, restore in `loadWidgetSettings()` in `widget.js`
- **Board detection broken** → Update selectors in `findBoard()` / `getFen()` in `board.js`
- **Add a new state variable** → Register it in `state.js` so all modules can access it

### Things to Watch Out For

- **chess.com DOM changes** — They update their markup periodically. Board selectors in `board.js` may need updating.
- **CSS conflicts** — chess.com's styles are aggressive. Use `!important` in `widget.css` as needed.
- **Blob Worker** — Don't change the Worker creation pattern in `engine.js`. It's the only way that works in MV3.
- **Load order** — `state.js` must be first, `content.js` must be last.
- **Turn detection** — `monitor()` in `content.js` is the single source of truth for show/hide arrow logic. Don't add turn checks elsewhere.
- **Hash table** — `ucinewgame` resets the hash table. Only send it on actual new games, not on every analysis.
- **Castling flags** — Reset in `content.js` on new game detection. Don't reset them elsewhere.
- **DOM injection** — Arrow/highlight elements are injected into the board element. Don't switch back to canvas — it doesn't work reliably on mobile.

## Tech Stack

- **Runtime**: Chrome Extension Manifest V3
- **Engine**: Stockfish (compiled to WASM)
- **UI**: Vanilla JS + CSS Custom Properties
- **Rendering**: DOM injection (SVG arrows + div highlights)
- **Storage**: `chrome.storage.local`
- **Build Tools**: None — zero dependencies, no bundler

## License

MIT — free to use, modify, and distribute.

---

Built with ♟️ by the Titan Chess team
