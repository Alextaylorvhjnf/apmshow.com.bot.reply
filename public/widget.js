const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const helmet = require('helmet');
const axios = require('axios');
const NodeCache = require('node-cache');
const { Telegraf, Markup } = require('telegraf');
require('dotenv').config();

// ==================== تنظیمات ====================
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = Number(process.env.ADMIN_TELEGRAM_ID);
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

// ==================== کش و نشست‌ها ====================
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
            pendingFiles: [],
            pendingVoices: []
        };
        cache.set(id, s);
    }
    return s;
};

// ==================== تحلیل پیام هوشمند ====================
function analyzeMessage(message) {
    const lower = message.toLowerCase();
    
    const codeMatch = message.match(/\b(\d{4,20})\b/);
    if (codeMatch) return { type: 'tracking', code: codeMatch[1] };
    
    const productTypes = {
        'تیشرت': ['تیشرت', 'تی‌شرت', 't-shirt'],
        'هودی': ['هودی', 'هودي', 'hoodie'],
        'پیراهن': ['پیراهن', 'پیرهن'],
        'شلوار': ['شلوار', 'شلور', 'pants'],
        'کت': ['کت', 'coat', 'jacket'],
        'دامن': ['دامن', 'skirt'],
        'کفش': ['کفش', 'shoe', 'کف'],
        'اکسسوری': ['اکسسوری', 'اکسسوري', 'accessory']
    };
    
    const sizePatterns = {
        'اسمال': ['اسمال', 'small', 's'],
        'مدیوم': ['مدیوم', 'medium', 'm'],
        'لارج': ['لارج', 'large', 'l'],
        'اکسترا': ['اکسترا', 'xl', 'xxl', '2xl']
    };
    
    const colorKeywords = [
        'قرمز', 'آبی', 'سبز', 'مشکی', 'سفید', 'خاکستری', 'بنفش', 
        'صورتی', 'نارنجی', 'زرد', 'قهوه‌ای', 'بژ', 'طلایی'
    ];
    
    const categoryKeywords = [
        'مردانه', 'زنانه', 'بچگانه', 'پسرانه', 'دخترانه', 
        'تابستانی', 'زمستانی', 'رسمی', 'اسپرت'
    ];
    
    let foundProductType = null;
    let foundSizes = [];
    let foundColors = [];
    let foundCategory = null;
    
    for (const [type, keywords] of Object.entries(productTypes)) {
        for (const keyword of keywords) {
            if (lower.includes(keyword)) {
                foundProductType = type;
                break;
            }
        }
        if (foundProductType) break;
    }
    
    for (const [size, patterns] of Object.entries(sizePatterns)) {
        for (const pattern of patterns) {
            if (lower.includes(pattern.toLowerCase())) {
                foundSizes.push(size);
                break;
            }
        }
    }
    
    for (const color of colorKeywords) {
        if (lower.includes(color)) {
            foundColors.push(color);
        }
    }
    
    for (const category of categoryKeywords) {
        if (lower.includes(category)) {
            foundCategory = category;
            break;
        }
    }
    
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
    
    if (lower.includes('پیشنهاد') || lower.includes('پیشنهادی') || 
        lower.includes('چی پیشنهاد')) {
        return { type: 'suggestion' };
    }
    
    if (/^(سلام|درود|هلو|سلامتی|عصر بخیر|صبح بخیر)/.test(lower)) {
        return { type: 'greeting' };
    }
    
    if (lower.includes('ممنون') || lower.includes('مرسی') || lower.includes('متشکرم')) {
        return { type: 'thanks' };
    }
    
    if (lower.includes('اپراتور') || lower.includes('انسان') || lower.includes('پشتیبان')) {
        return { type: 'operator' };
    }
    
    return { type: 'general' };
}

