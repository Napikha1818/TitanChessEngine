// Engine Manager - Stockfish Controller for FREE Tier
class StockfishEngine {
    constructor() {
        this.engine = null;
        this.ready = false;
        this.analyzing = false;
        this.currentElo = '1000';
        this.callbacks = new Map();
    }

    async init() {
        return new Promise((resolve) => {
            if (this.engine) {
                resolve(true);
                return;
            }

            const wasmSupported = typeof WebAssembly === 'object';
            const enginePath = wasmSupported 
                ? chrome.runtime.getURL('engine/stockfish.js')
                : chrome.runtime.getURL('engine/stockfish.js');

            this.engine = new Worker(enginePath);
            
            this.engine.onmessage = (e) => {
                const line = e.data;
                if (line === 'uciok') {
                    this.ready = true;
                    this.engine.postMessage('setoption name UCI_LimitStrength value true');
                    this.setElo(this.currentElo);
                    resolve(true);
                } else if (line.startsWith('bestmove')) {
                    this.handleBestMove(line);
                } else if (line.startsWith('info')) {
                    this.handleInfo(line);
                }
            };

            this.engine.postMessage('uci');
        });
    }

    setElo(elo) {
        this.currentElo = elo;
        const config = this.getEloConfig(elo);
        
        if (this.engine && this.ready) {
            this.engine.postMessage(`setoption name UCI_Elo value ${config.uciElo}`);
            this.engine.postMessage(`setoption name Skill Level value ${config.skillLevel}`);
        }
    }

    getEloConfig(elo) {
        const configs = {
            '1000': { skillLevel: 1, depth: 8, uciElo: 1000 },
            '1200': { skillLevel: 4, depth: 10, uciElo: 1200 },
            '1300': { skillLevel: 7, depth: 12, uciElo: 1300 },
            '1400': { skillLevel: 10, depth: 14, uciElo: 1400 },
            '1500': { skillLevel: 13, depth: 16, uciElo: 1500 }
        };
        return configs[elo] || configs['1000'];
    }

    analyze(fen, callback) {
        if (!this.ready || this.analyzing) return;
        
        this.analyzing = true;
        this.callbacks.set('analyze', callback);
        
        const config = this.getEloConfig(this.currentElo);
        
        this.engine.postMessage('ucinewgame');
        this.engine.postMessage(`position fen ${fen}`);
        this.engine.postMessage(`go depth ${config.depth}`);
    }

    handleBestMove(line) {
        const match = line.match(/bestmove ([a-h][1-8][a-h][1-8])/);
        if (match && this.callbacks.has('analyze')) {
            const callback = this.callbacks.get('analyze');
            callback({ move: match[1] });
            this.callbacks.delete('analyze');
        }
        this.analyzing = false;
    }

    handleInfo(line) {
        // Parse score for eval bar
        const scoreMatch = line.match(/score cp (-?\d+)/);
        if (scoreMatch && this.callbacks.has('analyze')) {
            const score = parseInt(scoreMatch[1]) / 100;
            const callback = this.callbacks.get('analyze');
            callback({ score: score, partial: true });
        }
    }

    stop() {
        if (this.engine) {
            this.engine.postMessage('stop');
            this.analyzing = false;
        }
    }
}

// Export for use in service worker
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StockfishEngine;
}
