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
const natural = require('natural');
require('dotenv').config();

// ==================== تنظیمات ====================
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = Number(process.env.ADMIN_TELEGRAM_ID);
let BASE_URL = process.env.RAILWAY_STATIC_URL || process.env.BACKEND_URL || '';
BASE_URL = BASE_URL.replace(/\/+$/, '').trim();
if (!BASE_URL) BASE_URL = 'https://ai-chat-support-production.up.railway.app';
if (!BASE_URL.startsWith('http')) BASE_URL = 'https://' + BASE_URL;

// ==================== اتصال به دیتابیس ====================
const dbConfig = {
    host: process.env.MYSQLHOST || process.env.DB_HOST || 'localhost',
    port: process.env.MYSQLPORT || 3306,
    user: process.env.MYSQLUSER || process.env.DB_USER || 'apmsho_shikpooshan',
    password: process.env.MYSQLPASSWORD || process.env.DB_PASS || '5W2nn}@tkm8926G*',
    database: process.env.MYSQLDATABASE || process.env.DB_NAME || 'apmsho_shikpooshan',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

let dbPool;

async function initializeDatabase() {
    try {
        dbPool = mysql.createPool(dbConfig);
        const connection = await dbPool.getConnection();
        console.log('✅ اتصال به دیتابیس موفقیت‌آمیز بود');
        connection.release();
        return true;
    } catch (error) {
        console.error('❌ خطا در اتصال به دیتابیس:', error.message);
        return false;
    }
}

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

app.use(cors({ 
    origin: ["https://shikpooshaan.ir", "http://localhost:3000", "*"],
    credentials: true 
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(helmet({ 
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== کش و سشن‌ها ====================
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 });
const botSessions = new Map();
const tokenizer = new natural.WordTokenizer();

const getSession = (id) => {
    let session = cache.get(id);
    if (!session) {
        session = { 
            id, 
            messages: [], 
            userInfo: {}, 
            connectedToHuman: false,
            lastActivity: Date.now()
        };
        cache.set(id, session);
    } else {
        session.lastActivity = Date.now();
    }
    return session;
};

const cleanupSessions = () => {
    const now = Date.now();
    const expired = [];
    
    cache.keys().forEach(key => {
        const session = cache.get(key);
        if (session && (now - session.lastActivity) > 1800000) { // 30 دقیقه
            expired.push(key);
        }
    });
    
    expired.forEach(key => cache.del(key));
    if (expired.length > 0) {
        console.log(`🧹 ${expired.length} سشن منقضی حذف شد`);
    }
};

setInterval(cleanupSessions, 300000); // هر 5 دقیقه

// ==================== هوش مصنوعی تحلیل پیام ====================
function analyzeMessage(message) {
    const lowerMessage = message.toLowerCase().trim();
    
    // تشخیص کد رهگیری (4 تا 20 رقمی)
    const trackingMatch = lowerMessage.match(/\b\d{4,20}\b/);
    if (trackingMatch) {
        return { type: 'tracking', code: trackingMatch[0] };
    }
    
    // تشخیص درخواست محصول
    const productKeywords = ['لباس', 'پیراهن', 'شلوار', 'کت', 'دامن', 'تیشرت', 'هودی', 'سوئیشرت', 'کفش', 'کالا', 'محصول', 'خرید', 'قیمت', 'موجودی'];
    const colorKeywords = ['قرمز', 'آبی', 'سبز', 'مشکی', 'سفید', 'خاکستری', 'بنفش', 'صورتی', 'نارنجی', 'زرد', 'قهوه‌ای', 'بژ', 'طلایی', 'نقره‌ای'];
    const sizeKeywords = ['اسمال', 'مدیوم', 'لارج', 'اکسترا لارج', 'XL', 'L', 'M', 'S', 'XS', 'XXL', 'سایز', 'اندازه'];
    
    const words = tokenizer.tokenize(lowerMessage);
    const hasProduct = productKeywords.some(keyword => 
        words.some(word => word.includes(keyword))
    );
    
    if (hasProduct) {
        const colors = colorKeywords.filter(color => 
            words.some(word => word.includes(color.toLowerCase()))
        );
        const sizes = sizeKeywords.filter(size => 
            words.some(word => word.includes(size.toLowerCase()))
        );
        
        return { 
            type: 'product_request', 
            colors: colors.length > 0 ? colors : null,
            sizes: sizes.length > 0 ? sizes : null,
            keywords: words.filter(word => word.length > 2)
        };
    }
    
    // تشخیص سلام
    if (/^(سلام|درود|هلو|هی|سلامتی|صبح بخیر|عصر بخیر)/.test(lowerMessage)) {
        return { type: 'greeting' };
    }
    
    // تشخیص تشکر
    if (/^(مرسی|ممنون|متشکرم|دستت درد نکنه|تشکر)/.test(lowerMessage)) {
        return { type: 'thanks' };
    }
    
    // تشخیص مشکل
    if (/^(مشکل|خطا|ایراد|اشکال|خراب|کار نمیکنه)/.test(lowerMessage)) {
        return { type: 'problem' };
    }
    
    return { type: 'general' };
}

// ==================== سیستم پیگیری سفارش از دیتابیس ====================
async function trackOrderFromDatabase(trackingCode) {
    try {
        if (!dbPool) {
            await initializeDatabase();
        }
        
        // جستجو در جدول پست‌ها برای سفارش
        const [orderRows] = await dbPool.execute(`
            SELECT 
                p.ID as order_id,
                p.post_title as order_title,
                p.post_date as order_date,
                p.post_status as order_status,
                pm.meta_value as order_total,
                pm2.meta_value as payment_method,
                pm3.meta_value as customer_name,
                pm4.meta_value as tracking_number
            FROM wp_posts p
            LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id AND pm.meta_key = '_order_total'
            LEFT JOIN wp_postmeta pm2 ON p.ID = pm2.post_id AND pm2.meta_key = '_payment_method_title'
            LEFT JOIN wp_postmeta pm3 ON p.ID = pm3.post_id AND pm3.meta_key = '_billing_first_name'
            LEFT JOIN wp_postmeta pm4 ON p.ID = pm4.post_id AND pm4.meta_key = '_shipping_tracking_number'
            WHERE p.post_type = 'shop_order'
            AND (pm4.meta_value = ? OR p.ID = ?)
            LIMIT 1
        `, [trackingCode, parseInt(trackingCode) || 0]);
        
        if (orderRows.length === 0) {
            // جستجوی دیگر در متاهای سفارش
            const [metaRows] = await dbPool.execute(`
                SELECT 
                    p.ID as order_id,
                    p.post_title as order_title,
                    p.post_date as order_date,
                    p.post_status as order_status
                FROM wp_posts p
                INNER JOIN wp_postmeta pm ON p.ID = pm.post_id
                WHERE p.post_type = 'shop_order'
                AND pm.meta_key LIKE '%tracking%'
                AND pm.meta_value LIKE ?
                LIMIT 1
            `, [`%${trackingCode}%`]);
            
            if (metaRows.length === 0) {
                return { found: false, message: 'سفارشی با این کد رهگیری یافت نشد.' };
            }
            
            const order = metaRows[0];
            return await getOrderDetails(order.order_id);
        }
        
        const order = orderRows[0];
        return await getOrderDetails(order.order_id);
        
    } catch (error) {
        console.error('❌ خطا در پیگیری سفارش:', error);
        return { 
            found: false, 
            message: 'خطا در اتصال به دیتابیس. لطفاً دوباره تلاش کنید.' 
        };
    }
}

async function getOrderDetails(orderId) {
    try {
        // اطلاعات اصلی سفارش
        const [orderInfo] = await dbPool.execute(`
            SELECT 
                p.ID,
                p.post_title,
                p.post_date,
                p.post_status,
                MAX(CASE WHEN pm.meta_key = '_order_total' THEN pm.meta_value END) as total,
                MAX(CASE WHEN pm.meta_key = '_payment_method_title' THEN pm.meta_value END) as payment_method,
                MAX(CASE WHEN pm.meta_key = '_billing_first_name' THEN pm.meta_value END) as first_name,
                MAX(CASE WHEN pm.meta_key = '_billing_last_name' THEN pm.meta_value END) as last_name,
                MAX(CASE WHEN pm.meta_key = '_billing_phone' THEN pm.meta_value END) as phone,
                MAX(CASE WHEN pm.meta_key = '_billing_email' THEN pm.meta_value END) as email,
                MAX(CASE WHEN pm.meta_key = '_shipping_tracking_number' THEN pm.meta_value END) as tracking_number
            FROM wp_posts p
            LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id
            WHERE p.ID = ?
            GROUP BY p.ID
        `, [orderId]);
        
        if (orderInfo.length === 0) {
            return { found: false };
        }
        
        const order = orderInfo[0];
        
        // دریافت آیتم‌های سفارش
        const [orderItems] = await dbPool.execute(`
            SELECT 
                oi.order_item_name as product_name,
                oim.meta_value as quantity
            FROM wp_woocommerce_order_items oi
            LEFT JOIN wp_woocommerce_order_itemmeta oim ON oi.order_item_id = oim.order_item_id
            WHERE oi.order_id = ?
            AND oi.order_item_type = 'line_item'
            AND oim.meta_key = '_qty'
        `, [orderId]);
        
        // وضعیت سفارش به فارسی
        const statusMap = {
            'wc-pending': 'در انتظار پرداخت',
            'wc-processing': 'در حال پردازش',
            'wc-on-hold': 'در انتظار',
            'wc-completed': 'تکمیل شده',
            'wc-cancelled': 'لغو شده',
            'wc-refunded': 'عودت داده شده',
            'wc-failed': 'ناموفق',
            'pending': 'در انتظار پرداخت',
            'processing': 'در حال پردازش',
            'completed': 'تکمیل شده'
        };
        
        const persianStatus = statusMap[order.post_status] || order.post_status;
        
        return {
            found: true,
            order: {
                id: order.ID,
                number: order.ID,
                tracking_code: order.tracking_number || 'ثبت نشده',
                customer_name: `${order.first_name || ''} ${order.last_name || ''}`.trim() || 'مشتری',
                date: new Date(order.post_date).toLocaleDateString('fa-IR'),
                status: persianStatus,
                total: parseFloat(order.total || 0).toLocaleString('fa-IR'),
                payment_method: order.payment_method || 'نامشخص',
                phone: order.phone || 'ثبت نشده',
                email: order.email || 'ثبت نشده',
                items: orderItems.map(item => `${item.quantity} × ${item.product_name}`)
            }
        };
        
    } catch (error) {
        console.error('❌ خطا در دریافت جزئیات سفارش:', error);
        return { found: false };
    }
}

// ==================== سیستم پیشنهاد محصول از دیتابیس ====================
async function suggestProductsFromDatabase(analysis) {
    try {
        if (!dbPool) {
            await initializeDatabase();
        }
        
        let query = `
            SELECT 
                p.ID,
                p.post_title,
                p.post_content,
                pm1.meta_value as regular_price,
                pm2.meta_value as sale_price,
                pm3.meta_value as product_image,
                t.name as product_type
            FROM wp_posts p
            LEFT JOIN wp_postmeta pm1 ON p.ID = pm1.post_id AND pm1.meta_key = '_regular_price'
            LEFT JOIN wp_postmeta pm2 ON p.ID = pm2.post_id AND pm2.meta_key = '_sale_price'
            LEFT JOIN wp_postmeta pm3 ON p.ID = pm3.post_id AND pm3.meta_key = '_thumbnail_id'
            LEFT JOIN wp_terms t ON (
                SELECT tr.term_taxonomy_id 
                FROM wp_term_relationships tr 
                INNER JOIN wp_term_taxonomy tx ON tr.term_taxonomy_id = tx.term_taxonomy_id 
                WHERE tr.object_id = p.ID AND tx.taxonomy = 'product_type' 
                LIMIT 1
            ) = t.term_id
            WHERE p.post_type = 'product'
            AND p.post_status = 'publish'
            AND (
        `;
        
        const conditions = [];
        const params = [];
        
        // جستجو بر اساس رنگ
        if (analysis.colors && analysis.colors.length > 0) {
            analysis.colors.forEach(color => {
                conditions.push(`(p.post_title LIKE ? OR p.post_content LIKE ?)`);
                params.push(`%${color}%`, `%${color}%`);
            });
        }
        
        // جستجو بر اساس سایز
        if (analysis.sizes && analysis.sizes.length > 0) {
            analysis.sizes.forEach(size => {
                conditions.push(`(p.post_title LIKE ? OR p.post_content LIKE ?)`);
                params.push(`%${size}%`, `%${size}%`);
            });
        }
        
        // جستجو بر اساس کلمات کلیدی
        if (analysis.keywords && analysis.keywords.length > 0) {
            analysis.keywords.forEach(keyword => {
                if (keyword.length > 2) {
                    conditions.push(`(p.post_title LIKE ? OR p.post_content LIKE ?)`);
                    params.push(`%${keyword}%`, `%${keyword}%`);
                }
            });
        }
        
        // اگر هیچ شرطی نداشتیم، محصولات پرفروش را برگردان
        if (conditions.length === 0) {
            query = `
                SELECT 
                    p.ID,
                    p.post_title,
                    p.post_content,
                    pm1.meta_value as regular_price,
                    pm2.meta_value as sale_price,
                    pm3.meta_value as product_image,
                    'پرفروش' as product_type
                FROM wp_posts p
                LEFT JOIN wp_postmeta pm1 ON p.ID = pm1.post_id AND pm1.meta_key = '_regular_price'
                LEFT JOIN wp_postmeta pm2 ON p.ID = pm2.post_id AND pm2.meta_key = '_sale_price'
                LEFT JOIN wp_postmeta pm3 ON p.ID = pm3.post_id AND pm3.meta_key = '_thumbnail_id'
                WHERE p.post_type = 'product'
                AND p.post_status = 'publish'
                ORDER BY p.post_date DESC
                LIMIT 5
            `;
        } else {
            query += conditions.join(' OR ');
            query += `) ORDER BY p.post_date DESC LIMIT 5`;
        }
        
        const [products] = conditions.length > 0 
            ? await dbPool.execute(query, params)
            : await dbPool.execute(query);
        
        if (products.length === 0) {
            return [];
        }
        
        // دریافت تصاویر محصولات
        const enrichedProducts = await Promise.all(
            products.map(async (product) => {
                if (product.product_image) {
                    const [imageRows] = await dbPool.execute(`
                        SELECT meta_value as image_url 
                        FROM wp_postmeta 
                        WHERE post_id = ? 
                        AND meta_key = '_wp_attached_file'
                        LIMIT 1
                    `, [product.product_image]);
                    
                    if (imageRows.length > 0) {
                        product.image_url = `https://shikpooshaan.ir/wp-content/uploads/${imageRows[0].image_url}`;
                    }
                }
                
                // قیمت نهایی
                const price = product.sale_price && parseFloat(product.sale_price) > 0 
                    ? parseFloat(product.sale_price)
                    : parseFloat(product.regular_price || 0);
                
                product.final_price = price.toLocaleString('fa-IR');
                product.has_discount = product.sale_price && parseFloat(product.sale_price) > 0;
                
                return product;
            })
        );
        
        return enrichedProducts;
        
    } catch (error) {
        console.error('❌ خطا در جستجوی محصولات:', error);
        return [];
    }
}

// ==================== پاسخ هوشمند فارسی ====================
function generateAIResponse(analysis, context = {}) {
    switch (analysis.type) {
        case 'tracking':
            return `در حال بررسی سفارش با کد ${analysis.code}... 🔍\nلطفاً کمی صبر کنید تا اطلاعات سفارش را از سیستم دریافت کنم.`;
        
        case 'product_request':
            let response = 'در حال جستجوی محصولات مناسب برای شما... 🛍️\n';
            if (analysis.colors) {
                response += `رنگ‌های درخواستی: ${analysis.colors.join('، ')}\n`;
            }
            if (analysis.sizes) {
                response += `سایزهای درخواستی: ${analysis.sizes.join('، ')}\n`;
            }
            response += 'لطفاً چند لحظه صبر کنید...';
            return response;
        
        case 'greeting':
            return 'سلام! 😊\nبه پشتیبانی هوشمند شیک‌پوشان خوش آمدید!\nچگونه می‌توانم کمکتان کنم؟\n• می‌توانید کد رهگیری سفارش خود را وارد کنید\n• یا در مورد محصولات سوال بپرسید\n• یا برای صحبت با اپراتور انسانی، تایپ کنید: "اپراتور"';
        
        case 'thanks':
            return 'خوشحالم که توانستم کمک کنم! 🌟\nاگر سوال دیگری دارید، در خدمت شما هستم.\nروز خوبی داشته باشید!';
        
        case 'problem':
            return 'ببخشید که با مشکل مواجه شدید! 😔\nلطفاً مشکل را با جزییات بیشتری توضیح دهید تا بتوانم بهتر راهنماییتان کنم.\nیا اگر ترجیح می‌دهید با اپراتور صحبت کنید، تایپ کنید: "اپراتور"';
        
        case 'general':
        default:
            if (context.hasProducts) {
                return `من ${context.productCount} محصول مرتبط برای شما پیدا کردم! 🎯\nبه نظر کدام یک بیشتر می‌پسندید؟ اگر نیاز به اطلاعات بیشتری دارید، بپرسید.`;
            }
            return 'متوجه شدم! 🤔\nلطفاً سوال خود را با جزییات بیشتری بپرسید.\nمثلاً:\n• کد رهگیری سفارشم را می‌خواهم بررسی کنم\n• لباس قرمز سایز مدیوم می‌خواهم\n• با اپراتور می‌خواهم صحبت کنم';
    }
}

// ==================== ربات تلگرام ====================
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// پذیرش درخواست توسط اپراتور
bot.action(/accept_(.+)/, async (ctx) => {
    const short = ctx.match[1];
    const info = botSessions.get(short);
    
    if (!info) {
        return ctx.answerCbQuery('درخواست منقضی شده است');
    }
    
    botSessions.set(short, { ...info, chatId: ctx.chat.id });
    getSession(info.fullId).connectedToHuman = true;
    
    await ctx.answerCbQuery('✅ درخواست پذیرفته شد');
    
    await ctx.editMessageText(`
🎯 شما این گفتگو را پذیرفتید

👤 کاربر: ${info.userInfo?.name || 'ناشناس'}
📄 صفحه: ${info.userInfo?.page || 'نامشخص'}
🌐 آی‌پی: ${info.userInfo?.ip || 'نامشخص'}
🔢 کد جلسه: ${short}

از این لحظه می‌توانید مستقیم با کاربر چت کنید.
    `.trim());
    
    // اطلاع‌رسانی به کاربر
    io.to(info.fullId).emit('operator-connected', {
        message: '🎉 اپراتور انسانی متصل شد!\nلطفاً سوال یا مشکل خود را مطرح کنید.'
    });
    
    // ارسال تاریخچه چت به اپراتور
    const session = getSession(info.fullId);
    const history = session.messages
        .slice(-10) // آخرین 10 پیام
        .map(m => `${m.role === 'user' ? '👤 کاربر' : '🤖 ربات'}: ${m.content}`)
        .join('\n\n') || '📝 کاربر هنوز پیامی نفرستاده است';
    
    await ctx.reply(`📜 تاریخچه چت:\n\n${history}\n\n📌 برای قطع اتصال، دستور /end را ارسال کنید.`);
});

// رد درخواست توسط اپراتور
bot.action(/reject_(.+)/, async (ctx) => {
    const short = ctx.match[1];
    const info = botSessions.get(short);
    
    if (info) {
        io.to(info.fullId).emit('operator-rejected', {
            message: 'متأسفانه در حال حاضر اپراتور در دسترس نیست. لطفاً سوال خود را از من بپرسید.'
        });
        botSessions.delete(short);
    }
    
    await ctx.answerCbQuery('❌ درخواست رد شد');
    await ctx.deleteMessage();
});

// پیام اپراتور → ویجت
bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) {
        // دستورات مدیریتی
        if (ctx.message.text === '/end') {
            const entry = [...botSessions.entries()].find(([_, v]) => v.chatId === ctx.chat.id);
            if (entry) {
                io.to(entry[1].fullId).emit('operator-disconnected', {
                    message: 'اپراتور ارتباط را قطع کرد. برای ارتباط مجدد، "اپراتور" را تایپ کنید.'
                });
                botSessions.delete(entry[0]);
                await ctx.reply('✅ ارتباط با کاربر قطع شد.');
            }
            return;
        }
        
        if (ctx.message.text === '/status') {
            const active = [...botSessions.values()].filter(v => v.chatId === ctx.chat.id).length;
            await ctx.reply(`📊 وضعیت فعلی:\n• اتصالات فعال: ${active}\n• سشن‌های منتظر: ${botSessions.size - active}`);
            return;
        }
        
        return;
    }
    
    // ارسال پیام عادی به کاربر
    const entry = [...botSessions.entries()].find(([_, v]) => v.chatId === ctx.chat.id);
    if (!entry) {
        return ctx.reply('⚠️ شما در حال حاضر با هیچ کاربری در ارتباط نیستید.');
    }
    
    const [short, info] = entry;
    
    // ارسال پیام به کاربر
    io.to(info.fullId).emit('operator-message', { 
        message: ctx.message.text,
        timestamp: new Date().toLocaleTimeString('fa-IR')
    });
    
    // ذخیره در تاریخچه
    const session = getSession(info.fullId);
    session.messages.push({ 
        role: 'operator', 
        content: ctx.message.text,
        timestamp: new Date()
    });
    
    await ctx.reply('✅ پیام ارسال شد.');
});

// وب‌هوک تلگرام
app.post('/telegram-webhook', async (req, res) => {
    try {
        await bot.handleUpdate(req.body, res);
    } catch (error) {
        console.error('❌ خطا در وب‌هوک تلگرام:', error);
        res.status(200).end();
    }
});

// ==================== مسیرهای API ====================

// سلامت سرور و دیتابیس
app.get('/api/health', async (req, res) => {
    try {
        const dbConnected = await initializeDatabase();
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            database: dbConnected ? 'connected' : 'disconnected',
            sessions: cache.keys().length,
            pending_requests: botSessions.size,
            memory: process.memoryUsage()
        });
    } catch (error) {
        res.status(500).json({ status: 'unhealthy', error: error.message });
    }
});

