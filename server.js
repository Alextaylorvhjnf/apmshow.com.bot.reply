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

// ==================== تنظیمات شیک‌پوشان ====================
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;

// آدرس API سایت شیک‌پوشان - این همانی است که شما دارید
const SHIKPOOSHAN_API_URL = 'https://shikpooshaan.ir/ai-shop-api.php';

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
        s = { 
            id, 
            messages: [], 
            userInfo: {}, 
            connectedToHuman: false, 
            preferences: {},
            searchHistory: [],
            lastSearch: null
        };
        cache.set(id, s);
    }
    return s;
};

// ==================== ارتباط با API شیک‌پوشان ====================
async function callShikpooshanAPI(action, data = {}) {
    try {
        console.log(`📡 درخواست به API شیک‌پوشان: ${action}`);
        
        const response = await axios.post(SHIKPOOSHAN_API_URL, {
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
        console.error(`❌ خطای API شیک‌پوشان (${action}):`, error.message);
        return { 
            error: true, 
            message: 'خطا در ارتباط با سایت شیک‌پوشان',
            details: error.message 
        };
    }
}

// ==================== تحلیل پیام هوشمند ====================
function analyzeMessage(message) {
    const lower = message.toLowerCase();
    
    // کد پیگیری
    const codeMatch = message.match(/\b(\d{4,20})\b/);
    if (codeMatch) return { type: 'tracking', code: codeMatch[1] };
    
    // تشخیص قیمت در پیام
    const priceMatch = message.match(/(\d+)\s*(هزار|میلیون|تومان)/);
    const exactPrice = message.match(/(\d[\d,]+)\s*(تومان|تومن)/);
    
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
    let minPrice = null;
    let maxPrice = null;
    
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
    
    // تشخیص قیمت
    if (priceMatch) {
        const value = parseInt(priceMatch[1]);
        const unit = priceMatch[2];
        
        if (unit.includes('میلیون')) {
            minPrice = value * 1000000;
        } else if (unit.includes('هزار')) {
            minPrice = value * 1000;
        } else {
            minPrice = value;
        }
    }
    
    if (exactPrice) {
        const priceStr = exactPrice[1].replace(/,/g, '');
        minPrice = parseInt(priceStr);
    }
    
    // اگر محصولی پیدا شد یا سوال قیمت/موجودی
    if (foundProductType || lower.includes('قیمت') || lower.includes('موجودی') || 
        lower.includes('خرید') || lower.includes('محصول') || lower.includes('دارید') ||
        lower.includes('هودی') || lower.includes('تیشرت') || lower.includes('شلوار')) {
        
        return { 
            type: 'product_search', 
            productType: foundProductType,
            sizes: foundSizes.length > 0 ? foundSizes : null,
            colors: foundColors.length > 0 ? foundColors : null,
            category: foundCategory,
            minPrice: minPrice,
            maxPrice: maxPrice,
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
    }
};

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
            searchParams.size = analysis.sizes[0];
        }
        
        if (analysis.colors) {
            searchParams.color = analysis.colors[0];
        }
        
        if (analysis.category) {
            searchParams.category = analysis.category;
        }
        
        if (analysis.minPrice) {
            searchParams.min_price = analysis.minPrice;
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
            cache.set(session.id, session);
        }
        
        // جستجوی پیشرفته در API
        console.log('🔍 جستجوی محصول با پارامترها:', searchParams);
        const result = await callShikpooshanAPI('search_product_advanced', searchParams);
        
        // اگر محصولی پیدا نشد
        if (result.error || !result.products || result.products.length === 0) {
            console.log('🔍 محصولی یافت نشد، جستجوی ساده‌تر...');
            
            // جستجوی فقط با کلمه کلیدی
            const simpleResult = await callShikpooshanAPI('search_product_advanced', {
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
            const popularResult = await callShikpooshanAPI('get_popular_products', { limit: 4 });
            
            return {
                success: false,
                products: popularResult.products || [],
                searchParams,
                message: 'محصولی با این مشخصات یافت نشد',
                suggestedAlternatives: true
            };
        }
        
        // به روز رسانی تاریخچه
        if (session.searchHistory && session.searchHistory.length > 0) {
            session.searchHistory[session.searchHistory.length - 1].found = true;
            cache.set(session.id, session);
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
        return `❌ **متأسفانه محصولی پیدا نکردم!**\n\n` +
               `✨ **می‌تونید:**\n` +
               `• نام دقیق‌تر محصول رو بگید\n` +
               `• از من بخواهید پیشنهاد بدم\n` +
               `• یا "اپراتور" رو برای کمک بیشتر تایپ کنید`;
    }
    
    let response = '';
    
    if (hasAlternatives) {
        response += `❌ **"${searchParams.keyword || 'این محصول'}" پیدا نکردم!**\n\n`;
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
        if (searchParams.min_price) {
            response += `💰 **حداکثر قیمت:** ${Number(searchParams.min_price).toLocaleString('fa-IR')} تومان\n`;
        }
        
        if (searchParams.size || searchParams.color || searchParams.category || searchParams.min_price) {
            response += '\n';
        }
    }
    
    // نمایش محصولات
    products.forEach((product, index) => {
        response += `**${index + 1}. ${product.name || product.title}**\n`;
        
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
        
        if (product.attributes && product.attributes.length > 0) {
            response += `   🏷️ **ویژگی‌ها:** ${product.attributes.join(', ')}\n`;
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

bot.action(/accept_(.+)/, async (ctx) => {
    const short = ctx.match[1];
    const info = botSessions.get(short);
    
    if (!info) return ctx.answerCbQuery('منقضی شده');
    
    botSessions.set(short, { ...info, chatId: ctx.chat.id });
    getSession(info.fullId).connectedToHuman = true;
    
    await ctx.answerCbQuery('پذیرفته شد');
    
    await ctx.editMessageText(`🎯 **شما این گفتگو را پذیرفتید**\n\n` +
                             `👤 کاربر: ${info.userInfo?.name || 'ناشناس'}\n` +
                             `📄 صفحه: ${info.userInfo?.page || 'نامشخص'}\n` +
                             `🔢 کد جلسه: ${short}`);
    
    io.to(info.fullId).emit('operator-connected', {
        message: '🎉 **اپراتور انسانی متصل شد!**\n\nلطفاً سوال یا درخواست خود را با جزئیات مطرح کنید. 😊'
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
    
    io.to(info.fullId).emit('operator-message', { 
        message: ctx.message.text,
        from: 'اپراتور'
    });
    
    await ctx.reply('✅ پیام شما ارسال شد.');
});

app.post('/telegram-webhook', (req, res) => bot.handleUpdate(req.body, res));

// ==================== مسیرهای API ====================

// تست سلامت
app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        time: new Date().toLocaleString('fa-IR'),
        api: SHIKPOOSHAN_API_URL,
        sessions: cache.keys().length,
        site: 'شیک‌پوشان'
    });
});

// تست API سایت
app.get('/api/test-api', async (req, res) => {
    try {
        const result = await callShikpooshanAPI('health_check', {});
        res.json({
            success: true,
            api: SHIKPOOSHAN_API_URL,
            response: result,
            site: 'شیک‌پوشان'
        });
    } catch (error) {
        res.json({
            success: false,
            error: error.message,
            api: SHIKPOOSHAN_API_URL,
            site: 'شیک‌پوشان'
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
        
        session.messages.push({ 
            role: 'user', 
            content: message,
            timestamp: new Date() 
        });
        
        const analysis = analyzeMessage(message);
        
        // ذخیره ترجیحات
        if (analysis.productType) {
            session.preferences.lastProductType = analysis.productType;
            session.lastSearch = {
                type: analysis.productType,
                timestamp: new Date()
            };
            cache.set(sessionId, session);
        }
        
        // ========== پیگیری سفارش ==========
        if (analysis.type === 'tracking') {
            const apiResult = await callShikpooshanAPI('track_order', {
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
                
                session.messages.push({ role: 'assistant', content: reply });
                cache.set(sessionId, session);
                return res.json({ success: true, message: reply });
                
            } else {
                const reply = `❌ **سفارشی با این کد پیدا نشد!**\n\n` +
                             `کد **${analysis.code}** در سیستم ما ثبت نیست.\n\n` +
                             `💡 **راهنمایی:**\n` +
                             `• کد را دوباره بررسی کنید\n` +
                             `• ممکن است سفارش هنوز ثبت نشده باشد\n` +
                             `• برای بررسی دقیق‌تر، "اپراتور" را تایپ کنید`;
                
                session.messages.push({ role: 'assistant', content: reply });
                cache.set(sessionId, session);
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
            if (analysis.minPrice) details.push(`حداکثر قیمت: ${Number(analysis.minPrice).toLocaleString('fa-IR')} تومان`);
            
            if (details.length > 0) {
                searchingMsg += details.join(' | ') + '\n\n';
            }
            
            searchingMsg += `لطفاً کمی صبر کنید... ⏳`;
            
            session.messages.push({ role: 'assistant', content: searchingMsg });
            cache.set(sessionId, session);
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
                    
                    session.messages.push({ role: 'assistant', content: productReply });
                    cache.set(sessionId, session);
                    
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
                    
                    session.messages.push({ role: 'assistant', content: errorReply });
                    cache.set(sessionId, session);
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
            session.messages.push({ role: 'assistant', content: prompt });
            cache.set(sessionId, session);
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
            
            session.messages.push({ role: 'assistant', content: reply });
            cache.set(sessionId, session);
            return res.json({ success: true, message: reply });
        }
        
        // ========== تشکر ==========
        if (analysis.type === 'thanks') {
            const reply = `${responses.thanks()}\n\n` +
                         `**امر دیگری هست که بتونم کمکتون کنم؟** 🌸\n\n` +
                         `همیشه در خدمت شما هستم!`;
            
            session.messages.push({ role: 'assistant', content: reply });
            cache.set(sessionId, session);
            return res.json({ success: true, message: reply });
        }
        
        // ========== اپراتور ==========
        if (analysis.type === 'operator') {
            const short = sessionId.substring(0, 12);
            botSessions.set(short, {
                fullId: sessionId,
                userInfo: session.userInfo || {},
                chatId: null,
                createdAt: new Date()
            });
            
            // اطلاع به تلگرام
            if (ADMIN_TELEGRAM_ID) {
                await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, 
                    `🔔 **درخواست اتصال به اپراتور**\n\n` +
                    `👤 نام: ${session.userInfo?.name || 'ناشناس'}\n` +
                    `📄 صفحه: ${session.userInfo?.page || 'نامشخص'}\n` +
                    `🔢 کد جلسه: ${short}\n` +
                    `💬 آخرین پیام: ${message.substring(0, 50)}...\n\n` +
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
            }
            
            const reply = `✅ **درخواست شما ثبت شد!**\n\n` +
                         `کارشناسان ما در تلگرام مطلع شدند و به زودی با شما ارتباط برقرار می‌کنند.\n\n` +
                         `⏳ **لطفاً منتظر بمانید...**\n` +
                         `کد جلسه شما: **${short}**`;
            
            session.messages.push({ role: 'assistant', content: reply });
            cache.set(sessionId, session);
            return res.json({ success: true, message: reply });
        }
        
        // ========== پاسخ پیش‌فرض هوشمند ==========
        if (session.lastSearch) {
            const reply = `🤔 **متوجه پیامتون شدم!**\n\n` +
                         `آیا دنبال محصولاتی مثل **"${session.lastSearch.type}"** هستید؟\n\n` +
                         `✨ **می‌تونید:**\n` +
                         `• نام دقیق محصول رو بگید\n` +
                         `• "پیشنهاد" رو برای دیدن محصولات ویژه تایپ کنید\n` +
                         `• کد پیگیری سفارش رو وارد کنید\n` +
                         `• یا "اپراتور" رو برای کمک بیشتر تایپ کنید`;
            
            session.messages.push({ role: 'assistant', content: reply });
            cache.set(sessionId, session);
            return res.json({ success: true, message: reply });
        }
        
        // پاسخ نهایی
        const finalReply = `🌈 **سلام! خوش اومدید به شیک‌پوشان!**\n\n` +
                          `من دستیار هوشمند شیک‌پوشان هستم و اینجا هستم تا کمکتون کنم:\n\n` +
                          `✨ **می‌تونم:**\n` +
                          `• پیگیری سفارش با کد رهگیری 📦\n` +
                          `• جستجوی محصولات با رنگ و سایز 🔍\n` +
                          `• پیشنهاد محصولات ویژه 🎁\n` +
                          `• اتصال به اپراتور انسانی 👤\n\n` +
                          `**لطفاً انتخاب کنید:**\n` +
                          `"کد پیگیری" ، "جستجو" ، "پیشنهاد" یا "اپراتور"`;
        
        session.messages.push({ role: 'assistant', content: finalReply });
        cache.set(sessionId, session);
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
        const result = await callShikpooshanAPI('get_categories', {});
        res.json(result);
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// محصولات پرفروش
app.get('/api/popular-products', async (req, res) => {
    try {
        const limit = req.query.limit || 6;
        const result = await callShikpooshanAPI('get_popular_products', { limit });
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
    if (ADMIN_TELEGRAM_ID) {
        await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, 
            `🔔 **درخواست اتصال جدید**\n\n` +
            `👤 کاربر: ${session.userInfo?.name || 'ناشناس'}\n` +
            `📄 صفحه: ${session.userInfo?.page || 'نامشخص'}\n` +
            `🔢 کد: ${short}\n\n` +
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
    }
    
    res.json({ 
        success: true, 
        pending: true,
        message: 'درخواست شما برای اتصال به اپراتور ثبت شد. لطفاً منتظر بمانید...',
        sessionCode: short
    });
});

// ==================== سوکت ====================
io.on('connection', (socket) => {
    console.log('🔌 کاربر جدید متصل شد:', socket.id);
    
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
                `💬 **پیام جدید از کاربر**\n\n` +
                `👤 کد جلسه: ${short}\n` +
                `📝 پیام:\n${message}\n\n` +
                `🕐 ${new Date().toLocaleTimeString('fa-IR')}`);
        }
    });
});

// صفحه اصلی
app.get('/', (req, res) => {
    res.json({
        name: '✨ شیک‌پوشان - پشتیبانی هوشمند ✨',
        version: '5.0.0',
        status: 'آنلاین ✅',
        site: 'shikpooshaan.ir',
        api_url: SHIKPOOSHAN_API_URL,
        features: [
            'پیگیری سفارش با کد رهگیری',
            'جستجوی هوشمند محصولات با فیلترهای پیشرفته',
            'تشخیص خودکار رنگ، سایز و دسته‌بندی',
            'پیشنهادات هوشمند بر اساس تاریخچه',
            'اتصال به اپراتور انسانی'
        ],
        endpoints: {
            chat: 'POST /api/chat',
            connect: 'POST /api/connect-human',
            categories: 'GET /api/categories',
            popular: 'GET /api/popular-products',
            health: 'GET /api/health',
            test: 'GET /api/test-api'
        },
        message: 'خوش آمدید به سیستم پشتیبانی هوشمند شیک‌پوشان! 🌸'
    });
});

// ==================== راه‌اندازی ====================
server.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 سرور روی پورت ${PORT} فعال شد`);
    console.log(`🌐 سایت: شیک‌پوشان (shikpooshaan.ir)`);
    console.log(`📡 API: ${SHIKPOOSHAN_API_URL}`);
    console.log(`🤖 تلگرام: ${TELEGRAM_BOT_TOKEN ? 'فعال ✅' : 'غیرفعال ❌'}`);
    
    try {
        if (TELEGRAM_BOT_TOKEN) {
            await bot.telegram.setWebhook(`https://ai-chat-support-production.up.railway.app/telegram-webhook`);
            console.log('✅ وب‌هوک تلگرام تنظیم شد');
            
            if (ADMIN_TELEGRAM_ID) {
                await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, 
                    `🤖 **سیستم پشتیبانی هوشمند شیک‌پوشان فعال شد** ✨\n\n` +
                    `✅ سرور: https://ai-chat-support-production.up.railway.app\n` +
                    `✅ API: ${SHIKPOOSHAN_API_URL}\n` +
                    `✅ جستجوی هوشمند: فعال\n` +
                    `✅ سیستم اپراتور: فعال\n\n` +
                    `📅 تاریخ: ${new Date().toLocaleDateString('fa-IR')}\n` +
                    `🕐 زمان: ${new Date().toLocaleTimeString('fa-IR')}\n\n` +
                    `✨ سیستم آماده خدمات‌رسانی است!`);
            }
        }
        
    } catch (error) {
        console.log('⚠️ وب‌هوک خطا → Polling فعال شد');
        if (TELEGRAM_BOT_TOKEN) {
            bot.launch();
        }
    }
});