// ==================== ارتباط با API سایت ====================
async function callShopAPI(action, data = {}) {
    try {
        console.log(`📡 درخواست به API: ${action}`, data);
        
        const response = await axios.post(SHOP_API_URL, {
            ...data,
            action
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
        
        const result = await callShopAPI('search_product_advanced', searchParams);
        
        if (result.error || !result.products || result.products.length === 0) {
            const simpleResult = await callShopAPI('search_product', {
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
            
            return {
                success: false,
                products: [],
                searchParams,
                message: 'محصولی با این مشخصات یافت نشد'
            };
        }
        
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
function generateProductResponse(products, searchParams) {
    if (!products || products.length === 0) {
        return `❌ **متأسفانه "${searchParams.keyword || 'این محصول'}" پیدا نکردم!**\n\n` +
               `✨ **می‌تونید:**\n` +
               `• نام دقیق‌تر محصول رو بگید\n` +
               `• از من بخواهید پیشنهاد بدم\n` +
               `• یا "اپراتور" رو برای کمک بیشتر تایپ کنید`;
    }
    
    let response = `🎯 **${products.length} محصول مرتبط پیدا کردم!** ✨\n\n`;
    
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
    
    products.forEach((product, index) => {
        response += `**${index + 1}. ${product.name}**\n`;
        
        if (product.price) {
            const price = Number(product.price).toLocaleString('fa-IR');
            response += `   💰 **قیمت:** ${price} تومان\n`;
        }
        
        if (product.stock) {
            const stockEmoji = product.stock.includes('موجود') ? '✅' : '❌';
            response += `   📦 **موجودی:** ${stockEmoji} ${product.stock}\n`;
        }
        
        if (product.sku) {
            response += `   🏷️ **کد:** ${product.sku}\n`;
        }
        
        if (product.url) {
            response += `   🔗 **لینک:** ${product.url}\n`;
        }
        
        response += '\n';
    });
    
    response += `💡 **راهنمایی:**\n`;
    response += `برای اطلاعات بیشتر، شماره محصول رو بنویسید (مثلاً "محصول 1")\n`;
    response += `یا "پیشنهاد" رو برای دیدن محصولات ویژه تایپ کنید`;
    
    return response;
}

// ==================== دکمه‌های کیبورد تلگرام ====================
const operatorKeyboard = Markup.keyboard([
    ['📁 ارسال فایل', '🎤 ارسال ویس'],
    ['📸 ارسال عکس'],
    ['🔚 پایان گفتگو']
]).resize();

const welcomeKeyboard = Markup.keyboard([
    ['🔍 جستجوی محصول', '📦 پیگیری سفارش'],
    ['🎁 پیشنهاد محصول', '👨‍💼 صحبت با اپراتور']
]).resize();

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
                             `🌐 صفحه: ${info.userInfo?.page || 'نامشخص'}\n` +
                             `🔢 کد جلسه: ${short}\n\n` +
                             `📝 **لینک صفحه کاربر:**\n${info.userInfo?.pageUrl || 'نامشخص'}\n\n` +
                             `✨ **برای ارسال فایل/ویس/عکس:**\n` +
                             `• فایل را آپلود کنید 📁\n` +
                             `• پیام صوتی ضبط کنید 🎤\n` +
                             `• عکس آپلود کنید 📸\n` +
                             `• یا از دکمه‌های پایین استفاده کنید`,
        {
            ...operatorKeyboard,
            parse_mode: 'Markdown'
        }
    );
    
    io.to(info.fullId).emit('operator-connected', {
        message: '🎉 **اپراتور انسانی متصل شد!**\n\nلطفاً سوال یا درخواست خود را مطرح کنید. 😊\n\n📌 *اپراتور می‌تواند فایل، ویس و عکس برای شما ارسال کند.*'
    });
});

bot.action(/reject_(.+)/, async (ctx) => {
    const short = ctx.match[1];
    botSessions.delete(short);
    await ctx.answerCbQuery('رد شد');
});

// ==================== پردازش پیام‌های اپراتور ====================

// پیام متنی
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    
    // اگر دستور است
    if (text.startsWith('/')) return;
    
    // بررسی دکمه‌های کیبورد
    if (text === '🔚 پایان گفتگو') {
        const entry = [...botSessions.entries()].find(([_, v]) => v.chatId === ctx.chat.id);
        if (!entry) return;
        
        const [short, info] = entry;
        
        io.to(info.fullId).emit('operator-ended', {
            message: '👋 **گفتگو با اپراتور به پایان رسید.**\n\nاگر سوال دیگری دارید، دوباره با من صحبت کنید! 😊'
        });
        
        botSessions.delete(short);
        getSession(info.fullId).connectedToHuman = false;
        
        await ctx.reply('✅ گفتگو با کاربر به پایان رسید.', {
            reply_markup: { remove_keyboard: true }
        });
        return;
    }
    
    // اگر دکمه راهنما فشرده شد
    if (text === '📁 ارسال فایل' || text === '🎤 ارسال ویس' || text === '📸 ارسال عکس') {
        await ctx.reply(`✅ برای ارسال ${text.includes('فایل') ? 'فایل' : text.includes('ویس') ? 'پیام صوتی' : 'عکس'}، لطفاً آن را آپلود کنید.`, {
            ...operatorKeyboard
        });
        return;
    }
    
    // پیام عادی
    const entry = [...botSessions.entries()].find(([_, v]) => v.chatId === ctx.chat.id);
    if (!entry) return;
    
    const [short, info] = entry;
    
    io.to(info.fullId).emit('operator-message', { 
        message: text,
        from: 'اپراتور',
        type: 'text'
    });
    
    await ctx.reply('✅ پیام شما ارسال شد.', {
        ...operatorKeyboard
    });
});

// فایل
bot.on('document', async (ctx) => {
    const entry = [...botSessions.entries()].find(([_, v]) => v.chatId === ctx.chat.id);
    if (!entry) return;
    
    const [short, info] = entry;
    const document = ctx.message.document;
    
    try {
        const fileLink = await ctx.telegram.getFileLink(document.file_id);
        const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
        const fileBuffer = Buffer.from(response.data);
        const fileBase64 = fileBuffer.toString('base64');
        
        io.to(info.fullId).emit('operator-file', {
            fileName: document.file_name || 'فایل',
            fileBase64: fileBase64,
            fileSize: document.file_size,
            mimeType: document.mime_type,
            from: 'اپراتور'
        });
        
        await ctx.reply(`✅ فایل "${document.file_name || 'فایل'}" ارسال شد.`, {
            ...operatorKeyboard
        });
        
    } catch (error) {
        console.error('❌ خطا در ارسال فایل از اپراتور:', error);
        await ctx.reply('❌ خطا در ارسال فایل. لطفاً دوباره تلاش کنید.', {
            ...operatorKeyboard
        });
    }
});

// ویس
bot.on('voice', async (ctx) => {
    const entry = [...botSessions.entries()].find(([_, v]) => v.chatId === ctx.chat.id);
    if (!entry) return;
    
    const [short, info] = entry;
    const voice = ctx.message.voice;
    
    try {
        const fileLink = await ctx.telegram.getFileLink(voice.file_id);
        const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
        const voiceBuffer = Buffer.from(response.data);
        const voiceBase64 = voiceBuffer.toString('base64');
        
        io.to(info.fullId).emit('operator-voice', {
            voiceBase64: voiceBase64,
            duration: voice.duration,
            from: 'اپراتور'
        });
        
        await ctx.reply(`✅ پیام صوتی ارسال شد (${voice.duration} ثانیه).`, {
            ...operatorKeyboard
        });
        
    } catch (error) {
        console.error('❌ خطا در ارسال پیام صوتی از اپراتور:', error);
        await ctx.reply('❌ خطا در ارسال پیام صوتی. لطفاً دوباره تلاش کنید.', {
            ...operatorKeyboard
        });
    }
});

// عکس
bot.on('photo', async (ctx) => {
    const entry = [...botSessions.entries()].find(([_, v]) => v.chatId === ctx.chat.id);
    if (!entry) return;
    
    const [short, info] = entry;
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    
    try {
        const fileLink = await ctx.telegram.getFileLink(photo.file_id);
        const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
        const photoBuffer = Buffer.from(response.data);
        const photoBase64 = photoBuffer.toString('base64');
        
        io.to(info.fullId).emit('operator-file', {
            fileName: 'عکس.jpg',
            fileBase64: photoBase64,
            fileSize: photo.file_size,
            mimeType: 'image/jpeg',
            from: 'اپراتور',
            isPhoto: true
        });
        
        await ctx.reply('✅ عکس ارسال شد.', {
            ...operatorKeyboard
        });
        
    } catch (error) {
        console.error('❌ خطا در ارسال عکس از اپراتور:', error);
        await ctx.reply('❌ خطا در ارسال عکس. لطفاً دوباره تلاش کنید.', {
            ...operatorKeyboard
        });
    }
});

// دستور /end
bot.command('end', async (ctx) => {
    const entry = [...botSessions.entries()].find(([_, v]) => v.chatId === ctx.chat.id);
    if (!entry) return;
    
    const [short, info] = entry;
    
    io.to(info.fullId).emit('operator-ended', {
        message: '👋 **گفتگو با اپراتور به پایان رسید.**\n\nاگر سوال دیگری دارید، دوباره با من صحبت کنید! 😊'
    });
    
    botSessions.delete(short);
    getSession(info.fullId).connectedToHuman = false;
    
    await ctx.reply('✅ گفتگو با کاربر به پایان رسید.', {
        reply_markup: { remove_keyboard: true }
    });
});

// دستور /start برای اپراتورها
bot.command('start', async (ctx) => {
    await ctx.reply('👨‍💼 **پنل اپراتور پشتیبانی شیک‌پوشان**\n\n' +
                   'منتظر درخواست‌های کاربران باشید.\n' +
                   'هنگامی که درخواستی دریافت شد، می‌توانید آن را بپذیرید.', {
        ...Markup.keyboard([
            ['📊 وضعیت سیستم']
        ]).resize()
    });
});

// دستور وضعیت سیستم
bot.command('status', async (ctx) => {
    const activeSessions = botSessions.size;
    const totalSessions = cache.keys().length;
    
    await ctx.reply(`📊 **وضعیت سیستم:**\n\n` +
                   `✅ سرور: آنلاین\n` +
                   `👥 اپراتورهای فعال: ${activeSessions}\n` +
                   `💬 سشن‌های کل: ${totalSessions}\n` +
                   `🛍️ API: ${SHOP_API_URL}`);
});

app.post('/telegram-webhook', (req, res) => bot.handleUpdate(req.body, res));

// ==================== مسیرهای API ====================

app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        time: new Date().toLocaleString('fa-IR'),
        api: SHOP_API_URL,
        sessions: cache.keys().length,
        active_operators: botSessions.size
    });
});

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