// درخواست جدید از ویجت
app.post('/api/webhook', async (req, res) => {
    try {
        const { event, data } = req.body;
        
        if (event !== 'new_session') {
            return res.status(400).json({ success: false, error: 'رویداد نامعتبر' });
        }
        
        const { sessionId, userInfo, userMessage } = data;
        
        if (!sessionId) {
            return res.status(400).json({ success: false, error: 'شناسه جلسه الزامی است' });
        }
        
        const short = sessionId.substring(0, 12);
        botSessions.set(short, { 
            fullId: sessionId, 
            userInfo: userInfo || {}, 
            chatId: null,
            createdAt: new Date()
        });
        
        const userName = userInfo?.name || 'ناشناس';
        const userPage = userInfo?.page || 'نامشخص';
        const userIp = userInfo?.ip || 'نامشخص';
        
        // اطلاع به تلگرام
        await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, `
🔔 درخواست پشتیبانی جدید

👤 نام: ${userName}
📄 صفحه: ${userPage}
🌐 آی‌پی: ${userIp}
🔢 کد جلسه: ${short}
💬 پیام اول: ${userMessage || 'درخواست اتصال به اپراتور'}

🕐 زمان: ${new Date().toLocaleTimeString('fa-IR')}
        `.trim(), {
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ پذیرش درخواست', callback_data: `accept_${short}` },
                    { text: '❌ رد درخواست', callback_data: `reject_${short}` }
                ]]
            }
        });
        
        res.json({ 
            success: true, 
            sessionId: short,
            message: 'درخواست ثبت شد و به اپراتورها اطلاع داده شد.' 
        });
        
    } catch (error) {
        console.error('❌ خطا در وب‌هوک:', error);
        res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
    }
});

