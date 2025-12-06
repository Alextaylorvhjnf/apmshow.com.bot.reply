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
const OPERATOR_TELEGRAM_IDS = process.env.OPERATOR_TELEGRAM_IDS 
    ? process.env.OPERATOR_TELEGRAM_IDS.split(',').map(id => Number(id.trim()))
    : [Number(process.env.ADMIN_TELEGRAM_ID)];

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

// ==================== سیستم نوبت‌دهی هوشمند ====================
const waitingQueue = []; // صف انتظار کاربران
const activeChats = new Map(); // چت‌های فعال
const operatorStatus = new Map(); // وضعیت اپراتورها
const botSessions = new Map(); // سشن‌های تلگرام

// کش برای ذخیره داده‌های سشن
const cache = new NodeCache({ stdTTL: 3600 * 24 });
const chatHistory = new Map(); // تاریخچه کامل چت

// مقداردهی اولیه اپراتورها
OPERATOR_TELEGRAM_IDS.forEach((operatorId, index) => {
    operatorStatus.set(operatorId, {
        id: operatorId,
        name: `اپراتور ${index + 1}`,
        isOnline: true,
        isAvailable: true,
        activeChats: [],
        maxChats: 3, // هر اپراتور حداکثر 3 چت همزمان
        totalAssigned: 0,
        lastActivity: new Date(),
        efficiency: 100 // بازدهی
    });
});

// ==================== توابع سیستم نوبت ====================

// اضافه کردن کاربر به صف انتظار
function addToWaitingQueue(sessionId, userInfo, message = '') {
    const position = waitingQueue.length + 1;
    const queueItem = {
        sessionId,
        userInfo,
        position,
        joinedAt: new Date(),
        lastMessage: message,
        estimatedWaitTime: position * 2 // زمان تخمینی انتظار بر اساس موقعیت در صف
    };
    
    waitingQueue.push(queueItem);
    
    console.log(`👤 کاربر ${sessionId.substring(0, 12)} به صف انتظار اضافه شد. موقعیت: ${position}`);
    
    return queueItem;
}

// حذف از صف انتظار
function removeFromWaitingQueue(sessionId) {
    const index = waitingQueue.findIndex(item => item.sessionId === sessionId);
    if (index !== -1) {
        waitingQueue.splice(index, 1);
        
        // به‌روزرسانی موقعیت بقیه
        waitingQueue.forEach((item, i) => {
            item.position = i + 1;
            item.estimatedWaitTime = item.position * 2;
        });
        
        console.log(`✅ کاربر ${sessionId.substring(0, 12)} از صف انتظار حذف شد`);
    }
}

// پیدا کردن اپراتور مناسب
function findBestOperator() {
    let bestOperator = null;
    let bestScore = -1;
    
    for (const [operatorId, status] of operatorStatus.entries()) {
        if (status.isOnline && status.isAvailable && status.activeChats.length < status.maxChats) {
            // محاسبه امتیاز
            const loadScore = (status.maxChats - status.activeChats.length) * 30;
            const efficiencyScore = status.efficiency;
            const timeScore = Math.max(0, 50 - ((new Date() - status.lastActivity) / 60000));
            
            const totalScore = loadScore + efficiencyScore + timeScore;
            
            if (totalScore > bestScore) {
                bestScore = totalScore;
                bestOperator = operatorId;
            }
        }
    }
    
    return bestOperator;
}

// تخصیص چت به اپراتور
async function assignChatToOperator(sessionId, userInfo) {
    const operatorId = findBestOperator();
    
    if (!operatorId) {
        console.log('⏳ هیچ اپراتور آزادی موجود نیست، کاربر در صف انتظار');
        return null;
    }
    
    const operator = operatorStatus.get(operatorId);
    const short = sessionId.substring(0, 12);
    
    // ایجاد سشن
    const sessionInfo = {
        fullId: sessionId,
        userInfo: userInfo || {},
        chatId: null,
        operatorId: operatorId,
        status: 'assigned',
        positionInQueue: 0,
        assignedAt: new Date(),
        estimatedWaitTime: 0
    };
    
    botSessions.set(short, sessionInfo);
    
    // به‌روزرسانی وضعیت اپراتور
    operator.activeChats.push({
        sessionCode: short,
        assignedAt: new Date(),
        userInfo: userInfo
    });
    
    if (operator.activeChats.length >= operator.maxChats) {
        operator.isAvailable = false;
    }
    
    operator.lastActivity = new Date();
    operator.totalAssigned++;
    
    // ارسال اطلاع به اپراتور
    await notifyOperatorAssignment(operatorId, short, userInfo, operator.activeChats.length);
    
    console.log(`✅ چت ${short} به ${operator.name} اختصاص یافت`);
    return operatorId;
}

