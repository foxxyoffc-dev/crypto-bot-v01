const axios = require('axios');

// ==================== KONFIGURASI ====================
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;
const COINPAPRIKA_URL = 'https://api.coinpaprika.com/v1/tickers';

// Cache untuk 100 coin teratas (update tiap 2 menit)
let topCoinsCache = [];
let lastCacheUpdate = 0;
const CACHE_DURATION = 120000; // 2 menit

// Alert system (simpan di memory, kalo Vercel restart bakal ilang)
let alerts = new Map(); // chatId -> { coinId, targetPrice, direction }

// ==================== AMBIL 100 COIN TERATAS ====================
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
            percent_change_24h: coin.quotes?.USD?.percent_change_24h || 0,
            market_cap: coin.quotes?.USD?.market_cap || 0,
            volume_24h: coin.quotes?.USD?.volume_24h || 0
        }));
        
        topCoinsCache = coins;
        lastCacheUpdate = now;
        console.log(`✅ Cache updated: ${coins.length} coins`);
        return coins;
    } catch (error) {
        console.error('Error fetching top 100 coins:', error.message);
        return topCoinsCache.length > 0 ? topCoinsCache : [];
    }
}

// ==================== AMBIL HARGA 1 COIN ====================
async function getCoinPrice(coinId) {
    try {
        const response = await axios.get(`${COINPAPRIKA_URL}/${coinId}`);
        return {
            id: response.data.id,
            name: response.data.name,
            symbol: response.data.symbol.toUpperCase(),
            price_usd: parseFloat(response.data.quotes?.USD?.price || 0),
            percent_change_1h: response.data.quotes?.USD?.percent_change_1h || 0,
            percent_change_24h: response.data.quotes?.USD?.percent_change_24h || 0,
            market_cap: response.data.quotes?.USD?.market_cap || 0,
            volume_24h: response.data.quotes?.USD?.volume_24h || 0,
            ath_price: response.data.quotes?.USD?.ath_price || 0
        };
    } catch (error) {
        console.error('Error fetching coin price:', error.message);
        return null;
    }
}

// ==================== FORMAT PESAN HARGA ====================
function formatPriceMessage(coin) {
    const price = coin.price_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    const change24h = coin.percent_change_24h;
    const changeSymbol = change24h >= 0 ? '📈' : '📉';
    const changeColor = change24h >= 0 ? '🟢' : '🔴';
    
    let message = `🔹 *${coin.name} (${coin.symbol})*\n`;
    message += `💰 Harga: *$${price}*\n`;
    message += `${changeColor} 24h: ${changeSymbol} *${Math.abs(change24h).toFixed(2)}%*\n`;
    message += `💎 Market Cap: $${(coin.market_cap / 1e9).toFixed(2)}B\n`;
    message += `📊 Volume 24h: $${(coin.volume_24h / 1e9).toFixed(2)}B\n`;
    
    if (coin.ath_price > 0) {
        const athPercent = (coin.price_usd / coin.ath_price) * 100;
        message += `🏆 ATH: $${coin.ath_price.toLocaleString()} (${athPercent.toFixed(1)}% dari ATH)\n`;
    }
    
    return message;
}