// اتصال به اپراتور انسانی
app.post('/api/connect-human', async (req, res) => {
    try {
        const { sessionId, userInfo } = req.body;
        
        if (!sessionId) {
            return res.status(400).json({ success: false, error: 'شناسه جلسه الزامی است' });
        }
        
        const session = getSession(sessionId);
        session.userInfo = { ...session.userInfo, ...userInfo };
        
        // ارسال درخواست به سیستم اطلاع‌رسانی
        await axios.post(`${BASE_URL}/api/webhook`, {
            event: 'new_session',
            data: { 
                sessionId, 
                userInfo: session.userInfo, 
                userMessage: 'درخواست اتصال به اپراتور انسانی' 
            }
        }).catch(() => {
            console.log('⚠️ وب‌هوک داخلی پاسخ نداد');
        });
        
        res.json({ 
            success: true, 
            pending: true,
            message: 'درخواست شما برای اتصال به اپراتور انسانی ثبت شد. لطفاً منتظر بمانید...' 
        });
        
    } catch (error) {
        console.error('❌ خطا در اتصال به اپراتور:', error);
        res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
    }
});

// سیستم چت هوشمند اصلی
app.post('/api/chat', async (req, res) => {
    try {
        const { message, sessionId } = req.body;
        
        if (!message || !sessionId) {
            return res.status(400).json({ 
                success: false, 
                error: 'پیام و شناسه جلسه الزامی هستند' 
            });
        }
        
        const session = getSession(sessionId);
        session.messages.push({ role: 'user', content: message });
        
        // بررسی اگر کاربر به اپراتور متصل است
        const short = sessionId.substring(0, 12);
        const botSession = botSessions.get(short);
        
        if (botSession?.chatId) {
            // کاربر در حال چت با اپراتور است
            return res.json({ 
                success: true, 
                operatorConnected: true,
                message: 'پیام شما به اپراتور ارسال شد.' 
            });
        }
        
        // تحلیل پیام
        const analysis = analyzeMessage(message);
        
        // اگر کد رهگیری بود
        if (analysis.type === 'tracking') {
            session.messages.push({ role: 'ai', content: 'در حال جستجوی سفارش...' });
            
            const orderInfo = await trackOrderFromDatabase(analysis.code);
            
            if (orderInfo.found) {
                const order = orderInfo.order;
                const response = `
🎯 **سفارش پیدا شد!**

📦 **کد سفارش:** ${order.number}
📮 **کد رهگیری:** ${order.tracking_code}
👤 **مشتری:** ${order.customer_name}
📅 **تاریخ ثبت:** ${order.date}
🟢 **وضعیت:** ${order.status}
💰 **مبلغ کل:** ${order.total} تومان
💳 **روش پرداخت:** ${order.payment_method}
📞 **تلفن:** ${order.phone}
📧 **ایمیل:** ${order.email}

🛍️ **محصولات:**
${order.items.map((item, i) => `${i+1}. ${item}`).join('\n')}

✅ سفارش شما در حال پردازش است. به زودی ارسال می‌شود.
                `.trim();
                
                session.messages.push({ role: 'ai', content: response });
                return res.json({ success: true, message: response });
            } else {
                const response = `❌ **سفارش یافت نشد!**\n\nسفارشی با کد "${analysis.code}" در سیستم یافت نشد.\n\nلطفاً موارد زیر را بررسی کنید:\n• کد رهگیری را دقیق وارد کنید\n• ممکن است سفارش هنوز در سیستم ثبت نشده باشد\n• برای بررسی بیشتر، "اپراتور" را تایپ کنید`;
                session.messages.push({ role: 'ai', content: response });
                return res.json({ success: true, message: response });
            }
        }
        
        // اگر درخواست محصول بود
        if (analysis.type === 'product_request') {
            const aiResponse = generateAIResponse(analysis);
            session.messages.push({ role: 'ai', content: aiResponse });
            
            // جستجوی محصولات در پس‌زمینه
            setTimeout(async () => {
                try {
                    const products = await suggestProductsFromDatabase(analysis);
                    
                    if (products.length > 0) {
                        let productList = `🎁 **${products.length} محصول مرتبط پیدا کردم:**\n\n`;
                        
                        products.forEach((product, index) => {
                            productList += `**${index + 1}. ${product.post_title}**\n`;
                            productList += `💰 قیمت: ${product.final_price} تومان\n`;
                            if (product.has_discount) {
                                productList += `🔥 **تخفیف ویژه!**\n`;
                            }
                            if (product.product_type) {
                                productList += `📌 دسته: ${product.product_type}\n`;
                            }
                            productList += `🔗 آدرس: https://shikpooshaan.ir/product/${product.ID}/\n\n`;
                        });
                        
                        productList += `💡 **راهنمایی:**\nبرای اطلاعات بیشتر درباره هر محصول، شماره آن را بنویسید (مثلاً "محصول 1")\nیا برای خرید مستقیم روی لینک محصول کلیک کنید.`;
                        
                        // ذخیره در سشن برای ارسال به کاربر
                        session.messages.push({ role: 'ai', content: productList });
                        
                        // ارسال به سوکت اگر کاربر آنلاین است
                        if (io.sockets.adapter.rooms.has(sessionId)) {
                            io.to(sessionId).emit('ai-message', { 
                                message: productList,
                                type: 'product_suggestions'
                            });
                        }
                    }
                } catch (error) {
                    console.error('❌ خطا در جستجوی محصولات:', error);
                }
            }, 100);
            
            return res.json({ success: true, message: aiResponse });
        }
        
        // پاسخ‌های عمومی
        const aiResponse = generateAIResponse(analysis);
        session.messages.push({ role: 'ai', content: aiResponse });
        
        return res.json({ 
            success: true, 
            message: aiResponse,
            analysis: analysis.type 
        });
        
    } catch (error) {
        console.error('❌ خطا در سیستم چت:', error);
        
        const fallbackResponse = `
⚠️ **خطای موقت در سیستم**

متأسفانه در حال حاضر با خطای موقت مواجه شده‌ایم.
لطفاً:

1. چند لحظه صبر کنید و دوباره تلاش کنید
2. یا مستقیماً با شماره پشتیبانی تماس بگیرید
3. یا "اپراتور" را تایپ کنید تا با اپراتور انسانی صحبت کنید

با تشکر از صبر و شکیبایی شما 🙏
        `.trim();
        
        return res.json({ 
            success: false, 
            message: fallbackResponse 
        });
    }
});

