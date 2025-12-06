const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const helmet = require('helmet');
const axios = require('axios');
const NodeCache = require('node-cache');
const { Telegraf } = require('telegraf');
require('dotenv').config();

// ==================== تنظیمات ====================
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = Number(process.env.ADMIN_TELEGRAM_ID);

// آدرس API سایت
const SHOP_API_URL = 'https://shikpooshaan.ir/ai-shop-api.php';

// ==================== سرور ====================
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== کش ====================
const cache = new NodeCache({ stdTTL: 3600 });
const botSessions = new Map();

const getSession = (id) => {
    let s = cache.get(id);
    if (!s) {
        s = { id, messages: [], userInfo: {}, connectedToHuman: false };
        cache.set(id, s);
    }
    return s;
};

// ==================== تحلیل پیام ====================
function analyzeMessage(message) {
    const lower = message.toLowerCase();
    
    // کد پیگیری
    const codeMatch = message.match(/\b(\d{4,20})\b/);
    if (codeMatch) return { type: 'tracking', code: codeMatch[1] };
    
    // محصول
    if (lower.includes('قیمت') || lower.includes('موجودی') || lower.includes('خرید') || 
        lower.includes('محصول') || lower.includes('لباس')) {
        return { type: 'product', keyword: message };
    }
    
    // سلام
    if (/^(سلام|درود|هلو)/.test(lower)) {
        return { type: 'greeting' };
    }
    
    // اپراتور
    if (lower.includes('اپراتور') || lower.includes('انسان')) {
        return { type: 'operator' };
    }
    
    return { type: 'general' };
}

// ==================== ارتباط با API سایت ====================
async function callShopAPI(action, data) {
    try {
        console.log(`📡 درخواست به API: ${action}`, data);
        
        const response = await axios.post(SHOP_API_URL, {
            action,
            ...data
        }, {
            timeout: 10000,
            headers: { 'Content-Type': 'application/json' }
        });
        
        console.log(`✅ پاسخ API:`, response.data);
        return response.data;
        
    } catch (error) {
        console.error('❌ خطای API:', error.message);
        return { error: 'خطا در ارتباط با سایت', details: error.message };
    }
}

// ==================== ربات تلگرام ====================
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

bot.action(/accept_(.+)/, async (ctx) => {
    const short = ctx.match[1];
    const info = botSessions.get(short);
    
    if (!info) return ctx.answerCbQuery('منقضی شده');
    
    botSessions.set(short, { ...info, chatId: ctx.chat.id });
    getSession(info.fullId).connectedToHuman = true;
    
    await ctx.answerCbQuery('پذیرفته شد');
    await ctx.editMessageText(`شما چت ${short} را پذیرفتید`);
    
    io.to(info.fullId).emit('operator-connected', {
        message: 'اپراتور متصل شد! سوال خود را بپرسید.'
    });
});

bot.action(/reject_(.+)/, async (ctx) => {
    const short = ctx.match[1];
    botSessions.delete(short);
    await ctx.answerCbQuery('رد شد');
});

bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    
    const entry = [...botSessions.entries()].find(([_, v]) => v.chatId === ctx.chat.id);
    if (!entry) return;
    
    io.to(entry[1].fullId).emit('operator-message', { 
        message: ctx.message.text 
    });
    
    await ctx.reply('✅ ارسال شد');
});

app.post('/telegram-webhook', (req, res) => bot.handleUpdate(req.body, res));

// ==================== مسیرهای API ====================

// تست سلامت
app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        time: new Date().toISOString(),
        api: SHOP_API_URL
    });
});

// تست API سایت
app.get('/api/test', async (req, res) => {
    try {
        const result = await callShopAPI('health_check', {});
        res.json({
            success: true,
            api: SHOP_API_URL,
            response: result
        });
    } catch (error) {
        res.json({
            success: false,
            error: error.message,
            api: SHOP_API_URL
        });
    }
});

