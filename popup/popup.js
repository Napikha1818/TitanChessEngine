(() => {
    const ELO_LABELS = {
        '1000': 'BRONZE', '1200': 'BRONZE+', '1300': 'SILVER',
        '1400': 'SILVER+', '1500': 'SILVER++', '1600': 'GOLD',
        '1700': 'GOLD+', '1800': 'GOLD++', '1900': 'EXPERT'
    };

    // Load current ELO
    chrome.storage.local.get(['elo'], (result) => {
        const eloEl = document.getElementById('currentElo');
        if (eloEl && result.elo) {
            const label = ELO_LABELS[result.elo] || 'CUSTOM';
            eloEl.textContent = `${result.elo} (${label})`;
        }
    });

    // Upgrade button
    document.getElementById('upgradeBtn').addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://titanchess.store' });
    });
})();
