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

// ==================== کش و تاریخچه ====================
const cache = new NodeCache({ stdTTL: 3600 * 24 }); // 24 ساعت
const botSessions = new Map();

// ذخیره تاریخچه کامل چت (کاربر + اپراتور + سیستم)
const chatHistory = new Map();

const getSession = (id) => {
    let s = cache.get(id);
    if (!s) {
        s = { 
            id, 
            messages: [], 
            userInfo: {}, 
            connectedToHuman: false, 
            operatorId: null,
            preferences: {},
            searchHistory: []
        };
        cache.set(id, s);
    }
    return s;
};

// ==================== مدیریت تاریخچه چت ====================
// ذخیره پیام در تاریخچه کامل
function saveMessageToHistory(sessionId, message) {
    if (!chatHistory.has(sessionId)) {
        chatHistory.set(sessionId, []);
    }
    chatHistory.get(sessionId).push({
        ...message,
        timestamp: new Date(),
        savedAt: new Date().toISOString()
    });
    
    // محدود کردن تاریخچه به 200 پیام آخر
    if (chatHistory.get(sessionId).length > 200) {
        chatHistory.set(sessionId, chatHistory.get(sessionId).slice(-200));
    }
}

// دریافت تاریخچه کامل چت
function getFullChatHistory(sessionId) {
    return chatHistory.get(sessionId) || [];
}

// پاک کردن تاریخچه چت برای کاربر
function clearChatHistory(sessionId) {
    if (chatHistory.has(sessionId)) {
        chatHistory.delete(sessionId);
    }
    // همچنین پیام‌های کش شده را پاک کنید
    const session = getSession(sessionId);
    session.messages = [];
    session.connectedToHuman = false;
    session.operatorId = null;
    cache.set(sessionId, session);
    
    // پاک کردن سشن از botSessions اگر وجود دارد
    const short = sessionId.substring(0, 12);
    if (botSessions.has(short)) {
        botSessions.delete(short);
    }
    
    return true;
}

// ==================== تحلیل پیام پیشرفته ====================
function analyzeMessage(message) {
    const lower = message.toLowerCase();
    
    // کد پیگیری
    const codeMatch = message.match(/\b(\d{4,20})\b/);
    if (codeMatch) return { type: 'tracking', code: codeMatch[1] };
    
    // تشخیص نوع محصول
    const productTypes = {
        'تیشرت': ['تیشرت', 'تی‌شرت', 't-shirt'],
        'هودی': ['هودی', 'هودي', 'hoodie'],
        'پیراهن': ['پیراهن', 'پیرهن'],
        'شلوار': ['شلوار', 'شلور', 'pants'],
        'کت': ['کت', 'coat', 'jacket'],
        'دامن': ['دامن', 'skirt'],
        'کفش': ['کفش', 'shoe', 'کف'],
        'اکسسوری': ['اکسسوری', 'اکسسوري', 'accessory'],
        'زیورآلات': ['زیور', 'گردنبند', 'دستبند', 'انگشتر'],
        'ساعت': ['ساعت', 'watch'],
        'کیف': ['کیف', 'bag'],
        'کمربند': ['کمربند', 'belt']
    };
    
    // تشخیص سایز
    const sizePatterns = {
        'اسمال': ['اسمال', 'small', 's'],
        'مدیوم': ['مدیوم', 'medium', 'm'],
        'لارج': ['لارج', 'large', 'l'],
        'اکسترا': ['اکسترا', 'اکسترا لارج', 'xl', 'xxl', '2xl', '3xl'],
        'پسرانه': ['پسرانه', 'پسرونه', 'boys'],
        'دخترانه': ['دخترانه', 'دخترونه', 'girls'],
        'بزرگسال': ['بزرگسال', 'adult']
    };
    
    // تشخیص رنگ
    const colorKeywords = [
        'قرمز', 'آبی', 'سبز', 'مشکی', 'سفید', 'خاکستری', 'بنفش', 
        'صورتی', 'نارنجی', 'زرد', 'قهوه‌ای', 'بژ', 'طلایی', 'نقره‌ای'
    ];
    
    // تشخیص دسته‌بندی
    const categoryKeywords = [
        'مردانه', 'زنانه', 'بچگانه', 'پسرانه', 'دخترانه', 
        'تابستانی', 'زمستانی', 'رسمی', 'اسپرت'
    ];
    
    // تحلیل
    let foundProductType = null;
    let foundSizes = [];
    let foundColors = [];
    let foundCategory = null;
    
    // تشخیص نوع محصول
    for (const [type, keywords] of Object.entries(productTypes)) {
        for (const keyword of keywords) {
            if (lower.includes(keyword)) {
                foundProductType = type;
                break;
            }
        }
        if (foundProductType) break;
    }
    
    // تشخیص سایز
    for (const [size, patterns] of Object.entries(sizePatterns)) {
        for (const pattern of patterns) {
            if (lower.includes(pattern.toLowerCase())) {
                foundSizes.push(size);
                break;
            }
        }
    }
    
    // تشخیص رنگ
    for (const color of colorKeywords) {
        if (lower.includes(color)) {
            foundColors.push(color);
        }
    }
    
    // تشخیص دسته‌بندی
    for (const category of categoryKeywords) {
        if (lower.includes(category)) {
            foundCategory = category;
            break;
        }
    }
    
    // اگر محصولی پیدا شد
    if (foundProductType || lower.includes('قیمت') || lower.includes('موجودی') || 
        lower.includes('خرید') || lower.includes('محصول') || lower.includes('دارید')) {
        
        return { 
            type: 'product_search', 
            productType: foundProductType,
            sizes: foundSizes.length > 0 ? foundSizes : null,
            colors: foundColors.length > 0 ? foundColors : null,
            category: foundCategory,
            originalMessage: message
        };
    }
    
    // پیشنهاد
    if (lower.includes('پیشنهاد') || lower.includes('پیشنهادی') || 
        lower.includes('چی پیشنهاد') || lower.includes('پیشنهاد میدی')) {
        return { type: 'suggestion' };
    }
    
    // سلام
    if (/^(سلام|درود|هلو|سلامتی|عصر بخیر|صبح بخیر|شب بخیر)/.test(lower)) {
        return { type: 'greeting' };
    }
    
    // تشکر
    if (lower.includes('ممنون') || lower.includes('مرسی') || lower.includes('متشکرم')) {
        return { type: 'thanks' };
    }
    
    // اپراتور
    if (lower.includes('اپراتور') || lower.includes('انسان') || lower.includes('پشتیبان')) {
        return { type: 'operator' };
    }
    
    // سوال در مورد موجودی
    if (lower.includes('دارید') || lower.includes('موجوده') || lower.includes('موجود')) {
        return { type: 'stock_inquiry' };
    }
    
    return { type: 'general' };
}