// اطلاع به اپراتور درباره اختصاص چت
async function notifyOperatorAssignment(operatorId, sessionCode, userInfo, currentChats) {
    const operator = operatorStatus.get(operatorId);
    
    return bot.telegram.sendMessage(operatorId,
        `🎯 **چت جدید به شما اختصاص یافت**\n\n` +
        `👤 کاربر: ${userInfo?.name || 'ناشناس'}\n` +
        `📄 صفحه: ${userInfo?.page || 'نامشخص'}\n` +
        `🔢 کد: ${sessionCode}\n` +
        `📊 چت‌های فعال شما: ${currentChats}/${operator.maxChats}\n` +
        `🏆 امتیاز بازدهی: ${operator.efficiency}%\n\n` +
        `⏰ **دستورات سریع:**\n` +
        `/accept_${sessionCode} - پذیرش چت\n` +
        `/reject_${sessionCode} - رد چت\n` +
        `/busy - مشغول شدم\n` +
        `/free - آزاد شدم`,
        {
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ پذیرش چت', callback_data: `accept_${sessionCode}` },
                    { text: '❌ رد چت', callback_data: `reject_${sessionCode}` }
                ]]
            }
        }
    );
}

// ارسال وضعیت صف به کاربر
function sendQueueStatusToUser(sessionId, positionInQueue) {
    let message = '';
    
    if (positionInQueue === 0) {
        message = `🎯 **نوبت شما رسیده!**\n\n` +
                 `در حال اتصال به اپراتور... ⏳`;
    } else if (positionInQueue === 1) {
        message = `⏳ **۱ نفر قبل از شما در صف است**\n\n` +
                 `لطفاً کمی صبر کنید...\n` +
                 `زمان تخمینی: ۲ دقیقه`;
    } else {
        message = `⏳ **${positionInQueue} نفر قبل از شما در صف هستند**\n\n` +
                 `موقعیت شما در صف: ${positionInQueue}\n` +
                 `زمان تخمینی: ${positionInQueue * 2} دقیقه\n\n` +
                 `🔄 به محض رسیدن نوبت شما، اطلاع داده می‌شود.`;
    }
    
    // ارسال از طریق سوکت
    io.to(sessionId).emit('queue-status', {
        position: positionInQueue,
        estimatedTime: positionInQueue * 2,
        message: message
    });
    
    return message;
}

// بررسی و تخصیص چت به نوبت بعدی
async function processNextInQueue() {
    if (waitingQueue.length === 0) return;
    
    const nextUser = waitingQueue[0];
    const operatorId = findBestOperator();
    
    if (operatorId) {
        // حذف از صف و تخصیص
        waitingQueue.shift();
        const assigned = await assignChatToOperator(nextUser.sessionId, nextUser.userInfo);
        
        if (assigned) {
            // اطلاع به کاربر
            sendQueueStatusToUser(nextUser.sessionId, 0);
            
            // اطلاع به بقیه افراد صف
            updateAllQueuePositions();
        }
    }
}

// به‌روزرسانی موقعیت همه افراد در صف
function updateAllQueuePositions() {
    waitingQueue.forEach((item, index) => {
        item.position = index + 1;
        item.estimatedWaitTime = item.position * 2;
        
        // ارسال وضعیت به هر کاربر
        sendQueueStatusToUser(item.sessionId, item.position);
    });
}

// ==================== مدیریت سشن و تاریخچه ====================
const getSession = (id) => {
    let s = cache.get(id);
    if (!s) {
        s = { 
            id, 
            messages: [], 
            userInfo: {}, 
            connectedToHuman: false, 
            operatorId: null,
            queuePosition: 0,
            preferences: {},
            searchHistory: []
        };
        cache.set(id, s);
    }
    return s;
};

