// ============================================================
// titan-free :: stockfish WASM engine
// ============================================================
//
// this is the brain of the extension. we run stockfish entirely
// in the browser using WebAssembly — no server needed.
//
// IMPORTANT: chrome content scripts can't do `new Worker(url)`
// with extension URLs. so we fetch the JS + WASM files, stuff
// them into a Blob, and create the Worker from that. don't try
// to "simplify" this — it'll break with a DOMException.
//
// === HOW ELO WORKS ===
//
// each elo level maps to a stockfish config:
//   - skillLevel: stockfish's internal skill (0-20)
//   - depth: how many moves ahead to search
//   - uciElo: UCI_Elo option (limits engine strength)
//   - errorRate: chance to intentionally skip a move
//     (makes the engine feel more human at lower levels)
//
// want to add a new elo level? add it to ELO_LEVELS, ELO_LABELS,
// and ELO_CONFIG. keep them in sync or the widget will break.
//
// COMBAT mode uses COMBAT_CONFIG instead — same elo keys but
// with higher depth and skill for each level. it's basically
// "try harder" mode.
//
// === WHAT NOT TO CHANGE ===
//
// - the blob Worker creation in initEngine() — this is the only
//   pattern that works in MV3 content scripts
// - the WASM_BUFFER message handshake — the worker needs the
//   binary before it can initialize stockfish
// - the uci retry loop — stockfish sometimes needs a few pokes
//   before it responds with 'uciok'
// ============================================================

