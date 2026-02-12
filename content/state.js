// ============================================================
// titan-free :: shared runtime state
// ============================================================
//
// every module reads and writes to this object. if you're adding
// a new feature, register your variables here so other modules
// can access them without circular imports.
//
// heads up: don't rename these keys without updating every module
// that references them — there's no typescript here to catch you.
//
// load order matters! this file MUST be first in manifest.json
// so that window.TitanState exists before anything else runs.
// ============================================================

window.TitanState = {
    // canvas overlay (sits on top of the board, pointer-events: none)
    canvas: null,
    ctx: null,

    // position tracking
    currentFen: '',       // last FEN we processed
    previousFen: '',      // FEN before that (for new-game detection)
    arrows: [],           // active arrows to render [{move: 'e2e4'}, ...]
    pendingArrows: [],    // backup copy for redraw after resize
    forceRedraw: false,

    // display preferences (persisted in chrome.storage)
    arrowColor: '#00f2ff',
    arrowMode: 'arrow',   // 'arrow' or 'highlight'

    // board DOM references (cached to avoid re-querying every 100ms)
    boardElement: null,
    boardCache: null,      // { board: DOMElement, rect: {x,y,width,height,orientation} }
    playerColor: null,     // 'w' or 'b'

    // polling & observation
    monitorInterval: null,
    boardObserver: null,

    // stockfish engine (runs in a blob Worker)
    stockfishWorker: null,
    engineReady: false,
    currentElo: '1000',   // string key into ELO_CONFIG / COMBAT_CONFIG
    analyzing: false,      // true while waiting for bestmove
    myTurnColor: null,     // which color we're playing this game

    // mode flags
    combatMode: false,     // deeper analysis, higher depth/skill
    queueMode: false,      // pre-analyze on opponent's turn
    moveQueue: [],          // queued moves when queueMode is on
    currentMode: 'account', // 'account' | 'combat' | 'threat'

    // castling tracking — set to true once king/rook leaves
    // starting square during a game. reset on new game detection.
    // this prevents false castling rights in the FEN when a piece
    // has moved and returned to its original square.
    castleWhiteKingMoved: false,
    castleBlackKingMoved: false,
    castleWhiteRookAMoved: false,  // a1 rook
    castleWhiteRookHMoved: false,  // h1 rook
    castleBlackRookAMoved: false,  // a8 rook
    castleBlackRookHMoved: false   // h8 rook
};