// ذخیره پیام در تاریخچه
function saveMessageToHistory(sessionId, message) {
    if (!chatHistory.has(sessionId)) {
        chatHistory.set(sessionId, []);
    }
    chatHistory.get(sessionId).push({
        ...message,
        timestamp: new Date(),
        savedAt: new Date().toISOString()
    });
    
    if (chatHistory.get(sessionId).length > 200) {
        chatHistory.set(sessionId, chatHistory.get(sessionId).slice(-200));
    }
}

// دریافت تاریخچه کامل
function getFullChatHistory(sessionId) {
    return chatHistory.get(sessionId) || [];
}

// پاک کردن تاریخچه
function clearChatHistory(sessionId) {
    if (chatHistory.has(sessionId)) {
        chatHistory.delete(sessionId);
    }
    
    const session = getSession(sessionId);
    session.messages = [];
    session.connectedToHuman = false;
    session.operatorId = null;
    cache.set(sessionId, session);
    
    const short = sessionId.substring(0, 12);
    if (botSessions.has(short)) {
        botSessions.delete(short);
    }
    
    // حذف از صف اگر وجود دارد
    removeFromWaitingQueue(sessionId);
    
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
                found: false
            });
            
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
            
            // محصولات پرفروش
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

// دستورات مدیریت برای اپراتورها
bot.command('status', async (ctx) => {
    const operatorId = ctx.from.id;
    const operator = operatorStatus.get(operatorId);
    
    if (!operator) {
        return ctx.reply('❌ شما اپراتور نیستید!');
    }
    
    const now = new Date();
    const queueLength = waitingQueue.length;
    const activeOperators = Array.from(operatorStatus.values())
        .filter(op => op.isOnline).length;
    
    const statusMessage = `📊 **وضعیت سیستم پشتیبانی**\n\n` +
                         `👤 **شما:** ${operator.name}\n` +
                         `🟢 **وضعیت:** ${operator.isAvailable ? 'آماده ✅' : 'مشغول 🔴'}\n` +
                         `💬 **چت‌های فعال:** ${operator.activeChats.length}/${operator.maxChats}\n` +
                         `🎯 **بازدهی:** ${operator.efficiency}%\n` +
                         `👥 **افراد در صف:** ${queueLength} نفر\n` +
                         `👨‍💼 **اپراتورهای آنلاین:** ${activeOperators}/${OPERATOR_TELEGRAM_IDS.length}\n` +
                         `⏰ **زمان:** ${now.toLocaleTimeString('fa-IR')}\n\n` +
                         `📝 **دستورات:**\n` +
                         `/busy - مشغول شدم\n` +
                         `/free - آزاد شدم\n` +
                         `/chats - چت‌های فعال\n` +
                         `/queue - وضعیت صف`;
    
    await ctx.reply(statusMessage);
});

bot.command('queue', async (ctx) => {
    const operatorId = ctx.from.id;
    if (!operatorStatus.has(operatorId)) {
        return ctx.reply('❌ شما اپراتور نیستید!');
    }
    
    if (waitingQueue.length === 0) {
        return ctx.reply('📭 **صف انتظار خالی است**\n\nهیچ کاربری در انتظار اپراتور نیست.');
    }
    
    let queueMessage = `📋 **صف انتظار (${waitingQueue.length} نفر)**\n\n`;
    
    waitingQueue.slice(0, 10).forEach((item, index) => {
        const waitTime = Math.floor((new Date() - item.joinedAt) / 60000);
        queueMessage += `${index + 1}. **${item.userInfo?.name || 'ناشناس'}**\n`;
        queueMessage += `   📄 صفحه: ${item.userInfo?.page || 'نامشخص'}\n`;
        queueMessage += `   ⏰ مدت انتظار: ${waitTime} دقیقه\n`;
        queueMessage += `   🕐 زمان ورود: ${item.joinedAt.toLocaleTimeString('fa-IR')}\n\n`;
    });
    
    if (waitingQueue.length > 10) {
        queueMessage += `📝 و ${waitingQueue.length - 10} نفر دیگر...`;
    }
    
    await ctx.reply(queueMessage);
});