// ==================== پاسخ‌های تعاملی ====================
const responses = {
    greeting: () => {
        const greetings = [
            "سلام عزیزم! 🌸✨ چه خوشحالم که پیدات کردم! امروز چطورید؟",
            "درود بر شما! 🌟 روز خوبی داشته باشید! خوش آمدید به شیک‌پوشان.",
            "سلام قشنگم! 💖 انرژی مثبت براتون میفرستم! امیدوارم روز عالی داشته باشید.",
            "هلوووو! 🎉 چه خوب شد که اومدین! حالمون رو گرفتین با حضور گرمتون!"
        ];
        return greetings[Math.floor(Math.random() * greetings.length)];
    },
    
    thanks: () => {
        const thanks = [
            "خواهش می‌کنم عزیزم! 🤗 خوشحالم که تونستم کمک کنم.",
            "قربونت برم! 💝 همیشه در خدمت شما هستم.",
            "چشم قشنگم! 🌸 هر زمان که نیاز داشتین، در کنارتونم.",
            "خوشحالم که راضیتون کردم! ✨ منتظر سوال بعدیتون می‌مونم."
        ];
        return thanks[Math.floor(Math.random() * thanks.length)];
    },
    
    suggestionPrompt: () => {
        return "🎁 **عالی! دوست دارید چه نوع محصولی رو پیشنهاد بدم؟**\n\n" +
               "مثلاً:\n" +
               "• تیشرت‌های جدید\n" +
               "• هودی‌های فصل\n" +
               "• شلوارهای جین\n" +
               "• کت‌های زمستانی\n" +
               "• یا هر چیزی که دلتون بخواد!";
    },
    
    noProductsFound: (searchTerm) => {
        return `❌ **متأسفانه "${searchTerm}" پیدا نکردم!**\n\n` +
               `✨ **اما می‌تونید:**\n` +
               `• نام دقیق‌تر محصول رو بگید\n` +
               `• از من بخواهید پیشنهاد بدم\n` +
               `• یا محصولات مشابه رو ببینید\n` +
               `• "اپراتور" رو برای کمک بیشتر تایپ کنید`;
    }
};

// ==================== ارتباط با API سایت ====================
async function callShopAPI(action, data = {}) {
    try {
        console.log(`📡 درخواست به API: ${action}`);
        
        const response = await axios.post(SHOP_API_URL, {
            action,
            ...data
        }, {
            timeout: 15000,
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });
        
        console.log(`✅ پاسخ API دریافت شد (${action})`);
        return response.data;
        
    } catch (error) {
        console.error(`❌ خطای API (${action}):`, error.message);
        return { 
            error: true, 
            message: 'خطا در ارتباط با سایت',
            details: error.message 
        };
    }
}

