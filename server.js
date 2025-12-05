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

let BASE_URL = process.env.RAILWAY_STATIC_URL || process.env.BACKEND_URL || '';
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
const openaiConfig = new Configuration({
  apiKey: OPENAI_API_KEY,
});
const openai = new OpenAIApi(openaiConfig);

// ==================== سرور و سوکت ====================
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { 
  cors: { 
    origin: "*", 
    methods: ["GET", "POST"],
    credentials: true 
  },
  transports: ['websocket', 'polling']
});

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(helmet({ 
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(express.static(path.join(__dirname, 'public')));

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
      messages: [], 
      userInfo: {}, 
      connectedToHuman: false,
      lastInteraction: Date.now(),
      orderHistory: [],
      preferences: {}
    };
    cache.set(id, session);
  }
  return session;
};

// به‌روزرسانی نشست
const updateSession = (id, updates) => {
  const session = getSession(id);
  Object.assign(session, updates, { lastInteraction: Date.now() });
  cache.set(id, session);
  return session;
};

// ==================== سیستم تشخیص کلمات کلیدی فارسی ====================
const extractKeywords = (text) => {
  const tokens = tokenizer.tokenize(text.toLowerCase());
  return tokens.map(token => stemmer.stem(token));
};

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
  
  return 'محصول';
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
        GROUP_CONCAT(DISTINCT pm_color.meta_value) as colors,
        GROUP_CONCAT(DISTINCT pm_size.meta_value) as sizes,
        (SELECT guid FROM wp_posts WHERE post_parent = p.ID AND post_type = 'attachment' ORDER BY menu_order LIMIT 1) as image_url
      FROM wp_posts p
      LEFT JOIN wp_postmeta pm_price ON pm_price.post_id = p.ID AND pm_price.meta_key = '_price'
      LEFT JOIN wp_postmeta pm_regular_price ON pm_regular_price.post_id = p.ID AND pm_regular_price.meta_key = '_regular_price'
      LEFT JOIN wp_postmeta pm_sale_price ON pm_sale_price.post_id = p.ID AND pm_sale_price.meta_key = '_sale_price'
      LEFT JOIN wp_postmeta pm_stock ON pm_stock.post_id = p.ID AND pm_stock.meta_key = '_stock_status'
      LEFT JOIN wp_postmeta pm_sku ON pm_sku.post_id = p.ID AND pm_sku.meta_key = '_sku'
      LEFT JOIN wp_postmeta pm_color ON pm_color.post_id = p.ID AND pm_color.meta_key IN ('_color', 'attribute_pa_color')
      LEFT JOIN wp_postmeta pm_size ON pm_size.post_id = p.ID AND pm_size.meta_key IN ('_size', 'attribute_pa_size')
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
    
    if (color) {
      conditions.push(`pm_color.meta_value LIKE ?`);
      params.push(`%${color}%`);
    }
    
    if (size) {
      conditions.push(`pm_size.meta_value LIKE ?`);
      params.push(`%${size}%`);
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
    
    return rows.map(row => ({
      id: row.product_id,
      name: row.product_name || 'بدون نام',
      description: (row.description || '').substring(0, 150) + '...',
      price: row.price ? parseInt(row.price) : 0,
      regular_price: row.regular_price ? parseInt(row.regular_price) : null,
      sale_price: row.sale_price ? parseInt(row.sale_price) : null,
      on_sale: row.sale_price !== null && row.sale_price !== row.price,
      stock_status: row.stock_status === 'instock' ? 'موجود' : 'ناموجود',
      sku: row.sku || 'ندارد',
      colors: row.colors ? row.colors.split(',') : [],
      sizes: row.sizes ? row.sizes.split(',') : [],
      image_url: row.image_url || 'https://via.placeholder.com/300x300?text=No+Image',
      url: `https://shikpooshaan.ir/product/?p=${row.product_id}`
    }));
    
  } catch (error) {
    console.error('خطا در جستجوی دیتابیس:', error);
    return [];
  }
}

