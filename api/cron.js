const axios = require('axios');

const COINPAPRIKA_URL = 'https://api.coinpaprika.com/v1/tickers';

let topCoinsCache = [];
let lastCacheUpdate = 0;
const CACHE_DURATION = 120000;

// Alert storage (sederhana, pake memory)
let alerts = new Map();

async function getTop100Coins() {
    const now = Date.now();
    if (topCoinsCache.length > 0 && (now - lastCacheUpdate) < CACHE_DURATION) {
        return topCoinsCache;
    }
    
    try {
        const response = await axios.get(`${COINPAPRIKA_URL}?limit=100`);
        const coins = response.data.map(coin => ({
            id: coin.id,
            name: coin.name,
            symbol: coin.symbol.toUpperCase(),
            price_usd: parseFloat(coin.quotes?.USD?.price || 0),
            percent_change_24h: coin.quotes?.USD?.percent_change_24h || 0
        }));
        
        topCoinsCache = coins;
        lastCacheUpdate = now;
        return coins;
    } catch (error) {
        return topCoinsCache;
    }
}

module.exports = async (req, res) => {
    // Ini cuma contoh. Lo butuh sistem persistent (Redis/Database)
    // karena memory Vercel gak persistent
    
    res.status(200).json({ 
        status: 'cron executed', 
        cacheSize: topCoinsCache.length,
        alertsCount: alerts.size 
    });
};