// ==================== جستجوی هوشمند محصولات ====================
async function smartProductSearch(analysis, session) {
    try {
        const searchParams = {};
        
        // تنظیم پارامترهای جستجو
        if (analysis.productType) {
            searchParams.keyword = analysis.productType;
        } else {
            searchParams.keyword = analysis.originalMessage;
        }
        
        if (analysis.sizes) {
            // تبدیل سایزها به فرمت قابل فهم برای API
            const sizeMap = {
                'اسمال': 'small',
                'مدیوم': 'medium', 
                'لارج': 'large',
                'اکسترا': 'xl',
                'پسرانه': 'boys',
                'دخترانه': 'girls',
                'بزرگسال': 'adult'
            };
            
            const apiSizes = analysis.sizes
                .map(size => sizeMap[size] || size)
                .filter(Boolean);
            
            if (apiSizes.length > 0) {
                searchParams.size = apiSizes[0]; // اولین سایز
            }
        }
        
        if (analysis.colors) {
            searchParams.color = analysis.colors[0]; // اولین رنگ
        }
        
        if (analysis.category) {
            searchParams.category = analysis.category;
        }
        
        // ذخیره در تاریخچه جستجو
        if (session.searchHistory) {
            session.searchHistory.push({
                ...searchParams,
                timestamp: new Date(),
                found: false // موقتاً
            });
            
            // فقط 10 جستجوی آخر رو نگه دار
            if (session.searchHistory.length > 10) {
                session.searchHistory = session.searchHistory.slice(-10);
            }
        }
        
        // جستجوی پیشرفته در API
        const result = await callShopAPI('search_product_advanced', searchParams);
        
        // اگر محصولی پیدا نشد، جستجوی ساده‌تر
        if (result.error || !result.products || result.products.length === 0) {
            // جستجوی فقط با کلمه کلیدی
            const simpleResult = await callShopAPI('search_product_advanced', {
                keyword: searchParams.keyword
            });
            
            if (simpleResult.products && simpleResult.products.length > 0) {
                return {
                    success: true,
                    products: simpleResult.products.slice(0, 6),
                    searchParams: { keyword: searchParams.keyword },
                    message: 'محصولات مشابه پیدا شد'
                };
            }
            
            // محصولات پرفروش رو پیشنهاد بده
            const popularResult = await callShopAPI('get_popular_products', { limit: 4 });
            
            return {
                success: false,
                products: popularResult.products || [],
                searchParams,
                message: 'محصولی با این مشخصات یافت نشد',
                suggestedAlternatives: true
            };
        }
        
        // به روز رسانی تاریخچه جستجو
        if (session.searchHistory && session.searchHistory.length > 0) {
            session.searchHistory[session.searchHistory.length - 1].found = true;
        }
        
        return {
            success: true,
            products: result.products,
            searchParams,
            message: 'محصولات پیدا شد'
        };
        
    } catch (error) {
        console.error('❌ خطا در جستجوی محصول:', error);
        return {
            success: false,
            products: [],
            error: error.message
        };
    }
}

// ==================== تولید پاسخ محصولات ====================
function generateProductResponse(products, searchParams, hasAlternatives = false) {
    if (!products || products.length === 0) {
        return responses.noProductsFound(searchParams.keyword || 'این محصول');
    }
    
    let response = '';
    
    if (hasAlternatives) {
        response += `❌ **متأسفانه "${searchParams.keyword}" پیدا نکردم!**\n\n`;
        response += `✨ **اما این محصولات پرفروش رو ببینید:**\n\n`;
    } else {
        response += `🎯 **${products.length} محصول مرتبط پیدا کردم!** ✨\n\n`;
        
        if (searchParams.size) {
            response += `📏 **سایز:** ${searchParams.size}\n`;
        }
        if (searchParams.color) {
            response += `🎨 **رنگ:** ${searchParams.color}\n`;
        }
        if (searchParams.category) {
            response += `🏷️ **دسته:** ${searchParams.category}\n`;
        }
        
        if (searchParams.size || searchParams.color || searchParams.category) {
            response += '\n';
        }
    }
    
    // نمایش محصولات
    products.forEach((product, index) => {
        response += `**${index + 1}. ${product.name}**\n`;
        
        if (product.price) {
            const price = Number(product.price).toLocaleString('fa-IR');
            response += `   💰 **قیمت:** ${price} تومان\n`;
            
            if (product.has_discount && product.discount_percent > 0) {
                response += `   🔥 **تخفیف:** ${product.discount_percent}%\n`;
            }
        }
        
        if (product.stock_status) {
            const stockEmoji = product.in_stock ? '✅' : '❌';
            response += `   📦 **موجودی:** ${stockEmoji} ${product.stock_status}\n`;
        }
        
        if (product.variations_info) {
            response += `   🎯 **تنوع:** ${product.variations_info}\n`;
        }
        
        if (product.url) {
            response += `   🔗 **لینک:** ${product.url}\n`;
        }
        
        response += '\n';
    });
    
    // راهنمایی
    response += `💡 **راهنمایی:**\n`;
    response += `برای اطلاعات بیشتر، شماره محصول رو بنویسید (مثلاً "محصول 1")\n`;
    
    if (!hasAlternatives) {
        response += `اگر دقیقاً این محصول رو نمی‌خواید، توضیح بیشتری بدید\n`;
    }
    
    response += `یا "پیشنهاد" رو برای دیدن محصولات ویژه تایپ کنید`;
    
    return response;
}

