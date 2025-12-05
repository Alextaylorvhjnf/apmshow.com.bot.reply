const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const helmet = require('helmet');
const axios = require('axios');
const NodeCache = require('node-cache');
const { Telegraf } = require('telegraf');
const mysql = require('mysql2/promise');
const natural = require('natural');
const { OpenAIApi, Configuration } = require('openai');
require('dotenv').config();

// ==================== تنظیمات اصلی ====================
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = Number(process.env.ADMIN_TELEGRAM_ID);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

let BASE_URL = process.env.RAILWAY_STATIC_URL || process.env.BACKEND_URL || CLIENT_URL;
BASE_URL = BASE_URL.replace(/\/+$/, '').trim();
if (!BASE_URL) BASE_URL = 'https://ai-chat-support-production.up.railway.app';
if (!BASE_URL.startsWith('http')) BASE_URL = 'https://' + BASE_URL;

// ==================== اتصال مستقیم به دیتابیس ووکامرس ====================
const DB_CONFIG = {
  host: 'localhost',
  user: 'apmsho_shikpooshan',
  password: '5W2nn}@tkm8926G*',
  database: 'apmsho_shikpooshan',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
};

const pool = mysql.createPool(DB_CONFIG);

// ==================== پیکربندی OpenAI ====================
let openai;
if (OPENAI_API_KEY) {
  try {
    const openaiConfig = new Configuration({
      apiKey: OPENAI_API_KEY,
    });
    openai = new OpenAIApi(openaiConfig);
  } catch (error) {
    console.log('⚠️ OpenAI غیرفعال - از منطق داخلی استفاده می‌شود');
  }
}

// ==================== سرور و سوکت ====================
const app = express();
const server = http.createServer(app);

// تنظیمات CORS برای ویجت
const io = socketIo(server, { 
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"]
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

// میدل‌ورهای اکسپرس با تنظیمات مناسب برای ویجت
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  credentials: true
}));

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// میدل‌ور برای هندل کردن OPTIONS (مهم برای ویجت)
app.options('*', cors());

// ==================== سیستم کش و نشست‌ها ====================
const cache = new NodeCache({ stdTTL: 7200, checkperiod: 600 });
const botSessions = new Map();
const tokenizer = new natural.WordTokenizer();
const stemmer = natural.PorterStemmerFa;

// تابع کوتاه کردن ID
const shortId = (id) => String(id).substring(0, 12);

// مدیریت نشست‌ها
const getSession = (id) => {
  let session = cache.get(id);
  if (!session) {
    session = { 
      id, 
      messages: [
        { role: 'ai', content: 'سلام! به پشتیبانی هوشمند شیک‌پوشان خوش اومدید. چطور می‌تونم کمکتون کنم؟ 😊', timestamp: new Date().toISOString() }
      ], 
      userInfo: {}, 
      connectedToHuman: false,
      lastInteraction: Date.now(),
      orderHistory: [],
      preferences: {},
      socketId: null
    };
    cache.set(id, session);
  }
  return session;
};

const updateSession = (id, updates) => {
  const session = getSession(id);
  Object.assign(session, updates, { lastInteraction: Date.now() });
  cache.set(id, session);
  return session;
};

// ==================== سیستم تشخیص کلمات کلیدی فارسی ====================
const extractColor = (text) => {
  const colors = ['قرمز', 'آبی', 'سبز', 'مشکی', 'سفید', 'خاکستری', 'نقره‌ای', 'طلایی', 'زرد', 'نارنجی', 'بنفش', 'قهوه‌ای', 'صورتی'];
  const words = text.split(/\s+/);
  for (const word of words) {
    for (const color of colors) {
      if (word.includes(color)) return color;
    }
  }
  return null;
};

const extractSize = (text) => {
  const sizes = ['xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl', '36', '38', '40', '42', '44', '46', '48', '50'];
  const words = text.toLowerCase().split(/\s+/);
  for (const word of words) {
    if (sizes.includes(word)) return word;
  }
  
  const sizePatterns = {
    'خیلی کوچک': 'xs',
    'کوچک': 's',
    'متوسط': 'm',
    'بزرگ': 'l',
    'خیلی بزرگ': 'xl'
  };
  
  for (const [pattern, size] of Object.entries(sizePatterns)) {
    if (text.includes(pattern)) return size;
  }
  
  return null;
};

const extractProductType = (text) => {
  const types = [
    'پیراهن', 'تیشرت', 'پولوشرت', 'بلوز', 'شلوار', 'شلوار جین', 'جین',
    'کفش', 'کفش ورزشی', 'کفش رسمی', 'صندل', 'کت', 'ژاکت', 'هودی',
    'لباس', 'لباس مجلسی', 'لباس ورزشی', 'مانتو', 'روسری', 'شال'
  ];
  
  const lowerText = text.toLowerCase();
  for (const type of types) {
    if (lowerText.includes(type.toLowerCase())) return type;
  }
  
  return null;
};

