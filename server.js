const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const helmet = require('helmet');
const axios = require('axios');
const { Telegraf } = require('telegraf');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const NodeCache = require('node-cache');
require('dotenv').config();

// راه‌اندازی سرور
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// تنظیمات
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;

// دیتابیس
const pool = mysql.createPool({
  host: 'localhost',
  user: 'apmsho_shikpooshan',
  password: '5W2nn}@tkm8926G*',
  database: 'apmsho_shikpooshan',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// کش
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 });
const sessions = new Map();

// میدل‌ور
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== توابع کمکی ====================
const getSession = (sessionId) => {
  let session = cache.get(sessionId);
  if (!session) {
    session = {
      id: sessionId,
      messages: [],
      userInfo: {},
      connectedToHuman: false,
      preferences: {}
    };
    cache.set(sessionId, session);
  }
  return session;
};

const updateSession = (sessionId, data) => {
  const session = getSession(sessionId);
  Object.assign(session, data);
  cache.set(sessionId, session);
  return session;
};

// ==================== جستجوی محصولات ====================
async function searchProducts(query = '', color = '', size = '', limit = 5) {
  try {
    let sql = `
      SELECT 
        p.ID,
        p.post_title as name,
        p.post_content as description,
        meta_price.meta_value as price,
        meta_regular.meta_value as regular_price,
        meta_sale.meta_value as sale_price,
        meta_sku.meta_value as sku,
        meta_stock.meta_value as stock_status
      FROM wp_posts p
      LEFT JOIN wp_postmeta meta_price ON meta_price.post_id = p.ID AND meta_price.meta_key = '_price'
      LEFT JOIN wp_postmeta meta_regular ON meta_regular.post_id = p.ID AND meta_regular.meta_key = '_regular_price'
      LEFT JOIN wp_postmeta meta_sale ON meta_sale.post_id = p.ID AND meta_sale.meta_key = '_sale_price'
      LEFT JOIN wp_postmeta meta_sku ON meta_sku.post_id = p.ID AND meta_sku.meta_key = '_sku'
      LEFT JOIN wp_postmeta meta_stock ON meta_stock.post_id = p.ID AND meta_stock.meta_key = '_stock_status'
      WHERE p.post_type = 'product' 
        AND p.post_status = 'publish'
    `;
    
    const params = [];
    
    if (query) {
      sql += ` AND (p.post_title LIKE ? OR p.post_content LIKE ?)`;
      params.push(`%${query}%`, `%${query}%`);
    }
    
    sql += ` ORDER BY p.post_date DESC LIMIT ?`;
    params.push(limit);
    
    const [rows] = await pool.execute(sql, params);
    
    return rows.map(row => ({
      id: row.ID,
      name: row.name || 'محصول',
      description: (row.description || '').substring(0, 100),
      price: parseInt(row.price) || 0,
      regular_price: parseInt(row.regular_price) || null,
      sale_price: parseInt(row.sale_price) || null,
      on_sale: row.sale_price && row.sale_price !== row.price,
      sku: row.sku || 'ندارد',
      stock_status: row.stock_status === 'instock' ? 'موجود' : 'ناموجود',
      url: `https://shikpooshaan.ir/?p=${row.ID}`
    }));
    
  } catch (error) {
    console.error('خطا در جستجوی محصولات:', error);
    return [];
  }
}