bot.command('chats', async (ctx) => {
    const operatorId = ctx.from.id;
    const operator = operatorStatus.get(operatorId);
    
    if (!operator) {
        return ctx.reply('❌ شما اپراتور نیستید!');
    }
    
    if (operator.activeChats.length === 0) {
        return ctx.reply('📭 **هیچ چت فعالی ندارید**');
    }
    
    let chatsMessage = `💬 **چت‌های فعال شما (${operator.activeChats.length})**\n\n`;
    
    operator.activeChats.forEach((chat, index) => {
        const duration = Math.floor((new Date() - chat.assignedAt) / 60000);
        const short = chat.sessionCode || 'نامشخص';
        const info = botSessions.get(short);
        
        chatsMessage += `${index + 1}. **${chat.userInfo?.name || 'ناشناس'}**\n`;
        chatsMessage += `   🔢 کد: ${short}\n`;
        chatsMessage += `   📄 صفحه: ${chat.userInfo?.page || 'نامشخص'}\n`;
        chatsMessage += `   ⏰ مدت گفتگو: ${duration} دقیقه\n`;
        chatsMessage += `   📝 مدیریت: /clear_${short} /close_${short}\n\n`;
    });
    
    await ctx.reply(chatsMessage);
});

bot.command('busy', async (ctx) => {
    const operatorId = ctx.from.id;
    const operator = operatorStatus.get(operatorId);
    
    if (!operator) {
        return ctx.reply('❌ شما اپراتور نیستید!');
    }
    
    operator.isAvailable = false;
    await ctx.reply('🔴 **وضعیت شما به "مشغول" تغییر یافت**\n\nچت جدیدی به شما اختصاص داده نمی‌شود.');
});

bot.command('free', async (ctx) => {
    const operatorId = ctx.from.id;
    const operator = operatorStatus.get(operatorId);
    
    if (!operator) {
        return ctx.reply('❌ شما اپراتور نیستید!');
    }
    
    operator.isAvailable = true;
    operator.isOnline = true;
    
    // بررسی اگر چت‌های فعال کمتر از حداکثر است
    if (operator.activeChats.length < operator.maxChats) {
        setTimeout(() => processNextInQueue(), 1000);
    }
    
    await ctx.reply('🟢 **وضعیت شما به "آزاد" تغییر یافت**\n\nآماده دریافت چت جدید هستید.');
});

// پذیرش درخواست چت
bot.action(/^accept_(.+)/, async (ctx) => {
    const sessionCode = ctx.match[1];
    const info = botSessions.get(sessionCode);
    
    if (!info) return ctx.answerCbQuery('منقضی شده');
    
    const operatorId = ctx.from.id;
    const operator = operatorStatus.get(operatorId);
    
    if (!operator) return ctx.answerCbQuery('دسترسی غیرمجاز');
    
    // به‌روزرسانی وضعیت
    info.chatId = ctx.chat.id;
    info.status = 'connected';
    
    const session = getSession(info.fullId);
    session.connectedToHuman = true;
    session.operatorId = operatorId;
    cache.set(info.fullId, session);
    
    await ctx.answerCbQuery('پذیرفته شد');
    
    await ctx.editMessageText(`🎯 **شما این گفتگو را پذیرفتید**\n\n` +
                             `👤 کاربر: ${info.userInfo?.name || 'ناشناس'}\n` +
                             `📄 صفحه: ${info.userInfo?.page || 'نامشخص'}\n` +
                             `🔢 کد جلسه: ${sessionCode}\n` +
                             `💬 تعداد پیام‌ها: ${getFullChatHistory(info.fullId).length}\n\n` +
                             `📝 **دستورات مدیریت:**\n` +
                             `/clear_${sessionCode} - پاک کردن تاریخچه\n` +
                             `/close_${sessionCode} - بستن چت`);
    
    // ارسال پیام اتصال موفق به کاربر
    const operatorConnectedMessage = `✅ **اپراتور به چت متصل شد**\n\n` +
                                   `👤 هم‌اکنون می‌توانید سوالات خود را بپرسید.\n` +
                                   `🎤 همچنین می‌توانید پیام صوتی و فایل ارسال کنید.`;
    
    io.to(info.fullId).emit('operator-connected', {
        message: operatorConnectedMessage
    });
    
    // حذف از صف اگر وجود داشت
    removeFromWaitingQueue(info.fullId);
    
    // ذخیره پیام سیستم
    const systemMessage = {
        role: 'system',
        content: '✅ اپراتور گفتگو را پذیرفت.',
        from: 'سیستم',
        timestamp: new Date()
    };
    saveMessageToHistory(info.fullId, systemMessage);
});