// ==================== سیستم پیگیری سفارش از دیتابیس ====================
async function trackOrderInDatabase(trackingCode) {
  try {
    // جستجو در جدول سفارشات ووکامرس
    const query = `
      SELECT 
        o.ID as order_id,
        o.post_date as order_date,
        pm_status.meta_value as status,
        pm_total.meta_value as total,
        pm_customer.meta_value as customer_id,
        pm_tracking.meta_value as tracking_code,
        u.user_email as customer_email,
        u.display_name as customer_name,
        pm_payment.meta_value as payment_method,
        pm_items.meta_value as items_data
      FROM wp_posts o
      LEFT JOIN wp_postmeta pm_status ON pm_status.post_id = o.ID AND pm_status.meta_key = '_order_status'
      LEFT JOIN wp_postmeta pm_total ON pm_total.post_id = o.ID AND pm_total.meta_key = '_order_total'
      LEFT JOIN wp_postmeta pm_customer ON pm_customer.post_id = o.ID AND pm_customer.meta_key = '_customer_user'
      LEFT JOIN wp_postmeta pm_tracking ON pm_tracking.post_id = o.ID AND pm_tracking.meta_key = '_tracking_number'
      LEFT JOIN wp_postmeta pm_payment ON pm_payment.post_id = o.ID AND pm_payment.meta_key = '_payment_method_title'
      LEFT JOIN wp_postmeta pm_items ON pm_items.post_id = o.ID AND pm_items.meta_key = '_order_items'
      LEFT JOIN wp_users u ON u.ID = pm_customer.meta_value
      WHERE o.post_type = 'shop_order'
        AND (pm_tracking.meta_value = ? OR o.ID = ?)
      ORDER BY o.post_date DESC
      LIMIT 1
    `;
    
    const [orders] = await pool.execute(query, [trackingCode, trackingCode]);
    
    if (orders.length === 0) {
      // تلاش با جستجوی گسترده‌تر
      const searchQuery = `
        SELECT 
          pm.meta_value as tracking_code,
          p.ID as order_id,
          p.post_date as order_date,
          pm_status.meta_value as status,
          pm_total.meta_value as total,
          u.display_name as customer_name
        FROM wp_postmeta pm
        JOIN wp_posts p ON p.ID = pm.post_id
        LEFT JOIN wp_postmeta pm_status ON pm_status.post_id = p.ID AND pm_status.meta_key = '_order_status'
        LEFT JOIN wp_postmeta pm_total ON pm_total.post_id = p.ID AND pm_total.meta_key = '_order_total'
        LEFT JOIN wp_users u ON u.ID = (SELECT meta_value FROM wp_postmeta WHERE post_id = p.ID AND meta_key = '_customer_user' LIMIT 1)
        WHERE p.post_type = 'shop_order'
          AND pm.meta_key = '_tracking_number'
          AND pm.meta_value LIKE ?
        LIMIT 1
      `;
      
      const [fuzzyResults] = await pool.execute(searchQuery, [`%${trackingCode}%`]);
      if (fuzzyResults.length > 0) {
        const order = fuzzyResults[0];
        return {
          found: true,
          order: {
            id: order.order_id,
            tracking_code: order.tracking_code,
            date: new Date(order.order_date).toLocaleDateString('fa-IR'),
            status: this.translateStatus(order.status),
            total: order.total ? parseInt(order.total).toLocaleString('fa-IR') : '0',
            customer_name: order.customer_name || 'مشتری ناشناس',
            payment: 'کارت به کارت / آنلاین',
            items: ['محصولات سفارش - برای جزئیات بیشتر با پشتیبانی تماس بگیرید']
          }
        };
      }
      
      return { found: false };
    }
    
    const order = orders[0];
    
    // استخراج محصولات سفارش
    let items = [];
    if (order.items_data) {
      try {
        const itemsArray = JSON.parse(order.items_data);
        items = itemsArray.map(item => 
          `${item.name || 'محصول'} - ${item.quantity || 1} عدد`
        );
      } catch (e) {
        items = ['جزئیات محصولات در دسترس نیست'];
      }
    }
    
    // اگر محصولات پیدا نشد، از جدول order items جستجو کن
    if (items.length === 0) {
      const itemsQuery = `
        SELECT 
          order_item_name as name,
          order_item_type as type
        FROM wp_woocommerce_order_items
        WHERE order_id = ?
          AND order_item_type = 'line_item'
      `;
      
      const [orderItems] = await pool.execute(itemsQuery, [order.order_id]);
      items = orderItems.map(item => item.name);
    }
    
    if (items.length === 0) {
      items = ['محصولات سفارش'];
    }
    
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
        tracking_code: order.tracking_code || trackingCode,
        date: new Date(order.order_date).toLocaleDateString('fa-IR'),
        status: statusMap[order.status] || order.status || 'نامشخص',
        total: order.total ? parseInt(order.total).toLocaleString('fa-IR') : '0',
        customer_name: order.customer_name || 'مشتری ناشناس',
        customer_email: order.customer_email || 'ندارد',
        payment: order.payment_method || 'کارت به کارت / آنلاین',
        items: items
      }
    };
    
  } catch (error) {
    console.error('خطا در پیگیری سفارش:', error);
    return { found: false, error: error.message };
  }
}