// ==================== سیستم جستجوی محصولات از دیتابیس ووکامرس ====================
async function searchProductsInDatabase(filters = {}) {
  const { color = null, size = null, productType = null, searchTerm = '', limit = 5 } = filters;
  
  try {
    let query = `
      SELECT 
        p.ID as product_id,
        p.post_title as product_name,
        p.post_content as description,
        pm_price.meta_value as price,
        pm_regular_price.meta_value as regular_price,
        pm_sale_price.meta_value as sale_price,
        pm_stock.meta_value as stock_status,
        pm_sku.meta_value as sku,
        (SELECT meta_value FROM wp_postmeta WHERE post_id = p.ID AND meta_key = '_product_attributes' LIMIT 1) as attributes,
        (SELECT guid FROM wp_posts WHERE post_parent = p.ID AND post_type = 'attachment' ORDER BY menu_order LIMIT 1) as image_url
      FROM wp_posts p
      LEFT JOIN wp_postmeta pm_price ON pm_price.post_id = p.ID AND pm_price.meta_key = '_price'
      LEFT JOIN wp_postmeta pm_regular_price ON pm_regular_price.post_id = p.ID AND pm_regular_price.meta_key = '_regular_price'
      LEFT JOIN wp_postmeta pm_sale_price ON pm_sale_price.post_id = p.ID AND pm_sale_price.meta_key = '_sale_price'
      LEFT JOIN wp_postmeta pm_stock ON pm_stock.post_id = p.ID AND pm_stock.meta_key = '_stock_status'
      LEFT JOIN wp_postmeta pm_sku ON pm_sku.post_id = p.ID AND pm_sku.meta_key = '_sku'
      WHERE p.post_type = 'product' 
        AND p.post_status = 'publish'
    `;
    
    const conditions = [];
    const params = [];
    
    if (searchTerm) {
      conditions.push(`(p.post_title LIKE ? OR p.post_content LIKE ? OR pm_sku.meta_value LIKE ?)`);
      params.push(`%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`);
    }
    
    if (productType) {
      conditions.push(`(p.post_title LIKE ? OR EXISTS (
        SELECT 1 FROM wp_term_relationships tr 
        JOIN wp_terms t ON t.term_id = tr.term_taxonomy_id 
        WHERE tr.object_id = p.ID AND t.name LIKE ?
      ))`);
      params.push(`%${productType}%`, `%${productType}%`);
    }
    
    if (conditions.length > 0) {
      query += ` AND (${conditions.join(' AND ')})`;
    }
    
    query += ` 
      GROUP BY p.ID
      ORDER BY 
        CASE WHEN pm_sale_price.meta_value IS NOT NULL THEN 0 ELSE 1 END,
        CAST(pm_price.meta_value AS DECIMAL) ASC
      LIMIT ?
    `;
    
    params.push(limit);
    
    const [rows] = await pool.execute(query, params);
    
    // پردازش ویژگی‌ها برای استخراج رنگ و سایز
    const processedRows = rows.map(row => {
      let colors = [];
      let sizes = [];
      
      if (row.attributes) {
        try {
          const attributes = JSON.parse(row.attributes);
          Object.values(attributes).forEach(attr => {
            if (attr.name.toLowerCase().includes('رنگ')) {
              colors = attr.options || [];
            }
            if (attr.name.toLowerCase().includes('سایز')) {
              sizes = attr.options || [];
            }
          });
        } catch (e) {
          // خطا در پارس JSON
        }
      }
      
      // اگر رنگ از فیلتر مشخص شده، فقط همان رنگ را نشان بده
      if (color && colors.length === 0) {
        colors = [color];
      }
      
      return {
        id: row.product_id,
        name: row.product_name || 'بدون نام',
        description: (row.description || '').substring(0, 100).replace(/<[^>]*>/g, '') + '...',
        price: row.price ? parseInt(row.price) : 0,
        regular_price: row.regular_price ? parseInt(row.regular_price) : null,
        sale_price: row.sale_price ? parseInt(row.sale_price) : null,
        on_sale: row.sale_price !== null && row.sale_price !== row.price && row.sale_price !== '0',
        stock_status: row.stock_status === 'instock' ? 'موجود' : 'ناموجود',
        sku: row.sku || 'ندارد',
        colors: colors,
        sizes: sizes,
        image_url: row.image_url || 'https://via.placeholder.com/300x300?text=Shikpooshan',
        url: `https://shikpooshaan.ir/?p=${row.product_id}`
      };
    });
    
    // فیلتر نهایی بر اساس رنگ (اگر مشخص شده)
    if (color) {
      return processedRows.filter(row => 
        row.colors.length === 0 || 
        row.colors.some(c => c.toLowerCase().includes(color.toLowerCase()))
      );
    }
    
    return processedRows;
    
  } catch (error) {
    console.error('خطا در جستجوی دیتابیس:', error.message);
    // نمونه محصولات در حالت آفلاین
    return [
      {
        id: 1,
        name: 'پیراهن مردانه کلاسیک',
        description: 'پیراهن رسمی مردانه با پارچه مرغوب',
        price: 250000,
        on_sale: true,
        stock_status: 'موجود',
        colors: ['آبی', 'سفید'],
        sizes: ['M', 'L', 'XL'],
        image_url: 'https://via.placeholder.com/300x300/4A90E2/FFFFFF?text=Shirt',
        url: 'https://shikpooshaan.ir'
      }
    ];
  }
}