// سیستم چت اصلی
app.post('/api/chat', async (req, res) => {
    try {
        const { message, sessionId } = req.body;
        
        if (!message || !sessionId) {
            return res.status(400).json({ error: 'داده ناقص' });
        }
        
        const session = getSession(sessionId);
        session.messages.push({ role: 'user', content: message });
        
        const analysis = analyzeMessage(message);
        
        // اگر کد پیگیری
        if (analysis.type === 'tracking') {
            const apiResult = await callShopAPI('track_order', {
                tracking_code: analysis.code
            });
            
            if (apiResult.found) {
                const order = apiResult.order;
                const reply = `✅ **سفارش پیدا شد!**\n\n` +
                             `کد: ${analysis.code}\n` +
                             `مشتری: ${order.customer_name}\n` +
                             `تاریخ: ${order.date}\n` +
                             `وضعیت: ${order.status}\n` +
                             `مبلغ: ${order.total} تومان\n` +
                             `محصولات: ${order.items.join('، ')}`;
                
                session.messages.push({ role: 'assistant', content: reply });
                return res.json({ success: true, message: reply });
                
            } else {
                const reply = `❌ سفارشی با کد ${analysis.code} یافت نشد.`;
                session.messages.push({ role: 'assistant', content: reply });
                return res.json({ success: true, message: reply });
            }
        }
        
        // اگر محصول
        if (analysis.type === 'product') {
            const apiResult = await callShopAPI('search_product', {
                keyword: analysis.keyword
            });
            
            if (apiResult.products && apiResult.products.length > 0) {
                let reply = `🛍️ **${apiResult.count} محصول پیدا شد:**\n\n`;
                
                apiResult.products.forEach((product, index) => {
                    reply += `${index + 1}. **${product.name}**\n`;
                    reply += `   قیمت: ${product.price} تومان\n`;
                    reply += `   موجودی: ${product.stock}\n`;
                    reply += `   لینک: ${product.url}\n\n`;
                });
                
                session.messages.push({ role: 'assistant', content: reply });
                return res.json({ success: true, message: reply });
                
            } else {
                const reply = '❌ محصولی یافت نشد.';
                session.messages.push({ role: 'assistant', content: reply });
                return res.json({ success: true, message: reply });
            }
        }
        
        // اگر سلام
        if (analysis.type === 'greeting') {
            const reply = `سلام! 😊\nبه پشتیبانی شیک‌پوشان خوش آمدید.\n\nمی‌توانید:\n• کد پیگیری سفارش را وارد کنید\n• نام محصول را جستجو کنید\n• "اپراتور" برای صحبت با پشتیبان`;
            
            session.messages.push({ role: 'assistant', content: reply });
            return res.json({ success: true, message: reply });
        }
        
        // اگر اپراتور
        if (analysis.type === 'operator') {
            const short = sessionId.substring(0, 12);
            botSessions.set(short, {
                fullId: sessionId,
                userInfo: session.userInfo || {},
                chatId: null
            });
            
            // اطلاع به تلگرام
            await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, 
                `درخواست اپراتور جدید\nکد: ${short}\nکاربر: ${session.userInfo?.name || 'ناشناس'}`,
                {
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '✅ پذیرش', callback_data: `accept_${short}` },
                            { text: '❌ رد', callback_data: `reject_${short}` }
                        ]]
                    }
                }
            );
            
            const reply = '✅ درخواست شما برای اتصال به اپراتور ثبت شد. لطفاً منتظر بمانید...';
            session.messages.push({ role: 'assistant', content: reply });
            return res.json({ success: true, message: reply });
        }
        
        // پاسخ پیش‌فرض
        const reply = 'لطفاً:\n• کد پیگیری سفارش را وارد کنید\n• یا نام محصول را بنویسید\n• یا "اپراتور" را تایپ کنید';
        session.messages.push({ role: 'assistant', content: reply });
        return res.json({ success: true, message: reply });
        
    } catch (error) {
        console.error('❌ خطا در چت:', error);
        return res.json({ 
            success: false, 
            message: '⚠️ خطای موقت. لطفاً دوباره تلاش کنید.' 
        });
    }
});