// ==================== FORMAT DAFTAR COIN ====================
function formatCoinList(coins, page = 1) {
    const itemsPerPage = 20;
    const start = (page - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const pageCoins = coins.slice(start, end);
    
    let message = `📊 *TOP 100 COIN (Halaman ${page} / 5)*\n\n`;
    pageCoins.forEach((coin, idx) => {
        const rank = start + idx + 1;
        const change = coin.percent_change_24h;
        const arrow = change >= 0 ? '🟢' : '🔴';
        message += `${rank}. *${coin.symbol}* - $${coin.price_usd.toFixed(2)} ${arrow} ${Math.abs(change).toFixed(1)}%\n`;
    });
    
    message += `\n📌 Ketik /price <symbol> buat detail\n`;
    message += `📌 Contoh: /price BTC\n`;
    message += `📌 Ketik /page <nomor> (1-5) buat ganti halaman`;
    
    return message;
}

// ==================== FORMAT ALERT ====================
function formatAlertList(chatId) {
    const userAlerts = alerts.get(chatId) || [];
    if (userAlerts.length === 0) {
        return "⚠️ *Belum ada alert yang aktif*\n\n📌 Buat alert: /alert <symbol> <target> <above/below>\n📌 Contoh: /alert BTC 100000 above";
    }
    
    let message = "🔔 *Daftar Alert Aktif*\n\n";
    userAlerts.forEach((alert, idx) => {
        message += `${idx + 1}. *${alert.coinId.toUpperCase()}* → $${alert.targetPrice.toLocaleString()} (${alert.direction})\n`;
    });
    message += "\n📌 Hapus alert: /remove <nomor>\n📌 Hapus semua: /clearalerts";
    
    return message;
}

// ==================== CEK ALERT ====================
async function checkAlerts() {
    const coins = await getTop100Coins();
    const coinMap = new Map();
    coins.forEach(coin => coinMap.set(coin.symbol.toLowerCase(), coin));
    
    for (const [chatId, userAlerts] of alerts.entries()) {
        const newAlerts = [];
        const triggeredAlerts = [];
        
        for (const alert of userAlerts) {
            const coin = coinMap.get(alert.coinId.toLowerCase());
            if (!coin) {
                newAlerts.push(alert);
                continue;
            }
            
            let triggered = false;
            if (alert.direction === 'above' && coin.price_usd >= alert.targetPrice) {
                triggered = true;
            } else if (alert.direction === 'below' && coin.price_usd <= alert.targetPrice) {
                triggered = true;
            }
            
            if (triggered) {
                triggeredAlerts.push({ ...alert, currentPrice: coin.price_usd });
            } else {
                newAlerts.push(alert);
            }
        }
        
        alerts.set(chatId, newAlerts);
        
        // Kirim notifikasi ke user
        for (const alert of triggeredAlerts) {
            const message = `🔔 *ALERT TRIGGERED!*\n\n` +
                `💰 *${alert.coinId.toUpperCase()}* ${alert.direction === 'above' ? 'naik di atas' : 'turun di bawah'} $${alert.targetPrice.toLocaleString()}\n` +
                `📊 Harga sekarang: *$${alert.currentPrice.toLocaleString()}*`;
            
            await sendMessage(chatId, message);
        }
    }
}

// ==================== KIRIM PESAN KE TELEGRAM ====================
async function sendMessage(chatId, text, parseMode = 'Markdown') {
    try {
        await axios.post(`${BASE_URL}/sendMessage`, {
            chat_id: chatId,
            text: text,
            parse_mode: parseMode
        });
    } catch (error) {
        console.error('Error sending message:', error.message);
    }
}

// ==================== PROSES COMMAND ====================
async function processCommand(chatId, text) {
    const parts = text.trim().split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);
    
    switch (command) {
        case '/start':
            await sendMessage(chatId, 
                "🤖 *Crypto Price Bot Aktif!*\n\n" +
                "📌 *Commands:*\n" +
                "/price <symbol> - Cek harga coin (contoh: /price BTC)\n" +
                "/list - Lihat 100 coin teratas\n" +
                "/page <1-5> - Ganti halaman list\n" +
                "/alert <symbol> <target> <above/below> - Buat alert harga\n" +
                "/myalerts - Lihat alert aktif\n" +
                "/remove <nomor> - Hapus alert\n" +
                "/clearalerts - Hapus semua alert\n" +
                "/top - Gainers & Losers 24h\n\n" +
                "🆓 *Gratis & Real-time!* ⚡"
            );
            break;
            
        case '/price':
            if (args.length === 0) {
                await sendMessage(chatId, "⚠️ Masukkan symbol coin!\n📌 Contoh: /price BTC");
                break;
            }
            const symbol = args[0].toUpperCase();
            const coins = await getTop100Coins();
            const coin = coins.find(c => c.symbol === symbol);
            
            if (!coin) {
                await sendMessage(chatId, `❌ Coin *${symbol}* tidak ditemukan!\n📌 Cek /list buat lihat daftar coin`);
                break;
            }
            
            const detail = await getCoinPrice(coin.id);
            if (detail) {
                await sendMessage(chatId, formatPriceMessage(detail));
            } else {
                await sendMessage(chatId, `❌ Gagal mengambil data *${symbol}*`);
            }
            break;
            
        case '/list':
            const allCoins = await getTop100Coins();
            await sendMessage(chatId, formatCoinList(allCoins, 1));
            break;
            
        case '/page':
            const page = parseInt(args[0]) || 1;
            if (page < 1 || page > 5) {
                await sendMessage(chatId, "⚠️ Halaman 1-5 aja bro!");
                break;
            }
            const listCoins = await getTop100Coins();
            await sendMessage(chatId, formatCoinList(listCoins, page));
            break;
            
        case '/alert':
            if (args.length < 3) {
                await sendMessage(chatId, "⚠️ Format: /alert <symbol> <target> <above/below>\n📌 Contoh: /alert BTC 100000 above");
                break;
            }
            const coinSymbol = args[0].toUpperCase();
            const targetPrice = parseFloat(args[1]);
            const direction = args[2].toLowerCase();
            
            if (isNaN(targetPrice)) {
                await sendMessage(chatId, "⚠️ Target harga harus angka!");
                break;
            }
            if (direction !== 'above' && direction !== 'below') {
                await sendMessage(chatId, "⚠️ Direction harus 'above' atau 'below'!");
                break;
            }
            
            const coinList = await getTop100Coins();
            const exists = coinList.find(c => c.symbol === coinSymbol);
            if (!exists) {
                await sendMessage(chatId, `❌ Coin *${coinSymbol}* tidak ditemukan!`);
                break;
            }
            
            const userAlerts = alerts.get(chatId) || [];
            userAlerts.push({ coinId: coinSymbol, targetPrice, direction, createdAt: Date.now() });
            alerts.set(chatId, userAlerts);
            
            await sendMessage(chatId, `✅ Alert untuk *${coinSymbol}* dibuat!\n📊 Target: ${direction === 'above' ? 'naik di atas' : 'turun di bawah'} *$${targetPrice.toLocaleString()}*`);
            break;
            
        case '/myalerts':
            await sendMessage(chatId, formatAlertList(chatId));
            break;
            
        case '/remove':
            const idx = parseInt(args[0]) - 1;
            const currentAlerts = alerts.get(chatId) || [];
            if (isNaN(idx) || idx < 0 || idx >= currentAlerts.length) {
                await sendMessage(chatId, "⚠️ Nomor alert tidak valid! Cek /myalerts");
                break;
            }
            const removed = currentAlerts.splice(idx, 1);
            alerts.set(chatId, currentAlerts);
            await sendMessage(chatId, `✅ Alert untuk *${removed[0].coinId.toUpperCase()}* dihapus!`);
            break;
            
        case '/clearalerts':
            alerts.delete(chatId);
            await sendMessage(chatId, "✅ Semua alert dihapus!");
            break;
            
        case '/top':
            const topCoins = await getTop100Coins();
            const gainers = [...topCoins].sort((a, b) => b.percent_change_24h - a.percent_change_24h).slice(0, 5);
            const losers = [...topCoins].sort((a, b) => a.percent_change_24h - b.percent_change_24h).slice(0, 5);
            
            let topMsg = "📈 *TOP 5 GAINERS 24H*\n";
            gainers.forEach((c, i) => {
                topMsg += `${i+1}. *${c.symbol}* 🟢 +${c.percent_change_24h.toFixed(1)}%\n`;
            });
            topMsg += "\n📉 *TOP 5 LOSERS 24H*\n";
            losers.forEach((c, i) => {
                topMsg += `${i+1}. *${c.symbol}* 🔴 ${c.percent_change_24h.toFixed(1)}%\n`;
            });
            
            await sendMessage(chatId, topMsg);
            break;
            
        default:
            await sendMessage(chatId, "❌ Command gak dikenal!\n📌 Ketik /start buat liat daftar command.");
    }
}