// ==================== سیستم پیگیری سفارش از دیتابیس ====================
async function trackOrderInDatabase(trackingCode) {
  try {
    // پاکسازی کد رهگیری
    const cleanCode = trackingCode.trim().replace(/\D/g, '');
    
    if (!cleanCode || cleanCode.length < 4) {
      return { found: false, error: 'کد رهگیری نامعتبر' };
    }
    
    // جستجو در سفارشات
    const query = `
      SELECT 
        o.ID as order_id,
        o.post_date as order_date,
        pm_status.meta_value as status,
        pm_total.meta_value as total,
        pm_tracking.meta_value as tracking_code,
        u.user_email as customer_email,
        u.display_name as customer_name,
        pm_payment.meta_value as payment_method
      FROM wp_posts o
      LEFT JOIN wp_postmeta pm_status ON pm_status.post_id = o.ID AND pm_status.meta_key = '_order_status'
      LEFT JOIN wp_postmeta pm_total ON pm_total.post_id = o.ID AND pm_total.meta_key = '_order_total'
      LEFT JOIN wp_postmeta pm_tracking ON pm_tracking.post_id = o.ID AND pm_tracking.meta_key = '_tracking_number'
      LEFT JOIN wp_postmeta pm_payment ON pm_payment.post_id = o.ID AND pm_payment.meta_key = '_payment_method_title'
      LEFT JOIN wp_users u ON u.ID = (SELECT meta_value FROM wp_postmeta WHERE post_id = o.ID AND meta_key = '_customer_user' LIMIT 1)
      WHERE o.post_type = 'shop_order'
        AND (pm_tracking.meta_value LIKE ? OR o.ID = ?)
      ORDER BY o.post_date DESC
      LIMIT 1
    `;
    
    const [orders] = await pool.execute(query, [`%${cleanCode}%`, cleanCode]);
    
    if (orders.length === 0) {
      // جستجوی جایگزین
      const altQuery = `
        SELECT 
          order_item_name as product_name,
          order_id
        FROM wp_woocommerce_order_items
        WHERE order_item_type = 'line_item'
          AND order_id IN (SELECT ID FROM wp_posts WHERE post_type = 'shop_order' AND post_status != 'trash')
        LIMIT 5
      `;
      
      const [sampleOrders] = await pool.execute(altQuery);
      
      return { 
        found: false, 
        message: `سفارشی با کد ${trackingCode} یافت نشد.`,
        sample_orders: sampleOrders.slice(0, 3)
      };
    }
    
    const order = orders[0];
    
    // دریافت محصولات سفارش
    const itemsQuery = `
      SELECT order_item_name as name
      FROM wp_woocommerce_order_items
      WHERE order_id = ? 
        AND order_item_type = 'line_item'
    `;
    
    const [items] = await pool.execute(itemsQuery, [order.order_id]);
    
    const statusMap = {
      'processing': 'در حال پردازش',
      'completed': 'تکمیل شده',
      'pending': 'در انتظار پرداخت',
      'on-hold': 'در انتظار بررسی',
      'cancelled': 'لغو شده',
      'refunded': 'مرجوع شده',
      'failed': 'ناموفق'
    };
    
    return {
      found: true,
      order: {
        id: order.order_id,
        tracking_code: order.tracking_code || cleanCode,
        date: new Date(order.order_date).toLocaleDateString('fa-IR'),
        status: statusMap[order.status] || order.status || 'نامشخص',
        total: order.total ? parseInt(order.total).toLocaleString('fa-IR') : '0',
        customer_name: order.customer_name || 'مشتری ناشناس',
        customer_email: order.customer_email || 'ندارد',
        payment: order.payment_method || 'آنلاین / کارت به کارت',
        items: items.map(item => item.name).slice(0, 5) || ['جزئیات محصولات در دسترس نیست']
      }
    };
    
  } catch (error) {
    console.error('خطا در پیگیری سفارش:', error.message);
    return { 
      found: false, 
      error: 'خطا در اتصال به دیتابیس',
      message: 'سیستم پیگیری موقتاً در دسترس نیست. لطفاً بعداً تلاش کنید.'
    };
  }
}