// ==================== ربات تلگرام ====================
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// تعریف دستورهای مدیریت چت در تلگرام
bot.command('chats', async (ctx) => {
    if (ctx.from.id !== ADMIN_TELEGRAM_ID) {
        return ctx.reply('❌ دسترسی غیر مجاز!');
    }
    
    const activeChats = Array.from(botSessions.entries())
        .filter(([_, info]) => info.chatId)
        .map(([short, info]) => ({
            code: short,
            user: info.userInfo?.name || 'ناشناس',
            page: info.userInfo?.page || 'نامشخص',
            createdAt: info.createdAt,
            messageCount: getFullChatHistory(info.fullId).length
        }));
    
    if (activeChats.length === 0) {
        return ctx.reply('📭 هیچ چت فعالی وجود ندارد.');
    }
    
    let message = `📊 **چت‌های فعال (${activeChats.length})**\n\n`;
    
    activeChats.forEach((chat, index) => {
        const timeAgo = Math.floor((new Date() - new Date(chat.createdAt)) / 60000);
        message += `${index + 1}. **کد:** ${chat.code}\n`;
        message += `   👤 کاربر: ${chat.user}\n`;
        message += `   🌐 صفحه: ${chat.page}\n`;
        message += `   💬 پیام‌ها: ${chat.messageCount}\n`;
        message += `   ⏰ زمان: ${timeAgo} دقیقه پیش\n`;
        message += `   📝 مدیریت: /clear_${chat.code} /close_${chat.code}\n\n`;
    });
    
    await ctx.reply(message);
});

// دستور پاک کردن تاریخچه چت
bot.command(/^clear_(.+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_TELEGRAM_ID) {
        return ctx.reply('❌ دسترسی غیر مجاز!');
    }
    
    const sessionCode = ctx.match[1];
    const info = botSessions.get(sessionCode);
    
    if (!info) {
        return ctx.reply(`❌ چتی با کد ${sessionCode} پیدا نشد.`);
    }
    
    // پاک کردن تاریخچه
    clearChatHistory(info.fullId);
    
    // اطلاع به کاربر
    io.to(info.fullId).emit('chat-cleared', {
        message: '📭 **تاریخچه چت پاک شد**\n\nاپراتور تاریخچه این گفتگو را پاک کرده است.'
    });
    
    // بستن اتصال اپراتور
    botSessions.delete(sessionCode);
    
    await ctx.reply(`✅ تاریخچه چت ${sessionCode} با موفقیت پاک شد.\nتعداد پیام‌های پاک شده: ${getFullChatHistory(info.fullId).length}`);
});

// دستور بستن چت
bot.command(/^close_(.+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_TELEGRAM_ID) {
        return ctx.reply('❌ دسترسی غیر مجاز!');
    }
    
    const sessionCode = ctx.match[1];
    const info = botSessions.get(sessionCode);
    
    if (!info) {
        return ctx.reply(`❌ چتی با کد ${sessionCode} پیدا نشد.`);
    }
    
    // ارسال پیام بستن چت به کاربر
    const closeMessage = '🚪 **چت با اپراتور بسته شد**\n\nاگر سوالی دارید ربات هوشمند در خدمت شماست.';
    
    io.to(info.fullId).emit('chat-closed', {
        message: closeMessage
    });
    
    // ریست کردن وضعیت اتصال
    const session = getSession(info.fullId);
    session.connectedToHuman = false;
    session.operatorId = null;
    cache.set(info.fullId, session);
    
    // پاک کردن از botSessions
    botSessions.delete(sessionCode);
    
    await ctx.reply(`✅ چت ${sessionCode} با موفقیت بسته شد و پیام مناسب برای کاربر ارسال گردید.`);
});

// پذیرش درخواست چت
bot.action(/accept_(.+)/, async (ctx) => {
    const short = ctx.match[1];
    const info = botSessions.get(short);
    
    if (!info) return ctx.answerCbQuery('منقضی شده');
    
    botSessions.set(short, { ...info, chatId: ctx.chat.id });
    
    const session = getSession(info.fullId);
    session.connectedToHuman = true;
    session.operatorId = ctx.chat.id;
    cache.set(info.fullId, session);
    
    await ctx.answerCbQuery('پذیرفته شد');
    
    await ctx.editMessageText(`🎯 **شما این گفتگو را پذیرفتید**\n\n` +
                             `👤 کاربر: ${info.userInfo?.name || 'ناشناس'}\n` +
                             `📄 صفحه: ${info.userInfo?.page || 'نامشخص'}\n` +
                             `🔢 کد جلسه: ${short}\n` +
                             `💬 تعداد پیام‌ها: ${getFullChatHistory(info.fullId).length}\n\n` +
                             `📝 **دستورات مدیریت:**\n` +
                             `/clear_${short} - پاک کردن تاریخچه چت\n` +
                             `/close_${short} - بستن چت`);
    
    // ارسال پیام اتصال موفق به کاربر
    const operatorConnectedMessage = `✅ **اپراتور به چت متصل شد**\n\n` +
                                   `👤 هم‌اکنون می‌توانید سوالات خود را بپرسید.\n` +
                                   `🎤 همچنین می‌توانید پیام صوتی و فایل ارسال کنید.`;
    
    io.to(info.fullId).emit('operator-connected', {
        message: operatorConnectedMessage
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
    
    const [short, info] = entry;
    
    // ذخیره پیام اپراتور در تاریخچه
    const operatorMessage = {
        role: 'operator',
        content: ctx.message.text,
        from: 'اپراتور تلگرام',
        operatorId: ctx.chat.id
    };
    
    saveMessageToHistory(info.fullId, operatorMessage);
    
    io.to(info.fullId).emit('operator-message', { 
        message: ctx.message.text,
        from: 'اپراتور'
    });
    
    await ctx.reply('✅ پیام شما ارسال شد.');
});

app.post('/telegram-webhook', (req, res) => bot.handleUpdate(req.body, res));

// ==================== مسیرهای API ====================

// دریافت تاریخچه کامل چت
app.post('/api/chat-history', (req, res) => {
    const { sessionId } = req.body;
    
    if (!sessionId) {
        return res.status(400).json({ error: 'کد سشن الزامی است' });
    }
    
    const history = getFullChatHistory(sessionId);
    const session = getSession(sessionId);
    
    res.json({
        success: true,
        sessionId,
        messageCount: history.length,
        history: history.slice(-100), // 100 پیام آخر
        userInfo: session.userInfo,
        connectedToHuman: session.connectedToHuman,
        operatorId: session.operatorId
    });
});

// تست سلامت
app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        time: new Date().toLocaleString('fa-IR'),
        api: SHOP_API_URL,
        sessions: cache.keys().length,
        activeChats: Array.from(botSessions.entries()).filter(([_, info]) => info.chatId).length,
        totalMessages: Array.from(chatHistory.keys()).reduce((sum, key) => sum + chatHistory.get(key).length, 0)
    });
});

