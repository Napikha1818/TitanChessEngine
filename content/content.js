// ============================================================
// titan-free :: main entry point
// ============================================================
//
// this is the last file loaded (see manifest.json content_scripts
// order). by the time this runs, all other modules are ready:
//   state.js → board.js → drawing.js → engine.js → widget.js
//
// this file does three things:
//   1. runs the monitor loop (polls the board every 100ms)
//   2. handles chrome.runtime messages from popup/background
//   3. boots everything up (canvas, widget, engine, observer)
//
// === THE MONITOR LOOP ===
//
// monitor() runs every 100ms via setInterval. it:
//   - reads the current FEN from the DOM
//   - detects new games (starting position after a non-start)
//   - triggers analysis when the position changes on our turn
//   - pre-analyzes during opponent's turn if queue mode is on
//   - clears arrows on opponent's turn
//   - restores pending arrows when it becomes our turn
//   - triggers analysis if it's our turn with no arrows
//
// monitor() is the SINGLE SOURCE OF TRUTH for arrow visibility.
// arrows are shown only on our turn, cleared on opponent's turn.
// don't add turn checks in draw() or showMove() — keep it here.
//
// 100ms is a good balance between responsiveness and CPU usage.
// going lower (50ms) makes it snappier but burns more cycles.
// going higher (200ms+) feels laggy on fast time controls.
//
// === NEW GAME DETECTION ===
//
// we detect a new game by checking if the current FEN is the
// starting position AND the previous FEN was NOT. this avoids
// false positives when the page first loads (which also shows
// the starting position).
//
// on new game: we disconnect the mutation observer, clear all
// cached board references, send `ucinewgame` to reset the hash
// table, and re-run setup() to find the new board element.
//
// === BOOT SEQUENCE ===
//
// 1. load persisted settings from chrome.storage
// 2. init stockfish engine (async, takes ~1-2 seconds)
// 3. after 1 second delay: create canvas, inject widget, start monitor
//
// the 1-second delay gives chess.com time to render the board.
// without it, findBoard() often returns null on page load.
//
// === WHAT NOT TO CHANGE ===
//
// - the setTimeout delay (1000ms) — lower values cause the
//   widget to inject before the board exists
// - the monitor interval (100ms) — tested across bullet, blitz,
//   and rapid; this is the sweet spot
// - the message listener return value (must return true for
//   async chrome.runtime.onMessage compatibility)
// ============================================================

(function () {
    const T = window.TitanState;
    const B = window.TitanBoard;
    const D = window.TitanDraw;
    const Eng = window.TitanEngine;
    const W = window.TitanWidget;

    // core polling loop — called every 100ms.
    // reads the board state and decides what to do.
    // wrapped in try/catch so a DOM error doesn't kill the loop.
    function monitor() {
        try {
            const fen = B.getFen(), rect = B.getBoardRect();
            if (!fen || !rect) return;

            const isStart = fen.includes('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
            const wasNotStart = T.previousFen && !T.previousFen.includes('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');

            // new game: starting position appeared after a non-starting position.
            // reset everything and re-attach to the (possibly new) board element.
            if (isStart && wasNotStart) {
                if (T.boardObserver) { T.boardObserver.disconnect(); T.boardObserver = null; }
                T.boardElement = T.boardCache = T.playerColor = T.myTurnColor = null;
                T.moveQueue = [];
                T.pendingArrows = [];
                // reset castling tracking for the new game
                T.castleWhiteKingMoved = T.castleBlackKingMoved = false;
                T.castleWhiteRookAMoved = T.castleWhiteRookHMoved = false;
                T.castleBlackRookAMoved = T.castleBlackRookHMoved = false;
                W.updateQueueDisplay();
                D.clearArrows();
                // reset hash table on new game so stale positions don't pollute results
                if (T.stockfishWorker && T.engineReady) {
                    T.stockfishWorker.postMessage('ucinewgame');
                }
                setup();
            }

            const turn = fen.split(' ')[1] || 'w';
            T.myTurnColor = B.getPlayerColor();
            const isMyTurn = (turn === T.myTurnColor);

            // position changed — new move was made
            if (fen !== T.currentFen) {
                T.previousFen = T.currentFen;
                T.currentFen = fen;
                T.pendingArrows = [];
                D.clearArrows();

                // only analyze on our turn (or pre-analyze in queue mode)
                if (isMyTurn) {
                    Eng.analyze(fen);
                } else if (T.queueMode) {
                    Eng.preAnalyze(fen);
                }
            }

            // opponent's turn — make sure arrows are cleared
            if (!isMyTurn && T.arrows.length > 0) {
                D.clearArrows();
            }

            // our turn — restore pending arrows if they got cleared
            if (isMyTurn && T.pendingArrows.length > 0 && T.arrows.length === 0) {
                T.arrows = [...T.pendingArrows];
                T.forceRedraw = true;
                D.draw(true);
            }

            // our turn, no arrows, not analyzing — trigger analysis
            if (isMyTurn && T.pendingArrows.length === 0 && T.arrows.length === 0 && !T.analyzing) {
                Eng.analyze(fen);
            }
        } catch (err) {
            console.error('[TitanFree] monitor error', err);
        }
    }

    // start (or restart) the monitor loop and board observer.
    // called on initial boot and after each new game detection.
    function setup() {
        if (T.monitorInterval) clearInterval(T.monitorInterval);
        if (T.boardObserver) { T.boardObserver.disconnect(); T.boardObserver = null; }

        // poll the board every 100ms
        T.monitorInterval = setInterval(monitor, 100);

        // watch for DOM changes on the board (piece moves, etc.)
        // so we can invalidate the cached bounding rect
        const board = B.findBoard();
        if (board) {
            T.boardObserver = new MutationObserver(() => { T.boardCache = null; });
            T.boardObserver.observe(board, { childList: true, subtree: true });
        }
    }

    // handle messages from the popup or background script.
    // the popup sends SET_ELO when user changes elo there,
    // CLEAR_ARROWS to manually wipe arrows, and SET_ARROW_COLOR
    // for color changes from the popup UI.
    chrome.runtime.onMessage.addListener((msg) => {
        if (!msg || typeof msg.type !== 'string') return true;
        if (msg.type === 'SET_ELO' && msg.elo) Eng.setElo(msg.elo);
        else if (msg.type === 'CLEAR_ARROWS') D.clearArrows();
        else if (msg.type === 'SET_ARROW_COLOR' && msg.color) {
            T.arrowColor = msg.color;
            chrome.storage.local.set({ arrowColor: msg.color });
            if (T.arrows.length) D.draw(true);
        }
        return true; // required for async message handling
    });

    // === BOOT ===
    // load saved settings first, then start the engine.
    // engine init is async (fetches WASM, creates blob worker).
    chrome.storage.local.get(['arrowColor', 'elo', 'arrowMode'], (r) => {
        if (r.arrowColor) T.arrowColor = r.arrowColor;
        if (r.arrowMode) T.arrowMode = r.arrowMode;
        if (r.elo) T.currentElo = r.elo;
        Eng.initEngine();
    });

    // wait for chess.com to finish rendering before we inject.
    // 1 second is enough for most connections; on very slow pages
    // the monitor loop will just return early until the board appears.
    setTimeout(() => {
        D.initCanvas();
        W.createFloatingWidget();
        setup();
    }, 1000);
})();