// ==================== هوش مصنوعی ترکیبی ====================
async function intelligentAIResponse(message, session) {
  const cleanMessage = message.trim();
  
  // 1. تشخیص کد رهگیری (4 تا 20 رقم)
  const trackingMatch = cleanMessage.match(/\b\d{4,20}\b/);
  if (trackingMatch) {
    const trackingCode = trackingMatch[0];
    const orderInfo = await trackOrderInDatabase(trackingCode);
    
    if (orderInfo.found) {
      const order = orderInfo.order;
      const itemsText = order.items.map((item, idx) => `${idx + 1}. ${item}`).join('\n');
      
      return {
        type: 'order_tracking',
        text: `✅ **سفارش شما پیدا شد!**\n\n` +
              `👤 **مشتری:** ${order.customer_name}\n` +
              `📦 **کد رهگیری:** ${order.tracking_code}\n` +
              `📅 **تاریخ سفارش:** ${order.date}\n` +
              `🟢 **وضعیت:** ${order.status}\n` +
              `💳 **روش پرداخت:** ${order.payment}\n` +
              `💰 **مبلغ کل:** ${order.total} تومان\n\n` +
              `🛍️ **محصولات:**\n${itemsText}\n\n` +
              `اگر سوال دیگری دارید در خدمتم! 😊`,
        data: orderInfo.order
      };
    } else {
      return {
        type: 'order_not_found',
        text: `🔍 **نتیجه جستجو:**\n\n` +
              `سفارشی با کد \`${trackingCode}\` پیدا نشد.\n\n` +
              `**لطفاً بررسی کنید:**\n` +
              `• کد را دقیق وارد کنید\n` +
              `• ممکن است سفارش هنوز ثبت نشده باشد\n` +
              `• شماره سفارش خود را نیز امتحان کنید\n\n` +
              `یا می‌توانید مستقیماً با پشتیبانی تماس بگیرید. 📞`
      };
    }
  }
  
  // 2. تشخیص درخواست محصول
  const hasProductKeywords = 
    cleanMessage.includes('پیراهن') || cleanMessage.includes('تیشرت') || 
    cleanMessage.includes('شلوار') || cleanMessage.includes('کفش') ||
    cleanMessage.includes('لباس') || cleanMessage.includes('محصول') ||
    cleanMessage.includes('خرید') || cleanMessage.includes('پیشنهاد') ||
    cleanMessage.includes('رنگ') || cleanMessage.includes('سایز');
  
  if (hasProductKeywords) {
    const color = extractColor(cleanMessage);
    const size = extractSize(cleanMessage);
    const productType = extractProductType(cleanMessage);
    
    // ذخیره ترجیحات
    if (color) session.preferences.color = color;
    if (size) session.preferences.size = size;
    
    const products = await searchProductsInDatabase({
      color,
      size,
      productType,
      searchTerm: productType || cleanMessage,
      limit: 5
    });
    
    if (products.length > 0) {
      let responseText = `🎯 **پیشنهادات ویژه برای شما:**\n\n`;
      
      products.forEach((product, index) => {
        const priceText = product.on_sale 
          ? `~~${product.regular_price?.toLocaleString('fa-IR') || product.price.toLocaleString('fa-IR')}~~ **${product.price.toLocaleString('fa-IR')} تومان** 🔥`
          : `${product.price.toLocaleString('fa-IR')} تومان`;
        
        responseText += `${index + 1}. **${product.name}**\n`;
        responseText += `   💰 ${priceText}\n`;
        responseText += `   📦 ${product.stock_status}\n`;
        if (product.colors.length > 0) {
          responseText += `   🎨 رنگ‌ها: ${product.colors.join(', ')}\n`;
        }
        if (product.sizes.length > 0) {
          responseText += `   📏 سایزها: ${product.sizes.join(', ')}\n`;
        }
        responseText += `   🔗 [مشاهده محصول](${product.url})\n\n`;
      });
      
      responseText += `💡 *نکته:* برای سفارش روی لینک محصولات کلیک کنید یا کد رهگیری وارد کنید.`;
      
      return {
        type: 'product_suggestions',
        text: responseText,
        data: { products, filters: { color, size, productType } }
      };
    }
  }
  
  // 3. سلام و احوالپرسی
  const greetings = ['سلام', 'درود', 'هلو', 'hello', 'hi', 'slm', 'salam'];
  const isGreeting = greetings.some(g => cleanMessage.toLowerCase().includes(g.toLowerCase()));
  
  if (isGreeting) {
    const greetings = [
      'سلام عزیزم! 😊 به پشتیبانی هوشمند شیک‌پوشان خوش اومدی. چطور می‌تونم کمکت کنم؟',
      'درود بر شما! 🌟 آماده‌ام تا در مورد سفارشات یا محصولات راهنماییتون کنم.',
      'سلام و وقت بخیر! 🛍️ برای پیگیری سفارش کد رهگیری رو وارد کنید یا در مورد محصولات سوال بپرسید.'
    ];
    
    return {
      type: 'greeting',
      text: greetings[Math.floor(Math.random() * greetings.length)]
    };
  }
  
  // 4. درخواست کمک
  if (cleanMessage.includes('کمک') || cleanMessage.includes('راهنمایی') || cleanMessage.includes('help')) {
    return {
      type: 'help',
      text: `🤖 **راهنمای پشتیبانی:**\n\n` +
            `**1. پیگیری سفارش:**\nکد رهگیری 4 تا 20 رقمی خود را وارد کنید.\n\n` +
            `**2. مشاهده محصولات:**\nمثلاً بنویسید: "پیراهن آبی سایز M" یا "کفش ورزشی"\n\n` +
            `**3. ارتباط با اپراتور:**\nبرای صحبت با پشتیبانی انسانی، کلمه "اپراتور" را بنویسید.\n\n` +
            `**4. اطلاعات تماس:**\nتلفن: 021-xxxxxxx\nایمیل: info@shikpooshaan.ir\n\n` +
            `چه سوالی دارید؟ 😊`
    };
  }
  
  // 5. درخواست اپراتور
  if (cleanMessage.includes('اپراتور') || cleanMessage.includes('انسان') || cleanMessage.includes('پشتیبانی')) {
    return {
      type: 'operator_request',
      text: `👨‍💼 **درخواست اپراتور**\n\n` +
            `درخواست شما برای اتصال به اپراتور انسانی ثبت شد.\n` +
            `لطفاً منتظر بمانید...\n\n` +
            `🔔 به محض آماده شدن اپراتور به شما اطلاع می‌دهم.`
    };
  }
  
  // 6. استفاده از OpenAI (اگر فعال باشد)
  if (openai && cleanMessage.length > 10) {
    try {
      const completion = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: `تو دستیار پشتیبانی فروشگاه لباس "شیک‌پوشان" هستی. 
            زبان: فارسی ساده و مودب
            موضوع: فروش لباس، پیگیری سفارش، پیشنهاد محصول
            سبک: پاسخ‌های کوتاه، مفید، دوستانه
            اگر کاربر کد رهگیری بدهد، اطلاعات سفارش را بده.
            اگر در مورد محصول بپرسد، از رنگ و سایز مورد نظرش بپرس.
            اگر سوال دیگری پرسید، مفید راهنمایی کن.
            حتماً از ایموجی مناسب استفاده کن.`
          },
          {
            role: "user",
            content: cleanMessage
          }
        ],
        max_tokens: 300,
        temperature: 0.7
      });
      
      const aiResponse = completion.data.choices[0].message.content.trim();
      
      if (aiResponse && aiResponse.length > 10) {
        return {
          type: 'ai_response',
          text: aiResponse
        };
      }
    } catch (error) {
      console.log('OpenAI خطا داد:', error.message);
    }
  }
  
  // 7. پاسخ پیش‌فرض
  const defaultResponses = [
    `جالب بود! 😊 لطفاً بیشتر توضیح دهید یا:\n• کد رهگیری سفارش را وارد کنید\n• در مورد محصول مورد نظر بپرسید\n• برای اپراتور بنویسید "اپراتور"`,
    `متوجه سوال شما شدم! 🤔 برای کمک بهتر:\n📦 برای پیگیری سفارش: کد رهگیری\n🛍️ برای محصولات: نوع و رنگ محصول\n👨‍💼 برای اپراتور: بنویسید "اپراتور"`,
    `سوال خوبی پرسیدید! 🌟\nاگر در مورد سفارشی سوال دارید، کد رهگیری را بفرستید.\nاگر محصول می‌خواهید، رنگ و سایز را بگویید.\nاگر نیاز به اپراتور دارید، کلمه "اپراتور" را تایپ کنید.`
  ];
  
  return {
    type: 'default',
    text: defaultResponses[Math.floor(Math.random() * defaultResponses.length)]
  };
}

// ==================== ربات تلگرام ====================
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