// دریافت تاریخچه چت
app.get('/api/chat-history/:sessionId', (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = getSession(sessionId);
        
        res.json({
            success: true,
            sessionId,
            messages: session.messages.slice(-50), // آخرین 50 پیام
            userInfo: session.userInfo,
            connectedToHuman: session.connectedToHuman,
            lastActivity: session.lastActivity
        });
        
    } catch (error) {
        console.error('❌ خطا در دریافت تاریخچه:', error);
        res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
    }
});

// جستجوی مستقیم محصولات
app.post('/api/search-products', async (req, res) => {
    try {
        const { query, colors, sizes, limit = 5 } = req.body;
        
        if (!query && !colors && !sizes) {
            return res.status(400).json({ 
                success: false, 
                error: 'حداقل یک پارامتر جستجو الزامی است' 
            });
        }
        
        const analysis = {
            type: 'product_request',
            colors: colors ? (Array.isArray(colors) ? colors : [colors]) : null,
            sizes: sizes ? (Array.isArray(sizes) ? sizes : [sizes]) : null,
            keywords: query ? tokenizer.tokenize(query.toLowerCase()) : []
        };
        
        const products = await suggestProductsFromDatabase(analysis);
        
        res.json({
            success: true,
            count: products.length,
            products: products.map(p => ({
                id: p.ID,
                title: p.post_title,
                price: p.final_price,
                has_discount: p.has_discount,
                type: p.product_type,
                url: `https://shikpooshaan.ir/product/${p.ID}/`,
                image: p.image_url
            }))
        });
        
    } catch (error) {
        console.error('❌ خطا در جستجوی محصولات:', error);
        res.status(500).json({ success: false, error: 'خطای داخلی سرور' });
    }
});