// ==================== پیگیری سفارش ====================
async function trackOrder(trackingCode) {
  try {
    const cleanCode = trackingCode.replace(/\D/g, '');
    
    if (cleanCode.length < 4) {
      return { found: false, message: 'کد رهگیری نامعتبر است' };
    }
    
    const sql = `
      SELECT 
        o.ID as order_id,
        o.post_date as order_date,
        meta_status.meta_value as status,
        meta_total.meta_value as total,
        meta_payment.meta_value as payment_method,
        u.display_name as customer_name,
        u.user_email as customer_email
      FROM wp_posts o
      LEFT JOIN wp_postmeta meta_status ON meta_status.post_id = o.ID AND meta_status.meta_key = '_order_status'
      LEFT JOIN wp_postmeta meta_total ON meta_total.post_id = o.ID AND meta_total.meta_key = '_order_total'
      LEFT JOIN wp_postmeta meta_payment ON meta_payment.post_id = o.ID AND meta_payment.meta_key = '_payment_method_title'
      LEFT JOIN wp_users u ON u.ID = (SELECT meta_value FROM wp_postmeta WHERE post_id = o.ID AND meta_key = '_customer_user' LIMIT 1)
      WHERE o.post_type = 'shop_order'
        AND (o.ID = ? OR EXISTS (
          SELECT 1 FROM wp_postmeta WHERE post_id = o.ID AND meta_key = '_tracking_number' AND meta_value LIKE ?
        ))
      ORDER BY o.post_date DESC
      LIMIT 1
    `;
    
    const [orders] = await pool.execute(sql, [cleanCode, `%${cleanCode}%`]);
    
    if (orders.length === 0) {
      return { found: false, message: 'سفارشی با این کد یافت نشد' };
    }
    
    const order = orders[0];
    
    // دریافت محصولات سفارش
    const itemsSql = `
      SELECT order_item_name as name
      FROM wp_woocommerce_order_items
      WHERE order_id = ? AND order_item_type = 'line_item'
    `;
    
    const [items] = await pool.execute(itemsSql, [order.order_id]);
    
    const statusMap = {
      'processing': 'در حال پردازش',
      'completed': 'تکمیل شده',
      'pending': 'در انتظار پرداخت',
      'on-hold': 'در انتظار بررسی',
      'cancelled': 'لغو شده',
      'refunded': 'مرجوع شده'
    };
    
    return {
      found: true,
      order: {
        id: order.order_id,
        date: new Date(order.order_date).toLocaleDateString('fa-IR'),
        status: statusMap[order.status] || order.status,
        total: parseInt(order.total).toLocaleString('fa-IR'),
        customer_name: order.customer_name || 'مشتری',
        payment: order.payment_method || 'آنلاین',
        items: items.map(item => item.name).slice(0, 5)
      }
    };
    
  } catch (error) {
    console.error('خطا در پیگیری سفارش:', error);
    return { found: false, message: 'خطا در سرویس پیگیری' };
  }
}