bot.action(/accept_(.+)/, async (ctx) => {
  const short = ctx.match[1];
  const info = botSessions.get(short);
  
  if (!info) {
    return ctx.answerCbQuery('درخواست منقضی شده است');
  }
  
  botSessions.set(short, { ...info, chatId: ctx.chat.id });
  updateSession(info.fullId, { connectedToHuman: true });
  
  await ctx.answerCbQuery('✅ پذیرفته شد');
  
  await ctx.editMessageText(`
👤 **پشتیبانی فعال شد**

📋 **اطلاعات کاربر:**
├ نام: ${info.userInfo?.name || 'ناشناس'}
├ صفحه: ${info.userInfo?.page || 'نامشخص'}
├ آی‌پی: ${info.userInfo?.ip || 'نامشخص'}
└ کد: ${short}

💬 **پیام اول:** ${info.userMessage || 'درخواست اتصال'}

🔗 اکنون می‌توانید با کاربر چت کنید.
  `.trim());
  
  // اطلاع به کاربر
  io.to(info.fullId).emit('operator-connected', {
    message: '🎉 اپراتور متصل شد! لطفاً سوال خود را بپرسید.',
    operator: ctx.from.first_name || 'اپراتور'
  });
  
  // ارسال تاریخچه
  const session = getSession(info.fullId);
  const history = session.messages
    .slice(-5)
    .map(m => `${m.role === 'user' ? '👤 کاربر' : '🤖 ربات'}: ${m.content}`)
    .join('\n\n');
  
  await ctx.reply(`📜 **تاریخچه اخیر:**\n\n${history || 'هنوز پیامی رد و بدل نشده'}`);
});

bot.action(/reject_(.+)/, async (ctx) => {
  const short = ctx.match[1];
  const info = botSessions.get(short);
  
  if (info) {
    io.to(info.fullId).emit('operator-rejected', {
      message: 'متأسفانه در حال حاضر اپراتور در دسترس نیست. لطفاً سوال خود را از من بپرسید. 😊'
    });
  }
  
  botSessions.delete(short);
  await ctx.answerCbQuery('❌ رد شد');
});

bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  
  const entry = [...botSessions.entries()].find(([_, v]) => v.chatId === ctx.chat.id);
  if (!entry) return;
  
  const [short, info] = entry;
  
  // ارسال پیام به کاربر
  io.to(info.fullId).emit('operator-message', { 
    message: ctx.message.text,
    operator: ctx.from.first_name || 'اپراتور',
    timestamp: new Date().toISOString()
  });
  
  // ذخیره در تاریخچه
  const session = getSession(info.fullId);
  session.messages.push({ 
    role: 'operator', 
    content: ctx.message.text,
    timestamp: new Date().toISOString()
  });
  cache.set(info.fullId, session);
  
  await ctx.reply('✅ پیام ارسال شد');
});

// ==================== API های اصلی ====================

// وب‌هوک تلگرام
app.post('/telegram-webhook', (req, res) => {
  bot.handleUpdate(req.body, res);
});

// API چت اصلی
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId, userInfo } = req.body;
    
    if (!message || !sessionId) {
      return res.status(400).json({ 
        success: false, 
        error: 'پیام و شناسه جلسه الزامی هستند' 
      });
    }
    
    // مدیریت نشست
    let session = getSession(sessionId);
    if (userInfo) {
      session.userInfo = { ...session.userInfo, ...userInfo };
    }
    
    // ذخیره پیام کاربر
    session.messages.push({ 
      role: 'user', 
      content: message,
      timestamp: new Date().toISOString()
    });
    updateSession(sessionId, session);
    
    // بررسی اتصال اپراتور
    const short = shortId(sessionId);
    const botSessionInfo = botSessions.get(short);
    
    if (botSessionInfo?.chatId && session.connectedToHuman) {
      // ارسال به اپراتور
      const userName = session.userInfo?.name || 'ناشناس';
      await bot.telegram.sendMessage(
        botSessionInfo.chatId,
        `👤 **پیام از کاربر**\n\n` +
        `📌 کد: ${short}\n` +
        `👤 نام: ${userName}\n` +
        `💬 پیام:\n${message}`
      );
      
      return res.json({ 
        success: true, 
        operatorConnected: true,
        message: 'پیام شما به اپراتور ارسال شد. منتظر پاسخ باشید...',
        timestamp: new Date().toISOString()
      });
    }
    
    // پردازش با هوش مصنوعی
    const aiResponse = await intelligentAIResponse(message, session);
    
    // ذخیره پاسخ
    session.messages.push({ 
      role: 'ai', 
      content: aiResponse.text,
      timestamp: new Date().toISOString(),
      type: aiResponse.type
    });
    updateSession(sessionId, session);
    
    // ارسال پاسخ به صورت real-time اگر سوکت متصل است
    if (session.socketId) {
      io.to(session.socketId).emit('ai-response', {
        message: aiResponse.text,
        type: aiResponse.type,
        timestamp: new Date().toISOString()
      });
    }
    
    res.json({ 
      success: true, 
      message: aiResponse.text,
      type: aiResponse.type,
      data: aiResponse.data || null,
      sessionId: sessionId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('خطا در API چت:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      message: 'با عرض پوزش، خطایی در پردازش رخ داد. لطفاً دوباره تلاش کنید.'
    });
  }
});

