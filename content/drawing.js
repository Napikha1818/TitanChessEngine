// ============================================================
// titan-free :: canvas rendering
// ============================================================
//
// all the arrow/highlight drawing happens here. we use a
// full-viewport canvas overlay (pointer-events: none) that
// sits on top of the chess board.
//
// there are three draw modes:
//   - highlight: colored squares on from/to
//   - arrow: straight arrow with glow + arrowhead
//   - knight arrow: L-shaped path for knight moves
//
// if you want to change arrow appearance (thickness, glow,
// opacity), look at drawArrowShape() and drawKnightArrow().
// the glow is done with ctx.shadowBlur — higher = more glow.
//
// the draw() function is the main entry point. it checks if
// it's our turn before rendering (no arrows on opponent's turn).
// ============================================================

(function () {
    const T = window.TitanState;
    const B = window.TitanBoard;

    function isKnightMove(from, to) {
        const fx = 'abcdefgh'.indexOf(from[0]), fy = parseInt(from[1]);
        const tx = 'abcdefgh'.indexOf(to[0]), ty = parseInt(to[1]);
        const dx = Math.abs(tx - fx), dy = Math.abs(ty - fy);
        return (dx === 2 && dy === 1) || (dx === 1 && dy === 2);
    }

    // simple colored rectangles on from/to squares
    function drawHighlight(from, to, rect, color) {
        const f = B.sq2px(from, rect), t = B.sq2px(to, rect);
        if (!f || !t) return;
        T.ctx.save();
        T.ctx.globalAlpha = 0.35;
        T.ctx.fillStyle = color;
        T.ctx.fillRect(f.x, f.y, f.w, f.h);
        T.ctx.globalAlpha = 0.5;
        T.ctx.fillRect(t.x, t.y, t.w, t.h);
        T.ctx.restore();
    }

    // L-shaped arrow for knight moves.
    // draws two line segments (horizontal then vertical, or vice versa)
    // with a triangular arrowhead at the end.
    function drawKnightArrow(from, to, rect, color, width) {
        const f = B.sq2px(from, rect), t = B.sq2px(to, rect);
        if (!f || !t) return;
        const fx = f.x + f.w * 0.5, fy = f.y + f.h * 0.5;
        const tx = t.x + t.w * 0.5, ty = t.y + t.h * 0.5;
        const dx = tx - fx, dy = ty - fy;
        let mx, my;
        if (Math.abs(dx) > Math.abs(dy)) { mx = tx; my = fy; } else { mx = fx; my = ty; }
        const margin = Math.min(f.w, f.h) * 0.18;
        const angle1 = Math.atan2(my - fy, mx - fx);
        const angle2 = Math.atan2(ty - my, tx - mx);
        const startX = fx + Math.cos(angle1) * margin, startY = fy + Math.sin(angle1) * margin;
        const endX = tx - Math.cos(angle2) * margin, endY = ty - Math.sin(angle2) * margin;
        const headLen = width * 2.5, headW = width * 2.0;

        T.ctx.save();
        // outer glow pass
        T.ctx.shadowBlur = 20; T.ctx.shadowColor = color;
        T.ctx.lineWidth = width + 4; T.ctx.lineCap = 'round'; T.ctx.lineJoin = 'round';
        T.ctx.strokeStyle = color; T.ctx.globalAlpha = 0.3;
        T.ctx.beginPath(); T.ctx.moveTo(startX, startY); T.ctx.lineTo(mx, my); T.ctx.lineTo(endX, endY); T.ctx.stroke();
        // solid inner pass
        T.ctx.shadowBlur = 12; T.ctx.lineWidth = width; T.ctx.globalAlpha = 0.9;
        T.ctx.beginPath(); T.ctx.moveTo(startX, startY); T.ctx.lineTo(mx, my); T.ctx.lineTo(endX, endY); T.ctx.stroke();
        // arrowhead
        T.ctx.shadowBlur = 15; T.ctx.globalAlpha = 0.95;
        T.ctx.save(); T.ctx.translate(tx, ty); T.ctx.rotate(angle2);
        T.ctx.beginPath(); T.ctx.moveTo(-headLen, -headW / 2); T.ctx.lineTo(0, 0); T.ctx.lineTo(-headLen, headW / 2); T.ctx.closePath();
        T.ctx.fillStyle = color; T.ctx.fill(); T.ctx.restore();
        T.ctx.restore();
    }

    // straight arrow with shaft + arrowhead.
    // uses translate/rotate so the math stays simple.
    // two passes: a wider glow layer, then the solid arrow on top.
    function drawArrowShape(from, to, rect, color, width) {
        const f = B.sq2px(from, rect), t = B.sq2px(to, rect);
        if (!f || !t) return;
        const fx = f.x + f.w * 0.5, fy = f.y + f.h * 0.5;
        const tx = t.x + t.w * 0.5, ty = t.y + t.h * 0.5;
        const angle = Math.atan2(ty - fy, tx - fx);
        const dist = Math.sqrt((tx - fx) ** 2 + (ty - fy) ** 2);
        const headLen = width * 2.5, headW = width * 2.0;
        const margin = Math.min(f.w, f.h) * 0.18;
        const arrowLen = Math.max(0, dist - margin * 2);

        T.ctx.save(); T.ctx.translate(fx, fy); T.ctx.rotate(angle); T.ctx.translate(margin, 0);
        // glow layer
        T.ctx.shadowBlur = 20; T.ctx.shadowColor = color; T.ctx.fillStyle = color; T.ctx.globalAlpha = 0.3;
        T.ctx.beginPath();
        T.ctx.moveTo(0, -(width + 4) * 0.5); T.ctx.lineTo(arrowLen - headLen, -(width + 4) * 0.5);
        T.ctx.lineTo(arrowLen - headLen, -(headW + 4) * 0.5); T.ctx.lineTo(arrowLen, 0);
        T.ctx.lineTo(arrowLen - headLen, (headW + 4) * 0.5); T.ctx.lineTo(arrowLen - headLen, (width + 4) * 0.5);
        T.ctx.lineTo(0, (width + 4) * 0.5); T.ctx.closePath(); T.ctx.fill();
        // solid layer
        T.ctx.shadowBlur = 12; T.ctx.globalAlpha = 0.95;
        T.ctx.beginPath();
        T.ctx.moveTo(0, -width * 0.5); T.ctx.lineTo(arrowLen - headLen, -width * 0.5);
        T.ctx.lineTo(arrowLen - headLen, -headW * 0.5); T.ctx.lineTo(arrowLen, 0);
        T.ctx.lineTo(arrowLen - headLen, headW * 0.5); T.ctx.lineTo(arrowLen - headLen, width * 0.5);
        T.ctx.lineTo(0, width * 0.5); T.ctx.closePath(); T.ctx.fill();
        T.ctx.restore();
    }

    // main render function — called from the monitor loop and on resize.
    // clears the canvas and redraws all active arrows.
    // won't draw anything if it's not our turn (prevents stale arrows).
    function draw(force) {
        if (!T.ctx || !T.canvas) return;
        const rect = B.getBoardRect(force || T.forceRedraw);
        if (!rect || !T.arrows.length) { T.ctx.clearRect(0, 0, T.canvas.width, T.canvas.height); return; }

        // don't show arrows on opponent's turn
        const fen = B.getFen();
        if (fen && T.myTurnColor) {
            const turn = fen.split(' ')[1] || 'w';
            if (turn !== T.myTurnColor) { T.ctx.clearRect(0, 0, T.canvas.width, T.canvas.height); return; }
        }

        if (force || T.forceRedraw) {
            T.forceRedraw = false;
            if (rect.width < 200 || rect.height < 200) return; // board too small, skip
            T.ctx.clearRect(0, 0, T.canvas.width, T.canvas.height);
            T.ctx.save();
            T.ctx.beginPath(); T.ctx.rect(rect.x, rect.y, rect.width, rect.height); T.ctx.clip();
            T.arrows.forEach(a => {
                if (!a || !a.move || a.move.length < 4) return;
                const from = a.move.substring(0, 2), to = a.move.substring(2, 4);
                const col = T.arrowColor || '#00f2ff';
                const w = Math.max(8, rect.width / 600 * 12);
                if (T.arrowMode === 'highlight') drawHighlight(from, to, rect, col);
                else if (isKnightMove(from, to)) drawKnightArrow(from, to, rect, col, w);
                else drawArrowShape(from, to, rect, col, w);
            });
            T.ctx.restore();
        }
    }

    function clearArrows() {
        T.arrows = []; T.pendingArrows = [];
        if (T.ctx && T.canvas) T.ctx.clearRect(0, 0, T.canvas.width, T.canvas.height);
    }

    // create the full-viewport canvas. only runs once.
    // the canvas is fixed-position and covers the entire window
    // but has pointer-events:none so it doesn't block clicks.
    function initCanvas() {
        if (T.canvas) return;
        T.canvas = document.createElement('canvas');
        T.canvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:999998;';
        T.canvas.width = window.innerWidth; T.canvas.height = window.innerHeight;
        document.body.appendChild(T.canvas);
        T.ctx = T.canvas.getContext('2d');

        // resize handler — debounced to avoid layout thrashing
        let timeout;
        window.addEventListener('resize', () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                T.canvas.width = window.innerWidth; T.canvas.height = window.innerHeight;
                T.boardCache = null; // force rect recalculation
                if (T.arrows.length) draw(true);
            }, 100);
        });
    }

    window.TitanDraw = { draw, clearArrows, initCanvas };
})();
