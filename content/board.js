// ============================================================
// titan-free :: board detection & FEN parser
// ============================================================
//
// this module handles all the chess.com DOM scraping:
// - finding the board element (they use different tags/classes)
// - figuring out if we're white or black
// - reading piece positions and building a FEN string
// - converting square names like 'e4' to pixel coordinates
//
// if chess.com changes their DOM structure (they do sometimes),
// you'll probably need to update findBoard() and getFen().
// the selectors here cover the most common layouts as of 2025.
//
// DON'T touch getPlayerColor() unless orientation detection
// is broken — the coordinate-label approach is the most reliable
// method we've found across all chess.com board variants.
// ============================================================

(function () {
    const T = window.TitanState;

    // try multiple selectors because chess.com uses different
    // elements depending on the page (live, daily, analysis, etc.)
    function findBoard() {
        if (T.boardElement && document.contains(T.boardElement)) return T.boardElement;

        // preferred: custom elements (most live games)
        const preciseBoards = document.querySelectorAll('chess-board, wc-chess-board');
        if (preciseBoards.length > 0) {
            let best = null, maxSize = 0;
            preciseBoards.forEach(b => {
                const r = b.getBoundingClientRect();
                if (r.width * r.height > maxSize && r.width > 100) { maxSize = r.width * r.height; best = b; }
            });
            if (best) return T.boardElement = best;
        }

        // fallback: generic selectors (older pages, analysis board)
        const boards = document.querySelectorAll('#board-layout-chessboard, .board, #board');
        let mainBoard = null, maxSize = 0;
        boards.forEach(b => {
            const rect = b.getBoundingClientRect();
            const size = rect.width * rect.height;
            if (size > maxSize && rect.width > 200 && rect.height > 200) { maxSize = size; mainBoard = b; }
        });
        return T.boardElement = mainBoard;
    }

    // figure out if we're playing white or black.
    // checks the 'flipped' class first, then falls back to
    // reading coordinate labels ('1' at bottom = white).
    function getPlayerColor() {
        const board = findBoard();
        if (!board) return T.playerColor || 'w';
        if (board.classList.contains('flipped')) return T.playerColor = 'b';

        const coords = board.querySelectorAll('.coordinate, .coords, [class*="coordinate"]');
        for (let c of coords) {
            if (c.textContent.trim() === '1') {
                const rect = c.getBoundingClientRect(), boardRect = board.getBoundingClientRect();
                return T.playerColor = (rect.bottom > boardRect.top + 0.75 * boardRect.height) ? 'w' : 'b';
            }
        }
        for (let c of coords) {
            if (c.textContent.trim() === '8') {
                const rect = c.getBoundingClientRect(), boardRect = board.getBoundingClientRect();
                return T.playerColor = (rect.bottom > boardRect.top + 0.75 * boardRect.height) ? 'b' : 'w';
            }
        }
        return T.playerColor || 'w';
    }

    // cached bounding rect — we call this every 100ms from the
    // monitor loop, so caching saves a ton of layout thrashing.
    // pass force=true after resize or board change.
    function getBoardRect(force) {
        const board = findBoard();
        if (!board) return T.boardCache = null;
        if (!force && T.boardCache && T.boardCache.board === board) return T.boardCache.rect;
        const r = board.getBoundingClientRect();
        const rect = { x: r.left, y: r.top, width: r.width, height: r.height, orientation: getPlayerColor() === 'w' ? 'white' : 'black' };
        return (T.boardCache = { board, rect }).rect;
    }

    // scrape piece positions from the DOM and build a FEN string.
    //
    // chess.com puts pieces as child elements with classes like:
    //   .piece.wk.square-51  (white king on e1)
    //   .piece.bp.square-47  (black pawn on d7)
    //
    // the square-XY class encodes file (X) and rank (Y) as 1-indexed.
    //
    // side-to-move is guessed from the last-move highlight squares:
    // if a white piece sits on a highlighted square, white just moved,
    // so it's black's turn. not perfect but works 99% of the time.
    function getFen() {
        try {
            const board = findBoard();
            if (!board) return null;
            let pos = new Array(64).fill(null);

        board.querySelectorAll('.piece').forEach(p => {
            const cls = Array.from(p.classList);
            let color = cls.some(c => c.startsWith('w') && c.length === 2) ? 'w' : 'b';
            if (cls.includes('white')) color = 'w';
            if (cls.includes('black')) color = 'b';

            let type = 'p';
            if (cls.some(c => c.includes('knight') || c.includes('bn') || c.includes('wn'))) type = 'n';
            else if (cls.some(c => c.includes('bishop') || c.includes('bb') || c.includes('wb'))) type = 'b';
            else if (cls.some(c => c.includes('rook') || c.includes('br') || c.includes('wr'))) type = 'r';
            else if (cls.some(c => c.includes('queen') || c.includes('bq') || c.includes('wq'))) type = 'q';
            else if (cls.some(c => c.includes('king') || c.includes('bk') || c.includes('wk'))) type = 'k';

            const sq = cls.find(c => c.match(/square-\d+/));
            if (sq) {
                const m = sq.match(/\d+/);
                if (m && m[0].length >= 2) {
                    const file = parseInt(m[0][0]) - 1, rank = 8 - parseInt(m[0][1]);
                    const idx = rank * 8 + file;
                    if (idx >= 0 && idx < 64) pos[idx] = color === 'w' ? type.toUpperCase() : type;
                }
            }
        });

        // build the position part of FEN
        let fen = '';
        for (let r = 0; r < 8; r++) {
            let empty = 0;
            for (let f = 0; f < 8; f++) {
                if (pos[r * 8 + f]) { if (empty) { fen += empty; empty = 0; } fen += pos[r * 8 + f]; } else empty++;
            }
            if (empty) fen += empty;
            if (r < 7) fen += '/';
        }

        // guess side to move from highlighted squares
        let turn = 'w';
        if (fen !== 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR') {
            const hl = document.querySelectorAll('.highlight');
            let hasHL = false, isWhite = false;
            hl.forEach(h => {
                const sq = Array.from(h.classList).find(c => c.match(/square-\d+/));
                if (sq) {
                    const m = sq.match(/\d+/);
                    if (m && m[0].length >= 2) {
                        const file = parseInt(m[0][0]) - 1, rank = 8 - parseInt(m[0][1]);
                        const pc = pos[rank * 8 + file];
                        if (pc) { hasHL = true; if (pc === pc.toUpperCase()) isWhite = true; }
                    }
                }
            });
            if (hasHL) turn = isWhite ? 'b' : 'w';
        }

        // we hardcode castling rights and move counters because
        // we can't reliably detect them from the DOM alone.
        // stockfish handles this fine for move suggestions.
        return `${fen} ${turn} KQkq - 0 1`;
        } catch (err) {
            console.error('[TitanFree] getFen error', err);
            return null;
        }
    }

    // convert algebraic notation (e.g. 'e4') to screen pixel coords.
    // returns {x, y, w, h} where x,y is top-left of the square.
    // accounts for board orientation (white/black at bottom).
    function sq2px(sq, rect) {
        if (!sq || sq.length < 2 || !rect) return null;
        const file = 'abcdefgh'.indexOf(sq[0]), rank = parseInt(sq[1]) - 1;
        if (file < 0 || rank < 0 || file > 7 || rank > 7) return null;
        const w = rect.width / 8, h = rect.height / 8;
        let x, y;
        if (rect.orientation === 'white') { x = rect.x + file * w; y = rect.y + (7 - rank) * h; }
        else { x = rect.x + (7 - file) * w; y = rect.y + rank * h; }
        return { x, y, w, h };
    }

    window.TitanBoard = { findBoard, getPlayerColor, getBoardRect, getFen, sq2px };
})();