// اتصال به اپراتور
app.post('/api/connect-human', async (req, res) => {
    const { sessionId, userInfo } = req.body;
    const session = getSession(sessionId);
    session.userInfo = userInfo || {};
    
    const short = sessionId.substring(0, 12);
    botSessions.set(short, {
        fullId: sessionId,
        userInfo: session.userInfo,
        chatId: null
    });
    
    // اطلاع به تلگرام
    await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, 
        `درخواست اتصال جدید\nکد: ${short}\nکاربر: ${session.userInfo?.name || 'ناشناس'}`,
        {
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ پذیرش', callback_data: `accept_${short}` },
                    { text: '❌ رد', callback_data: `reject_${short}` }
                ]]
            }
        }
    );
    
    res.json({ success: true, pending: true });
});

// ==================== سوکت برای فایل و ویس ====================
io.on('connection', (socket) => {
    socket.on('join-session', (sessionId) => {
        socket.join(sessionId);
        console.log(`📝 کاربر به سشن ${sessionId} پیوست`);
    });
    
    socket.on('user-message', async ({ sessionId, message }) => {
        if (!sessionId || !message) return;
        
        const short = sessionId.substring(0, 12);
        const info = botSessions.get(short);
        
        if (info?.chatId) {
            await bot.telegram.sendMessage(info.chatId, 
                `پیام جدید از کاربر ${short}:\n\n${message}`);
        }
    });
    
    // ارسال فایل
    socket.on('user-file', async ({ sessionId, fileName, fileBase64 }) => {
        const short = sessionId.substring(0, 12);
        const info = botSessions.get(short);
        
        if (info?.chatId) {
            try {
                const buffer = Buffer.from(fileBase64, 'base64');
                await bot.telegram.sendDocument(info.chatId, {
                    source: buffer,
                    filename: fileName
                }, {
                    caption: `فایل از کاربر ${short}`
                });
                
                socket.emit('file-sent', { success: true });
            } catch (error) {
                console.error('خطای فایل:', error);
                socket.emit('file-error', { error: error.message });
            }
        }
    });
    
    // ارسال ویس
    socket.on('user-voice', async ({ sessionId, voiceBase64 }) => {
        const short = sessionId.substring(0, 12);
        const info = botSessions.get(short);
        
        if (info?.chatId) {
            try {
                const buffer = Buffer.from(voiceBase64, 'base64');
                await bot.telegram.sendVoice(info.chatId, {
                    source: buffer
                }, {
                    caption: `پیام صوتی از کاربر ${short}`
                });
                
                socket.emit('voice-sent', { success: true });
            } catch (error) {
                console.error('خطای ویس:', error);
                socket.emit('voice-error', { error: error.message });
            }
        }
    });
});

// صفحه اصلی
app.get('/', (req, res) => {
    res.json({
        name: 'Shikpooshan Support',
        status: 'online',
        endpoints: {
            chat: 'POST /api/chat',
            connect: 'POST /api/connect-human',
            test: 'GET /api/test',
            health: 'GET /api/health'
        }
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== راه‌اندازی ====================
server.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 سرور روی پورت ${PORT} فعال شد`);
    console.log(`🛍️ API سایت: ${SHOP_API_URL}`);
    
    try {
        await bot.telegram.setWebhook(`https://ai-chat-support-production.up.railway.app/telegram-webhook`);
        console.log('✅ وب‌هوک تلگرام تنظیم شد');
        
        await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, 
            `🤖 سیستم پشتیبانی فعال شد\nآدرس: https://ai-chat-support-production.up.railway.app`);
    } catch (error) {
        console.log('⚠️ وب‌هوک خطا → Polling فعال شد');
        bot.launch();
    }
});
