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
        s = { id, messages: [], userInfo: {}, connectedToHuman: false, preferences: {} };
        cache.set(id, s);
    }
    return s;
};

// ==================== تحلیل پیام پیشرفته ====================
function analyzeMessage(message) {
    const lower = message.toLowerCase();
    
    // کد پیگیری
    const codeMatch = message.match(/\b(\d{4,20})\b/);
    if (codeMatch) return { type: 'tracking', code: codeMatch[1] };
    
    // محصولات
    const productTypes = ['تیشرت', 'هودی', 'پیراهن', 'شلوار', 'کت', 'دامن', 'لباس', 'کفش', 'اکسسوری', 'زیورآلات', 'ساعت', 'کیف', 'کمربند'];
    const hasProduct = productTypes.some(type => lower.includes(type));
    
    if (hasProduct || lower.includes('قیمت') || lower.includes('موجودی') || lower.includes('خرید') || lower.includes('محصول')) {
        // تشخیص سایز
        const sizes = ['اسمال', 'مدیوم', 'لارج', 'اکسترا', 'سایز', 'XL', '2XL', 'XXL', 'L', 'M', 'S', 'XS'];
        const foundSizes = sizes.filter(size => lower.includes(size.toLowerCase()));
        
        // تشخیص رنگ
        const colors = ['قرمز', 'آبی', 'سبز', 'مشکی', 'سفید', 'خاکستری', 'بنفش', 'صورتی', 'نارنجی', 'زرد', 'قهوه‌ای', 'بژ', 'طلایی', 'نقره‌ای'];
        const foundColors = colors.filter(color => lower.includes(color));
        
        return { 
            type: 'product', 
            keyword: message,
            sizes: foundSizes.length > 0 ? foundSizes : null,
            colors: foundColors.length > 0 ? foundColors : null
        };
    }
    
    // پیشنهاد
    if (lower.includes('پیشنهاد') || lower.includes('پیشنهادی') || lower.includes('چی پیشنهاد')) {
        return { type: 'suggestion' };
    }
    
    // سلام و احوالپرسی
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

// ==================== تبدیل وضعیت به فارسی ====================
function getPersianStatus(status) {
    const statusMap = {
        'wc-pending': '⏳ در انتظار پرداخت',
        'wc-processing': '🔄 در حال پردازش',
        'wc-on-hold': '⏸️ در انتظار بررسی',
        'wc-completed': '✅ تکمیل شده',
        'wc-cancelled': '❌ لغو شده',
        'wc-refunded': '↩️ عودت داده شده',
        'wc-failed': '❌ ناموفق',
        'pending': '⏳ در انتظار پرداخت',
        'processing': '🔄 در حال پردازش',
        'on-hold': '⏸️ در انتظار',
        'completed': '✅ تکمیل شده',
        'cancelled': '❌ لغو شده',
        'refunded': '↩️ عودت داده شده',
        'failed': '❌ ناموفق'
    };
    
    return statusMap[status] || status;
}

// ==================== پاسخ‌های تعاملی ====================
function getGreetingResponse() {
    const greetings = [
        "سلام عزیزم! 🌸✨ چه خوشحالم که پیدات کردم! امروز چطورید؟",
        "درود بر شما! 🌟 روز خوبی داشته باشید! خوش آمدید به شیک‌پوشان.",
        "سلام قشنگم! 💖 انرژی مثبت براتون میفرستم! امیدوارم روز عالی داشته باشید.",
        "هلوووو! 🎉 چه خوب شد که اومدین! حالمون رو گرفتین با حضور گرمتون!"
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
}

function getThanksResponse() {
    const thanks = [
        "خواهش می‌کنم عزیزم! 🤗 خوشحالم که تونستم کمک کنم.",
        "قربونت برم! 💝 همیشه در خدمت شما هستم.",
        "چشم قشنگم! 🌸 هر زمان که نیاز داشتین، در کنارتونم.",
        "خوشحالم که راضیتون کردم! ✨ منتظر سوال بعدیتون می‌مونم."
    ];
    return thanks[Math.floor(Math.random() * thanks.length)];
}

function getSuggestionPrompt() {
    return "🎁 **عالی! دوست دارید چه نوع محصولی رو پیشنهاد بدم؟**\n\n" +
           "مثلاً:\n" +
           "• تیشرت‌های جدید\n" +
           "• هودی‌های فصل\n" +
           "• شلوارهای جین\n" +
           "• کت‌های زمستانی\n" +
           "• یا هر چیزی که دلتون بخواد!";
}

// ==================== ارتباط با API سایت ====================
async function callShopAPI(action, data = {}) {
    try {
        console.log(`📡 درخواست به API: ${action}`, data);
        
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
        
        console.log(`✅ پاسخ API دریافت شد`);
        return response.data;
        
    } catch (error) {
        console.error('❌ خطای API:', error.message);
        return { 
            error: true, 
            message: 'خطا در ارتباط با سایت',
            details: error.message 
        };
    }
}

// ==================== جستجوی پیشرفته محصولات ====================
async function searchProductsAdvanced(keyword, filters = {}) {
    try {
        // ابتدا جستجوی عادی
        const result = await callShopAPI('search_product', { keyword });
        
        if (result.error || !result.products) {
            return { products: [] };
        }
        
        let products = result.products;
        
        // اگر سایز یا رنگ مشخص شده، فیلتر کن
        if (filters.sizes || filters.colors) {
            products = products.filter(product => {
                // اینجا می‌تونی منطق فیلتر بر اساس ویژگی‌ها رو اضافه کنی
                return true;
            });
        }
        
        return {
            success: true,
            count: products.length,
            products: products.slice(0, 8), // حداکثر 8 محصول
            filtersApplied: Object.keys(filters).length > 0
        };
        
    } catch (error) {
        console.error('خطا در جستجوی پیشرفته:', error);
        return { products: [] };
    }
}

// ==================== سیستم پیشنهاد هوشمند ====================
async function getSmartSuggestions(session) {
    try {
        // از تاریخچه چت کاربر ترجیحات رو استخراج کن
        const preferences = session.preferences || {};
        
        let searchKeyword = 'پرفروش';
        
        if (preferences.lastProductType) {
            searchKeyword = preferences.lastProductType;
        } else if (session.messages.length > 0) {
            // از پیام‌های قبلی کلمات کلیدی استخراج کن
            const lastMessages = session.messages
                .filter(m => m.role === 'user')
                .slice(-3)
                .map(m => m.content);
            
            const productKeywords = ['تیشرت', 'هودی', 'پیراهن', 'شلوار', 'کت', 'دامن'];
            
            for (const msg of lastMessages) {
                for (const keyword of productKeywords) {
                    if (msg.toLowerCase().includes(keyword.toLowerCase())) {
                        searchKeyword = keyword;
                        break;
                    }
                }
                if (searchKeyword !== 'پرفروش') break;
            }
        }
        
        const result = await callShopAPI('search_product', { 
            keyword: searchKeyword 
        });
        
        if (result.products && result.products.length > 0) {
            // متنوع‌ترین محصولات رو انتخاب کن
            const suggestedProducts = result.products
                .sort(() => Math.random() - 0.5)
                .slice(0, 5);
            
            return suggestedProducts;
        }
        
        return [];
        
    } catch (error) {
        console.error('خطا در پیشنهاد هوشمند:', error);
        return [];
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
        api: SHOP_API_URL,
        sessions: cache.keys().length,
        telegram: TELEGRAM_BOT_TOKEN ? 'فعال' : 'غیرفعال'
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

// سیستم چت اصلی پیشرفته
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
        
        // ذخیره ترجیحات کاربر
        if (analysis.type === 'product' && analysis.keyword) {
            const productTypes = ['تیشرت', 'هودی', 'پیراهن', 'شلوار', 'کت', 'دامن'];
            for (const type of productTypes) {
                if (message.toLowerCase().includes(type.toLowerCase())) {
                    session.preferences.lastProductType = type;
                    break;
                }
            }
        }
        
        // اگر کد پیگیری
        if (analysis.type === 'tracking') {
            const apiResult = await callShopAPI('track_order', {
                tracking_code: analysis.code
            });
            
            if (apiResult.found) {
                const order = apiResult.order;
                const persianStatus = getPersianStatus(order.status);
                
                const reply = `🎯 **سفارش شما پیدا شد!** ✨\n\n` +
                             `📦 **کد سفارش:** ${order.number}\n` +
                             `👤 **مشتری:** ${order.customer_name}\n` +
                             `📅 **تاریخ ثبت:** ${order.date}\n` +
                             `🟢 **وضعیت:** ${persianStatus}\n` +
                             `💰 **مبلغ کل:** ${Number(order.total).toLocaleString('fa-IR')} تومان\n` +
                             `💳 **روش پرداخت:** ${order.payment}\n\n` +
                             `🛍️ **محصولات:**\n` +
                             `${order.items.map((item, i) => `   ${i+1}. ${item}`).join('\n')}\n\n` +
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
        
        // اگر محصول
        if (analysis.type === 'product') {
            // ساخت پیام در حال جستجو
            let searchingMsg = `🔍 **در حال جستجو برای شما...**\n\n`;
            
            if (analysis.sizes) {
                searchingMsg += `📏 سایزهای درخواستی: ${analysis.sizes.join(', ')}\n`;
            }
            if (analysis.colors) {
                searchingMsg += `🎨 رنگ‌های درخواستی: ${analysis.colors.join(', ')}\n`;
            }
            
            searchingMsg += `\nلطفاً کمی صبر کنید... ⏳`;
            
            // ارسال پاسخ اولیه
            session.messages.push({ role: 'assistant', content: searchingMsg });
            res.json({ success: true, message: searchingMsg, searching: true });
            
            // جستجوی پیشرفته در پس‌زمینه
            setTimeout(async () => {
                try {
                    const searchResult = await searchProductsAdvanced(analysis.keyword, {
                        sizes: analysis.sizes,
                        colors: analysis.colors
                    });
                    
                    if (searchResult.products.length > 0) {
                        let productReply = `🎁 **${searchResult.products.length} محصول مرتبط پیدا کردم!** 🌟\n\n`;
                        
                        searchResult.products.forEach((product, index) => {
                            productReply += `**${index + 1}. ${product.name}**\n`;
                            productReply += `   💰 قیمت: ${Number(product.price || 0).toLocaleString('fa-IR')} تومان\n`;
                            
                            if (product.stock) {
                                productReply += `   📦 موجودی: ${product.stock}\n`;
                            }
                            
                            if (product.url) {
                                productReply += `   🔗 لینک: ${product.url}\n`;
                            }
                            
                            productReply += '\n';
                        });
                        
                        productReply += `💡 **نکته:**\n`;
                        productReply += `برای اطلاعات بیشتر درباره هر محصول، شماره آن را بنویسید (مثلاً "محصول 3")\n`;
                        productReply += `یا مستقیماً روی لینک محصول کلیک کنید.\n\n`;
                        productReply += `اگر محصول خاصی مدنظر دارید، دقیق‌تر بگویید. 😊`;
                        
                        session.messages.push({ role: 'assistant', content: productReply });
                        
                        // ارسال از طریق سوکت
                        io.to(sessionId).emit('ai-message', {
                            message: productReply,
                            type: 'products_found'
                        });
                        
                    } else {
                        const noProductReply = `❌ **محصولی با این مشخصات پیدا نکردم!**\n\n` +
                                             `متأسفانه محصولی با جستجوی "${analysis.keyword}" یافت نشد.\n\n` +
                                             `✨ **پیشنهاد من:**\n` +
                                             `• نام دقیق‌تر محصول را وارد کنید\n` +
                                             `• از من بخواهید پیشنهاد بدهم\n` +
                                             `• یا "اپراتور" را تایپ کنید`;
                        
                        session.messages.push({ role: 'assistant', content: noProductReply });
                        io.to(sessionId).emit('ai-message', {
                            message: noProductReply,
                            type: 'no_products'
                        });
                    }
                } catch (error) {
                    console.error('خطا در جستجوی محصول:', error);
                }
            }, 100);
            
            return;
        }
        
        // اگر پیشنهاد
        if (analysis.type === 'suggestion') {
            const prompt = getSuggestionPrompt();
            session.messages.push({ role: 'assistant', content: prompt });
            return res.json({ success: true, message: prompt });
        }
        
        // اگر سلام
        if (analysis.type === 'greeting') {
            const greeting = getGreetingResponse();
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
        
        // اگر تشکر
        if (analysis.type === 'thanks') {
            const reply = `${getThanksResponse()}\n\n` +
                         `**امر دیگری هست که بتونم کمکتون کنم؟** 🌸\n\n` +
                         `همیشه در خدمت شما هستم!`;
            
            session.messages.push({ role: 'assistant', content: reply });
            return res.json({ success: true, message: reply });
        }
        
        // اگر اپراتور
        if (analysis.type === 'operator') {
            const short = sessionId.substring(0, 12);
            botSessions.set(short, {
                fullId: sessionId,
                userInfo: session.userInfo || {},
                chatId: null,
                createdAt: new Date()
            });
            
            // اطلاع به تلگرام
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
            
            const reply = `✅ **درخواست شما ثبت شد!**\n\n` +
                         `کارشناسان ما در تلگرام مطلع شدند و به زودی با شما ارتباط برقرار می‌کنند.\n\n` +
                         `⏳ **لطفاً منتظر بمانید...**\n` +
                         `کد جلسه شما: **${short}**`;
            
            session.messages.push({ role: 'assistant', content: reply });
            return res.json({ success: true, message: reply });
        }
        
        // پاسخ پیش‌فرض هوشمند
        const suggestions = await getSmartSuggestions(session);
        
        if (suggestions.length > 0) {
            let reply = `🤔 **متوجه پیامتون شدم!**\n\n` +
                       `شاید این پیشنهادات براتون جالب باشه: ✨\n\n`;
            
            suggestions.slice(0, 3).forEach((product, index) => {
                reply += `**${index + 1}. ${product.name}**\n`;
                if (product.price) {
                    reply += `   💰 قیمت: ${Number(product.price).toLocaleString('fa-IR')} تومان\n`;
                }
                reply += '\n';
            });
            
            reply += `**یا می‌تونید:**\n` +
                    `• کد پیگیری سفارش رو وارد کنید 📦\n` +
                    `• محصول خاصی رو جستجو کنید 🔍\n` +
                    `• "اپراتور" رو برای کمک بیشتر تایپ کنید 👤`;
            
            session.messages.push({ role: 'assistant', content: reply });
            return res.json({ success: true, message: reply });
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
    
    res.json({ 
        success: true, 
        pending: true,
        message: 'درخواست شما برای اتصال به اپراتور ثبت شد. لطفاً منتظر بمانید...',
        sessionCode: short
    });
});

// دریافت پیشنهادات
app.post('/api/get-suggestions', async (req, res) => {
    try {
        const { sessionId, category } = req.body;
        const session = getSession(sessionId);
        
        let searchKeyword = category || 'پرفروش';
        
        if (session.preferences?.lastProductType) {
            searchKeyword = session.preferences.lastProductType;
        }
        
        const result = await callShopAPI('search_product', { 
            keyword: searchKeyword 
        });
        
        if (result.products && result.products.length > 0) {
            const suggestions = result.products.slice(0, 5);
            
            res.json({
                success: true,
                category: searchKeyword,
                suggestions: suggestions.map(p => ({
                    name: p.name,
                    price: p.price,
                    url: p.url,
                    image: p.image
                }))
            });
        } else {
            res.json({
                success: false,
                message: 'هیچ محصولی برای پیشنهاد یافت نشد.'
            });
        }
        
    } catch (error) {
        res.json({
            success: false,
            error: error.message
        });
    }
});

// ==================== سوکت برای فایل و ویس ====================
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
        version: '4.0.0',
        status: 'آنلاین ✅',
        features: [
            'پیگیری سفارش با کد رهگیری',
            'جستجوی محصولات با فیلتر رنگ و سایز',
            'پیشنهادات هوشمند محصولات',
            'اتصال به اپراتور انسانی',
            'ارسال فایل و پیام صوتی',
            'پاسخ‌های تعاملی و شخصی‌سازی شده'
        ],
        endpoints: {
            chat: 'POST /api/chat',
            connect: 'POST /api/connect-human',
            suggestions: 'POST /api/get-suggestions',
            health: 'GET /api/health',
            test: 'GET /api/test'
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
    
    try {
        await bot.telegram.setWebhook(`https://ai-chat-support-production.up.railway.app/telegram-webhook`);
        console.log('✅ وب‌هوک تلگرام تنظیم شد');
        
        await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, 
            `🤖 **سیستم پشتیبانی هوشمند فعال شد** ✨\n\n` +
            `✅ سرور: https://ai-chat-support-production.up.railway.app\n` +
            `✅ API سایت: ${SHOP_API_URL}\n` +
            `✅ فایل/ویس: فعال\n` +
            `✅ پیشنهادات هوشمند: فعال\n\n` +
            `📅 تاریخ: ${new Date().toLocaleDateString('fa-IR')}\n` +
            `🕐 زمان: ${new Date().toLocaleTimeString('fa-IR')}\n\n` +
            `✨ سیستم آماده خدمات‌رسانی است!`);
        
    } catch (error) {
        console.log('⚠️ وب‌هوک خطا → Polling فعال شد');
        bot.launch();
    }
});
