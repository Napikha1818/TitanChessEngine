// ============================================================
// titan-free :: floating widget UI
// ============================================================
//
// this is the main dashboard that floats on top of chess.com.
// it handles everything the user interacts with:
//   - tab navigation (engine, info, style, arrow, eval)
//   - elo slider with level labels
//   - mode switching (account / combat / threat)
//   - arrow color and mode selection
//   - theme switching (dark, light, purple, green, orange)
//   - drag-to-move, minimize, hide
//   - settings persistence via chrome.storage
//
// the widget is injected as a raw HTML string (no framework).
// chess.com's CSS is aggressive, so we load our own stylesheet
// and use !important liberally in widget.css to fight back.
//
// === ADDING A NEW TAB ===
//
// 1. add a .widget-tab div and .widget-icon div in the HTML
// 2. add a .tab-content div with matching data-content attribute
// 3. the tab/icon click handlers are generic — they'll pick it
//    up automatically via data-tab / data-icon attributes
//
// === SETTINGS PERSISTENCE ===
//
// all user preferences are saved to chrome.storage.local:
//   elo, arrowMode, arrowColor, theme, engineMode, queueMode
// loadWidgetSettings() restores them on page load.
// if you add a new setting, save it in the relevant handler
// and restore it in loadWidgetSettings().
//
// === WHAT NOT TO CHANGE ===
//
// - the widget ID ('titan-widget') — CSS and other modules
//   reference it by ID for theme application
// - the data-theme attribute on #titan-widget — that's how
//   CSS custom properties switch between themes
// - the .tab-content display toggling logic — we use both
//   classList AND inline style.display because chess.com's
//   CSS can override one but not both
// ============================================================