bot.action(/^reject_(.+)/, async (ctx) => {
    const sessionCode = ctx.match[1];
    const info = botSessions.get(sessionCode);
    
    if (!info) return ctx.answerCbQuery('منقضی شده');
    
    // آزاد کردن اپراتور
    const operator = operatorStatus.get(info.operatorId);
    if (operator) {
        operator.activeChats = operator.activeChats.filter(chat => chat.sessionCode !== sessionCode);
        if (operator.activeChats.length < operator.maxChats) {
            operator.isAvailable = true;
        }
    }
    
    // برگرداندن کاربر به ابتدای صف
    if (info.userInfo) {
        addToWaitingQueue(info.fullId, info.userInfo);
        sendQueueStatusToUser(info.fullId, 1);
    }
    
    botSessions.delete(sessionCode);
    
    await ctx.answerCbQuery('رد شد');
    await ctx.editMessageText(`❌ **این گفتگو را رد کردید**\n\nکاربر به ابتدای صف انتظار بازگردانده شد.`);
    
    // بررسی برای تخصیص به اپراتور دیگر
    setTimeout(() => processNextInQueue(), 1000);
});

// دستور پاک کردن تاریخچه
bot.command(/^clear_(.+)/, async (ctx) => {
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
    
    await ctx.reply(`✅ تاریخچه چت ${sessionCode} با موفقیت پاک شد.`);
});