(function () {
    const T = window.TitanState;
    const B = window.TitanBoard;
    const D = window.TitanDraw;

    // elo levels shown in the widget slider.
    const ELO_LEVELS = [1000, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000, 2200, 2500, 2800, 3000];
    const ELO_LABELS = ['BRONZE', 'BRONZE+', 'SILVER', 'SILVER+', 'SILVER++', 'GOLD', 'GOLD+', 'GOLD++', 'EXPERT', 'MASTER', 'IM', 'GM', 'SUPER GM', 'STOCKFISH'];

    // normal mode config — tweak these if you want different
    // playing strength at each level. errorRate is the probability
    // that the engine "misses" a move (0.25 = 25% chance to skip).
    // human-like: lower elo = shallower depth + more errors.
    // higher elo = deeper search, near-zero error rate.
    const ELO_CONFIG = {
        '1000': { skillLevel: 1,  depth: 5,  uciElo: 800,  errorRate: 0.30 },
        '1200': { skillLevel: 3,  depth: 7,  uciElo: 1100, errorRate: 0.22 },
        '1300': { skillLevel: 5,  depth: 8,  uciElo: 1250, errorRate: 0.18 },
        '1400': { skillLevel: 7,  depth: 9,  uciElo: 1350, errorRate: 0.14 },
        '1500': { skillLevel: 9,  depth: 10, uciElo: 1450, errorRate: 0.10 },
        '1600': { skillLevel: 11, depth: 11, uciElo: 1550, errorRate: 0.08 },
        '1700': { skillLevel: 13, depth: 12, uciElo: 1650, errorRate: 0.06 },
        '1800': { skillLevel: 15, depth: 13, uciElo: 1750, errorRate: 0.04 },
        '1900': { skillLevel: 17, depth: 14, uciElo: 1850, errorRate: 0.03 },
        '2000': { skillLevel: 18, depth: 16, uciElo: 2000, errorRate: 0.02 },
        '2200': { skillLevel: 19, depth: 18, uciElo: 2200, errorRate: 0.01 },
        '2500': { skillLevel: 20, depth: 20, uciElo: 2500, errorRate: 0.005 },
        '2800': { skillLevel: 20, depth: 22, uciElo: 2800, errorRate: 0.0 },
        '3000': { skillLevel: 20, depth: 24, uciElo: 3000, errorRate: 0.0 }
    };

    // combat mode — same keys, but cranked up.
    // depth is higher, skill is higher, error rate is lower.
    // this is what kicks in when the user hits the COMBAT button.
    const COMBAT_CONFIG = {
        '1000': { skillLevel: 3,  depth: 10, uciElo: 1100, errorRate: 0.15 },
        '1200': { skillLevel: 6,  depth: 12, uciElo: 1350, errorRate: 0.12 },
        '1300': { skillLevel: 9,  depth: 14, uciElo: 1450, errorRate: 0.10 },
        '1400': { skillLevel: 12, depth: 16, uciElo: 1550, errorRate: 0.08 },
        '1500': { skillLevel: 15, depth: 18, uciElo: 1650, errorRate: 0.06 },
        '1600': { skillLevel: 17, depth: 20, uciElo: 1750, errorRate: 0.04 },
        '1700': { skillLevel: 18, depth: 22, uciElo: 1850, errorRate: 0.03 },
        '1800': { skillLevel: 19, depth: 24, uciElo: 1950, errorRate: 0.02 },
        '1900': { skillLevel: 20, depth: 26, uciElo: 2100, errorRate: 0.01 },
        '2000': { skillLevel: 20, depth: 28, uciElo: 2300, errorRate: 0.005 },
        '2200': { skillLevel: 20, depth: 30, uciElo: 2500, errorRate: 0.0 },
        '2500': { skillLevel: 20, depth: 32, uciElo: 2800, errorRate: 0.0 },
        '2800': { skillLevel: 20, depth: 34, uciElo: 3000, errorRate: 0.0 },
        '3000': { skillLevel: 20, depth: 40, uciElo: 3200, errorRate: 0.0 }
    };

    // stuck analysis timeout — if analyzing stays true for >10s,
    // something went wrong (worker crash, no bestmove response).
    // we force-reset it so future analysis isn't permanently blocked.
    let analyzeWatchdog = null;

    function startAnalyzeWatchdog() {
        clearTimeout(analyzeWatchdog);
        analyzeWatchdog = setTimeout(() => {
            if (T.analyzing) {
                console.warn('[TitanFree] analysis stuck for >10s, force-resetting');
                T.analyzing = false;
            }
        }, 10000);
    }

    function clearAnalyzeWatchdog() {
        clearTimeout(analyzeWatchdog);
        analyzeWatchdog = null;
    }

    // boot up stockfish. fetches the JS and WASM files from the
    // extension bundle, wraps them in a Blob Worker, and waits
    // for 'uciok'. the retry loop is needed because the WASM
    // init is async and stockfish might not be ready immediately.
    function initEngine() {
        if (T.stockfishWorker) return;
        try {
            const wasmUrl = chrome.runtime.getURL('engine/stockfish.wasm');
            const jsUrl = chrome.runtime.getURL('engine/stockfish.js');

            Promise.all([
                fetch(jsUrl).then(r => r.text()),
                fetch(wasmUrl).then(r => r.arrayBuffer())
            ]).then(([jsCode, wasmBuffer]) => {
                // this blob trick is required because content scripts
                // can't create Workers from chrome-extension:// URLs.
                // we inline the stockfish JS and intercept WASM fetches.
                const workerCode = `
                    let wasmBinary = null;
                    let stockfishReady = false;
                    const initListener = function(e) {
                        if (e.data && e.data.type === 'WASM_BUFFER') {
                            wasmBinary = new Uint8Array(e.data.buffer);
                            self.removeEventListener('message', initListener);
                            initStockfish();
                        }
                    };
                    self.addEventListener('message', initListener);
                    function initStockfish() {
                        WebAssembly.instantiateStreaming = function(source, importObject) {
                            return WebAssembly.instantiate(wasmBinary, importObject);
                        };
                        self.locateFile = function(path) { return 'stockfish.wasm'; };
                        const originalFetch = self.fetch;
                        self.fetch = function(url, options) {
                            if (typeof url === 'string' && url.includes('.wasm')) {
                                return Promise.resolve(new Response(wasmBinary, {
                                    status: 200, headers: { 'Content-Type': 'application/wasm' }
                                }));
                            }
                            return originalFetch(url, options);
                        };
                        ${jsCode}
                    }
                `;
                const blob = new Blob([workerCode], { type: 'application/javascript' });
                T.stockfishWorker = new Worker(URL.createObjectURL(blob));

                T.stockfishWorker.onmessage = (e) => {
                    const line = e.data;
                    if (typeof line !== 'string') return;

                    if (line === 'uciok') {
                        T.engineReady = true;
                        // limit strength so it plays at the selected elo
                        T.stockfishWorker.postMessage('setoption name UCI_LimitStrength value true');
                        setElo(T.currentElo);
                        if (window.TitanWidget) window.TitanWidget.updateStatus(true);
                    } else if (line.startsWith('bestmove')) {
                        const match = line.match(/bestmove ([a-h][1-8][a-h][1-8])/);
                        if (match) showMove(match[1]);
                        T.analyzing = false;
                        clearAnalyzeWatchdog();
                    }
                };

                T.stockfishWorker.onerror = (err) => {
                    console.error('[TitanFree] engine error', err);
                    T.analyzing = false;
                    clearAnalyzeWatchdog();
                    if (window.TitanWidget) window.TitanWidget.updateStatus(false);
                    // attempt auto-restart after worker crash
                    T.stockfishWorker = null;
                    T.engineReady = false;
                    console.warn('[TitanFree] attempting engine restart in 2s...');
                    setTimeout(() => initEngine(), 2000);
                };

                // send the WASM binary to the worker (transferable for speed)
                T.stockfishWorker.postMessage({ type: 'WASM_BUFFER', buffer: wasmBuffer }, [wasmBuffer]);

                // stockfish needs a few 'uci' pokes before it responds.
                // we retry every 500ms, up to 20 times (10 seconds).
                let uciRetries = 0;
                const uciInterval = setInterval(() => {
                    if (T.engineReady) { clearInterval(uciInterval); return; }
                    if (uciRetries > 20) {
                        clearInterval(uciInterval);
                        console.error('[TitanFree] engine failed to respond after 20 retries');
                        if (window.TitanWidget) {
                            window.TitanWidget.updateStatus(false);
                            window.TitanWidget.showStatusNotification('ENGINE: FAILED TO START');
                        }
                        return;
                    }
                    T.stockfishWorker.postMessage('uci');
                    uciRetries++;
                }, 500);
            }).catch(err => {
                console.error('[TitanFree] failed to fetch engine files', err);
                if (window.TitanWidget) {
                    window.TitanWidget.updateStatus(false);
                    window.TitanWidget.showStatusNotification('ENGINE: LOAD FAILED');
                }
            });
        } catch (err) {
            console.error('[TitanFree] engine init failed', err);
            if (window.TitanWidget) {
                window.TitanWidget.updateStatus(false);
                window.TitanWidget.showStatusNotification('ENGINE: INIT ERROR');
            }
        }
    }

    // apply elo settings to the running engine.
    // called when user changes elo in the widget, or on startup.
    function setElo(elo) {
        T.currentElo = elo;
        const cfg = ELO_CONFIG[elo] || ELO_CONFIG['1000'];
        if (T.engineReady && T.stockfishWorker) {
            T.stockfishWorker.postMessage(`setoption name UCI_Elo value ${cfg.uciElo}`);
            T.stockfishWorker.postMessage(`setoption name Skill Level value ${cfg.skillLevel}`);
        }
    }

    // send a position to stockfish for analysis.
    // picks config from COMBAT_CONFIG or ELO_CONFIG based on mode.
    function analyze(fen) {
        if (!T.engineReady || !T.stockfishWorker || T.analyzing) return;
        T.analyzing = true;
        startAnalyzeWatchdog();
        const configTable = T.combatMode ? COMBAT_CONFIG : ELO_CONFIG;
        const cfg = configTable[T.currentElo] || configTable['1000'];
        T.stockfishWorker.postMessage('ucinewgame');
        T.stockfishWorker.postMessage(`position fen ${fen}`);
        T.stockfishWorker.postMessage(`go depth ${cfg.depth}`);
    }

    // called when stockfish returns a bestmove.
    // arrow shows immediately if it's our turn, otherwise stored
    // in pendingArrows so it appears the instant our turn arrives.
    function showMove(move) {
        // queue mode: store the move for later
        if (T.queueMode) {
            T.moveQueue.push(move);
            if (window.TitanWidget) window.TitanWidget.updateQueueDisplay();
        }

        const turn = T.currentFen ? (T.currentFen.split(' ')[1] || 'w') : 'w';
        const isMyTurn = (turn === B.getPlayerColor());

        // always store in pending so monitor() can restore it
        T.pendingArrows = [{ move }];

        if (isMyTurn) {
            // our turn — show arrow immediately
            T.arrows = [{ move }];
            T.forceRedraw = true;
            D.draw(true);
        }
        // if not our turn, pendingArrows will be picked up by
        // monitor() the moment it becomes our turn
    }

    // switch to combat-level config on the running engine
    function applyCombatConfig() {
        const cfg = COMBAT_CONFIG[T.currentElo] || COMBAT_CONFIG['1000'];
        if (T.engineReady && T.stockfishWorker) {
            T.stockfishWorker.postMessage(`setoption name UCI_Elo value ${cfg.uciElo}`);
            T.stockfishWorker.postMessage(`setoption name Skill Level value ${cfg.skillLevel}`);
        }
    }

    // queue mode: analyze during opponent's turn at reduced depth.
    // this gives us a head start so the arrow appears faster
    // when it becomes our turn.
    function preAnalyze(fen) {
        if (!T.engineReady || !T.stockfishWorker || T.analyzing) return;
        T.analyzing = true;
        startAnalyzeWatchdog();
        const configTable = T.combatMode ? COMBAT_CONFIG : ELO_CONFIG;
        const cfg = configTable[T.currentElo] || configTable['1000'];
        T.stockfishWorker.postMessage('ucinewgame');
        T.stockfishWorker.postMessage(`position fen ${fen}`);
        T.stockfishWorker.postMessage(`go depth ${Math.max(6, cfg.depth - 4)}`);
    }

    window.TitanEngine = {
        ELO_LEVELS, ELO_LABELS, ELO_CONFIG, COMBAT_CONFIG,
        initEngine, setElo, analyze, showMove, applyCombatConfig, preAnalyze
    };
})();