// ==================== پردازش هوشمند پیام ====================
async function processMessage(message, sessionId) {
  const session = getSession(sessionId);
  
  // تشخیص کد رهگیری
  const trackingMatch = message.match(/\b\d{4,20}\b/);
  if (trackingMatch) {
    const trackingCode = trackingMatch[0];
    const result = await trackOrder(trackingCode);
    
    if (result.found) {
      const order = result.order;
      const itemsText = order.items.map((item, i) => `${i + 1}. ${item}`).join('\n');
      
      return {
        type: 'order_tracking',
        text: `✅ **سفارش شما پیدا شد!**\n\n` +
              `👤 مشتری: ${order.customer_name}\n` +
              `📦 کد: ${trackingCode}\n` +
              `📅 تاریخ: ${order.date}\n` +
              `🟢 وضعیت: ${order.status}\n` +
              `💳 پرداخت: ${order.payment}\n` +
              `💰 مبلغ: ${order.total} تومان\n\n` +
              `🛍️ محصولات:\n${itemsText}`
      };
    } else {
      return {
        type: 'order_not_found',
        text: `❌ سفارشی با کد ${trackingCode} یافت نشد.\n\nلطفاً کد را بررسی کنید یا با پشتیبانی تماس بگیرید.`
      };
    }
  }
  
  // تشخیص درخواست محصول
  const productKeywords = ['پیراهن', 'شلوار', 'کفش', 'لباس', 'تیشرت', 'خرید', 'محصول'];
  const isProductRequest = productKeywords.some(keyword => message.includes(keyword));
  
  if (isProductRequest) {
    const products = await searchProducts(message, '', '', 3);
    
    if (products.length > 0) {
      let response = `🎯 **پیشنهادات برای شما:**\n\n`;
      
      products.forEach((product, index) => {
        const priceText = product.on_sale 
          ? `~~${product.regular_price?.toLocaleString('fa-IR')}~~ **${product.price.toLocaleString('fa-IR')} تومان** 🔥`
          : `${product.price.toLocaleString('fa-IR')} تومان`;
        
        response += `${index + 1}. **${product.name}**\n`;
        response += `   💰 ${priceText}\n`;
        response += `   📦 ${product.stock_status}\n`;
        response += `   🔗 [مشاهده محصول](${product.url})\n\n`;
      });
      
      return {
        type: 'product_suggestions',
        text: response
      };
    }
  }
  
  // پاسخ‌های پیش‌فرض
  if (message.includes('سلام') || message.includes('درود')) {
    return {
      type: 'greeting',
      text: 'سلام! 😊 به پشتیبانی شیک‌پوشان خوش آمدید.\nچطور می‌تونم کمک کنم؟\n\n• کد رهگیری سفارش\n• جستجوی محصول\n• صحبت با اپراتور'
    };
  }
  
  if (message.includes('تشکر') || message.includes('ممنون')) {
    return {
      type: 'thanks',
      text: 'خواهش می‌کنم! 😊\nخیلی خوشحالم که تونستم کمک کنم.\nاگر سوال دیگه‌ای دارید، در خدمتم.'
    };
  }
  
  if (message.includes('اپراتور') || message.includes('انسان')) {
    return {
      type: 'operator_request',
      text: '👨‍💼 **درخواست اپراتور**\n\nدرخواست شما برای اتصال به پشتیبانی انسانی ثبت شد.\nلطفاً چند لحظه منتظر بمانید...'
    };
  }
  
  // پاسخ عمومی
  const responses = [
    'جالب بود! 🤔 لطفاً بیشتر توضیح دهید یا:\n• کد رهگیری وارد کنید\n• نام محصول بگویید\n• "اپراتور" تایپ کنید',
    'متوجه شدم! 😊\nبرای کمک بهتر:\n📦 پیگیری سفارش: کد رهگیری\n🛍️ محصولات: نام محصول\n👨‍💼 پشتیبانی: "اپراتور"',
    'سوال خوبی پرسیدید! 🌟\nاگر در مورد سفارشی سوال دارید، کد رهگیری را بفرستید.\nاگر نیاز به اپراتور دارید، کلمه "اپراتور" را تایپ کنید.'
  ];
  
  return {
    type: 'general',
    text: responses[Math.floor(Math.random() * responses.length)]
  };
}

// ==================== تلگرام ====================
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const telegramSessions = new Map();

bot.action(/accept_(.+)/, async (ctx) => {
  const sessionId = ctx.match[1];
  const info = telegramSessions.get(sessionId);
  
  if (!info) {
    return ctx.answerCbQuery('درخواست منقضی شده');
  }
  
  telegramSessions.set(sessionId, { ...info, operatorId: ctx.chat.id });
  updateSession(sessionId, { connectedToHuman: true });
  
  await ctx.answerCbQuery('✅ پذیرفته شد');
  
  await ctx.editMessageText(`
👤 **پشتیبانی فعال**

📋 کاربر: ${info.userInfo?.name || 'ناشناس'}
🌐 صفحه: ${info.userInfo?.page || 'نامشخص'}
📡 IP: ${info.userInfo?.ip || 'نامشخص'}

💬 اکنون می‌توانید چت کنید.
  `.trim());
  
  io.to(sessionId).emit('operator-connected', {
    message: '🎉 اپراتور متصل شد! لطفاً سوال خود را بپرسید.'
  });
});