(function () {
    const T = window.TitanState;
    const B = window.TitanBoard;
    const D = window.TitanDraw;
    const Eng = window.TitanEngine;

    // tracks which elo level is selected in the slider.
    // index into Eng.ELO_LEVELS and Eng.ELO_LABELS arrays.
    let currentEloIndex = 0;

    // apply theme by setting data-theme on the widget root.
    // CSS custom properties in widget.css handle the rest.
    // don't apply to document.body — chess.com will override it.
    function applyTheme(theme) {
        const widget = document.getElementById('titan-widget');
        if (widget) widget.setAttribute('data-theme', theme || 'dark');
    }

    // build and inject the entire widget into the page.
    // this is one big HTML template — not pretty, but it works
    // and avoids any build tooling or framework dependency.
    //
    // the structure:
    //   #titan-widget
    //     .widget-header (draggable, has minimize button)
    //     .widget-body
    //       .widget-tabs (text tabs) + .widget-icons (emoji tabs)
    //       .tab-content-container (one div per tab)
    //       .widget-toolbar (quick-access icons at bottom)
    //     #widget-advanced (overlay panel for theme/color settings)
    function createFloatingWidget() {
        if (document.getElementById('titan-widget')) return;

        // load our stylesheet — must be a separate file because
        // inline styles alone can't handle :hover, animations, etc.
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = chrome.runtime.getURL('content/widget.css');
        document.head.appendChild(link);

        const widget = document.createElement('div');
        widget.id = 'titan-widget';
        widget.innerHTML = `
            <div class="widget-status connected" id="widget-status-dot"></div>
            <div class="widget-header">
                <div class="widget-title">TITAN FREE</div>
                <button class="widget-minimize" title="Minimize">−</button>
            </div>
            <div class="widget-body">
                <div class="widget-tabs">
                    <div class="widget-tab active" data-tab="engine">ENGINE</div>
                    <div class="widget-tab" data-tab="info">INFO</div>
                    <div class="widget-tab" data-tab="style">STYLE</div>
                    <div class="widget-tab" data-tab="arrow">ARROW</div>
                    <div class="widget-tab" data-tab="eval">EVAL</div>
                </div>
                <div class="widget-icons">
                    <div class="widget-icon active" data-icon="engine" title="Engine">⚙️</div>
                    <div class="widget-icon" data-icon="info" title="Info">ℹ️</div>
                    <div class="widget-icon" data-icon="style" title="Style">🎨</div>
                    <div class="widget-icon" data-icon="arrow" title="Arrow">➜</div>
                    <div class="widget-icon" data-icon="eval" title="Eval">📊</div>
                </div>
                <div class="tab-content-container">
                    <!-- ENGINE tab: mode buttons, elo slider, action buttons -->
                    <div class="tab-content active" data-content="engine">
                        <div class="widget-modes">
                            <div class="mode-btn threat">THREAT</div>
                            <div class="mode-btn account active">ACCOUNT</div>
                            <div class="mode-btn combat">COMBAT</div>
                        </div>
                        <div class="widget-elo">
                            <div class="elo-slider">
                                <div class="elo-arrow" data-action="first">«</div>
                                <div class="elo-arrow" data-action="prev">‹</div>
                                <div class="elo-display">
                                    <div class="elo-value" id="elo-value">1000</div>
                                    <div class="elo-label" id="elo-label">BRONZE</div>
                                </div>
                                <div class="elo-arrow" data-action="next">›</div>
                                <div class="elo-arrow" data-action="last">»</div>
                            </div>
                            <div class="elo-advanced">
                                <button class="advanced-btn" id="advanced-btn">ADVANCED</button>
                            </div>
                        </div>
                        <div class="widget-actions">
                            <div class="action-btn hide" id="hide-btn">HIDE</div>
                            <div class="action-btn auto active" id="auto-btn">AUTO</div>
                            <div class="action-btn queue" id="queue-btn">QUEUE</div>
                        </div>
                    </div>
                    <!-- INFO tab: read-only status display -->
                    <div class="tab-content" data-content="info" style="display:none">
                        <div class="info-container">
                            <div class="info-section">
                                <div class="info-section-header">
                                    <div class="info-section-icon">⚙️</div>
                                    <div class="info-section-title">Engine</div>
                                </div>
                                <div class="info-section-body">
                                    <div class="info-row"><div class="info-label">ENGINE</div><div class="info-value highlight">STOCKFISH (LOCAL)</div></div>
                                    <div class="info-row"><div class="info-label">STATUS</div><div class="info-value" id="info-status"><span class="status-dot connected"></span><span class="status-text">Connected</span></div></div>
                                    <div class="info-row"><div class="info-label">CURRENT ELO</div><div class="info-value highlight" id="info-elo">1000</div></div>
                                    <div class="info-row"><div class="info-label">ELO RANGE</div><div class="info-value">1000 — 1900</div></div>
                                </div>
                            </div>
                            <div class="info-section">
                                <div class="info-section-header">
                                    <div class="info-section-icon">🎯</div>
                                    <div class="info-section-title">Display</div>
                                </div>
                                <div class="info-section-body">
                                    <div class="info-row"><div class="info-label">ARROW MODE</div><div class="info-value" id="info-arrow-mode">Arrow</div></div>
                                    <div class="info-row"><div class="info-label">ARROW COLOR</div><div class="info-value" id="info-arrow-color"><span class="color-indicator" style="background:#00f2ff;"></span><span>Cyan</span></div></div>
                                    <div class="info-row"><div class="info-label">EVAL BAR</div><div class="info-value premium-locked">🔒 Premium</div></div>
                                    <div class="info-row"><div class="info-label">VERSION</div><div class="info-value"><span class="info-version-badge"><span class="info-version-dot"></span>FREE v1.0</span></div></div>
                                </div>
                            </div>
                            <div class="info-section" style="background:transparent;border:none;">
                                <div class="info-upgrade-card">
                                    <div class="info-upgrade-content">
                                        <div class="info-upgrade-icon">⭐</div>
                                        <div class="info-upgrade-title">UPGRADE TO PREMIUM</div>
                                        <div class="info-upgrade-desc">ELO 2500 · Eval Bar · Titan_Chess Engines<br>Play Styles · Advanced Features</div>
                                        <div class="info-upgrade-btn" id="info-upgrade-link">VISIT STORE</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <!-- STYLE tab: locked in free version -->
                    <div class="tab-content" data-content="style" style="display:none">
                        <div class="style-info">
                            <div class="info-text">🔒 Premium Only</div>
                            <div class="info-subtext">Play styles available in Premium version.<br>Aggressive, Defensive, Balanced & more.</div>
                        </div>
                    </div>
                    <!-- ARROW tab: mode + color selection -->
                    <div class="tab-content" data-content="arrow" style="display:none">
                        <div class="arrow-section">
                            <div class="section-label">ARROW MODE</div>
                            <div class="arrow-mode-grid">
                                <div class="arrow-mode-card" data-mode="highlight"><div class="arrow-mode-icon">🔆</div><div class="arrow-mode-title">HIGHLIGHT</div><div class="arrow-mode-desc">Square highlights</div></div>
                                <div class="arrow-mode-card active" data-mode="arrow"><div class="arrow-mode-icon">➜</div><div class="arrow-mode-title">ARROW</div><div class="arrow-mode-desc">Directional arrows</div></div>
                            </div>
                        </div>
                        <div class="arrow-section">
                            <div class="section-label">ARROW COLOR</div>
                            <div class="arrow-color-grid">
                                <div class="arrow-color-card selected" data-color="#00f2ff"><div class="arrow-color-preview" style="background:#00f2ff;"></div><div class="arrow-color-name">CYAN</div></div>
                                <div class="arrow-color-card" data-color="#00ff88"><div class="arrow-color-preview" style="background:#00ff88;"></div><div class="arrow-color-name">GREEN</div></div>
                                <div class="arrow-color-card" data-color="#ff00ff"><div class="arrow-color-preview" style="background:#ff00ff;"></div><div class="arrow-color-name">MAGENTA</div></div>
                                <div class="arrow-color-card" data-color="#ffff00"><div class="arrow-color-preview" style="background:#ffff00;"></div><div class="arrow-color-name">YELLOW</div></div>
                                <div class="arrow-color-card" data-color="#ff8800"><div class="arrow-color-preview" style="background:#ff8800;"></div><div class="arrow-color-name">ORANGE</div></div>
                            </div>
                        </div>
                    </div>
                    <!-- EVAL tab: locked + theme picker -->
                    <div class="tab-content" data-content="eval" style="display:none">
                        <div class="eval-section">
                            <div class="section-label">EVALUATION BAR</div>
                            <div class="eval-toggle-grid">
                                <div class="eval-toggle-card active" data-eval="false"><div class="eval-toggle-icon">🔒</div><div class="eval-toggle-title">LOCKED</div><div class="eval-toggle-desc">Premium only</div></div>
                                <div class="eval-toggle-card" data-eval="true" style="opacity:0.4;cursor:not-allowed;"><div class="eval-toggle-icon">✅</div><div class="eval-toggle-title">ON</div><div class="eval-toggle-desc">Premium only</div></div>
                            </div>
                        </div>
                        <div class="eval-section">
                            <div class="section-label">THEME</div>
                            <div class="theme-grid-compact">
                                <div class="theme-card active" data-theme="dark"><div class="theme-preview-compact" style="background: linear-gradient(135deg, #0a0f19 0%, #00f2ff 100%);"></div><div class="theme-name-compact">DARK</div></div>
                                <div class="theme-card" data-theme="light"><div class="theme-preview-compact" style="background: linear-gradient(135deg, #f5f5f5 0%, #00f2ff 100%);"></div><div class="theme-name-compact">LIGHT</div></div>
                                <div class="theme-card" data-theme="purple"><div class="theme-preview-compact" style="background: linear-gradient(135deg, #0a0f19 0%, #a855f7 100%);"></div><div class="theme-name-compact">PURPLE</div></div>
                                <div class="theme-card" data-theme="green"><div class="theme-preview-compact" style="background: linear-gradient(135deg, #0a0f19 0%, #10b981 100%);"></div><div class="theme-name-compact">GREEN</div></div>
                                <div class="theme-card" data-theme="orange"><div class="theme-preview-compact" style="background: linear-gradient(135deg, #0a0f19 0%, #f97316 100%);"></div><div class="theme-name-compact">ORANGE</div></div>
                            </div>
                        </div>
                    </div>
                </div>
                <!-- bottom toolbar: quick toggles without opening tabs -->
                <div class="widget-toolbar">
                    <div class="tool-icon" data-tool="highlight" title="Highlight Mode">🔆</div>
                    <div class="tool-icon active" data-tool="arrow" title="Arrow Mode">➜</div>
                    <div class="tool-icon" data-tool="color" title="Arrow Color">🎨</div>
                    <div class="tool-icon" data-tool="eval" title="Eval Bar (Premium)" style="opacity:0.4;">📊</div>
                    <div class="tool-icon" data-tool="theme" title="Themes">🌈</div>
                    <div class="tool-icon" data-tool="settings" title="Settings">⚙️</div>
                    <div class="tool-icon" data-tool="upgrade" title="Upgrade to Premium">⭐</div>
                </div>
            </div>
            <!-- advanced settings overlay (theme + color pickers) -->
            <div class="widget-advanced" id="widget-advanced" style="display: none;">
                <div class="advanced-header">
                    <div class="advanced-title">ADVANCED SETTINGS</div>
                    <button class="advanced-close">×</button>
                </div>
                <div class="advanced-body">
                    <div class="advanced-section">
                        <div class="advanced-label">THEME</div>
                        <div class="theme-grid">
                            <div class="theme-option active" data-theme="dark"><div class="theme-preview" style="background: linear-gradient(135deg, #0a0f19 0%, #00f2ff 100%);"></div><div class="theme-name">DARK</div></div>
                            <div class="theme-option" data-theme="light"><div class="theme-preview" style="background: linear-gradient(135deg, #f5f5f5 0%, #00f2ff 100%);"></div><div class="theme-name">LIGHT</div></div>
                            <div class="theme-option" data-theme="purple"><div class="theme-preview" style="background: linear-gradient(135deg, #0a0f19 0%, #a855f7 100%);"></div><div class="theme-name">PURPLE</div></div>
                            <div class="theme-option" data-theme="green"><div class="theme-preview" style="background: linear-gradient(135deg, #0a0f19 0%, #10b981 100%);"></div><div class="theme-name">GREEN</div></div>
                            <div class="theme-option" data-theme="orange"><div class="theme-preview" style="background: linear-gradient(135deg, #0a0f19 0%, #f97316 100%);"></div><div class="theme-name">ORANGE</div></div>
                        </div>
                    </div>
                    <div class="advanced-section">
                        <div class="advanced-label">ARROW COLOR</div>
                        <div class="color-grid-advanced">
                            <div class="color-box-advanced selected" data-color="#00f2ff" style="background:#00f2ff;"></div>
                            <div class="color-box-advanced" data-color="#00ff88" style="background:#00ff88;"></div>
                            <div class="color-box-advanced" data-color="#ff00ff" style="background:#ff00ff;"></div>
                            <div class="color-box-advanced" data-color="#ffff00" style="background:#ffff00;"></div>
                            <div class="color-box-advanced" data-color="#ff8800" style="background:#ff8800;"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(widget);
        makeWidgetDraggable();
        setupWidgetEvents();
        loadWidgetSettings();
    }

    // drag-to-move: mousedown on header starts tracking,
    // mousemove updates position, mouseup stops.
    // we set right:auto so the widget doesn't fight its
    // default CSS positioning during drag.
    function makeWidgetDraggable() {
            const widget = document.getElementById('titan-widget');
            const header = widget.querySelector('.widget-header');
            let isDragging = false, startX, startY, startLeft, startTop;

            function onStart(x, y) {
                isDragging = true;
                widget.classList.add('dragging');
                const rect = widget.getBoundingClientRect();
                startX = x; startY = y;
                startLeft = rect.left; startTop = rect.top;
            }

            function onMove(x, y) {
                if (!isDragging) return;
                widget.style.left = (startLeft + x - startX) + 'px';
                widget.style.top = (startTop + y - startY) + 'px';
                widget.style.right = 'auto';
            }

            function onEnd() {
                if (isDragging) { isDragging = false; widget.classList.remove('dragging'); }
            }

            // Mouse events
            header.addEventListener('mousedown', (e) => {
                if (e.target.classList.contains('widget-minimize')) return;
                onStart(e.clientX, e.clientY);
                e.preventDefault();
            });
            document.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
            document.addEventListener('mouseup', onEnd);

            // Touch events (mobile)
            header.addEventListener('touchstart', (e) => {
                if (e.target.classList.contains('widget-minimize')) return;
                const touch = e.touches[0];
                onStart(touch.clientX, touch.clientY);
                e.preventDefault();
            }, { passive: false });
            document.addEventListener('touchmove', (e) => {
                if (!isDragging) return;
                const touch = e.touches[0];
                onMove(touch.clientX, touch.clientY);
                e.preventDefault();
            }, { passive: false });
            document.addEventListener('touchend', onEnd);
        }




    // wire up all interactive elements in the widget.
    // this is a big function because there are a lot of controls.
    // each section is grouped by feature area.
    function setupWidgetEvents() {
        const widget = document.getElementById('titan-widget');

        // sync the elo display (number + label) with currentEloIndex,
        // push the new value to the engine, and persist it.
        // also clears arrows because the old suggestion is now invalid.
        function updateEloDisplay() {
            const eloValue = widget.querySelector('#elo-value');
            const eloLabel = widget.querySelector('#elo-label');
            if (eloValue) eloValue.textContent = Eng.ELO_LEVELS[currentEloIndex];
            if (eloLabel) eloLabel.textContent = Eng.ELO_LABELS[currentEloIndex];
            Eng.setElo(String(Eng.ELO_LEVELS[currentEloIndex]));
            chrome.storage.local.set({ elo: String(Eng.ELO_LEVELS[currentEloIndex]) });
            D.clearArrows();
            T.currentFen = '';  // force re-analysis on next poll
            updateInfoDisplay();
        }

        // elo slider: «/‹/›/» buttons navigate through levels.
        // first/last jump to min/max, prev/next step by one.
        widget.querySelectorAll('.elo-arrow').forEach(arrow => {
            arrow.addEventListener('click', function () {
                const action = this.dataset.action;
                if (action === 'first') currentEloIndex = 0;
                else if (action === 'prev') currentEloIndex = Math.max(0, currentEloIndex - 1);
                else if (action === 'next') currentEloIndex = Math.min(Eng.ELO_LEVELS.length - 1, currentEloIndex + 1);
                else if (action === 'last') currentEloIndex = Eng.ELO_LEVELS.length - 1;
                updateEloDisplay();
            });
        });

        // minimize: collapses the widget body, keeps header visible
        widget.querySelector('.widget-minimize').addEventListener('click', () => widget.classList.toggle('minimized'));

        // hide: fully hides the widget (user needs to reload page to get it back)
        const hideBtn = widget.querySelector('#hide-btn');
        if (hideBtn) hideBtn.addEventListener('click', () => widget.classList.add('hidden'));

        // auto mode toggle: when active, engine analyzes automatically
        const autoBtn = widget.querySelector('#auto-btn');
        if (autoBtn) autoBtn.addEventListener('click', function () {
            this.classList.toggle('active');
            showStatusNotification(this.classList.contains('active') ? 'AUTO: ON' : 'AUTO: OFF');
        });

        // mode switching: account / combat / threat
        // these are mutually exclusive — clicking one deactivates the others.
        // combat mode uses COMBAT_CONFIG (higher depth/skill).
        // threat mode is a placeholder in free version.
        // account mode is the default (normal elo-limited play).
        widget.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                const mode = this.classList.contains('combat') ? 'combat' :
                             this.classList.contains('threat') ? 'threat' : 'account';
                widget.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                T.currentMode = mode;
                T.combatMode = (mode === 'combat');
                if (T.combatMode) {
                    Eng.applyCombatConfig();
                    showStatusNotification('COMBAT MODE: ON');
                } else if (mode === 'threat') {
                    showStatusNotification('THREAT MODE');
                } else {
                    Eng.setElo(T.currentElo);
                    showStatusNotification('ACCOUNT MODE');
                }
                D.clearArrows();
                T.currentFen = '';
                chrome.storage.local.set({ engineMode: mode });
            });
        });

        // queue toggle: pre-analyze during opponent's turn.
        // stores moves in T.moveQueue for display.
        const queueBtn = widget.querySelector('#queue-btn');
        if (queueBtn) queueBtn.addEventListener('click', function () {
            T.queueMode = !T.queueMode;
            this.classList.toggle('active', T.queueMode);
            T.moveQueue = [];
            updateQueueDisplay();
            showStatusNotification(T.queueMode ? 'QUEUE: ON' : 'QUEUE: OFF');
            chrome.storage.local.set({ queueMode: T.queueMode });
        });

        // tab switching (text tabs at top).
        // we toggle both classList AND style.display because
        // chess.com's CSS can override one layer but not both.
        widget.querySelectorAll('.widget-tab').forEach(tab => {
            tab.addEventListener('click', function () {
                const tabName = this.dataset.tab;
                widget.querySelectorAll('.widget-tab').forEach(t => t.classList.remove('active'));
                this.classList.add('active');
                widget.querySelectorAll('.widget-icon').forEach(i => { i.classList.remove('active'); if (i.dataset.icon === tabName) i.classList.add('active'); });
                widget.querySelectorAll('.tab-content').forEach(c => { c.classList.remove('active'); c.style.display = 'none'; if (c.dataset.content === tabName) { c.classList.add('active'); c.style.display = 'block'; } });
            });
        });

        // icon switching (emoji row below tabs) — same logic as tabs
        widget.querySelectorAll('.widget-icon[data-icon]').forEach(icon => {
            icon.addEventListener('click', function () {
                const iconName = this.dataset.icon;
                widget.querySelectorAll('.widget-icon').forEach(i => i.classList.remove('active'));
                this.classList.add('active');
                widget.querySelectorAll('.widget-tab').forEach(t => { t.classList.remove('active'); if (t.dataset.tab === iconName) t.classList.add('active'); });
                widget.querySelectorAll('.tab-content').forEach(c => { c.classList.remove('active'); c.style.display = 'none'; if (c.dataset.content === iconName) { c.classList.add('active'); c.style.display = 'block'; } });
            });
        });

        // bottom toolbar: quick actions without switching tabs.
        // highlight/arrow toggle the draw mode.
        // color cycles through the 5 preset colors.
        // theme/settings open the advanced panel.
        // upgrade opens the store in a new tab.
        widget.querySelectorAll('.tool-icon[data-tool]').forEach(icon => {
            icon.addEventListener('click', function () {
                const tool = this.dataset.tool;
                if (tool === 'highlight' || tool === 'arrow') {
                    widget.querySelectorAll('.tool-icon[data-tool="highlight"], .tool-icon[data-tool="arrow"]').forEach(i => i.classList.remove('active'));
                    this.classList.add('active');
                    T.arrowMode = tool === 'arrow' ? 'arrow' : 'highlight';
                    chrome.storage.local.set({ arrowMode: T.arrowMode });
                    showStatusNotification(`ARROW MODE: ${T.arrowMode.toUpperCase()}`);
                    if (T.arrows.length) D.draw(true);
                    updateInfoDisplay();
                } else if (tool === 'eval') {
                    showStatusNotification('EVAL BAR: PREMIUM ONLY');
                } else if (tool === 'color') {
                    // cycle through colors on each click
                    const colors = ['#00f2ff', '#00ff88', '#ff00ff', '#ffff00', '#ff8800'];
                    const names = ['CYAN', 'GREEN', 'MAGENTA', 'YELLOW', 'ORANGE'];
                    const idx = colors.indexOf(T.arrowColor);
                    const next = (idx + 1) % colors.length;
                    T.arrowColor = colors[next];
                    chrome.storage.local.set({ arrowColor: T.arrowColor });
                    showStatusNotification(`ARROW COLOR: ${names[next]}`);
                    if (T.arrows.length) D.draw(true);
                    updateInfoDisplay();
                } else if (tool === 'theme' || tool === 'settings') {
                    const panel = widget.querySelector('#widget-advanced');
                    if (panel) panel.style.display = 'block';
                } else if (tool === 'upgrade') {
                    window.open('https://titanchess.online', '_blank');
                }
            });
        });

        // advanced panel open/close
        const advClose = widget.querySelector('.advanced-close');
        if (advClose) advClose.addEventListener('click', () => widget.querySelector('#widget-advanced').style.display = 'none');
        const advBtn = widget.querySelector('#advanced-btn');
        if (advBtn) advBtn.addEventListener('click', () => widget.querySelector('#widget-advanced').style.display = 'block');

        // theme selection from advanced panel.
        // syncs with the compact theme cards in the eval tab too.
        widget.querySelectorAll('.theme-option').forEach(opt => {
            opt.addEventListener('click', function () {
                widget.querySelectorAll('.theme-option').forEach(o => o.classList.remove('active'));
                this.classList.add('active');
                const theme = this.dataset.theme;
                chrome.storage.local.set({ theme });
                applyTheme(theme);
                // keep compact cards in sync
                widget.querySelectorAll('.theme-card').forEach(c => { c.classList.remove('active'); if (c.dataset.theme === theme) c.classList.add('active'); });
                showStatusNotification(`THEME: ${theme.toUpperCase()}`);
            });
        });

        // theme selection from compact cards (eval tab).
        // syncs with the advanced panel theme options.
        widget.querySelectorAll('.theme-card').forEach(card => {
            card.addEventListener('click', function () {
                const theme = this.dataset.theme;
                widget.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active'));
                this.classList.add('active');
                widget.querySelectorAll('.theme-option').forEach(o => { o.classList.remove('active'); if (o.dataset.theme === theme) o.classList.add('active'); });
                chrome.storage.local.set({ theme });
                applyTheme(theme);
                showStatusNotification(`THEME: ${theme.toUpperCase()}`);
            });
        });

        // arrow color from advanced panel
        widget.querySelectorAll('.color-box-advanced').forEach(box => {
            box.addEventListener('click', function () {
                T.arrowColor = this.dataset.color;
                widget.querySelectorAll('.color-box-advanced').forEach(b => b.classList.remove('selected'));
                this.classList.add('selected');
                chrome.storage.local.set({ arrowColor: T.arrowColor });
                if (T.arrows.length) D.draw(true);
                updateInfoDisplay();
            });
        });

        // arrow mode cards (arrow tab)
        widget.querySelectorAll('.arrow-mode-card').forEach(card => {
            card.addEventListener('click', function () {
                T.arrowMode = this.dataset.mode;
                widget.querySelectorAll('.arrow-mode-card').forEach(c => c.classList.remove('active'));
                this.classList.add('active');
                // sync toolbar icons
                widget.querySelectorAll('.tool-icon[data-tool="highlight"], .tool-icon[data-tool="arrow"]').forEach(i => i.classList.remove('active'));
                const toolIcon = widget.querySelector(`.tool-icon[data-tool="${T.arrowMode}"]`);
                if (toolIcon) toolIcon.classList.add('active');
                chrome.storage.local.set({ arrowMode: T.arrowMode });
                showStatusNotification(`ARROW MODE: ${T.arrowMode.toUpperCase()}`);
                if (T.arrows.length) D.draw(true);
                updateInfoDisplay();
            });
        });

        // arrow color cards (arrow tab).
        // syncs with the advanced panel color boxes.
        widget.querySelectorAll('.arrow-color-card').forEach(card => {
            card.addEventListener('click', function () {
                T.arrowColor = this.dataset.color;
                widget.querySelectorAll('.arrow-color-card').forEach(c => c.classList.remove('selected'));
                this.classList.add('selected');
                // sync advanced panel
                widget.querySelectorAll('.color-box-advanced').forEach(b => b.classList.remove('selected'));
                const advBox = widget.querySelector(`.color-box-advanced[data-color="${T.arrowColor}"]`);
                if (advBox) advBox.classList.add('selected');
                chrome.storage.local.set({ arrowColor: T.arrowColor });
                const names = { '#00f2ff': 'CYAN', '#00ff88': 'GREEN', '#ff00ff': 'MAGENTA', '#ffff00': 'YELLOW', '#ff8800': 'ORANGE' };
                showStatusNotification(`ARROW COLOR: ${names[T.arrowColor] || 'CUSTOM'}`);
                if (T.arrows.length) D.draw(true);
                updateInfoDisplay();
            });
        });

        // eval toggle cards — locked in free version
        widget.querySelectorAll('.eval-toggle-card').forEach(card => {
            card.addEventListener('click', () => showStatusNotification('EVAL BAR: PREMIUM ONLY'));
        });

        // upgrade link in info tab
        const upgradeLink = widget.querySelector('#info-upgrade-link');
        if (upgradeLink) upgradeLink.addEventListener('click', () => window.open('https://titanchess.online', '_blank'));
    }

    // restore saved preferences from chrome.storage.
    // runs once after widget creation. if you add a new
    // persisted setting, load it here and apply it to the UI.
    function loadWidgetSettings() {
        chrome.storage.local.get(['elo', 'arrowMode', 'arrowColor', 'theme', 'engineMode', 'queueMode'], (result) => {
            const widget = document.getElementById('titan-widget');
            if (!widget) return;

            // restore elo level (capped at 1900 for free version)
            if (result.elo && parseInt(result.elo) <= 1900) {
                const idx = Eng.ELO_LEVELS.indexOf(parseInt(result.elo));
                if (idx !== -1) {
                    currentEloIndex = idx;
                    const v = widget.querySelector('#elo-value'), l = widget.querySelector('#elo-label');
                    if (v) v.textContent = Eng.ELO_LEVELS[idx];
                    if (l) l.textContent = Eng.ELO_LABELS[idx];
                }
            }

            // restore arrow mode (arrow or highlight)
            if (result.arrowMode) {
                T.arrowMode = result.arrowMode;
                widget.querySelectorAll('.tool-icon[data-tool="highlight"], .tool-icon[data-tool="arrow"]').forEach(i => i.classList.remove('active'));
                const toolIcon = widget.querySelector(`.tool-icon[data-tool="${result.arrowMode}"]`);
                if (toolIcon) toolIcon.classList.add('active');
                const modeCard = widget.querySelector(`.arrow-mode-card[data-mode="${result.arrowMode}"]`);
                if (modeCard) { widget.querySelectorAll('.arrow-mode-card').forEach(c => c.classList.remove('active')); modeCard.classList.add('active'); }
            }

            // restore arrow color
            if (result.arrowColor) {
                T.arrowColor = result.arrowColor;
                const colorBox = widget.querySelector(`.color-box-advanced[data-color="${result.arrowColor}"]`);
                if (colorBox) { widget.querySelectorAll('.color-box-advanced').forEach(b => b.classList.remove('selected')); colorBox.classList.add('selected'); }
                const colorCard = widget.querySelector(`.arrow-color-card[data-color="${result.arrowColor}"]`);
                if (colorCard) { widget.querySelectorAll('.arrow-color-card').forEach(c => c.classList.remove('selected')); colorCard.classList.add('selected'); }
            }

            // restore engine mode (account / combat / threat)
            if (result.engineMode) {
                T.currentMode = result.engineMode;
                T.combatMode = (result.engineMode === 'combat');
                widget.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
                const modeBtn = widget.querySelector(`.mode-btn.${result.engineMode}`);
                if (modeBtn) modeBtn.classList.add('active');
                if (T.combatMode && T.engineReady) Eng.applyCombatConfig();
            }

            // restore queue mode
            if (result.queueMode) {
                T.queueMode = result.queueMode;
                const qBtn = widget.querySelector('#queue-btn');
                if (qBtn) qBtn.classList.toggle('active', T.queueMode);
                updateQueueDisplay();
            }

            // restore theme (default: dark)
            const theme = result.theme || 'dark';
            applyTheme(theme);
            const themeOpt = widget.querySelector(`.theme-option[data-theme="${theme}"]`);
            if (themeOpt) { widget.querySelectorAll('.theme-option').forEach(o => o.classList.remove('active')); themeOpt.classList.add('active'); }
            const themeCard = widget.querySelector(`.theme-card[data-theme="${theme}"]`);
            if (themeCard) { widget.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active')); themeCard.classList.add('active'); }

            updateInfoDisplay();
        });
    }

    // update the status dot (green = connected, red = disconnected).
    // called by engine.js when stockfish sends 'uciok' or errors out.
    function updateStatus(connected) {
        const widget = document.getElementById('titan-widget');
        if (!widget) return;
        const dot = widget.querySelector('#widget-status-dot');
        if (dot) dot.classList.toggle('connected', connected);
        const statusDot = widget.querySelector('#info-status .status-dot');
        const statusText = widget.querySelector('#info-status .status-text');
        if (statusDot) statusDot.classList.toggle('connected', connected);
        if (statusText) statusText.textContent = connected ? 'Connected' : 'Disconnected';
    }

    // toast notification that appears briefly at the top of the page.
    // auto-removes after 2 seconds. only one visible at a time.
    function showStatusNotification(text) {
        const existing = document.querySelector('.status-notification');
        if (existing) existing.remove();
        const el = document.createElement('div');
        el.className = 'status-notification';
        el.innerHTML = `<div class="status-notification-text">${text}</div>`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 2000);
    }

    // refresh the INFO tab with current values.
    // called after any setting change so the info tab stays accurate.
    function updateInfoDisplay() {
        const widget = document.getElementById('titan-widget');
        if (!widget) return;
        const infoElo = widget.querySelector('#info-elo');
        if (infoElo) infoElo.textContent = Eng.ELO_LEVELS[currentEloIndex];
        const infoMode = widget.querySelector('#info-arrow-mode');
        if (infoMode) infoMode.textContent = T.arrowMode === 'arrow' ? 'Arrow' : 'Highlight';
        const infoColor = widget.querySelector('#info-arrow-color');
        if (infoColor) {
            const names = { '#00f2ff': 'Cyan', '#00ff88': 'Green', '#ff00ff': 'Magenta', '#ffff00': 'Yellow', '#ff8800': 'Orange' };
            infoColor.innerHTML = `<span class="color-indicator" style="background:${T.arrowColor};"></span><span>${names[T.arrowColor] || 'Custom'}</span>`;
        }
    }

    // update the queue button text to show move count
    function updateQueueDisplay() {
        const widget = document.getElementById('titan-widget');
        if (!widget) return;
        const queueBtn = widget.querySelector('#queue-btn');
        if (queueBtn) queueBtn.textContent = T.queueMode ? `QUEUE (${T.moveQueue.length})` : 'QUEUE';
    }

    // public API — other modules call these to update the widget
    window.TitanWidget = {
        createFloatingWidget, updateStatus, showStatusNotification,
        updateInfoDisplay, updateQueueDisplay
    };
})();