// تست API سایت
app.get('/api/test-api', async (req, res) => {
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

// ==================== سیستم چت اصلی ====================
app.post('/api/chat', async (req, res) => {
    try {
        const { message, sessionId, userInfo } = req.body;
        
        if (!message || !sessionId) {
            return res.status(400).json({ error: 'داده ناقص' });
        }
        
        const session = getSession(sessionId);
        if (userInfo) {
            session.userInfo = { ...session.userInfo, ...userInfo };
        }
        
        // ذخیره پیام کاربر در تاریخچه
        const userMessage = { 
            role: 'user', 
            content: message,
            timestamp: new Date(),
            from: 'کاربر وبسایت'
        };
        
        session.messages.push(userMessage);
        saveMessageToHistory(sessionId, userMessage);
        
        const analysis = analyzeMessage(message);
        
        // ذخیره ترجیحات
        if (analysis.productType) {
            session.preferences.lastProductType = analysis.productType;
            session.preferences.lastSearch = {
                type: analysis.productType,
                timestamp: new Date()
            };
        }
        
        // ========== پیگیری سفارش ==========
        if (analysis.type === 'tracking') {
            const apiResult = await callShopAPI('track_order', {
                tracking_code: analysis.code
            });
            
            if (apiResult.found) {
                const order = apiResult.order;
                
                const reply = `🎯 **سفارش شما پیدا شد!** ✨\n\n` +
                             `📦 **کد سفارش:** ${order.number}\n` +
                             `👤 **مشتری:** ${order.customer_name}\n` +
                             `📅 **تاریخ ثبت:** ${order.date}\n` +
                             `🟢 **وضعیت:** ${order.status}\n` +
                             `💰 **مبلغ کل:** ${Number(order.total).toLocaleString('fa-IR')} تومان\n\n` +
                             `🛍️ **محصولات:**\n` +
                             `${order.items.map((item, i) => `   ${i+1}. ${item}`).join('\n')}\n\n` +
                             `✅ **پیگیری شما کامل شد!**\n` +
                             `اگر سوال دیگری دارید، با کمال میل در خدمتتونم. 😊`;
                
                const assistantMessage = { 
                    role: 'assistant', 
                    content: reply,
                    from: 'دستیار هوشمند'
                };
                session.messages.push(assistantMessage);
                saveMessageToHistory(sessionId, assistantMessage);
                
                return res.json({ success: true, message: reply });
                
            } else {
                const reply = `❌ **سفارشی با این کد پیدا نشد!**\n\n` +
                             `کد **${analysis.code}** در سیستم ما ثبت نیست.\n\n` +
                             `💡 **راهنمایی:**\n` +
                             `• کد را دوباره بررسی کنید\n` +
                             `• ممکن است سفارش هنوز ثبت نشده باشد\n` +
                             `• برای بررسی دقیق‌تر، "اپراتور" را تایپ کنید`;
                
                const assistantMessage = { 
                    role: 'assistant', 
                    content: reply,
                    from: 'دستیار هوشمند'
                };
                session.messages.push(assistantMessage);
                saveMessageToHistory(sessionId, assistantMessage);
                
                return res.json({ success: true, message: reply });
            }
        }
        
        // ========== جستجوی محصول ==========
        if (analysis.type === 'product_search') {
            // پاسخ اولیه
            const searchingMsg = `🔍 **در حال جستجوی دقیق برای شما...**\n\n`;
            
            let details = [];
            if (analysis.productType) details.push(`نوع: ${analysis.productType}`);
            if (analysis.sizes) details.push(`سایز: ${analysis.sizes.join(', ')}`);
            if (analysis.colors) details.push(`رنگ: ${analysis.colors.join(', ')}`);
            if (analysis.category) details.push(`دسته: ${analysis.category}`);
            
            if (details.length > 0) {
                searchingMsg += details.join(' | ') + '\n\n';
            }
            
            searchingMsg += `لطفاً کمی صبر کنید... ⏳`;
            
            const searchingMessage = { 
                role: 'assistant', 
                content: searchingMsg,
                from: 'دستیار هوشمند'
            };
            session.messages.push(searchingMessage);
            saveMessageToHistory(sessionId, searchingMessage);
            
            res.json({ success: true, message: searchingMsg, searching: true });
            
            // جستجوی پیشرفته در پس‌زمینه
            setTimeout(async () => {
                try {
                    const searchResult = await smartProductSearch(analysis, session);
                    
                    const productReply = generateProductResponse(
                        searchResult.products,
                        searchResult.searchParams,
                        searchResult.suggestedAlternatives
                    );
                    
                    const productMessage = { 
                        role: 'assistant', 
                        content: productReply,
                        from: 'دستیار هوشمند'
                    };
                    session.messages.push(productMessage);
                    saveMessageToHistory(sessionId, productMessage);
                    
                    // ارسال از طریق سوکت
                    io.to(sessionId).emit('ai-message', {
                        message: productReply,
                        type: 'products_found'
                    });
                    
                } catch (error) {
                    console.error('خطا در جستجوی محصول:', error);
                    
                    const errorReply = `⚠️ **خطا در جستجوی محصولات!**\n\n` +
                                     `سیستم موقتاً با مشکل مواجه شده.\n\n` +
                                     `🔄 **لطفاً:**\n` +
                                     `• چند لحظه دیگر دوباره تلاش کنید\n` +
                                     `• یا "اپراتور" رو تایپ کنید`;
                    
                    const errorMessage = { 
                        role: 'assistant', 
                        content: errorReply,
                        from: 'دستیار هوشمند'
                    };
                    session.messages.push(errorMessage);
                    saveMessageToHistory(sessionId, errorMessage);
                    
                    io.to(sessionId).emit('ai-message', {
                        message: errorReply,
                        type: 'error'
                    });
                }
            }, 100);
            
            return;
        }
        
        // ========== پیشنهاد ==========
        if (analysis.type === 'suggestion') {
            const prompt = responses.suggestionPrompt();
            const promptMessage = { 
                role: 'assistant', 
                content: prompt,
                from: 'دستیار هوشمند'
            };
            session.messages.push(promptMessage);
            saveMessageToHistory(sessionId, promptMessage);
            
            return res.json({ success: true, message: prompt });
        }
        
        // ========== سلام ==========
        if (analysis.type === 'greeting') {
            const greeting = responses.greeting();
            const reply = `${greeting}\n\n` +
                         `**چطور می‌تونم کمکتون کنم؟** 🤗\n\n` +
                         `می‌تونید:\n` +
                         `• کد پیگیری سفارش رو وارد کنید 📦\n` +
                         `• محصول خاصی رو جستجو کنید 🔍\n` +
                         `• از من بخواهید پیشنهاد بدم 🎁\n` +
                         `• یا برای صحبت با "اپراتور" بنویسید 👤`;
            
            const greetingMessage = { 
                role: 'assistant', 
                content: reply,
                from: 'دستیار هوشمند'
            };
            session.messages.push(greetingMessage);
            saveMessageToHistory(sessionId, greetingMessage);
            
            return res.json({ success: true, message: reply });
        }
        
        // ========== تشکر ==========
        if (analysis.type === 'thanks') {
            const reply = `${responses.thanks()}\n\n` +
                         `**امر دیگری هست که بتونم کمکتون کنم؟** 🌸\n\n` +
                         `همیشه در خدمت شما هستم!`;
            
            const thanksMessage = { 
                role: 'assistant', 
                content: reply,
                from: 'دستیار هوشمند'
            };
            session.messages.push(thanksMessage);
            saveMessageToHistory(sessionId, thanksMessage);
            
            return res.json({ success: true, message: reply });
        }
        
        // ========== اپراتور ==========
        if (analysis.type === 'operator') {
            const short = sessionId.substring(0, 12);
            botSessions.set(short, {
                fullId: sessionId,
                userInfo: session.userInfo,
                chatId: null,
                createdAt: new Date()
            });
            
            // اطلاع به تلگرام
            await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, 
                `🔔 **درخواست اتصال به اپراتور**\n\n` +
                `👤 نام: ${session.userInfo?.name || 'ناشناس'}\n` +
                `📄 صفحه: ${session.userInfo?.page || 'نامشخص'}\n` +
                `🔢 کد جلسه: ${short}\n` +
                `💬 آخرین پیام: ${message.substring(0, 50)}...\n` +
                `📊 تعداد پیام‌ها: ${getFullChatHistory(sessionId).length}\n\n` +
                `🕐 زمان: ${new Date().toLocaleTimeString('fa-IR')}`,
                {
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '✅ پذیرش درخواست', callback_data: `accept_${short}` },
                            { text: '❌ رد درخواست', callback_data: `reject_${short}` }
                        ]]
                    }
                }
            );
            
            const reply = `✅ **درخواست برای اپراتورها ارسال شد**\n\n` +
                         `لطفاً چند لحظه منتظر بمانید... ⏳\n\n` +
                         `کد جلسه شما: **${short}**\n` +
                         `به محض پذیرش توسط اپراتور، به شما اطلاع داده می‌شود.`;
            
            const operatorMessage = { 
                role: 'system', 
                content: reply,
                from: 'سیستم'
            };
            session.messages.push(operatorMessage);
            saveMessageToHistory(sessionId, operatorMessage);
            
            return res.json({ success: true, message: reply });
        }
        
        // ========== پاسخ پیش‌فرض هوشمند ==========
        // سعی کن بر اساس تاریخچه، پیشنهاد بدهی
        if (session.searchHistory && session.searchHistory.length > 0) {
            const lastSearch = session.searchHistory[session.searchHistory.length - 1];
            
            if (lastSearch.found) {
                const reply = `🤔 **متوجه پیامتون شدم!**\n\n` +
                             `آیا دنبال محصولاتی مثل **"${lastSearch.keyword}"** هستید؟\n\n` +
                             `✨ **می‌تونید:**\n` +
                             `• نام دقیق محصول رو بگید\n` +
                             `• "پیشنهاد" رو برای دیدن محصولات ویژه تایپ کنید\n` +
                             `• کد پیگیری سفارش رو وارد کنید\n` +
                             `• یا "اپراتور" رو برای کمک بیشتر تایپ کنید`;
                
                const defaultMessage = { 
                    role: 'assistant', 
                    content: reply,
                    from: 'دستیار هوشمند'
                };
                session.messages.push(defaultMessage);
                saveMessageToHistory(sessionId, defaultMessage);
                
                return res.json({ success: true, message: reply });
            }
        }
        
        // پاسخ نهایی
        const finalReply = `🌈 **سلام! خوش اومدید!**\n\n` +
                          `من دستیار هوشمند شیک‌پوشان هستم و اینجا هستم تا کمکتون کنم:\n\n` +
                          `✨ **می‌تونم:**\n` +
                          `• پیگیری سفارش با کد رهگیری 📦\n` +
                          `• جستجوی محصولات با رنگ و سایز 🔍\n` +
                          `• پیشنهاد محصولات ویژه 🎁\n` +
                          `• اتصال به اپراتور انسانی 👤\n\n` +
                          `**لطفاً انتخاب کنید:**\n` +
                          `"کد پیگیری" ، "جستجو" ، "پیشنهاد" یا "اپراتور"`;
        
        const finalMessage = { 
            role: 'assistant', 
            content: finalReply,
            from: 'دستیار هوشمند'
        };
        session.messages.push(finalMessage);
        saveMessageToHistory(sessionId, finalMessage);
        
        return res.json({ success: true, message: finalReply });
        
    } catch (error) {
        console.error('❌ خطا در سیستم چت:', error);
        
        const errorReply = `⚠️ **اوه! یه مشکلی پیش اومده!**\n\n` +
                          `سیستم موقتاً با مشکل مواجه شده.\n\n` +
                          `🔄 **لطفاً:**\n` +
                          `• چند لحظه صبر کنید و دوباره تلاش کنید\n` +
                          `• یا "اپراتور" رو تایپ کنید\n\n` +
                          `با تشکر از صبر و شکیبایی شما 🙏`;
        
        return res.json({ 
            success: false, 
            message: errorReply 
        });
    }
});

