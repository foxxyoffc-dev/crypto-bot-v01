const axios = require('axios');

// Konfigurasi
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;
const COINPAPRIKA_URL = 'https://api.coinpaprika.com/v1/tickers';

// Cache 100 coin teratas
let topCoinsCache = [];
let lastCacheUpdate = 0;

// Alert storage (sementara, pake memory)
let alerts = new Map();

// Ambil 100 coin teratas
async function getTop100Coins() {
    const now = Date.now();
    if (topCoinsCache.length > 0 && (now - lastCacheUpdate) < 120000) {
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
        return coins;
    } catch (error) {
        return topCoinsCache;
    }
}

// Ambil detail 1 coin
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
            volume_24h: response.data.quotes?.USD?.volume_24h || 0
        };
    } catch (error) {
        return null;
    }
}

// Kirim pesan ke Telegram
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

// Format pesan harga
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
    
    return message;
}

// Format daftar coin
function formatCoinList(coins, page = 1) {
    const itemsPerPage = 20;
    const start = (page - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const pageCoins = coins.slice(start, end);
    
    let message = `📊 *TOP 100 COIN (Halaman ${page}/5)*\n\n`;
    pageCoins.forEach((coin, idx) => {
        const rank = start + idx + 1;
        const change = coin.percent_change_24h;
        const arrow = change >= 0 ? '🟢' : '🔴';
        message += `${rank}. *${coin.symbol}* - $${coin.price_usd.toFixed(2)} ${arrow} ${Math.abs(change).toFixed(1)}%\n`;
    });
    
    message += `\n📌 Ketik /price <symbol> buat detail\n📌 Contoh: /price BTC\n📌 Ketik /page <nomor> (1-5)`;
    
    return message;
}

// Format top gainers/losers
async function getTopGainersLosers() {
    const coins = await getTop100Coins();
    const gainers = [...coins].sort((a, b) => b.percent_change_24h - a.percent_change_24h).slice(0, 5);
    const losers = [...coins].sort((a, b) => a.percent_change_24h - b.percent_change_24h).slice(0, 5);
    
    let message = "📈 *TOP 5 GAINERS 24H*\n";
    gainers.forEach((c, i) => {
        message += `${i+1}. *${c.symbol}* 🟢 +${c.percent_change_24h.toFixed(1)}%\n`;
    });
    message += "\n📉 *TOP 5 LOSERS 24H*\n";
    losers.forEach((c, i) => {
        message += `${i+1}. *${c.symbol}* 🔴 ${c.percent_change_24h.toFixed(1)}%\n`;
    });
    
    return message;
}

// Proses command
async function processCommand(chatId, text) {
    const parts = text.trim().split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);
    
    switch (command) {
        case '/start':
            await sendMessage(chatId, 
                "🤖 *Crypto Price Bot Aktif!*\n\n" +
                "📌 *Commands:*\n" +
                "/price <symbol> - Cek harga (contoh: /price BTC)\n" +
                "/list - 100 coin teratas\n" +
                "/page <1-5> - Ganti halaman\n" +
                "/top - Gainers & Losers\n" +
                "/alert <symbol> <target> <above/below> - Buat alert\n" +
                "/myalerts - Lihat alert\n" +
                "/remove <nomor> - Hapus alert\n" +
                "/clearalerts - Hapus semua alert\n\n" +
                "🆓 *Gratis & Real-time!*"
            );
            break;
            
        case '/price':
            if (args.length === 0) {
                await sendMessage(chatId, "⚠️ Masukkan symbol!\n📌 Contoh: /price BTC");
                break;
            }
            const symbol = args[0].toUpperCase();
            const coins = await getTop100Coins();
            const coin = coins.find(c => c.symbol === symbol);
            
            if (!coin) {
                await sendMessage(chatId, `❌ *${symbol}* tidak ditemukan!\n📌 Cek /list`);
                break;
            }
            
            const detail = await getCoinPrice(coin.id);
            if (detail) {
                await sendMessage(chatId, formatPriceMessage(detail));
            } else {
                await sendMessage(chatId, `❌ Gagal ambil data *${symbol}*`);
            }
            break;
            
        case '/list':
            const allCoins = await getTop100Coins();
            await sendMessage(chatId, formatCoinList(allCoins, 1));
            break;
            
        case '/page':
            const page = parseInt(args[0]) || 1;
            if (page < 1 || page > 5) {
                await sendMessage(chatId, "⚠️ Halaman 1-5 aja!");
                break;
            }
            const listCoins = await getTop100Coins();
            await sendMessage(chatId, formatCoinList(listCoins, page));
            break;
            
        case '/top':
            const topMsg = await getTopGainersLosers();
            await sendMessage(chatId, topMsg);
            break;
            
        case '/alert':
            if (args.length < 3) {
                await sendMessage(chatId, "⚠️ Format: /alert <symbol> <target> <above/below>\n📌 Contoh: /alert BTC 100000 above");
                break;
            }
            const coinSym = args[0].toUpperCase();
            const targetPrice = parseFloat(args[1]);
            const direction = args[2].toLowerCase();
            
            if (isNaN(targetPrice)) {
                await sendMessage(chatId, "⚠️ Target harus angka!");
                break;
            }
            if (direction !== 'above' && direction !== 'below') {
                await sendMessage(chatId, "⚠️ Direction harus 'above' atau 'below'!");
                break;
            }
            
            const coinList = await getTop100Coins();
            const exists = coinList.find(c => c.symbol === coinSym);
            if (!exists) {
                await sendMessage(chatId, `❌ *${coinSym}* tidak ditemukan!`);
                break;
            }
            
            const userAlerts = alerts.get(chatId) || [];
            userAlerts.push({ coinId: coinSym, targetPrice, direction });
            alerts.set(chatId, userAlerts);
            
            await sendMessage(chatId, `✅ Alert *${coinSym}* dibuat!\n📊 Target: ${direction === 'above' ? 'naik di atas' : 'turun di bawah'} *$${targetPrice.toLocaleString()}*`);
            break;
            
        case '/myalerts':
            const myAlerts = alerts.get(chatId) || [];
            if (myAlerts.length === 0) {
                await sendMessage(chatId, "⚠️ Belum ada alert aktif!");
                break;
            }
            let alertMsg = "🔔 *Alert Aktif*\n\n";
            myAlerts.forEach((a, i) => {
                alertMsg += `${i+1}. *${a.coinId}* → $${a.targetPrice.toLocaleString()} (${a.direction})\n`;
            });
            await sendMessage(chatId, alertMsg);
            break;
            
        case '/remove':
            const idx = parseInt(args[0]) - 1;
            const currentAlerts = alerts.get(chatId) || [];
            if (isNaN(idx) || idx < 0 || idx >= currentAlerts.length) {
                await sendMessage(chatId, "⚠️ Nomor tidak valid! Cek /myalerts");
                break;
            }
            const removed = currentAlerts.splice(idx, 1);
            alerts.set(chatId, currentAlerts);
            await sendMessage(chatId, `✅ Alert *${removed[0].coinId}* dihapus!`);
            break;
            
        case '/clearalerts':
            alerts.delete(chatId);
            await sendMessage(chatId, "✅ Semua alert dihapus!");
            break;
            
        default:
            await sendMessage(chatId, "❌ Command tidak dikenal!\n📌 Ketik /start");
    }
}

// Webhook utama
module.exports = async (req, res) => {
    if (req.method === 'POST') {
        const { message } = req.body;
        
        if (message && message.text && message.chat && message.chat.id) {
            const chatId = message.chat.id;
            const text = message.text;
            
            console.log(`Message from ${chatId}: ${text}`);
            await processCommand(chatId, text);
        }
        
        res.status(200).json({ status: 'ok' });
    } else if (req.method === 'GET') {
        res.status(200).json({ status: 'Bot is alive!' });
    } else {
        res.status(405).json({ error: 'Method not allowed' });
    }
};
