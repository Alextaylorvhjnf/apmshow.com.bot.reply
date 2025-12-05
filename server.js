const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const helmet = require('helmet');
const axios = require('axios');
const mysql = require('mysql2/promise');
const NodeCache = require('node-cache');
const { Telegraf } = require('telegraf');
require('dotenv').config();

// ==================== تنظیمات ====================
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = Number(process.env.ADMIN_TELEGRAM_ID);

let BASE_URL = process.env.RAILWAY_STATIC_URL || process.env.BACKEND_URL || '';
BASE_URL = BASE_URL.replace(/\/+$/, '').trim();
if (!BASE_URL) BASE_URL = 'https://ai-chat-support-production.up.railway.app';
if (!BASE_URL.startsWith('http')) BASE_URL = 'https://' + BASE_URL;

// ==================== API سایت اصلی ====================
const SHOP_API_URL = 'https://shikpooshaan.ir/ai-shop-api.php';

// ==================== سرور ====================
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { 
    cors: { 
        origin: "*", 
        methods: ["GET", "POST"],
        credentials: true
    } 
});

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== کش و سشن‌ها ====================
const cache = new NodeCache({ stdTTL: 3600 });
const botSessions = new Map();
const shortId = (id) => String(id).substring(0, 12);

const getSession = (id) => {
    let s = cache.get(id);
    if (!s) {
        s = { id, messages: [], userInfo: {}, connectedToHuman: false };
        cache.set(id, s);
    }
    return s;
};

// ==================== هوش مصنوعی تحلیل پیام ====================
function analyzeMessage(message) {
    const lowerMsg = message.toLowerCase();
    
    // تشخیص کد پیگیری (4-20 رقم)
    const codeMatch = message.match(/\b(\d{4,20})\b/);
    if (codeMatch) {
        return { type: 'tracking', code: codeMatch[1] };
    }
    
    // تشخیص درخواست محصول
    const productKeywords = ['قیمت', 'موجودی', 'دارید', 'خرید', 'محصول', 'لباس', 'پیراهن', 'شلوار', 'کت', 'دامن'];
    const colorKeywords = ['قرمز', 'آبی', 'سبز', 'مشکی', 'سفید', 'خاکستری', 'بنفش', 'صورتی', 'نارنجی'];
    const sizeKeywords = ['اسمال', 'مدیوم', 'لارج', 'اکسترا', 'XL', 'L', 'M', 'S', 'XS'];
    
    const hasProduct = productKeywords.some(keyword => lowerMsg.includes(keyword));
    if (hasProduct) {
        const colors = colorKeywords.filter(color => lowerMsg.includes(color));
        const sizes = sizeKeywords.filter(size => lowerMsg.includes(size.toLowerCase()));
        
        return { 
            type: 'product_request',
            colors: colors.length > 0 ? colors : null,
            sizes: sizes.length > 0 ? sizes : null,
            keyword: message
        };
    }
    
    // تشخیص سلام
    if (/^(سلام|درود|هلو|هی|سلامتی)/.test(lowerMsg)) {
        return { type: 'greeting' };
    }
    
    // تشخیص اپراتور
    if (lowerMsg.includes('اپراتور') || lowerMsg.includes('انسان') || lowerMsg.includes('پشتیبان')) {
        return { type: 'operator' };
    }
    
    return { type: 'general' };
}

// ==================== سیستم پیگیری سفارش از API سایت ====================
async function trackOrderFromAPI(trackingCode) {
    try {
        const result = await axios.post(
            SHOP_API_URL, 
            { 
                action: 'track_order', 
                tracking_code: trackingCode 
            }, 
            { 
                timeout: 10000,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            }
        );
        
        return result.data;
        
    } catch (error) {
        console.error('❌ خطا در ارتباط با API سایت:', error.message);
        return { 
            found: false, 
            message: 'خطا در ارتباط با سرور اصلی سایت. لطفاً چند دقیقه دیگر تلاش کنید.' 
        };
    }
}