// ==================== API اضافی ====================

// جستجوی دسته‌بندی‌ها
app.get('/api/categories', async (req, res) => {
    try {
        const result = await callShopAPI('get_categories', {});
        res.json(result);
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// محصولات پرفروش
app.get('/api/popular-products', async (req, res) => {
    try {
        const limit = req.query.limit || 6;
        const result = await callShopAPI('get_popular_products', { limit });
        res.json(result);
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// اتصال به اپراتور
app.post('/api/connect-human', async (req, res) => {
    const { sessionId, userInfo } = req.body;
    const session = getSession(sessionId);
    
    if (userInfo) {
        session.userInfo = { ...session.userInfo, ...userInfo };
    }
    
    const short = sessionId.substring(0, 12);
    botSessions.set(short, {
        fullId: sessionId,
        userInfo: session.userInfo,
        chatId: null,
        createdAt: new Date()
    });
    
    // اطلاع به تلگرام
    await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, 
        `🔔 **درخواست اتصال جدید**\n\n` +
        `👤 کاربر: ${session.userInfo?.name || 'ناشناس'}\n` +
        `📄 صفحه: ${session.userInfo?.page || 'نامشخص'}\n` +
        `🔢 کد: ${short}\n` +
        `📊 تاریخچه: ${getFullChatHistory(sessionId).length} پیام\n\n` +
        `🕐 ${new Date().toLocaleTimeString('fa-IR')}`,
        {
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ پذیرش درخواست', callback_data: `accept_${short}` },
                    { text: '❌ رد درخواست', callback_data: `reject_${short}` }
                ]]
            }
        }
    );
    
    const responseMessage = `✅ **درخواست برای اپراتورها ارسال شد**\n\n` +
                          `لطفاً چند لحظه منتظر بمانید... ⏳\n\n` +
                          `کد جلسه شما: **${short}**\n` +
                          `به محض پذیرش توسط اپراتور، به شما اطلاع داده می‌شود.`;
    
    // ذخیره پیام سیستم
    const systemMessage = {
        role: 'system',
        content: responseMessage,
        from: 'سیستم',
        timestamp: new Date()
    };
    
    saveMessageToHistory(sessionId, systemMessage);
    session.messages.push(systemMessage);
    
    res.json({ 
        success: true, 
        pending: true,
        message: responseMessage,
        sessionCode: short
    });
});

// ==================== سوکت ====================
io.on('connection', (socket) => {
    console.log('🔌 کاربر جدید متصل شد:', socket.id);
    
    socket.on('join-session', (sessionId) => {
        socket.join(sessionId);
        console.log(`📝 کاربر به سشن ${sessionId} پیوست`);
        
        // ارسال تاریخچه چت قبلی
        const history = getFullChatHistory(sessionId);
        if (history.length > 0) {
            socket.emit('chat-history-loaded', {
                history: history.slice(-50) // 50 پیام آخر
            });
        }
    });
    
    socket.on('user-message', async ({ sessionId, message }) => {
        if (!sessionId || !message) return;
        
        const short = sessionId.substring(0, 12);
        const info = botSessions.get(short);
        
        if (info?.chatId) {
            await bot.telegram.sendMessage(info.chatId, 
                `💬 **پیام جدید از کاربر**\n\n` +
                `👤 کد جلسه: ${short}\n` +
                `📝 پیام:\n${message}\n\n` +
                `🕐 ${new Date().toLocaleTimeString('fa-IR')}`);
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
                    caption: `📎 **فایل ارسالی از کاربر**\n\n` +
                            `🔢 کد جلسه: ${short}\n` +
                            `📄 نام فایل: ${fileName}`
                });
                
                socket.emit('file-sent', { 
                    success: true,
                    message: '✅ فایل با موفقیت ارسال شد!' 
                });
                
            } catch (error) {
                console.error('خطای فایل:', error);
                socket.emit('file-error', { 
                    error: 'خطا در ارسال فایل',
                    details: error.message 
                });
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
                    caption: `🎤 **پیام صوتی از کاربر**\n\n` +
                            `🔢 کد جلسه: ${short}`
                });
                
                socket.emit('voice-sent', { 
                    success: true,
                    message: '✅ پیام صوتی ارسال شد!' 
                });
                
            } catch (error) {
                console.error('خطای ویس:', error);
                socket.emit('voice-error', { 
                    error: 'خطا در ارسال پیام صوتی',
                    details: error.message 
                });
            }
        }
    });
});