app.get('/api/categories', async (req, res) => {
    try {
        const result = await callShopAPI('get_categories', {});
        res.json(result);
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.get('/api/popular-products', async (req, res) => {
    try {
        const limit = req.query.limit || 6;
        const result = await callShopAPI('get_popular_products', { limit });
        res.json(result);
    } catch (error) {
        res.json({ success: false, error: error.message });
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
            session.userInfo = { 
                ...session.userInfo, 
                ...userInfo,
                pageUrl: userInfo.pageUrl || session.userInfo?.pageUrl || 'نامشخص'
            };
        }
        
        session.messages.push({ 
            role: 'user', 
            content: message,
            timestamp: new Date() 
        });
        
        const analysis = analyzeMessage(message);
        
        if (analysis.productType) {
            session.preferences.lastProductType = analysis.productType;
            session.preferences.lastSearch = {
                type: analysis.productType,
                timestamp: new Date()
            };
        }
        
        // پیگیری سفارش
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
                             `${order.items.map(item => `• ${item.name}`).join('\n')}\n\n` +
                             `✅ **پیگیری شما کامل شد!**\n` +
                             `اگر سوال دیگری دارید، با کمال میل در خدمتتونم. 😊`;
                
                session.messages.push({ role: 'assistant', content: reply });
                return res.json({ success: true, message: reply });
                
            } else {
                const reply = `❌ **سفارشی با این کد پیدا نشد!**\n\n` +
                             `کد **${analysis.code}** در سیستم ما ثبت نیست.\n\n` +
                             `💡 **راهنمایی:**\n` +
                             `• کد را دوباره بررسی کنید\n` +
                             `• ممکن است سفارش هنوز ثبت نشده باشد\n` +
                             `• برای بررسی دقیق‌تر، "اپراتور" را تایپ کنید`;
                
                session.messages.push({ role: 'assistant', content: reply });
                return res.json({ success: true, message: reply });
            }
        }
        
        // جستجوی محصول
        if (analysis.type === 'product_search') {
            const searchingMsg = `🔍 **در حال جستجوی دقیق برای شما...**\n\n`;
            
            let details = [];
            if (analysis.productType) details.push(`نوع: ${analysis.productType}`);
            if (analysis.sizes) details.push(`سایز: ${analysis.sizes.join(', ')}`);
            if (analysis.colors) details.push(`رنگ: ${analysis.colors.join(', ')}`);
            if (analysis.category) details.push(`دسته: ${analysis.category}`);
            
            const finalMsg = searchingMsg + (details.length > 0 ? details.join(' | ') + '\n\n' : '') + `لطفاً کمی صبر کنید... ⏳`;
            
            session.messages.push({ role: 'assistant', content: finalMsg });
            res.json({ success: true, message: finalMsg, searching: true });
            
            setTimeout(async () => {
                try {
                    const searchResult = await smartProductSearch(analysis, session);
                    
                    const productReply = generateProductResponse(
                        searchResult.products,
                        searchResult.searchParams
                    );
                    
                    session.messages.push({ role: 'assistant', content: productReply });
                    
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
                    io.to(sessionId).emit('ai-message', {
                        message: errorReply,
                        type: 'error'
                    });
                }
            }, 100);
            
            return;
        }
        
        // پیشنهاد
        if (analysis.type === 'suggestion') {
            const prompt = `🎁 **عالی! دوست دارید چه نوع محصولی رو پیشنهاد بدم؟**\n\n` +
                         `مثلاً:\n` +
                         `• تیشرت‌های جدید\n` +
                         `• هودی‌های فصل\n` +
                         `• شلوارهای جین\n` +
                         `• کت‌های زمستانی\n` +
                         `• یا هر چیزی که دلتون بخواد!`;
            
            session.messages.push({ role: 'assistant', content: prompt });
            return res.json({ success: true, message: prompt });
        }
        
        // سلام
        if (analysis.type === 'greeting') {
            const greetings = [
                "سلام عزیزم! 🌸✨ چه خوشحالم که پیدات کردم! امروز چطورید؟",
                "درود بر شما! 🌟 روز خوبی داشته باشید! خوش آمدید به شیک‌پوشان.",
                "سلام قشنگم! 💖 انرژی مثبت براتون میفرستم! امیدوارم روز عالی داشته باشید."
            ];
            const greeting = greetings[Math.floor(Math.random() * greetings.length)];
            
            const reply = `${greeting}\n\n` +
                         `**چطور می‌تونم کمکتون کنم؟** 🤗\n\n` +
                         `می‌تونید:\n` +
                         `• کد پیگیری سفارش رو وارد کنید 📦\n` +
                         `• محصول خاصی رو جستجو کنید 🔍\n` +
                         `• از من بخواهید پیشنهاد بدم 🎁\n` +
                         `• یا برای صحبت با "اپراتور" بنویسید 👤`;
            
            session.messages.push({ role: 'assistant', content: reply });
            return res.json({ success: true, message: reply });
        }
        
        // تشکر
        if (analysis.type === 'thanks') {
            const thanks = [
                "خواهش می‌کنم عزیزم! 🤗 خوشحالم که تونستم کمک کنم.",
                "قربونت برم! 💝 همیشه در خدمت شما هستم.",
                "چشم قشنگم! 🌸 هر زمان که نیاز داشتین، در کنارتونم."
            ];
            const thankMsg = thanks[Math.floor(Math.random() * thanks.length)];
            
            const reply = `${thankMsg}\n\n` +
                         `**امر دیگری هست که بتونم کمکتون کنم؟** 🌸\n\n` +
                         `همیشه در خدمت شما هستم!`;
            
            session.messages.push({ role: 'assistant', content: reply });
            return res.json({ success: true, message: reply });
        }
        
        // اپراتور
        if (analysis.type === 'operator') {
            const short = sessionId.substring(0, 12);
            botSessions.set(short, {
                fullId: sessionId,
                userInfo: session.userInfo || {},
                chatId: null,
                createdAt: new Date()
            });
            
            await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, 
                `🔔 **درخواست اتصال به اپراتور**\n\n` +
                `👤 **نام:** ${session.userInfo?.name || 'ناشناس'}\n` +
                `📧 **ایمیل:** ${session.userInfo?.email || 'نامشخص'}\n` +
                `📱 **موبایل:** ${session.userInfo?.phone || 'نامشخص'}\n` +
                `🌐 **صفحه:** ${session.userInfo?.page || 'نامشخص'}\n` +
                `🔗 **لینک صفحه:** ${session.userInfo?.pageUrl || 'نامشخص'}\n` +
                `🔢 **کد جلسه:** ${short}\n` +
                `💬 **آخرین پیام:** ${message.substring(0, 100)}...\n\n` +
                `🕐 **زمان:** ${new Date().toLocaleTimeString('fa-IR')}\n` +
                `📅 **تاریخ:** ${new Date().toLocaleDateString('fa-IR')}`,
                {
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '✅ پذیرش درخواست', callback_data: `accept_${short}` },
                            { text: '❌ رد درخواست', callback_data: `reject_${short}` }
                        ]]
                    }
                }
            );
            
            const reply = `✅ **درخواست شما ثبت شد!**\n\n` +
                         `کارشناسان ما در تلگرام مطلع شدند و به زودی با شما ارتباط برقرار می‌کنند.\n\n` +
                         `⏳ **لطفاً منتظر بمانید...**\n` +
                         `کد جلسه شما: **${short}**\n\n` +
                         `📌 *اپراتور می‌تواند فایل، ویس و عکس برای شما ارسال کند.*`;
            
            session.messages.push({ role: 'assistant', content: reply });
            return res.json({ success: true, message: reply });
        }
        
        // پاسخ پیش‌فرض
        const finalReply = `🌈 **سلام! خوش اومدید!**\n\n` +
                          `من دستیار هوشمند شیک‌پوشان هستم و اینجا هستم تا کمکتون کنم:\n\n` +
                          `✨ **می‌تونم:**\n` +
                          `• پیگیری سفارش با کد رهگیری 📦\n` +
                          `• جستجوی محصولات با رنگ و سایز 🔍\n` +
                          `• پیشنهاد محصولات ویژه 🎁\n` +
                          `• اتصال به اپراتور انسانی 👤\n\n` +
                          `**لطفاً انتخاب کنید:**\n` +
                          `"کد پیگیری" ، "جستجو" ، "پیشنهاد" یا "اپراتور"`;
        
        session.messages.push({ role: 'assistant', content: finalReply });
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
        session.userInfo = { 
            ...session.userInfo, 
            ...userInfo,
            pageUrl: userInfo.pageUrl || session.userInfo?.pageUrl || 'نامشخص'
        };
    }
    
    const short = sessionId.substring(0, 12);
    botSessions.set(short, {
        fullId: sessionId,
        userInfo: session.userInfo,
        chatId: null,
        createdAt: new Date()
    });
    
    await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, 
        `🔔 **درخواست اتصال جدید**\n\n` +
        `👤 **کاربر:** ${session.userInfo?.name || 'ناشناس'}\n` +
        `📧 **ایمیل:** ${session.userInfo?.email || 'نامشخص'}\n` +
        `📱 **موبایل:** ${session.userInfo?.phone || 'نامشخص'}\n` +
        `🌐 **صفحه:** ${session.userInfo?.page || 'نامشخص'}\n` +
        `🔗 **لینک صفحه:** ${session.userInfo?.pageUrl || 'نامشخص'}\n` +
        `🔢 **کد:** ${short}\n\n` +
        `🕐 **زمان:** ${new Date().toLocaleTimeString('fa-IR')}\n` +
        `📅 **تاریخ:** ${new Date().toLocaleDateString('fa-IR')}`,
        {
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ پذیرش درخواست', callback_data: `accept_${short}` },
                    { text: '❌ رد درخواست', callback_data: `reject_${short}` }
                ]]
            }
        }
    );
    
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
                `👤 **کاربر:** ${info.userInfo?.name || 'ناشناس'}\n` +
                `🌐 **صفحه:** ${info.userInfo?.page || 'نامشخص'}\n` +
                `🔗 **لینک صفحه:** ${info.userInfo?.pageUrl || 'نامشخص'}\n` +
                `🔢 **کد جلسه:** ${short}\n` +
                `📝 **پیام:**\n${message}\n\n` +
                `🕐 **زمان:** ${new Date().toLocaleTimeString('fa-IR')}\n` +
                `📅 **تاریخ:** ${new Date().toLocaleDateString('fa-IR')}`);
        }
    });
    
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
                            `👤 **کاربر:** ${info.userInfo?.name || 'ناشناس'}\n` +
                            `🌐 **صفحه:** ${info.userInfo?.page || 'نامشخص'}\n` +
                            `🔗 **لینک صفحه:** ${info.userInfo?.pageUrl || 'نامشخص'}\n` +
                            `🔢 **کد جلسه:** ${short}\n` +
                            `📄 **نام فایل:** ${fileName}`
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
                            `👤 **کاربر:** ${info.userInfo?.name || 'ناشناس'}\n` +
                            `🌐 **صفحه:** ${info.userInfo?.page || 'نامشخص'}\n` +
                            `🔗 **لینک صفحه:** ${info.userInfo?.pageUrl || 'نامشخص'}\n` +
                            `🔢 **کد جلسه:** ${short}`
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
    
    socket.on('end-chat', ({ sessionId }) => {
        const short = sessionId.substring(0, 12);
        const info = botSessions.get(short);
        
        if (info?.chatId) {
            bot.telegram.sendMessage(info.chatId, 
                `👋 **کاربر گفتگو را به پایان رساند.**\n\n` +
                `🔢 کد جلسه: ${short}\n` +
                `🕐 زمان: ${new Date().toLocaleTimeString('fa-IR')}`
            );
            
            botSessions.delete(short);
            getSession(sessionId).connectedToHuman = false;
        }
    });
});