// ==================== WEBHOOK UTAMA ====================
module.exports = async (req, res) => {
    if (req.method === 'POST') {
        const { message } = req.body;
        
        if (message && message.text && message.chat && message.chat.id) {
            const chatId = message.chat.id;
            const text = message.text;
            
            console.log(`Received message from ${chatId}: ${text}`);
            
            try {
                await processCommand(chatId, text);
            } catch (error) {
                console.error('Error processing command:', error);
                await sendMessage(chatId, "❌ Terjadi kesalahan, coba lagi nanti.");
            }
        }
        
        res.status(200).json({ status: 'ok' });
    } else if (req.method === 'GET') {
        // Buat testing: cek apakah bot hidup
        res.status(200).json({ status: 'Bot is alive', alerts: alerts.size });
    } else {
        res.status(405).json({ error: 'Method not allowed' });
    }
};

// ==================== CRON JOB BUAT UPDATE CACHE & CEK ALERT ====================
// Di Vercel, cron job harus pake layanan eksternal kayak cron-job.org
// Atau pake Vercel Cron Jobs (beta)
// Gue saranin pake cron-job.org (gratis) buat panggil endpoint ini tiap 2 menit

// Endpoint buat cron job: https://your-bot.vercel.app/api/cron
// Lo bisa tambahin file api/cron.js sendiri kalo mau