bot.action(/reject_(.+)/, async (ctx) => {
  const sessionId = ctx.match[1];
  telegramSessions.delete(sessionId);
  await ctx.answerCbQuery('❌ رد شد');
});

bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  
  const entry = [...telegramSessions.entries()]
    .find(([_, v]) => v.operatorId === ctx.chat.id);
  
  if (entry) {
    const [sessionId, info] = entry;
    io.to(sessionId).emit('operator-message', {
      message: ctx.message.text,
      operator: ctx.from.first_name || 'اپراتور'
    });
    await ctx.reply('✅ ارسال شد');
  }
});

// ==================== API ها ====================

// API چت
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId = uuidv4(), userInfo } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'پیام الزامی است' });
    }
    
    const session = updateSession(sessionId, { userInfo });
    session.messages.push({ role: 'user', content: message });
    
    // بررسی اتصال اپراتور
    const telegramSession = telegramSessions.get(sessionId);
    if (telegramSession?.operatorId && session.connectedToHuman) {
      // ارسال به اپراتور
      await bot.telegram.sendMessage(
        telegramSession.operatorId,
        `👤 کاربر: ${session.userInfo?.name || 'ناشناس'}\n💬 پیام:\n${message}`
      );
      
      return res.json({
        operatorConnected: true,
        message: 'پیام به اپراتور ارسال شد. منتظر پاسخ باشید...'
      });
    }
    
    // پردازش هوشمند
    const response = await processMessage(message, sessionId);
    session.messages.push({ role: 'assistant', content: response.text });
    
    res.json({
      success: true,
      message: response.text,
      sessionId,
      type: response.type
    });
    
  } catch (error) {
    console.error('خطا در API چت:', error);
    res.status(500).json({ error: 'خطا در پردازش' });
  }
});