// دستور بستن چت
bot.command(/^close_(.+)/, async (ctx) => {
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
    
    // آزاد کردن اپراتور
    if (info.operatorId) {
        releaseOperatorFromChat(info.operatorId, sessionCode);
    }
    
    // پاک کردن از botSessions
    botSessions.delete(sessionCode);
    
    await ctx.reply(`✅ چت ${sessionCode} با موفقیت بسته شد و پیام مناسب برای کاربر ارسال گردید.`);
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
        operatorId: ctx.chat.id,
        timestamp: new Date()
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

// دریافت وضعیت صف
app.get('/api/queue-status', (req, res) => {
    res.json({
        success: true,
        queueLength: waitingQueue.length,
        waitingQueue: waitingQueue.map(item => ({
            sessionId: item.sessionId.substring(0, 12),
            position: item.position,
            waitingTime: Math.floor((new Date() - item.joinedAt) / 60000),
            userInfo: item.userInfo
        })),
        activeOperators: Array.from(operatorStatus.values())
            .filter(op => op.isOnline).length,
        totalOperators: OPERATOR_TELEGRAM_IDS.length
    });
});

// دریافت وضعیت اپراتورها
app.get('/api/operators-status', (req, res) => {
    const operators = Array.from(operatorStatus.values()).map(op => ({
        id: op.id,
        name: op.name,
        isOnline: op.isOnline,
        isAvailable: op.isAvailable,
        activeChats: op.activeChats.length,
        maxChats: op.maxChats,
        efficiency: op.efficiency,
        lastActivity: op.lastActivity
    }));
    
    res.json({
        success: true,
        operators,
        totalActiveChats: operators.reduce((sum, op) => sum + op.activeChats, 0)
    });
});

// دریافت تاریخچه چت
app.post('/api/chat-history', (req, res) => {
    const { sessionId } = req.body;
    
    if (!sessionId) {
        return res.status(400).json({ error: 'کد سشن الزامی است' });
    }
    
    const history = getFullChatHistory(sessionId);
    const session = getSession(sessionId);
    
    // بررسی موقعیت در صف
    const queuePosition = waitingQueue.findIndex(item => item.sessionId === sessionId) + 1;
    
    res.json({
        success: true,
        sessionId,
        messageCount: history.length,
        history: history.slice(-100),
        userInfo: session.userInfo,
        connectedToHuman: session.connectedToHuman,
        operatorId: session.operatorId,
        queuePosition: queuePosition > 0 ? queuePosition : 0,
        estimatedWaitTime: queuePosition * 2
    });
});

// تست سلامت
app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        time: new Date().toLocaleString('fa-IR'),
        api: SHOP_API_URL,
        sessions: cache.keys().length,
        queueLength: waitingQueue.length,
        activeChats: Array.from(botSessions.values()).filter(s => s.status === 'connected').length,
        activeOperators: Array.from(operatorStatus.values()).filter(op => op.isOnline && op.isAvailable).length
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

// سیستم چت اصلی
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
        
        // ========== اپراتور ==========
        if (analysis.type === 'operator' || message.includes('اپراتور')) {
            const short = sessionId.substring(0, 12);
            
            // بررسی اگر قبلاً در صف است
            const existingInQueue = waitingQueue.find(item => item.sessionId === sessionId);
            if (existingInQueue) {
                const position = existingInQueue.position;
                const reply = `⏳ **شما در حال حاضر در صف انتظار هستید**\n\n` +
                             `موقعیت شما در صف: **${position}**\n` +
                             `${position === 1 ? '۱ نفر قبل از شما' : `${position} نفر قبل از شما`}\n` +
                             `⏱ زمان تخمینی: **${position * 2} دقیقه**\n\n` +
                             `لطفاً منتظر بمانید...`;
                
                const systemMessage = { 
                    role: 'system', 
                    content: reply,
                    from: 'سیستم صف'
                };
                session.messages.push(systemMessage);
                saveMessageToHistory(sessionId, systemMessage);
                
                return res.json({ success: true, message: reply });
            }
            
            // سعی کن اپراتور اختصاص بدهی
            const assignedOperator = await assignChatToOperator(sessionId, session.userInfo);
            
            if (assignedOperator) {
                // موفق شد اپراتور اختصاص دهد
                const reply = `✅ **درخواست شما دریافت شد**\n\n` +
                             `در حال اتصال به اپراتور... ⏳\n\n` +
                             `کد جلسه شما: **${short}**\n` +
                             `به زودی اپراتور با شما ارتباط برقرار می‌کند.`;
                
                const systemMessage = { 
                    role: 'system', 
                    content: reply,
                    from: 'سیستم'
                };
                session.messages.push(systemMessage);
                saveMessageToHistory(sessionId, systemMessage);
                
                return res.json({ success: true, message: reply });
            } else {
                // اضافه به صف انتظار
                const queueItem = addToWaitingQueue(sessionId, session.userInfo, message);
                
                const reply = `⏳ **شما به صف انتظار اضافه شدید**\n\n` +
                             `موقعیت شما در صف: **${queueItem.position}**\n` +
                             `${queueItem.position === 1 ? 'هیچکس قبل از شما نیست' : `${queueItem.position - 1} نفر قبل از شما`}\n` +
                             `⏱ زمان تخمینی: **${queueItem.estimatedWaitTime} دقیقه**\n\n` +
                             `کد جلسه شما: **${short}**\n` +
                             `به محض رسیدن نوبت، به شما اطلاع داده می‌شود.`;
                
                const systemMessage = { 
                    role: 'system', 
                    content: reply,
                    from: 'سیستم صف'
                };
                session.messages.push(systemMessage);
                saveMessageToHistory(sessionId, systemMessage);
                
                // ارسال وضعیت صف به کاربر
                sendQueueStatusToUser(sessionId, queueItem.position);
                
                return res.json({ success: true, message: reply, queuePosition: queueItem.position });
            }
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
        
        // ========== پاسخ پیش‌فرض هوشمند ==========
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
                          `**برای اتصال به اپراتور کلمه "اپراتور" را تایپ کنید**`;
        
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

// اتصال به اپراتور
app.post('/api/connect-human', async (req, res) => {
    const { sessionId, userInfo } = req.body;
    const session = getSession(sessionId);
    
    if (userInfo) {
        session.userInfo = { ...session.userInfo, ...userInfo };
    }
    
    const short = sessionId.substring(0, 12);
    
    // بررسی اگر قبلاً در صف است
    const existingInQueue = waitingQueue.find(item => item.sessionId === sessionId);
    if (existingInQueue) {
        const position = existingInQueue.position;
        const reply = `⏳ **شما در حال حاضر در صف انتظار هستید**\n\n` +
                     `موقعیت شما در صف: **${position}**\n` +
                     `${position === 1 ? 'هیچکس قبل از شما نیست' : `${position - 1} نفر قبل از شما`}\n` +
                     `⏱ زمان تخمینی: **${position * 2} دقیقه**\n\n` +
                     `کد جلسه شما: **${short}**\n` +
                     `لطفاً منتظر بمانید...`;
        
        const systemMessage = {
            role: 'system',
            content: reply,
            from: 'سیستم صف',
            timestamp: new Date()
        };
        
        saveMessageToHistory(sessionId, systemMessage);
        session.messages.push(systemMessage);
        
        return res.json({ 
            success: true, 
            message: reply,
            queuePosition: position,
            estimatedWaitTime: position * 2,
            sessionCode: short
        });
    }
    
    // سعی کن اپراتور اختصاص بدهی
    const assignedOperator = await assignChatToOperator(sessionId, session.userInfo);
    
    if (assignedOperator) {
        const reply = `✅ **درخواست شما دریافت شد**\n\n` +
                     `در حال اتصال به اپراتور... ⏳\n\n` +
                     `کد جلسه شما: **${short}**\n` +
                     `به زودی اپراتور با شما ارتباط برقرار می‌کند.`;
        
        const systemMessage = {
            role: 'system',
            content: reply,
            from: 'سیستم',
            timestamp: new Date()
        };
        
        saveMessageToHistory(sessionId, systemMessage);
        session.messages.push(systemMessage);
        
        return res.json({ 
            success: true, 
            message: reply,
            sessionCode: short,
            status: 'assigned'
        });
    } else {
        // اضافه به صف انتظار
        const queueItem = addToWaitingQueue(sessionId, session.userInfo, 'درخواست اتصال به اپراتور');
        
        const reply = `⏳ **شما به صف انتظار اضافه شدید**\n\n` +
                     `موقعیت شما در صف: **${queueItem.position}**\n` +
                     `${queueItem.position === 1 ? 'هیچکس قبل از شما نیست' : `${queueItem.position - 1} نفر قبل از شما`}\n` +
                     `⏱ زمان تخمینی: **${queueItem.estimatedWaitTime} دقیقه**\n\n` +
                     `کد جلسه شما: **${short}**\n` +
                     `به محض رسیدن نوبت، به شما اطلاع داده می‌شود.`;
        
        const systemMessage = {
            role: 'system',
            content: reply,
            from: 'سیستم صف',
            timestamp: new Date()
        };
        
        saveMessageToHistory(sessionId, systemMessage);
        session.messages.push(systemMessage);
        
        // ارسال وضعیت صف به کاربر
        sendQueueStatusToUser(sessionId, queueItem.position);
        
        return res.json({ 
            success: true, 
            message: reply,
            queuePosition: queueItem.position,
            estimatedWaitTime: queueItem.estimatedWaitTime,
            sessionCode: short,
            status: 'waiting_in_queue'
        });
    }
});

// ==================== سوکت ====================
io.on('connection', (socket) => {
    console.log('🔌 کاربر جدید متصل شد:', socket.id);
    
    socket.on('join-session', (sessionId) => {
        socket.join(sessionId);
        console.log(`📝 کاربر به سشن ${sessionId.substring(0, 12)} پیوست`);
        
        // ارسال تاریخچه چت قبلی
        const history = getFullChatHistory(sessionId);
        if (history.length > 0) {
            socket.emit('chat-history-loaded', {
                history: history.slice(-50)
            });
        }
        
        // بررسی و ارسال وضعیت صف
        const queueItem = waitingQueue.find(item => item.sessionId === sessionId);
        if (queueItem) {
            sendQueueStatusToUser(sessionId, queueItem.position);
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
    socket.on('user-file', async ({ sessionId, fileName, fileBase64, telegramBotToken, telegramChatId, caption }) => {
        const short = sessionId.substring(0, 12);
        const info = botSessions.get(short);
        
        if (info?.chatId) {
            try {
                const buffer = Buffer.from(fileBase64, 'base64');
                await bot.telegram.sendDocument(info.chatId, {
                    source: buffer,
                    filename: fileName
                }, {
                    caption: caption || `📎 **فایل ارسالی از کاربر**\n\n🔢 کد جلسه: ${short}`
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
    socket.on('user-voice', async ({ sessionId, voiceBase64, telegramBotToken, telegramChatId, caption }) => {
        const short = sessionId.substring(0, 12);
        const info = botSessions.get(short);
        
        if (info?.chatId) {
            try {
                const buffer = Buffer.from(voiceBase64, 'base64');
                await bot.telegram.sendVoice(info.chatId, {
                    source: buffer
                }, {
                    caption: caption || `🎤 **پیام صوتی از کاربر**\n\n🔢 کد جلسه: ${short}`
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

// تایمر برای بررسی وضعیت صف هر 30 ثانیه
setInterval(() => {
    processNextInQueue();
}, 30000);

// صفحه اصلی
app.get('/', (req, res) => {
    res.json({
        name: '✨ شیک‌پوشان - پشتیبانی هوشمند ✨',
        version: '9.0.0',
        status: 'آنلاین ✅',
        features: [
            'سیستم نوبت‌دهی هوشمند',
            'صف انتظار خودکار',
            'تخصیص هوشمند به اپراتور',
            'پیگیری وضعیت صف در لحظه',
            'چندین اپراتور همزمان',
            'مدیریت پیشرفته از تلگرام',
            'ذخیره تاریخچه کامل',
            'بارگذاری خودکار تاریخچه',
            'جستجوی هوشمند محصولات',
            'پیگیری سفارش',
            'ارسال فایل و پیام صوتی'
        ],
        queueStats: {
            waiting: waitingQueue.length,
            activeChats: Array.from(botSessions.values()).filter(s => s.status === 'connected').length,
            onlineOperators: Array.from(operatorStatus.values()).filter(op => op.isOnline).length
        },
        endpoints: {
            chat: 'POST /api/chat',
            connect: 'POST /api/connect-human',
            history: 'POST /api/chat-history',
            queue: 'GET /api/queue-status',
            operators: 'GET /api/operators-status',
            health: 'GET /api/health'
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
    console.log(`👨‍💼 اپراتورها: ${OPERATOR_TELEGRAM_IDS.length} نفر`);
    console.log(`📊 سیستم نوبت‌دهی: فعال ✅`);
    console.log(`⏳ صف انتظار: فعال ✅`);
    console.log(`💾 ذخیره تاریخچه: فعال ✅`);
    
    try {
        await bot.telegram.setWebhook(`https://ai-chat-support-production.up.railway.app/telegram-webhook`);
        console.log('✅ وب‌هوک تلگرام تنظیم شد');
        
        // اطلاع به همه اپراتورها
        OPERATOR_TELEGRAM_IDS.forEach(async (operatorId) => {
            try {
                await bot.telegram.sendMessage(operatorId,
                    `🤖 **سیستم پشتیبانی هوشمند فعال شد** ✨\n\n` +
                    `✅ سرور: https://ai-chat-support-production.up.railway.app\n` +
                    `✅ سیستم نوبت‌دهی: فعال\n` +
                    `✅ صف انتظار: فعال\n` +
                    `✅ اپراتورهای آنلاین: ${OPERATOR_TELEGRAM_IDS.length} نفر\n\n` +
                    `📝 **دستورات اصلی:**\n` +
                    `/status - وضعیت شما\n` +
                    `/queue - مشاهده صف\n` +
                    `/chats - چت‌های فعال\n` +
                    `/busy - مشغول شدم\n` +
                    `/free - آزاد شدم\n\n` +
                    `📅 تاریخ: ${new Date().toLocaleDateString('fa-IR')}\n` +
                    `🕐 زمان: ${new Date().toLocaleTimeString('fa-IR')}\n\n` +
                    `✨ سیستم آماده خدمات‌رسانی است!`
                );
            } catch (error) {
                console.log(`⚠️ خطا در اطلاع به اپراتور ${operatorId}:`, error.message);
            }
        });
        
    } catch (error) {
        console.log('⚠️ وب‌هوک خطا → Polling فعال شد');
        bot.launch();
    }
});

// تابع آزاد کردن اپراتور
function releaseOperatorFromChat(operatorId, sessionCode) {
    const operator = operatorStatus.get(operatorId);
    if (!operator) return;
    
    operator.activeChats = operator.activeChats.filter(chat => chat.sessionCode !== sessionCode);
    
    if (operator.activeChats.length === 0) {
        operator.isAvailable = true;
    } else if (operator.activeChats.length < operator.maxChats) {
        operator.isAvailable = true;
    }
    
    console.log(`✅ اپراتور ${operatorId} از چت ${sessionCode} آزاد شد`);
}
