let currentElo = '1000';
let arrowMode = 'highlight';
let arrowColor = '#00f2ff';

// Load settings
chrome.storage.local.get(['elo', 'arrowMode', 'arrowColor'], (result) => {
    if (result.elo && parseInt(result.elo) <= 1500) {
        currentElo = result.elo;
    }
    if (result.arrowMode) {
        arrowMode = result.arrowMode;
    }
    if (result.arrowColor) {
        arrowColor = result.arrowColor;
    }
});

// Message handler
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SET_ELO') {
        currentElo = msg.elo;
        chrome.storage.local.set({ elo: msg.elo });
        chrome.tabs.query({ url: '*://www.chess.com/*' }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, {
                    type: 'SET_ELO',
                    elo: msg.elo
                }).catch(() => {});
            });
        });
        sendResponse({ success: true });
    } else if (msg.type === 'SET_ARROW_MODE') {
        arrowMode = msg.mode;
        chrome.storage.local.set({ arrowMode: msg.mode });
        sendResponse({ success: true });
    } else if (msg.type === 'SET_ARROW_COLOR') {
        arrowColor = msg.color;
        chrome.storage.local.set({ arrowColor: msg.color });
        sendResponse({ success: true });
    } else if (msg.type === 'SET_EVAL_BAR') {
        chrome.tabs.query({ url: '*://www.chess.com/*' }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, {
                    type: 'SET_EVAL_BAR',
                    enabled: msg.enabled
                }).catch(() => {});
            });
        });
        sendResponse({ success: true });
    } else if (msg.type === 'GET_STATUS') {
        sendResponse({ ready: true, elo: currentElo });
    }
    
    return true;
});