// ==================== هوش مصنوعی ترکیبی (OpenAI + منطق داخلی) ====================
async function intelligentAIResponse(message, session) {
  try {
    // اگر پیام خیلی کوتاه است از منطق داخلی استفاده کن
    if (message.length < 5) {
      const greetings = ['سلام', 'درود', 'هی', 'hello', 'hi', 'سلامت', 'علیک', 'السلام'];
      if (greetings.some(g => message.includes(g))) {
        return 'سلام عزیزم! 😊 خوش اومدی. چطور می‌تونم کمکتون کنم؟ می‌تونید کد رهگیری سفارشتون رو وارد کنید یا در مورد محصولات سوال بپرسید.';
      }
      return 'لطفاً کمی بیشتر توضیح دهید تا بتونم کمک مفیدی براتون داشته باشم.';
    }
    
    // تحلیل پیام برای تشخیص نوع درخواست
    const keywords = extractKeywords(message);
    const hasTrackingRequest = /\d{4,20}/.test(message) || 
      message.includes('کد رهگیری') || 
      message.includes('پیگیری سفارش') || 
      message.includes('سفارش') && /\d/.test(message);
    
    const hasProductRequest = keywords.some(kw => 
      ['پیراهن', 'تیشرت', 'شلوار', 'کفش', 'لباس', 'محصول', 'خرید'].includes(kw)
    ) || message.includes('پیشنهاد') || message.includes('رنگ') || message.includes('سایز');
    
    const hasGreeting = ['سلام', 'درود', 'هلو', 'hi', 'hello'].some(g => message.includes(g));
    
    // 1. درخواست پیگیری سفارش
    if (hasTrackingRequest) {
      const trackingCode = message.match(/\d{4,20}/)?.[0];
      if (trackingCode) {
        const orderInfo = await trackOrderInDatabase(trackingCode);
        if (orderInfo.found) {
          const order = orderInfo.order;
          const itemsText = order.items.map((item, idx) => `${idx + 1}. ${item}`).join('\n');
          
          return `✅ **سفارش شما پیدا شد!**\n\n` +
                 `👤 **مشتری:** ${order.customer_name}\n` +
                 `📦 **کد رهگیری:** ${order.tracking_code}\n` +
                 `📅 **تاریخ سفارش:** ${order.date}\n` +
                 `🟢 **وضعیت:** ${order.status}\n` +
                 `💳 **روش پرداخت:** ${order.payment}\n` +
                 `💰 **مبلغ کل:** ${order.total} تومان\n\n` +
                 `🛍️ **محصولات سفارش:**\n${itemsText}\n\n` +
                 `اگر سوال دیگری دارید خوشحال می‌شم کمکتون کنم! 😊`;
        } else {
          return `متاسفانه سفارشی با کد رهگیری \`${trackingCode}\` پیدا نکردم. 😔\n\n` +
                 `لطفاً بررسی کنید:\n` +
                 `1. کد رهگیری را دقیق وارد کنید\n` +
                 `2. ممکن است سفارش هنوز در سیستم ثبت نشده باشد\n` +
                 `3. می‌توانید شماره سفارش خود را نیز امتحان کنید\n\n` +
                 `اگر مشکل ادامه داشت، لطفاً با پشتیبانی تماس بگیرید.`;
        }
      }
    }
    
    // 2. درخواست محصول یا پیشنهاد
    if (hasProductRequest) {
      const color = extractColor(message);
      const size = extractSize(message);
      const productType = extractProductType(message);
      
      // ذخیره ترجیحات کاربر در نشست
      if (color) session.preferences.color = color;
      if (size) session.preferences.size = size;
      
      // جستجو در دیتابیس
      const products = await searchProductsInDatabase({
        color,
        size,
        productType,
        searchTerm: productType,
        limit: 5
      });
      
      if (products.length > 0) {
        let response = `🎯 **پیشنهادات ویژه برای شما:**\n\n`;
        
        products.forEach((product, index) => {
          const priceText = product.on_sale 
            ? `~~${product.regular_price?.toLocaleString('fa-IR')}~~ **${product.price.toLocaleString('fa-IR')} تومان** 🔥`
            : `${product.price.toLocaleString('fa-IR')} تومان`;
          
          response += `${index + 1}. **${product.name}**\n`;
          response += `   💰 قیمت: ${priceText}\n`;
          response += `   📦 موجودی: ${product.stock_status}\n`;
          if (product.colors.length > 0) {
            response += `   🎨 رنگ‌ها: ${product.colors.join(', ')}\n`;
          }
          if (product.sizes.length > 0) {
            response += `   📏 سایزها: ${product.sizes.join(', ')}\n`;
          }
          response += `   🔗 [مشاهده محصول](${product.url})\n\n`;
        });
        
        response += `💡 *نکته:* می‌تونید روی لینک محصولات کلیک کنید یا برای سفارش کد رهگیری رو وارد کنید.`;
        
        // ذخیره تاریخچه محصولات دیده شده
        if (!session.orderHistory) session.orderHistory = [];
        session.orderHistory.push({
          type: 'product_view',
          products: products.map(p => p.id),
          timestamp: new Date().toISOString()
        });
        
        updateSession(session.id, session);
        
        return response;
      } else {
        // اگر محصولی پیدا نشد، محصولات پرفروش را نشان بده
        const popularProducts = await searchProductsInDatabase({ limit: 5 });
        if (popularProducts.length > 0) {
          let response = `با عرض پوزش، محصولی با مشخصات مورد نظر شما پیدا نکردم. 😔\n\n`;
          response += `🎖️ **محصولات پرفروش ما:**\n\n`;
          
          popularProducts.forEach((product, index) => {
            response += `${index + 1}. **${product.name}** - ${product.price.toLocaleString('fa-IR')} تومان\n`;
            response += `   🔗 [مشاهده](${product.url})\n\n`;
          });
          
          return response;
        }
      }
    }
    
    // 3. سلام و احوالپرسی
    if (hasGreeting) {
      const greetingResponses = [
        'سلام عزیز! 😊 خوش اومدی به پشتیبانی شیک‌پوشان. چطور می‌تونم کمکت کنم؟',
        'درود بر شما! 🌟 آماده‌ام تا در مورد سفارشات یا محصولات کمکتون کنم.',
        'سلام و وقت بخیر! 🛍️ برای پیگیری سفارش کد رهگیری رو وارد کنید یا در مورد محصولات سوال بپرسید.'
      ];
      
      return greetingResponses[Math.floor(Math.random() * greetingResponses.length)];
    }
    
    // 4. اگر هیچکدام از موارد بالا نبود، از OpenAI استفاده کن
    try {
      const completion = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: `تو یک دستیار پشتیبانی فروشگاه لباس شیک‌پوشان هستی. 
            زبانت فارسی است. مودب، مفید و دقیق پاسخ بده.
            فروشگاه محصولات مختلف لباسی دارد.
            اگر کاربر سوالی در مورد سفارش دارد، از او کد رهگیری بخواه.
            اگر در مورد محصول سوال دارد، از او رنگ و سایز مورد نظر را بپرس.
            اگر سوال خارج از این موارد بود، به شکل مفید راهنمایی کن.
            جواب‌ها باید کامل و کاربردی باشند.`
          },
          {
            role: "user",
            content: message
          }
        ],
        max_tokens: 500,
        temperature: 0.7
      });
      
      const aiResponse = completion.data.choices[0].message.content.trim();
      
      // بررسی کنید که پاسخ AI معقول است
      if (aiResponse && aiResponse.length > 10) {
        return aiResponse;
      }
    } catch (openaiError) {
      console.warn('OpenAI خطا داد، از منطق داخلی استفاده می‌کنم:', openaiError.message);
    }
    
    // 5. پاسخ پیش‌فرض هوشمند
    const context = session.messages.slice(-3).map(m => m.content).join(' ');
    
    if (context.includes('سفارش') || context.includes('خرید')) {
      return 'برای پیگیری سفارش خود لطفاً کد رهگیری ۴ تا ۲۰ رقمی رو وارد کنید. اگر کد رو ندارید، شماره سفارش خود را بگویید. 😊';
    }
    
    if (context.includes('محصول') || context.includes('لباس')) {
      return 'برای پیشنهاد محصول لطفاً بگویید چه نوع لباسی مد نظرتون هست؟ (مثلاً: پیراهن آبی سایز M) 🛍️';
    }
    
    return 'متوجه سوال شما شدم! 🤔 لطفاً کمی بیشتر توضیح دهید تا بتونم بهترین کمک رو بهتون ارائه کنم. می‌تونید در مورد:\n\n' +
           '• پیگیری سفارش (با کد رهگیری)\n' +
           '• محصولات و پیشنهادات\n' +
           '• راهنمای سایز و رنگ\n' +
           '• شرایط خرید و ارسال\n\n' +
           'سوال بپرسید. 😊';
    
  } catch (error) {
    console.error('خطا در پردازش هوش مصنوعی:', error);
    return 'با عرض پوزش، در پردازش درخواست شما مشکلی پیش آمد. لطفاً دوباره تلاش کنید یا مستقیماً با پشتیبانی تماس بگیرید. 🙏';
  }
}