// ==================== سوکت آی‌او ====================
io.on('connection', (socket) => {
    console.log('🔌 کاربر جدید متصل شد:', socket.id);
    
    socket.on('join-session', (sessionId) => {
        socket.join(sessionId);
        console.log(`📝 کاربر به سشن ${sessionId} پیوست`);
        
        // اطلاع‌رسانی آنلاین بودن
        socket.to(sessionId).emit('user-online', { status: 'online' });
    });
    
    socket.on('user-message', async ({ sessionId, message }) => {
        if (!sessionId || !message) return;
        
        console.log(`💬 پیام از سشن ${sessionId}:`, message.substring(0, 50));
        
        const short = sessionId.substring(0, 12);
        const info = botSessions.get(short);
        
        // اگر کاربر با اپراتور در ارتباط است
        if (info?.chatId) {
            const userName = info.userInfo?.name || 'ناشناس';
            const userPage = info.userInfo?.page || 'نامشخص';
            const userIp = info.userInfo?.ip || 'نامشخص';
            
            await bot.telegram.sendMessage(info.chatId, `
📩 **پیام جدید از کاربر**

👤 نام: ${userName}
📄 صفحه: ${userPage}
🌐 آی‌پی: ${userIp}
🔢 کد جلسه: ${short}

💬 پیام:
${message}

🕐 زمان: ${new Date().toLocaleTimeString('fa-IR')}
            `.trim());
        }
        
        // ذخیره در تاریخچه سشن
        const session = getSession(sessionId);
        session.messages.push({ 
            role: 'user', 
            content: message,
            timestamp: new Date(),
            via: 'socket'
        });
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
                });
                
                // اطلاع به کاربر
                socket.emit('file-sent', { success: true, fileName });
            } catch (error) {
                console.error('❌ خطا در ارسال فایل:', error);
                socket.emit('file-error', { error: 'خطا در ارسال فایل' });
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
                });
                
                socket.emit('voice-sent', { success: true });
            } catch (error) {
                console.error('❌ خطا در ارسال ویس:', error);
                socket.emit('voice-error', { error: 'خطا در ارسال پیام صوتی' });
            }
        }
    });
    
    socket.on('disconnect', () => {
        console.log('🔌 کاربر قطع شد:', socket.id);
    });
});