// صفحه اصلی
app.get('/', (req, res) => {
    res.json({
        name: '✨ شیک‌پوشان - پشتیبانی هوشمند ✨',
        version: '7.0.0',
        status: 'آنلاین ✅',
        features: [
            'پیگیری سفارش با کد رهگیری',
            'جستجوی هوشمند محصولات با فیلترهای پیشرفته',
            'تشخیص خودکار رنگ، سایز و دسته‌بندی',
            'پیشنهادات هوشمند بر اساس تاریخچه',
            'اتصال به اپراتور انسانی',
            'ارسال فایل و پیام صوتی',
            'مدیریت چت از تلگرام (پاک کردن/بستن)',
            'ذخیره تاریخچه کامل چت (کاربر + اپراتور)',
            'بارگذاری خودکار تاریخچه با رفرش صفحه'
        ],
        api: SHOP_API_URL,
        endpoints: {
            chat: 'POST /api/chat',
            history: 'POST /api/chat-history',
            connect: 'POST /api/connect-human',
            categories: 'GET /api/categories',
            popular: 'GET /api/popular-products',
            health: 'GET /api/health',
            test: 'GET /api/test-api'
        },
        message: 'خوش آمدید به سیستم پشتیبانی هوشمند شیک‌پوشان! 🌸'
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== راه‌اندازی ====================
server.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 سرور روی پورت ${PORT} فعال شد`);
    console.log(`🌐 آدرس: https://ai-chat-support-production.up.railway.app`);
    console.log(`🛍️ API سایت: ${SHOP_API_URL}`);
    console.log(`🤖 تلگرام: ${TELEGRAM_BOT_TOKEN ? 'فعال ✅' : 'غیرفعال ❌'}`);
    console.log(`📊 سیستم مدیریت چت: فعال ✅`);
    console.log(`💾 ذخیره تاریخچه کامل: فعال ✅`);
    console.log(`🔄 بارگذاری خودکار تاریخچه: فعال ✅`);
    
    try {
        await bot.telegram.setWebhook(`https://ai-chat-support-production.up.railway.app/telegram-webhook`);
        console.log('✅ وب‌هوک تلگرام تنظیم شد');
        
        await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, 
            `🤖 **سیستم پشتیبانی هوشمند فعال شد** ✨\n\n` +
            `✅ سرور: https://ai-chat-support-production.up.railway.app\n` +
            `✅ API: ${SHOP_API_URL}\n` +
            `✅ جستجوی هوشمند: فعال\n` +
            `✅ مدیریت چت: فعال\n` +
            `✅ ذخیره تاریخچه کامل: فعال\n\n` +
            `📝 **دستورات مدیریت:**\n` +
            `/chats - مشاهده چت‌های فعال\n` +
            `/clear_[کد] - پاک کردن تاریخچه\n` +
            `/close_[کد] - بستن چت\n\n` +
            `📅 تاریخ: ${new Date().toLocaleDateString('fa-IR')}\n` +
            `🕐 زمان: ${new Date().toLocaleTimeString('fa-IR')}\n\n` +
            `✨ سیستم آماده خدمات‌رسانی است!`);
        
    } catch (error) {
        console.log('⚠️ وب‌هوک خطا → Polling فعال شد');
        bot.launch();
    }
});