// ==================== ربات تلگرام ====================
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// پذیرش درخواست پشتیبانی
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
👤 **پشتیبانی فعال شد**

📋 **اطلاعات کاربر:**
├ نام: ${info.userInfo?.name || 'ناشناس'}
├ صفحه: ${info.userInfo?.page || 'نامشخص'}
├ آی‌پی: ${info.userInfo?.ip || 'نامشخص'}
└ کد جلسه: ${short}

💬 **پیام اول:** ${info.userMessage || 'درخواست اتصال به اپراتور'}

🔗 اتصال برقرار شد. اکنون می‌توانید با کاربر چت کنید.
  `.trim());
  
  // اطلاع به کاربر در وب‌سایت
  io.to(info.fullId).emit('operator-connected', {
    message: '🎉 اپراتور پشتیبانی متصل شد! می‌توانید سوال خود را مطرح کنید.'
  });
  
  // ارسال تاریخچه چت
  const session = getSession(info.fullId);
  const history = session.messages
    .filter(m => m.role === 'user' || m.role === 'ai')
    .map(m => `${m.role === 'user' ? '👤 کاربر' : '🤖 ربات'}: ${m.content}`)
    .join('\n\n') || '👤 کاربر هنوز پیامی نفرستاده است';
  
  await ctx.reply(`📜 **تاریخچه چت:**\n\n${history}\n\n📌 اکنون با کاربر در ارتباط هستید.`);
});

// رد درخواست پشتیبانی
bot.action(/reject_(.+)/, async (ctx) => {
  const short = ctx.match[1];
  const info = botSessions.get(short);
  
  if (info) {
    io.to(info.fullId).emit('operator-rejected', {
      message: 'اپراتور در حال حاضر مشغول است. لطفاً سوال خود را از من بپرسید یا بعداً تلاش کنید. 😊'
    });
  }
  
  botSessions.delete(short);
  await ctx.answerCbQuery('❌ درخواست رد شد');
});

// پیام اپراتور به کاربر
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  
  const entry = [...botSessions.entries()].find(([_, v]) => v.chatId === ctx.chat.id);
  if (!entry) {
    return ctx.reply('⚠️ جلسه فعالی پیدا نشد. لطفاً از طریق دکمه‌ها اقدام کنید.');
  }
  
  const [short, info] = entry;
  
  // ارسال پیام به کاربر
  io.to(info.fullId).emit('operator-message', { 
    message: ctx.message.text,
    timestamp: new Date().toISOString(),
    operator: ctx.from.first_name || 'اپراتور'
  });
  
  // ذخیره در تاریخچه
  const session = getSession(info.fullId);
  session.messages.push({ 
    role: 'operator', 
    content: ctx.message.text,
    timestamp: new Date().toISOString()
  });
  cache.set(info.fullId, session);
  
  await ctx.reply('✅ پیام شما ارسال شد.');
});

// دستور وضعیت سرور
bot.command('status', async (ctx) => {
  const activeSessions = botSessions.size;
  const cacheStats = cache.getStats();
  
  await ctx.reply(`