// صفحه اصلی
app.get('/', (req, res) => {
    res.json({
        name: '✨ شیک‌پوشان - پشتیبانی هوشمند ✨',
        version: '5.0.0',
        status: 'آنلاین ✅',
        features: [
            'پیگیری سفارش با کد رهگیری',
            'جستجوی هوشمند محصولات با فیلترهای پیشرفته',
            'تشخیص خودکار رنگ، سایز و دسته‌بندی',
            'پیشنهادات هوشمند',
            'اتصال دوطرفه به اپراتور انسانی',
            'ارسال فایل و پیام صوتی دوطرفه',
            'ارسال عکس از اپراتور',
            'کیبورد شناور تلگرام'
        ],
        api: SHOP_API_URL,
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

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== راه‌اندازی ====================
server.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 سرور روی پورت ${PORT} فعال شد`);
    console.log(`🌐 آدرس: http://localhost:${PORT}`);
    console.log(`🛍️ API سایت: ${SHOP_API_URL}`);
    console.log(`🤖 تلگرام: ${TELEGRAM_BOT_TOKEN ? 'فعال ✅' : 'غیرفعال ❌'}`);
    console.log(`🎯 کیبورد شناور: فعال`);
    console.log(`📁 قابلیت‌ها: متن، فایل، ویس، عکس (دوطرفه)`);
    
    try {
        await bot.telegram.setWebhook(`https://ai-chat-support-production.up.railway.app/telegram-webhook`);
        console.log('✅ وب‌هوک تلگرام تنظیم شد');
        
        await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, 
            `🤖 **سیستم پشتیبانی هوشمند فعال شد** ✨\n\n` +
            `✅ سرور: http://localhost:${PORT}\n` +
            `✅ API: ${SHOP_API_URL}\n` +
            `✅ جستجوی هوشمند: فعال\n` +
            `✅ ارتباط دوطرفه: فعال\n` +
            `✅ کیبورد شناور: فعال\n` +
            `✅ ارسال فایل/ویس/عکس: فعال\n` +
            `✅ اطلاعات صفحه کاربر: فعال\n\n` +
            `📅 تاریخ: ${new Date().toLocaleDateString('fa-IR')}\n` +
            `🕐 زمان: ${new Date().toLocaleTimeString('fa-IR')}\n\n` +
            `✨ سیستم آماده خدمات‌رسانی است!\n\n` +
            `📌 **راهنمایی برای اپراتورها:**\n` +
            `• برای ارسال فایل: دکمه 📁 یا آپلود فایل\n` +
            `• برای ارسال ویس: دکمه 🎤 یا ضبط ویس\n` +
            `• برای ارسال عکس: دکمه 📸 یا آپلود عکس\n` +
            `• برای پایان گفتگو: دکمه 🔚 یا /end\n` +
            `• وضعیت سیستم: /status`);
        
    } catch (error) {
        console.log('⚠️ وب‌هوک خطا → Polling فعال شد');
        bot.launch();
    }
});
