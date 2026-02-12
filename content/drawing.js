// ============================================================
// titan-free :: move visualization (DOM injection)
// ============================================================
//
// renders move suggestions directly inside the chess.com board
// element using injected DOM elements. this approach is far more
// reliable than canvas overlay because:
//   - elements inherit the board's coordinate system automatically
//   - no pixel math, no DPR scaling, no viewport quirks
//   - works identically on desktop and mobile
//
// chess.com positions pieces using percentage-based CSS transforms:
//   .piece.square-34 → transform: translate(200%, 400%)
// where file (3) = (file-1)*100% from left, rank (4) = (8-rank)*100% from top.
//
// we use the same system for our highlight/arrow overlays.
//
// draw modes:
//   - highlight: colored div overlays on from/to squares
//   - arrow: SVG arrow injected into the board
//
// draw() renders whatever is in T.arrows[]. turn-based visibility
// is handled by monitor() in content.js — draw() just renders.
// ============================================================

(function () {
    const T = window.TitanState;
    const B = window.TitanBoard;

    // container for our injected elements, lives inside the board
    let overlayContainer = null;

    // convert algebraic square (e.g. 'e4') to chess.com's
    // percentage-based coordinates for CSS transform.
    // returns {xPct, yPct} where each is a multiple of 100%.
    function sqToTransform(sq, orientation) {
        const file = 'abcdefgh'.indexOf(sq[0]); // 0-7
        const rank = parseInt(sq[1]) - 1;        // 0-7
        if (file < 0 || rank < 0 || file > 7 || rank > 7) return null;
        let xPct, yPct;
        if (orientation === 'white') {
            xPct = file * 100;       // a=0%, b=100%, ... h=700%
            yPct = (7 - rank) * 100; // 1=700%, 2=600%, ... 8=0%
        } else {
            xPct = (7 - file) * 100; // h=0%, g=100%, ... a=700%
            yPct = rank * 100;        // 8=700%, 7=600%, ... 1=0%
        }
        return { xPct, yPct };
    }

    // ensure the overlay container exists inside the board element.
    // creates it if missing. the container is position:absolute,
    // fills the board, and has pointer-events:none so clicks pass through.
    function ensureOverlay() {
        const board = B.findBoard();
        if (!board) return null;
        if (overlayContainer && board.contains(overlayContainer)) return overlayContainer;
        overlayContainer = document.createElement('div');
        overlayContainer.className = 'titan-overlay';
        overlayContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100;';
        board.style.position = board.style.position || 'relative';
        board.appendChild(overlayContainer);
        return overlayContainer;
    }

    // create a highlight div on a single square
    function createHighlightEl(sq, orientation, color, opacity) {
        const pos = sqToTransform(sq, orientation);
        if (!pos) return null;
        const el = document.createElement('div');
        el.className = 'titan-highlight';
        el.style.cssText = `position:absolute;width:12.5%;height:12.5%;` +
            `background:${color};opacity:${opacity};pointer-events:none;` +
            `transform:translate(${pos.xPct}%,${pos.yPct}%);`;
        return el;
    }

    // create an SVG arrow between two squares
    function createArrowSvg(from, to, orientation, color) {
        const f = sqToTransform(from, orientation);
        const t = sqToTransform(to, orientation);
        if (!f || !t) return null;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'titan-arrow');
        svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;';
        svg.setAttribute('viewBox', '0 0 800 800');

        // center of each square in the 800x800 viewBox (each square = 100 units)
        const fx = f.xPct + 50, fy = f.yPct + 50;
        const tx = t.xPct + 50, ty = t.yPct + 50;

        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        const markerId = 'titan-head-' + Date.now();
        marker.setAttribute('id', markerId);
        marker.setAttribute('markerWidth', '4');
        marker.setAttribute('markerHeight', '4');
        marker.setAttribute('refX', '2.5');
        marker.setAttribute('refY', '2');
        marker.setAttribute('orient', 'auto');
        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', '0 0, 4 2, 0 4');
        polygon.setAttribute('fill', color);
        marker.appendChild(polygon);
        defs.appendChild(marker);
        svg.appendChild(defs);

        // glow line (wider, semi-transparent)
        const glow = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        glow.setAttribute('x1', fx); glow.setAttribute('y1', fy);
        glow.setAttribute('x2', tx); glow.setAttribute('y2', ty);
        glow.setAttribute('stroke', color);
        glow.setAttribute('stroke-width', '28');
        glow.setAttribute('stroke-opacity', '0.3');
        glow.setAttribute('stroke-linecap', 'round');
        svg.appendChild(glow);

        // solid line
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', fx); line.setAttribute('y1', fy);
        line.setAttribute('x2', tx); line.setAttribute('y2', ty);
        line.setAttribute('stroke', color);
        line.setAttribute('stroke-width', '18');
        line.setAttribute('stroke-opacity', '0.9');
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('marker-end', `url(#${markerId})`);
        svg.appendChild(line);

        return svg;
    }

    // main render function — clears previous overlays and draws
    // whatever is in T.arrows[]. called from monitor loop.
    function draw(force) {
        try {
            const container = ensureOverlay();
            if (!container) return;

            // clear previous elements
            container.innerHTML = '';

            if (!T.arrows.length) return;

            const orientation = B.getPlayerColor() === 'w' ? 'white' : 'black';
            const color = T.arrowColor || '#00f2ff';

            T.forceRedraw = false;

            T.arrows.forEach(a => {
                if (!a || !a.move || a.move.length < 4) return;
                const from = a.move.substring(0, 2), to = a.move.substring(2, 4);

                if (T.arrowMode === 'highlight') {
                    const fromEl = createHighlightEl(from, orientation, color, 0.35);
                    const toEl = createHighlightEl(to, orientation, color, 0.5);
                    if (fromEl) container.appendChild(fromEl);
                    if (toEl) container.appendChild(toEl);
                } else {
                    // arrow mode (SVG)
                    const arrowEl = createArrowSvg(from, to, orientation, color);
                    if (arrowEl) container.appendChild(arrowEl);
                }
            });
        } catch (err) {
            console.error('[TitanFree] draw error', err);
        }
    }

    function clearArrows() {
        T.arrows = [];
        if (overlayContainer) overlayContainer.innerHTML = '';
    }

    // init is now a no-op — no canvas needed.
    // the overlay container is created lazily in ensureOverlay().
    function initCanvas() {
        // legacy name kept for API compatibility with content.js
        // actual init happens on first draw() call via ensureOverlay()
    }

    window.TitanDraw = { draw, clearArrows, initCanvas };
})();