📊 **وضعیت سرور**

🔌 سرور: آنلاین
🔗 آدرس: ${BASE_URL}
👥 جلسات فعال: ${activeSessions}
💾 کش: ${cacheStats.keys} کلید
📈 استفاده حافظه: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB

🔄 همه‌چیز نرمال است ✅
  `.trim());
});

// ==================== وب‌هوک‌ها و API ====================

// وب‌هوک تلگرام
app.post('/telegram-webhook', (req, res) => {
  bot.handleUpdate(req.body, res);
});

// وب‌هوک درخواست جدید از ویجت
app.post('/webhook', async (req, res) => {
  try {
    if (req.body.event !== 'new_session') {
      return res.json({ success: false, error: 'رویداد نامعتبر' });
    }
    
    const { sessionId, userInfo, userMessage } = req.body.data;
    
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'شناسه جلسه الزامی است' });
    }
    
    const short = shortId(sessionId);
    
    // ذخیره درخواست
    botSessions.set(short, { 
      fullId: sessionId, 
      userInfo: userInfo || {}, 
      chatId: null,
      userMessage: userMessage || 'درخواست اتصال به اپراتور'
    });
    
    const userName = userInfo?.name || 'ناشناس';
    const userPage = userInfo?.page || 'نامشخص';
    const userIp = userInfo?.ip || 'نامشخص';
    
    // ارسال به تلگرام
    await bot.telegram.sendMessage(
      ADMIN_TELEGRAM_ID,
      `🔔 **درخواست پشتیبانی جدید**\n\n` +
      `📝 **کد جلسه:** \`${short}\`\n` +
      `👤 **کاربر:** ${userName}\n` +
      `🌐 **صفحه:** ${userPage}\n` +
      `📡 **آی‌پی:** ${userIp}\n` +
      `💬 **پیام:** ${userMessage || 'درخواست اتصال به اپراتور'}\n\n` +
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
    
    res.json({ success: true, sessionId: short });
    
  } catch (error) {
    console.error('خطا در وب‌هوک:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API اتصال به اپراتور
app.post('/api/connect-human', async (req, res) => {
  try {
    const { sessionId, userInfo } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'شناسه جلسه الزامی است' });
    }
    
    // به‌روزرسانی اطلاعات کاربر
    updateSession(sessionId, { userInfo: userInfo || {} });
    
    // ارسال درخواست به وب‌هوک
    await axios.post(`${BASE_URL}/webhook`, {
      event: 'new_session',
      data: { 
        sessionId, 
        userInfo, 
        userMessage: 'درخواست اتصال مستقیم به اپراتور' 
      }
    }).catch(() => {
      console.warn('ارسال وب‌هوک ناموفق بود');
    });
    
    res.json({ 
      success: true, 
      pending: true,
      message: 'درخواست شما به اپراتور ارسال شد. لطفاً منتظر بمانید...'
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API اصلی چت
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId, userInfo } = req.body;
    
    if (!message || !sessionId) {
      return res.status(400).json({ 
        success: false, 
        error: 'پیام و شناسه جلسه الزامی هستند' 
      });
    }
    
    // به‌روزرسانی یا ایجاد نشست
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
    
    if (botSessionInfo?.chatId) {
      session.connectedToHuman = true;
      updateSession(sessionId, session);
      
      // ارسال پیام کاربر به اپراتور
      const userName = session.userInfo?.name || 'ناشناس';
      await bot.telegram.sendMessage(
        botSessionInfo.chatId,
        `👤 **پیام جدید از کاربر**\n\n` +
        `📌 کد: ${short}\n` +
        `👤 نام: ${userName}\n` +
        `💬 پیام:\n${message}`
      );
      
      return res.json({ 
        success: true, 
        operatorConnected: true,
        message: 'پیام شما به اپراتور ارسال شد. منتظر پاسخ باشید...'
      });
    }
    
    // پردازش با هوش مصنوعی
    const aiResponse = await intelligentAIResponse(message, session);
    
    // ذخیره پاسخ AI
    session.messages.push({ 
      role: 'ai', 
      content: aiResponse,
      timestamp: new Date().toISOString()
    });
    updateSession(sessionId, session);
    
    res.json({ 
      success: true, 
      message: aiResponse,
      sessionId: sessionId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('خطا در API چت:', error);
    res.status(500).json({ 
      success: false, 
      error: 'خطا در پردازش درخواست',
      message: 'با عرض پوزش، در پردازش درخواست شما مشکلی پیش آمد. لطفاً دوباره تلاش کنید.'
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
      limit: Math.min(limit, 20)
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

// API وضعیت دیتابیس
app.get('/api/db-status', async (req, res) => {
  try {
    const [result] = await pool.execute('SELECT 1 as db_status');
    const [productsCount] = await pool.execute('SELECT COUNT(*) as count FROM wp_posts WHERE post_type = "product" AND post_status = "publish"');
    const [ordersCount] = await pool.execute('SELECT COUNT(*) as count FROM wp_posts WHERE post_type = "shop_order"');
    
    res.json({
      success: true,
      database: 'متصل ✅',
      products_count: productsCount[0]?.count || 0,
      orders_count: ordersCount[0]?.count || 0,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.json({
      success: false,
      database: 'قطع ❌',
      error: error.message
    });
  }
});

// ==================== سوکت‌های زمان واقعی ====================
io.on('connection', (socket) => {
  console.log('کلاینت جدید متصل شد:', socket.id);
  
  socket.on('join-session', (sessionId) => {
    if (sessionId) {
      socket.join(sessionId);
      console.log(`سوکت ${socket.id} به جلسه ${sessionId} پیوست`);
    }
  });
  
  // پیام از کاربر
  socket.on('user-message', async ({ sessionId, message }) => {
    if (!sessionId || !message) return;
    
    const short = shortId(sessionId);
    const info = botSessions.get(short);
    
    if (info?.chatId) {
      const session = getSession(sessionId);
      const userName = session.userInfo?.name || 'ناشناس';
      
      await bot.telegram.sendMessage(
        info.chatId,
        `💬 **پیام جدید در زمان واقعی**\n\n` +
        `👤 کاربر: ${userName}\n` +
        `📌 کد: ${short}\n\n` +
        `📝 پیام:\n${message}`
      );
    }
  });
  
  // ارسال فایل
  socket.on('user-file', async ({ sessionId, fileName, fileBase64 }) => {
    const short = shortId(sessionId);
    const info = botSessions.get(short);
    
    if (info?.chatId && fileName && fileBase64) {
      try {
        const buffer = Buffer.from(fileBase64, 'base64');
        await bot.telegram.sendDocument(info.chatId, {
          source: buffer,
          filename: fileName
        });
        
        socket.emit('file-sent', { success: true, fileName });
      } catch (error) {
        socket.emit('file-error', { error: 'خطا در ارسال فایل' });
      }
    }
  });
  
  // ارسال ویس
  socket.on('user-voice', async ({ sessionId, voiceBase64 }) => {
    const short = shortId(sessionId);
    const info = botSessions.get(short);
    
    if (info?.chatId && voiceBase64) {
      try {
        const buffer = Buffer.from(voiceBase64, 'base64');
        await bot.telegram.sendVoice(info.chatId, {
          source: buffer,
          filename: 'voice-message.ogg'
        });
        
        socket.emit('voice-sent', { success: true });
      } catch (error) {
        socket.emit('voice-error', { error: 'خطا در ارسال پیام صوتی' });
      }
    }
  });
  
  socket.on('disconnect', () => {
    console.log('کلاینت قطع شد:', socket.id);
  });
});

// ==================== روت‌های استاتیک و تست ====================
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'AI Chat Support System',
    version: '2.0.0'
  });
});

app.get('/api/test-db', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT NOW() as db_time');
    res.json({ 
      success: true, 
      message: 'اتصال دیتابیس موفق',
      db_time: rows[0].db_time
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== راه‌اندازی سرور ====================
async function initializeServer() {
  try {
    // تست اتصال به دیتابیس
    const connection = await pool.getConnection();
    console.log('✅ اتصال به دیتابیس موفق');
    connection.release();
    
    server.listen(PORT, '0.0.0.0', async () => {
      console.log(`🚀 سرور روی پورت ${PORT} فعال شد`);
      console.log(`🌐 آدرس دسترسی: ${BASE_URL}`);
      
      try {
        // تنظیم وب‌هوک تلگرام
        await bot.telegram.setWebhook(`${BASE_URL}/telegram-webhook`);
        console.log('✅ وب‌هوک تلگرام تنظیم شد:', `${BASE_URL}/telegram-webhook`);
        
        // اطلاع به مدیر
        await bot.telegram.sendMessage(
          ADMIN_TELEGRAM_ID,
          `🟢 **سرور راه‌اندازی شد**\n\n` +
          `📡 آدرس: ${BASE_URL}\n` +
          `⏰ زمان: ${new Date().toLocaleString('fa-IR')}\n` +
          `💾 دیتابیس: متصل\n` +
          `🤖 ربات: فعال\n\n` +
          `سیستم پشتیبان هوشمند آماده خدمات‌رسانی است.`
        );
        
      } catch (telegramError) {
        console.warn('⚠️ تنظیم وب‌هوک ناموفق، استفاده از polling:', telegramError.message);
        bot.launch();
      }
    });
    
  } catch (dbError) {
    console.error('❌ خطا در اتصال به دیتابیس:', dbError.message);
    console.log('🔄 راه‌اندازی سرور بدون دیتابیس...');
    
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 سرور روی پورت ${PORT} فعال شد (بدون دیتابیس)`);
      bot.launch();
    });
  }
}

// مدیریت خاتمه سرور
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

// آغاز به کار
initializeServer();