// ==================== مسیرهای استاتیک و فال‌بک ====================
app.get('/api/test-db', async (req, res) => {
    try {
        const connected = await initializeDatabase();
        if (!connected) {
            return res.json({ success: false, error: 'اتصال به دیتابیس ناموفق' });
        }
        
        // تست کوئری ساده
        const [rows] = await dbPool.execute('SELECT COUNT(*) as count FROM wp_posts WHERE post_type = "product"');
        const [orderRows] = await dbPool.execute('SELECT COUNT(*) as count FROM wp_posts WHERE post_type = "shop_order"');
        
        res.json({
            success: true,
            database: 'connected',
            products_count: rows[0]?.count || 0,
            orders_count: orderRows[0]?.count || 0,
            tables: [
                'wp_posts',
                'wp_postmeta', 
                'wp_woocommerce_order_items',
                'wp_woocommerce_order_itemmeta'
            ]
        });
        
    } catch (error) {
        res.json({ 
            success: false, 
            error: error.message,
            config: { ...dbConfig, password: '***' } 
        });
    }
});

// صفحه اصلی
app.get('/', (req, res) => {
    res.json({
        name: 'Shikpooshan AI Support System',
        version: '2.0.0',
        endpoints: [
            { path: '/api/chat', method: 'POST', description: 'سیستم چت هوشمند' },
            { path: '/api/connect-human', method: 'POST', description: 'اتصال به اپراتور' },
            { path: '/api/search-products', method: 'POST', description: 'جستجوی محصولات' },
            { path: '/api/health', method: 'GET', description: 'سلامت سیستم' },
            { path: '/api/test-db', method: 'GET', description: 'تست دیتابیس' }
        ],
        status: 'operational',
        timestamp: new Date().toISOString()
    });
});