// ==================== سیستم جستجوی محصول از API سایت ====================
async function searchProductsFromAPI(keyword) {
    try {
        const result = await axios.post(
            SHOP_API_URL,
            {
                action: 'search_product',
                keyword: keyword
            },
            { 
                timeout: 10000,
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
        
        return result.data;
        
    } catch (error) {
        console.error('❌ خطا در جستجوی محصول:', error.message);
        return { products: [], success: false };
    }
}

// ==================== سیستم پیشنهاد محصول هوشمند ====================
async function suggestProducts(analysis) {
    try {
        let searchKeyword = analysis.keyword;
        
        // اضافه کردن رنگ و سایز به کلمه جستجو
        if (analysis.colors) {
            searchKeyword += ' ' + analysis.colors.join(' ');
        }
        if (analysis.sizes) {
            searchKeyword += ' ' + analysis.sizes.join(' ');
        }
        
        const result = await searchProductsFromAPI(searchKeyword);
        
        if (result.products && result.products.length > 0) {
            return result.products.slice(0, 5); // 5 محصول اول
        }
        
        return [];
        
    } catch (error) {
        console.error('❌ خطا در پیشنهاد محصول:', error);
        return [];
    }
}

// ==================== پاسخ هوشمند فارسی ====================
function generateResponse(analysis, context = {}) {
    switch (analysis.type) {
        case 'tracking':
            return `در حال بررسی سفارش با کد ${analysis.code}... 🔍\nلطفاً کمی صبر کنید.`;
        
        case 'product_request':
            return `در حال جستجوی "${analysis.keyword}"... 🛍️\nلطفاً صبر کنید.`;
        
        case 'greeting':
            return `سلام! 😊\nبه پشتیبانی هوشمند شیک‌پوشان خوش آمدید!\n\nچطور می‌تونم کمکتون کنم؟\n• کد رهگیری سفارش\n• قیمت و موجودی محصول\n• اتصال به اپراتور`;
        
        case 'operator':
            return `✅ درخواست شما برای اتصال به اپراتور ثبت شد.\nلطفاً منتظر بمانید...`;
        
        case 'general':
        default:
            if (context.hasProducts) {
                return `🎯 ${context.count} محصول مرتبط پیدا کردم!`;
            }
            return `متوجه شدم! 🤔\nلطفاً دقیق‌تر بگید:\n• کد رهگیری سفارش\n• نام محصول\n• یا "اپراتور" برای صحبت با پشتیبان`;
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
    
    await ctx.editMessageText(`
🎯 شما این گفتگو را پذیرفتید

👤 کاربر: ${info.userInfo?.name || 'ناشناس'}
📄 صفحه: ${info.userInfo?.page || 'نامشخص'}
🔢 کد: ${short}
    `.trim());
    
    io.to(info.fullId).emit('operator-connected', {
        message: '🎉 اپراتور متصل شد! لطفاً سوال خود را بپرسید.'
    });
    
    const session = getSession(info.fullId);
    const history = session.messages
        .filter(m => m.role === 'user')
        .map(m => `کاربر: ${m.content}`)
        .join('\n\n') || 'کاربر هنوز پیامی نفرستاده';
    
    await ctx.reply(`📜 تاریخچه چت:\n\n${history}`);
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
    
    await ctx.reply('✅ پیام ارسال شد');
});

app.post('/telegram-webhook', (req, res) => bot.handleUpdate(req.body, res));

// ==================== وب‌هوک ویجت ====================
app.post('/webhook', async (req, res) => {
    if (req.body.event !== 'new_session') return res.json({ success: false });
    
    const { sessionId, userInfo, userMessage } = req.body.data;
    const short = shortId(sessionId);
    
    botSessions.set(short, { 
        fullId: sessionId, 
        userInfo: userInfo || {}, 
        chatId: null 
    });
    
    const userName = userInfo?.name || 'ناشناس';
    const userPage = userInfo?.page || 'نامشخص';
    
    await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, `
🔔 درخواست پشتیبانی جدید

👤 نام: ${userName}
📄 صفحه: ${userPage}
🔢 کد: ${short}
💬 پیام: ${userMessage || 'درخواست اتصال'}

🕐 ${new Date().toLocaleTimeString('fa-IR')}
    `.trim(), {
        reply_markup: {
            inline_keyboard: [[
                { text: '✅ پذیرش', callback_data: `accept_${short}` },
                { text: '❌ رد', callback_data: `reject_${short}` }
            ]]
        }
    });
    
    res.json({ success: true });
});

// ==================== اتصال به اپراتور ====================
app.post('/api/connect-human', async (req, res) => {
    const { sessionId, userInfo } = req.body;
    getSession(sessionId).userInfo = userInfo || {};
    
    await axios.post(`${BASE_URL}/webhook`, {
        event: 'new_session',
        data: { sessionId, userInfo, userMessage: 'درخواست اتصال' }
    }).catch(() => {});
    
    res.json({ success: true, pending: true });
});

// ==================== سیستم چت هوشمند اصلی ====================
app.post('/api/chat', async (req, res) => {
    try {
        const { message, sessionId } = req.body;
        
        if (!message || !sessionId) {
            return res.status(400).json({ error: 'داده ناقص' });
        }
        
        const session = getSession(sessionId);
        session.messages.push({ role: 'user', content: message });
        
        const short = shortId(sessionId);
        if (botSessions.get(short)?.chatId) {
            return res.json({ operatorConnected: true });
        }
        
        const analysis = analyzeMessage(message);
        
        // اگر درخواست اپراتور بود
        if (analysis.type === 'operator') {
            const response = generateResponse(analysis);
            session.messages.push({ role: 'assistant', content: response });
            
            // ارسال درخواست به تلگرام
            await axios.post(`${BASE_URL}/webhook`, {
                event: 'new_session',
                data: { 
                    sessionId, 
                    userInfo: session.userInfo, 
                    userMessage: 'درخواست اتصال به اپراتور' 
                }
            }).catch(() => {
                console.log('⚠️ ارسال به وب‌هوک انجام نشد');
            });
            
            return res.json({ 
                success: true, 
                message: response,
                analysis: analysis.type 
            });
        }
        
        // اگر کد پیگیری بود
        if (analysis.type === 'tracking' && analysis.code) {
            const aiResponse = generateResponse(analysis);
            session.messages.push({ role: 'assistant', content: aiResponse });
            
            // پاسخ فوری بده
            res.json({ 
                success: true, 
                message: aiResponse,
                tracking: true 
            });
            
            // در پس‌زمینه اطلاعات رو بگیر و از سوکت بفرست
            setTimeout(async () => {
                try {
                    const orderInfo = await trackOrderFromAPI(analysis.code);
                    
                    if (orderInfo.found) {
                        const order = orderInfo.order;
                        const items = order.items?.join('\n') || 'ندارد';
                        const total = Number(order.total || 0).toLocaleString('fa-IR');
                        const status = order.status || 'نامشخص';
                        const customer = order.customer_name || 'مشتری';
                        
                        const reply = `🎯 **سفارش پیدا شد!**\n\n` +
                                     `📦 کد سفارش: ${analysis.code}\n` +
                                     `👤 مشتری: ${customer}\n` +
                                     `📅 تاریخ: ${order.date || 'ثبت نشده'}\n` +
                                     `🟢 وضعیت: ${status}\n` +
                                     `💰 مبلغ: ${total} تومان\n` +
                                     `💳 پرداخت: ${order.payment || 'نامشخص'}\n\n` +
                                     `🛍️ محصولات:\n${items}\n\n` +
                                     `✅ در حال پردازش...`;
                        
                        session.messages.push({ role: 'assistant', content: reply });
                        
                        // ارسال به کاربر از طریق سوکت
                        io.to(sessionId).emit('ai-message', { 
                            message: reply,
                            type: 'order_info' 
                        });
                        
                    } else {
                        const reply = `❌ **سفارش یافت نشد!**\n\nسفارشی با کد "${analysis.code}" پیدا نشد.\n\nلطفاً:\n• کد را دوباره بررسی کنید\n• یا "اپراتور" را تایپ کنید`;
                        
                        session.messages.push({ role: 'assistant', content: reply });
                        
                        io.to(sessionId).emit('ai-message', { 
                            message: reply,
                            type: 'order_not_found' 
                        });
                    }
                } catch (error) {
                    console.error('❌ خطا در پیگیری سفارش:', error);
                    
                    const errorReply = `⚠️ **خطا در دریافت اطلاعات**\n\nسیستم در حال حاضر قادر به بررسی سفارش نیست.\nلطفاً بعداً تلاش کنید یا "اپراتور" را تایپ کنید.`;
                    
                    io.to(sessionId).emit('ai-message', { 
                        message: errorReply,
                        type: 'error' 
                    });
                }
            }, 100);
            
            return;
        }
        
        // اگر درخواست محصول بود
        if (analysis.type === 'product_request') {
            const aiResponse = generateResponse(analysis);
            session.messages.push({ role: 'assistant', content: aiResponse });
            
            // پاسخ فوری بده
            res.json({ 
                success: true, 
                message: aiResponse,
                searching: true 
            });
            
            // در پس‌زمینه محصولات رو پیدا کن
            setTimeout(async () => {
                try {
                    const products = await suggestProducts(analysis);
                    
                    if (products.length > 0) {
                        let productList = `🎁 **${products.length} محصول مرتبط پیدا کردم:**\n\n`;
                        
                        products.forEach((product, index) => {
                            productList += `**${index + 1}. ${product.name}**\n`;
                            productList += `💰 قیمت: ${Number(product.price || 0).toLocaleString('fa-IR')} تومان\n`;
                            if (product.stock) {
                                productList += `📦 موجودی: ${product.stock}\n`;
                            }
                            if (product.url) {
                                productList += `🔗 مشاهده: ${product.url}\n`;
                            }
                            productList += '\n';
                        });
                        
                        productList += `💡 **راهنمایی:**\nبرای اطلاعات بیشتر شماره محصول رو بنویسید (مثلاً "محصول 1")`;
                        
                        session.messages.push({ role: 'assistant', content: productList });
                        
                        // ارسال به کاربر
                        io.to(sessionId).emit('ai-message', { 
                            message: productList,
                            type: 'product_suggestions' 
                        });
                        
                    } else {
                        const noProductMsg = `❌ **محصولی یافت نشد!**\n\nمتأسفانه محصولی با مشخصات شما پیدا نکردم.\n\nمی‌توانید:\n• نام دقیق‌تر محصول رو بگید\n• یا "اپراتور" رو تایپ کنید`;
                        
                        session.messages.push({ role: 'assistant', content: noProductMsg });
                        
                        io.to(sessionId).emit('ai-message', { 
                            message: noProductMsg,
                            type: 'no_products' 
                        });
                    }
                } catch (error) {
                    console.error('❌ خطا در جستجوی محصول:', error);
                    
                    const errorReply = `⚠️ **خطا در جستجوی محصولات**\n\nسیستم جستجو در حال حاضر در دسترس نیست.\nلطفاً بعداً تلاش کنید.`;
                    
                    io.to(sessionId).emit('ai-message', { 
                        message: errorReply,
                        type: 'error' 
                    });
                }
            }, 100);
            
            return;
        }
        
        // پاسخ‌های عمومی
        const aiResponse = generateResponse(analysis);
        session.messages.push({ role: 'assistant', content: aiResponse });
        
        return res.json({ 
            success: true, 
            message: aiResponse,
            analysis: analysis.type 
        });
        
    } catch (error) {
        console.error('❌ خطا در سیستم چت:', error);
        
        return res.json({ 
            success: false, 
            message: '⚠️ خطای موقت در سیستم. لطفاً چند لحظه دیگه تلاش کنید.' 
        });
    }
});

// ==================== سوکت ====================
io.on('connection', (socket) => {
    socket.on('join-session', (sessionId) => socket.join(sessionId));
    
    socket.on('user-message', async ({ sessionId, message }) => {
        if (!sessionId || !message) return;
        
        const short = shortId(sessionId);
        const info = botSessions.get(short);
        
        if (info?.chatId) {
            const userName = info.userInfo?.name || 'ناشناس';
            const userPage = info.userInfo?.page || 'نامشخص';
            
            await bot.telegram.sendMessage(info.chatId, `
📩 پیام جدید از کاربر

👤 نام: ${userName}
📄 صفحه: ${userPage}
🔢 کد: ${short}

💬 پیام:
${message}

🕐 ${new Date().toLocaleTimeString('fa-IR')}
            `.trim());
        }
    });
});

// ==================== تست API سایت ====================
app.get('/api/test-shop-api', async (req, res) => {
    try {
        // تست پیگیری سفارش
        const trackResult = await axios.post(
            SHOP_API_URL,
            { action: 'track_order', tracking_code: '12345' },
            { timeout: 8000 }
        );
        
        // تست جستجوی محصول
        const searchResult = await axios.post(
            SHOP_API_URL,
            { action: 'search_product', keyword: 'پیراهن' },
            { timeout: 8000 }
        );
        
        res.json({
            success: true,
            api_url: SHOP_API_URL,
            track_api: trackResult.data,
            search_api: searchResult.data
        });
        
    } catch (error) {
        res.json({
            success: false,
            error: error.message,
            api_url: SHOP_API_URL
        });
    }
});

// صفحه اصلی
app.get('/', (req, res) => {
    res.json({
        name: 'Shikpooshan AI Support',
        version: '3.0.0',
        status: 'online',
        features: [
            'پیگیری سفارش از API سایت',
            'جستجوی محصول هوشمند',
            'اتصال به اپراتور تلگرام',
            'چت هوشمند فارسی'
        ],
        endpoints: {
            chat: 'POST /api/chat',
            connect_human: 'POST /api/connect-human',
            test_api: 'GET /api/test-shop-api'
        }
    });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ==================== راه‌اندازی ====================
server.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 سرور روی پورت ${PORT} فعال شد`);
    console.log(`🌐 آدرس: ${BASE_URL}`);
    console.log(`🛍️ API سایت: ${SHOP_API_URL}`);
    
    try {
        await bot.telegram.setWebhook(`${BASE_URL}/telegram-webhook`);
        console.log('✅ وب‌هوک تلگرام تنظیم شد');
        
        await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, `
🤖 سیستم پشتیبانی هوشمند فعال شد

✅ سرور: ${BASE_URL}
✅ API: ${SHOP_API_URL}
✅ تاریخ: ${new Date().toLocaleDateString('fa-IR')}

✨ سیستم آماده خدمات‌رسانی است.
        `.trim());
        
    } catch (err) {
        console.error('⚠️ وب‌هوک خطا داد → Polling فعال شد');
        bot.launch();
    }
});