// API درخواست اپراتور
app.post('/api/request-operator', async (req, res) => {
  try {
    const { sessionId, userInfo, reason } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'شناسه جلسه الزامی است' });
    }
    
    const session = getSession(sessionId);
    
    // ذخیره درخواست
    telegramSessions.set(sessionId, {
      userInfo: { ...session.userInfo, ...userInfo },
      reason: reason || 'درخواست اپراتور',
      operatorId: null
    });
    
    // ارسال به تلگرام
    await bot.telegram.sendMessage(
      ADMIN_TELEGRAM_ID,
      `🔔 **درخواست پشتیبانی جدید**\n\n` +
      `👤 کاربر: ${session.userInfo?.name || 'ناشناس'}\n` +
      `🌐 صفحه: ${session.userInfo?.page || 'نامشخص'}\n` +
      `📡 IP: ${session.userInfo?.ip || 'نامشخص'}\n` +
      `💬 دلیل: ${reason || 'درخواست اتصال'}\n\n` +
      `🆔 کد: ${sessionId}`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ پذیرش', callback_data: `accept_${sessionId}` },
            { text: '❌ رد', callback_data: `reject_${sessionId}` }
          ]]
        }
      }
    );
    
    // اطلاع به کاربر
    io.to(sessionId).emit('operator-requested', {
      message: 'درخواست شما به اپراتور ارسال شد. لطفاً منتظر بمانید...'
    });
    
    res.json({
      success: true,
      message: 'درخواست ارسال شد',
      pending: true
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API جستجوی محصولات
app.post('/api/search-products', async (req, res) => {
  try {
    const { query, limit = 5 } = req.body;
    
    const products = await searchProducts(query, '', '', limit);
    
    res.json({
      success: true,
      products,
      count: products.length
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API پیگیری سفارش
app.post('/api/track-order', async (req, res) => {
  try {
    const { trackingCode } = req.body;
    
    if (!trackingCode) {
      return res.status(400).json({ error: 'کد رهگیری الزامی است' });
    }
    
    const result = await trackOrder(trackingCode);
    
    res.json(result);
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// وضعیت سرور
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    sessions: cache.keys().length,
    telegramSessions: telegramSessions.size,
    version: '2.0.0'
  });
});

// ==================== سوکت‌ها ====================
io.on('connection', (socket) => {
  console.log('🔌 کاربر متصل شد:', socket.id);
  
  socket.on('join-session', (sessionId) => {
    socket.join(sessionId);
    console.log(`📱 کاربر به جلسه ${sessionId} پیوست`);
  });
  
  socket.on('disconnect', () => {
    console.log('🔌 کاربر قطع شد:', socket.id);
  });
});

// ==================== صفحات استاتیک ====================

// صفحه اصلی
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// صفحه تست ویجت
app.get('/test', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>تست ویجت پشتیبانی</title>
      <style>
        body {
          font-family: Tahoma;
          padding: 20px;
          background: #f5f5f5;
        }
        .container {
          max-width: 800px;
          margin: 0 auto;
          background: white;
          padding: 30px;
          border-radius: 10px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        button {
          background: #4A90E2;
          color: white;
          border: none;
          padding: 10px 20px;
          margin: 5px;
          border-radius: 5px;
          cursor: pointer;
        }
        #result {
          margin-top: 20px;
          padding: 15px;
          background: #f8f9fa;
          border-radius: 5px;
          white-space: pre-wrap;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🧪 تست ویجت پشتیبانی</h1>
        <button onclick="testChat()">💬 تست چت</button>
        <button onclick="testProducts()">🛍️ تست محصولات</button>
        <button onclick="testTracking()">📦 تست پیگیری</button>
        <button onclick="testOperator()">👨‍💼 تست اپراتور</button>
        <div id="result">آماده تست...</div>
      </div>
      
      <script>
        const sessionId = 'test_' + Date.now();
        const API_URL = 'http://localhost:${PORT}';
        
        async function testChat() {
          const response = await fetch(API_URL + '/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: 'سلام',
              sessionId: sessionId
            })
          });
          const data = await response.json();
          document.getElementById('result').innerText = 
            data.operatorConnected ? 'اپراتور متصل شد' : 'پاسخ: ' + data.message;
        }
        
        async function testProducts() {
          const response = await fetch(API_URL + '/api/search-products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: 'پیراهن',
              limit: 3
            })
          });
          const data = await response.json();
          document.getElementById('result').innerText = 
            'تعداد محصولات: ' + data.count + '\\n' + 
            data.products.map(p => p.name).join('\\n');
        }
        
        async function testTracking() {
          const response = await fetch(API_URL + '/api/track-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              trackingCode: '12345'
            })
          });
          const data = await response.json();
          document.getElementById('result').innerText = 
            data.found ? 'سفارش پیدا شد: ' + JSON.stringify(data.order, null, 2) 
                      : 'سفارش پیدا نشد: ' + data.message;
        }
        
        async function testOperator() {
          const response = await fetch(API_URL + '/api/request-operator', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: sessionId,
              reason: 'تست سیستم'
            })
          });
          const data = await response.json();
          document.getElementById('result').innerText = 
            data.success ? 'درخواست ارسال شد' : 'خطا: ' + data.error;
        }
      </script>
    </body>
    </html>
  `);
});

// ==================== راه‌اندازی ====================
server.listen(PORT, async () => {
  console.log(`🚀 سرور روی پورت ${PORT} فعال شد`);
  
  try {
    await bot.telegram.setWebhook(`https://your-domain.com/telegram-webhook`);
    console.log('✅ وب‌هوک تلگرام تنظیم شد');
  } catch (error) {
    console.log('🔄 استفاده از polling...');
    bot.launch();
  }
});

// وب‌هوک تلگرام
app.post('/telegram-webhook', (req, res) => {
  bot.handleUpdate(req.body, res);
});

module.exports = { app, server };