// API درخواست اتصال به اپراتور
app.post('/api/connect-human', async (req, res) => {
  try {
    const { sessionId, userInfo, reason } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ 
        success: false, 
        error: 'شناسه جلسه الزامی است' 
      });
    }
    
    const session = getSession(sessionId);
    const short = shortId(sessionId);
    
    // ذخیره درخواست
    botSessions.set(short, { 
      fullId: sessionId, 
      userInfo: { ...session.userInfo, ...userInfo }, 
      chatId: null,
      userMessage: reason || 'درخواست اتصال به اپراتور'
    });
    
    // ارسال به تلگرام
    const userName = session.userInfo?.name || 'ناشناس';
    const userPage = session.userInfo?.page || 'نامشخص';
    const userIp = session.userInfo?.ip || 'نامشخص';
    
    await bot.telegram.sendMessage(
      ADMIN_TELEGRAM_ID,
      `🔔 **درخواست پشتیبانی جدید**\n\n` +
      `📝 **کد جلسه:** \`${short}\`\n` +
      `👤 **کاربر:** ${userName}\n` +
      `🌐 **صفحه:** ${userPage}\n` +
      `📡 **آی‌پی:** ${userIp}\n` +
      `💬 **دلیل:** ${reason || 'درخواست اتصال به اپراتور'}\n\n` +
      `⏰ زمان: ${new Date().toLocaleTimeString('fa-IR')}`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ پذیرش درخواست', callback_data: `accept_${short}` },
            { text: '❌ رد درخواست', callback_data: `reject_${short}` }
          ]]
        }
      }
    );
    
    // اطلاع به کاربر
    io.to(sessionId).emit('operator-requested', {
      message: '✅ درخواست شما به اپراتور ارسال شد. لطفاً منتظر پذیرش بمانید...'
    });
    
    res.json({ 
      success: true, 
      pending: true,
      message: 'درخواست شما برای اپراتور ارسال شد. منتظر پذیرش باشید...',
      sessionId: short
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// API جستجوی محصولات
app.post('/api/search-products', async (req, res) => {
  try {
    const { query, color, size, category, limit = 5 } = req.body;
    
    const products = await searchProductsInDatabase({
      searchTerm: query,
      color,
      size,
      productType: category,
      limit: Math.min(limit, 10)
    });
    
    res.json({
      success: true,
      count: products.length,
      products: products,
      filters: { query, color, size, category }
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      products: []
    });
  }
});

// API پیگیری سفارش
app.post('/api/track-order', async (req, res) => {
  try {
    const { trackingCode } = req.body;
    
    if (!trackingCode) {
      return res.status(400).json({ 
        success: false, 
        error: 'کد رهگیری الزامی است' 
      });
    }
    
    const result = await trackOrderInDatabase(trackingCode);
    
    if (result.found) {
      res.json({
        success: true,
        found: true,
        order: result.order,
        message: 'سفارش پیدا شد'
      });
    } else {
      res.json({
        success: true,
        found: false,
        message: result.message || 'سفارش پیدا نشد'
      });
    }
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// API وضعیت سرور
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    status: 'online',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    services: {
      database: 'connected',
      telegram_bot: TELEGRAM_BOT_TOKEN ? 'active' : 'inactive',
      openai: OPENAI_API_KEY ? 'active' : 'inactive',
      socket_io: 'active'
    },
    statistics: {
      active_sessions: cache.keys().length,
      bot_sessions: botSessions.size,
      memory_usage: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
    }
  });
});

// API تست دیتابیس
app.get('/api/test-db', async (req, res) => {
  try {
    const [result] = await pool.execute('SELECT NOW() as db_time, DATABASE() as db_name');
    res.json({ 
      success: true, 
      message: 'اتصال دیتابیس موفق',
      database: result[0].db_name,
      time: result[0].db_time
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==================== سوکت‌های زمان واقعی ====================
io.on('connection', (socket) => {
  console.log('🔌 کاربر جدید متصل شد:', socket.id);
  
  socket.on('join-session', (sessionId) => {
    if (sessionId) {
      socket.join(sessionId);
      const session = getSession(sessionId);
      session.socketId = socket.id;
      cache.set(sessionId, session);
      
      console.log(`📱 سوکت ${socket.id} به جلسه ${sessionId} پیوست`);
      
      // ارسال سلام اولیه
      socket.emit('welcome', {
        message: 'به پشتیبانی هوشمند شیک‌پوشان خوش آمدید! 😊',
        sessionId: sessionId,
        timestamp: new Date().toISOString()
      });
    }
  });
  
  socket.on('user-message', async ({ sessionId, message }) => {
    if (!sessionId || !message) return;
    
    const short = shortId(sessionId);
    const info = botSessions.get(short);
    
    if (info?.chatId) {
      const session = getSession(sessionId);
      const userName = session.userInfo?.name || 'ناشناس';
      
      await bot.telegram.sendMessage(
        info.chatId,
        `💬 **پیام جدید**\n\n` +
        `👤 کاربر: ${userName}\n` +
        `📌 کد: ${short}\n` +
        `📝 پیام:\n${message}`
      );
    }
  });
  
  socket.on('disconnect', () => {
    console.log('🔌 کاربر قطع شد:', socket.id);
  });
});

// ==================== فایل‌های استاتیک برای ویجت ====================

// صفحه اصلی نمایش ویجت
app.get('/widget', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'widget.html'));
});

// اسکریپت جاسازی ویجت
app.get('/widget.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`
    // ویجت چت پشتیبانی شیک‌پوشان
    (function() {
      const widgetConfig = {
        position: 'bottom-right',
        primaryColor: '#4A90E2',
        accentColor: '#FF6B6B',
        title: 'پشتیبانی شیک‌پوشان',
        subtitle: 'پاسخگویی 24 ساعته',
        serverUrl: '${BASE_URL}'
      };
      
      // کد ویجت اینجا لود می‌شود
      console.log('ویجت شیک‌پوشان لود شد');
    })();
  `);
});

// صفحه تست ویجت
app.get('/test-widget', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>تست ویجت پشتیبانی</title>
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          margin: 0;
          padding: 20px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          color: #333;
        }
        .container {
          max-width: 800px;
          margin: 50px auto;
          background: white;
          padding: 40px;
          border-radius: 20px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        h1 {
          color: #4A90E2;
          text-align: center;
          margin-bottom: 30px;
        }
        .test-buttons {
          display: flex;
          flex-direction: column;
          gap: 15px;
          margin: 30px 0;
        }
        .test-btn {
          padding: 15px;
          border: none;
          border-radius: 10px;
          background: #4A90E2;
          color: white;
          font-size: 16px;
          cursor: pointer;
          transition: all 0.3s;
        }
        .test-btn:hover {
          background: #357ae8;
          transform: translateY(-2px);
        }
        .status {
          padding: 15px;
          background: #f8f9fa;
          border-radius: 10px;
          margin: 20px 0;
          text-align: center;
          font-weight: bold;
        }
        .status.online {
          background: #d4edda;
          color: #155724;
        }
        .status.offline {
          background: #f8d7da;
          color: #721c24;
        }
        .instructions {
          background: #fff3cd;
          padding: 20px;
          border-radius: 10px;
          margin: 20px 0;
          line-height: 1.8;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🧪 تست ویجت پشتیبانی هوشمند</h1>
        
        <div class="instructions">
          <h3>📋 راهنمای تست:</h3>
          <p>1. ابتدا وضعیت سرور را چک کنید</p>
          <p>2. می‌توانید API های مختلف را تست کنید</p>
          <p>3. برای تست کامل، از دکمه‌های زیر استفاده کنید</p>
        </div>
        
        <div class="test-buttons">
          <button class="test-btn" onclick="testStatus()">🔍 تست وضعیت سرور</button>
          <button class="test-btn" onclick="testChat()">💬 تست چت هوشمند</button>
          <button class="test-btn" onclick="testProducts()">🛍️ تست جستجوی محصولات</button>
          <button class="test-btn" onclick="testTracking()">📦 تست پیگیری سفارش</button>
          <button class="test-btn" onclick="openWidget()">🎯 بازکردن ویجت کامل</button>
        </div>
        
        <div id="status" class="status">آماده تست...</div>
        <div id="result" style="white-space: pre-wrap; padding: 20px; background: #f8f9fa; border-radius: 10px; margin-top: 20px;"></div>
      </div>
      
      <script>
        const BASE_URL = '${BASE_URL}';
        const sessionId = 'test_' + Date.now();
        
        function showResult(text, isError = false) {
          const resultDiv = document.getElementById('result');
          resultDiv.innerHTML = text;
          resultDiv.style.color = isError ? '#dc3545' : '#28a745';
        }
        
        function updateStatus(text, isOnline = true) {
          const statusDiv = document.getElementById('status');
          statusDiv.textContent = text;
          statusDiv.className = 'status ' + (isOnline ? 'online' : 'offline');
        }
        
        async function testStatus() {
          updateStatus('در حال بررسی وضعیت سرور...');
          try {
            const response = await fetch(BASE_URL + '/api/status');
            const data = await response.json();
            updateStatus('✅ سرور آنلاین است');
            showResult(JSON.stringify(data, null, 2));
          } catch (error) {
            updateStatus('❌ سرور آفلاین است', false);
            showResult('خطا: ' + error.message, true);
          }
        }
        
        async function testChat() {
          updateStatus('در حال تست چت...');
          try {
            const response = await fetch(BASE_URL + '/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: 'سلام',
                sessionId: sessionId
              })
            });
            const data = await response.json();
            updateStatus('✅ چت تست شد');
            showResult('پاسخ ربات: ' + data.message);
          } catch (error) {
            updateStatus('❌ خطا در چت', false);
            showResult('خطا: ' + error.message, true);
          }
        }
        
        async function testProducts() {
          updateStatus('در حال جستجوی محصولات...');
          try {
            const response = await fetch(BASE_URL + '/api/search-products', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                query: 'پیراهن',
                limit: 3
              })
            });
            const data = await response.json();
            updateStatus('✅ محصولات یافت شد');
            const productsText = data.products.map(p => 
              \`\${p.name} - \${p.price.toLocaleString()} تومان\`
            ).join('\\n');
            showResult(\`تعداد: \${data.count}\\n\\n\${productsText}\`);
          } catch (error) {
            updateStatus('❌ خطا در جستجو', false);
            showResult('خطا: ' + error.message, true);
          }
        }
        
        async function testTracking() {
          updateStatus('در حال تست پیگیری...');
          try {
            const response = await fetch(BASE_URL + '/api/track-order', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                trackingCode: '123456'
              })
            });
            const data = await response.json();
            updateStatus(data.found ? '✅ سفارش یافت شد' : '🔍 سفارش یافت نشد');
            showResult(JSON.stringify(data, null, 2));
          } catch (error) {
            updateStatus('❌ خطا در پیگیری', false);
            showResult('خطا: ' + error.message, true);
          }
        }
        
        function openWidget() {
          window.open(BASE_URL + '/widget', '_blank');
        }
        
        // تست اولیه
        testStatus();
      </script>
    </body>
    </html>
  `);
});

// صفحه اصلی
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>پشتیبانی هوشمند شیک‌پوشان</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 20px;
          color: #333;
        }
        
        .container {
          background: white;
          padding: 50px;
          border-radius: 25px;
          box-shadow: 0 30px 80px rgba(0,0,0,0.4);
          max-width: 900px;
          width: 100%;
          text-align: center;
        }
        
        h1 {
          color: #4A90E2;
          margin-bottom: 20px;
          font-size: 2.5em;
        }
        
        .subtitle {
          color: #666;
          font-size: 1.2em;
          margin-bottom: 40px;
          line-height: 1.6;
        }
        
        .features {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 25px;
          margin: 40px 0;
        }
        
        .feature {
          background: #f8f9fa;
          padding: 30px;
          border-radius: 15px;
          transition: all 0.3s;
        }
        
        .feature:hover {
          transform: translateY(-10px);
          box-shadow: 0 15px 35px rgba(0,0,0,0.1);
        }
        
        .feature-icon {
          font-size: 3em;
          margin-bottom: 20px;
        }
        
        .feature h3 {
          color: #4A90E2;
          margin-bottom: 15px;
        }
        
        .buttons {
          display: flex;
          gap: 20px;
          justify-content: center;
          margin-top: 40px;
          flex-wrap: wrap;
        }
        
        .btn {
          padding: 15px 35px;
          border: none;
          border-radius: 50px;
          font-size: 16px;
          font-weight: bold;
          cursor: pointer;
          transition: all 0.3s;
          text-decoration: none;
          display: inline-block;
        }
        
        .btn-primary {
          background: #4A90E2;
          color: white;
        }
        
        .btn-primary:hover {
          background: #357ae8;
          transform: translateY(-3px);
        }
        
        .btn-secondary {
          background: #FF6B6B;
          color: white;
        }
        
        .btn-secondary:hover {
          background: #ff5252;
          transform: translateY(-3px);
        }
        
        .status-indicator {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 10px 20px;
          background: #d4edda;
          color: #155724;
          border-radius: 50px;
          margin-top: 20px;
          font-weight: bold;
        }
        
        .status-dot {
          width: 10px;
          height: 10px;
          background: #28a745;
          border-radius: 50%;
          animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.5; }
          100% { opacity: 1; }
        }
        
        .instructions {
          background: #fff3cd;
          padding: 25px;
          border-radius: 15px;
          margin: 30px 0;
          text-align: right;
          line-height: 1.8;
        }
        
        @media (max-width: 768px) {
          .container {
            padding: 30px;
          }
          
          .buttons {
            flex-direction: column;
          }
          
          .btn {
            width: 100%;
          }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🤖 پشتیبانی هوشمند شیک‌پوشان</h1>
        
        <p class="subtitle">
          سیستم پیشرفته پشتیبانی با هوش مصنوعی، پیگیری سفارش و پیشنهاد محصولات
        </p>
        
        <div class="status-indicator">
          <div class="status-dot"></div>
          سرور فعال و آماده خدمات‌رسانی
        </div>
        
        <div class="features">
          <div class="feature">
            <div class="feature-icon">🤖</div>
            <h3>هوش مصنوعی پیشرفته</h3>
            <p>پاسخگویی خودکار به سوالات با دقت بالا</p>
          </div>
          
          <div class="feature">
            <div class="feature-icon">📦</div>
            <h3>پیگیری سفارش</h3>
            <p>پیگیری لحظه‌ای سفارشات با کد رهگیری</p>
          </div>
          
          <div class="feature">
            <div class="feature-icon">🛍️</div>
            <h3>پیشنهاد محصول</h3>
            <p>پیشنهاد هوشمند محصولات بر اساس نیاز شما</p>
          </div>
          
          <div class="feature">
            <div class="feature-icon">👨‍💼</div>
            <h3>پشتیبانی انسانی</h3>
            <p>اتصال مستقیم به اپراتور در صورت نیاز</p>
          </div>
        </div>
        
        <div class="instructions">
          <h3>📋 راهنمای استفاده:</h3>
          <p>1. برای استفاده از ویجت، روی دکمه "تست ویجت" کلیک کنید</p>
          <p>2. برای جاسازی در سایت، از آدرس ${BASE_URL}/widget استفاده کنید</p>
          <p>3. API ها مستقیماً قابل فراخوانی هستند</p>
          <p>4. برای تنظیمات بیشتر با پشتیبانی تماس بگیرید</p>
        </div>
        
        <div class="buttons">
          <a href="/test-widget" class="btn btn-primary">🧪 تست ویجت</a>
          <a href="/api/status" class="btn btn-secondary">📊 وضعیت سرور</a>
          <a href="/api/test-db" class="btn btn-primary">🗄️ تست دیتابیس</a>
        </div>
        
        <div style="margin-top: 40px; color: #666; font-size: 0.9em;">
          <p>📞 پشتیبانی: 021-xxxxxxx | ✉️ info@shikpooshaan.ir</p>
          <p>© ${new Date().getFullYear()} شیک‌پوشان - تمامی حقوق محفوظ است</p>
        </div>
      </div>
      
      <script>
        // تست خودکار وضعیت
        fetch('/api/status')
          .then(res => res.json())
          .then(data => {
            if (data.success) {
              console.log('✅ سرور آماده:', data);
            }
          })
          .catch(err => console.warn('⚠️ تست سرور:', err));
      </script>
    </body>
    </html>
  `);
});

// ==================== راه‌اندازی سرور ====================
async function startServer() {
  try {
    // تست اتصال دیتابیس
    const connection = await pool.getConnection();
    console.log('✅ اتصال به دیتابیس موفق');
    connection.release();
    
    server.listen(PORT, '0.0.0.0', async () => {
      console.log(`🚀 سرور روی پورت ${PORT} فعال شد`);
      console.log(`🌐 آدرس اصلی: ${BASE_URL}`);
      console.log(`🔗 تست ویجت: ${BASE_URL}/test-widget`);
      console.log(`📊 وضعیت سرور: ${BASE_URL}/api/status`);
      
      try {
        // تنظیم وب‌هوک تلگرام
        await bot.telegram.setWebhook(`${BASE_URL}/telegram-webhook`);
        console.log('✅ وب‌هوک تلگرام تنظیم شد');
        
        // اطلاع به مدیر
        await bot.telegram.sendMessage(
          ADMIN_TELEGRAM_ID,
          `🟢 **سرور راه‌اندازی شد**\n\n` +
          `📡 آدرس: ${BASE_URL}\n` +
          `⏰ زمان: ${new Date().toLocaleString('fa-IR')}\n` +
          `💾 دیتابیس: متصل ✅\n` +
          `🤖 ربات: فعال ✅\n` +
          `🧠 هوش مصنوعی: ${OPENAI_API_KEY ? 'فعال ✅' : 'غیرفعال ⚠️'}\n\n` +
          `🔗 تست ویجت: ${BASE_URL}/test-widget`
        );
        
      } catch (tgError) {
        console.warn('⚠️ خطای تلگرام:', tgError.message);
        console.log('🔄 استفاده از polling...');
        bot.launch();
      }
    });
    
  } catch (dbError) {
    console.error('❌ خطا در اتصال دیتابیس:', dbError.message);
    console.log('🔄 راه‌اندازی سرور بدون دیتابیس...');
    
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 سرور روی پورت ${PORT} فعال شد (بدون دیتابیس)`);
      bot.launch();
    });
  }
}

// مدیریت graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 در حال خاموش کردن سرور...');
  try {
    await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, '🔴 سرور در حال خاموش شدن...');
    await pool.end();
  } catch (error) {
    console.error('خطا در خاموش کردن:', error);
  }
  process.exit(0);
});

// شروع سرور
startServer();