// فال‌بک برای SPA
app.get('*', (req, res) => {
    if (req.accepts('html')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.status(404).json({ error: 'مسیر یافت نشد' });
    }
});

// ==================== راه‌اندازی سرور ====================
async function startServer() {
    try {
        // راه‌اندازی دیتابیس
        await initializeDatabase();
        
        // راه‌اندازی سرور
        server.listen(PORT, '0.0.0.0', async () => {
            console.log(`🚀 سرور روی پورت ${PORT} فعال شد`);
            console.log(`🌐 آدرس: ${BASE_URL}`);
            console.log(`📊 وضعیت: http://localhost:${PORT}/api/health`);
            
            try {
                // تنظیم وب‌هوک تلگرام
                await bot.telegram.setWebhook(`${BASE_URL}/telegram-webhook`);
                console.log('✅ وب‌هوک تلگرام تنظیم شد:', `${BASE_URL}/telegram-webhook`);
                
                // اطلاع به ادمین
                await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, `
🤖 **سیستم پشتیبانی هوشمند فعال شد**

✅ سرور: ${BASE_URL}
✅ دیتابیس: متصل
✅ سوکت: فعال
✅ تاریخ: ${new Date().toLocaleDateString('fa-IR')}
🕐 زمان: ${new Date().toLocaleTimeString('fa-IR')}

✨ سیستم آماده خدمات‌رسانی است.
                `.trim());
                
            } catch (telegramError) {
                console.warn('⚠️ وب‌هوک تلگرام تنظیم نشد، حالت polling فعال شد');
                bot.launch();
            }
        });
        
    } catch (error) {
        console.error('❌ خطای بحرانی در راه‌اندازی سرور:', error);
        process.exit(1);
    }
}

// هندلر خطاهای غیرمنتظره
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ خطای unhandledRejection:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ خطای uncaughtException:', error);
});

// شروع سرور
startServer();

module.exports = { app, server, io };
