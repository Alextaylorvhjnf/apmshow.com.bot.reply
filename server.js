const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const helmet = require('helmet');
const { Telegraf } = require('telegraf');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const NodeCache = require('node-cache');
require('dotenv').config();

// ==================== تنظیمات ====================
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ==================== اتصال به دیتابیس ====================
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'apmsho_shikpooshan',
  password: process.env.DB_PASSWORD || '5W2nn}@tkm8926G*',
  database: process.env.DB_NAME || 'apmsho_shikpooshan',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
});

// ==================== سرور ====================
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// ==================== کش ====================
const cache = new NodeCache({ stdTTL: 600 });
const operatorRequests = new Map();

// ==================== میدل‌ورها ====================
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: '10mb' }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== مدیریت نشست‌ها ====================
const getSession = (sessionId) => {
  let session = cache.get(sessionId);
  if (!session) {
    session = {
      id: sessionId,
      messages: [{
        role: 'ai',
        content: '👋 سلام! به پشتیبانی شیک‌پوشان خوش آمدید. 😊\n\n✨ **چطور می‌تونم کمکتون کنم؟**\n\n📦 **پیگیری سفارش:** کد رهگیری را وارد کنید\n👨‍💼 **صحبت با اپراتور:** کلمه "اپراتور" را بنویسید\n🛍️ **محصولات:** نام محصول را بگویید',
        timestamp: new Date().toISOString()
      }],
      userInfo: {},
      connectedToHuman: false,
      createdAt: new Date().toISOString()
    };
    cache.set(sessionId, session);
  }
  return session;
};

// ==================== تابع جستجوی سفارش ====================
// ==================== تابع جستجوی پیشرفته سفارش ====================
async function findOrderByTrackingCode(trackingCode) {
  const cleanCode = trackingCode.trim();
  
  if (!cleanCode || cleanCode.length < 2) {
    return { 
      found: false, 
      message: 'کد وارد شده کوتاه است'
    };
  }
  
  console.log(`🔍 جستجوی پیشرفته سفارش با: "${cleanCode}"`);
  
  try {
    // ===== روش 1: جستجو در ID سفارش =====
    if (/^\d+$/.test(cleanCode)) {
      const [ordersById] = await pool.execute(`
        SELECT 
          ID as order_id,
          post_date,
          post_status,
          post_title
        FROM wp_posts 
        WHERE ID = ? 
          AND post_type = 'shop_order'
          AND post_status != 'trash'
        LIMIT 1
      `, [cleanCode]);
      
      if (ordersById.length > 0) {
        console.log(`✅ سفارش با ID ${cleanCode} پیدا شد`);
        return await getFullOrderDetails(ordersById[0].order_id, cleanCode);
      }
    }
    
    // ===== روش 2: جستجو در post_title (شماره سفارش) =====
    // حالت‌های مختلف جستجو
    const searchPatterns = [
      `%${cleanCode}%`,                    // 7123
      `%#${cleanCode}%`,                   // #7123
      `%order ${cleanCode}%`,              // Order 7123
      `%سفارش ${cleanCode}%`,              // سفارش 7123
      `%${cleanCode.padStart(5, '0')}%`,   // 07123
      `%${cleanCode.padStart(6, '0')}%`    // 007123
    ];
    
    for (const pattern of searchPatterns) {
      const [ordersByTitle] = await pool.execute(`
        SELECT 
          ID as order_id,
          post_date,
          post_status,
          post_title
        FROM wp_posts 
        WHERE post_type = 'shop_order'
          AND post_status != 'trash'
          AND post_title LIKE ?
        ORDER BY ID DESC
        LIMIT 1
      `, [pattern]);
      
      if (ordersByTitle.length > 0) {
        console.log(`✅ سفارش با الگوی "${pattern}" پیدا شد: ${ordersByTitle[0].order_id}`);
        return await getFullOrderDetails(ordersByTitle[0].order_id, cleanCode);
      }
    }
    
    // ===== روش 3: جستجو در متادیتاها =====
    // کد رهگیری در فیلدهای مختلف
    const metaKeys = [
      '_tracking_number',
      '_shipping_tracking_number',
      '_billing_phone',
      '_billing_email',
      '_order_key',
      '_transaction_id'
    ];
    
    for (const metaKey of metaKeys) {
      const [ordersByMeta] = await pool.execute(`
        SELECT 
          p.ID as order_id,
          p.post_date
        FROM wp_posts p
        INNER JOIN wp_postmeta pm ON pm.post_id = p.ID
        WHERE p.post_type = 'shop_order'
          AND p.post_status != 'trash'
          AND pm.meta_key = ?
          AND pm.meta_value LIKE ?
        ORDER BY p.post_date DESC
        LIMIT 1
      `, [metaKey, `%${cleanCode}%`]);
      
      if (ordersByMeta.length > 0) {
        console.log(`✅ سفارش در متادیتای ${metaKey} پیدا شد`);
        return await getFullOrderDetails(ordersByMeta[0].order_id, cleanCode);
      }
    }
    
    // ===== روش 4: جستجو در همه متادیتاها =====
    const [ordersInAnyMeta] = await pool.execute(`
      SELECT DISTINCT
        p.ID as order_id,
        p.post_date
      FROM wp_posts p
      INNER JOIN wp_postmeta pm ON pm.post_id = p.ID
      WHERE p.post_type = 'shop_order'
        AND p.post_status != 'trash'
        AND pm.meta_value LIKE ?
      ORDER BY p.post_date DESC
      LIMIT 1
    `, [`%${cleanCode}%`]);
    
    if (ordersInAnyMeta.length > 0) {
      console.log(`✅ سفارش در یکی از متادیتاها پیدا شد`);
      return await getFullOrderDetails(ordersInAnyMeta[0].order_id, cleanCode);
    }
    
    // ===== روش 5: اگر کاربر شماره تلفن وارد کرده =====
    if (cleanCode.length >= 10 && /^[0-9]+$/.test(cleanCode)) {
      const [ordersByPhone] = await pool.execute(`
        SELECT 
          p.ID as order_id,
          p.post_date
        FROM wp_posts p
        INNER JOIN wp_postmeta pm ON pm.post_id = p.ID
        WHERE p.post_type = 'shop_order'
          AND p.post_status != 'trash'
          AND pm.meta_key = '_billing_phone'
          AND REPLACE(pm.meta_value, ' ', '') LIKE ?
        ORDER BY p.post_date DESC
        LIMIT 1
      `, [`%${cleanCode.replace(/\D/g, '')}%`]);
      
      if (ordersByPhone.length > 0) {
        console.log(`✅ سفارش با شماره تلفن پیدا شد`);
        return await getFullOrderDetails(ordersByPhone[0].order_id, cleanCode);
      }
    }
    
    // ===== سفارش پیدا نشد - اطلاعات مفید برگردان =====
    console.log(`❌ سفارشی با "${cleanCode}" پیدا نشد`);
    
    // اطلاعاتی برای کمک به کاربر
    const [suggestions] = await pool.execute(`
      SELECT 
        ID as order_id,
        post_title as order_number,
        post_date
      FROM wp_posts 
      WHERE post_type = 'shop_order'
        AND post_status != 'trash'
      ORDER BY post_date DESC
      LIMIT 3
    `);
    
    const sampleOrders = suggestions.map(order => 
      `• شماره سفارش: ${order.order_number} (ID: ${order.order_id})`
    ).join('\n');
    
    return {
      found: false,
      message: `سفارشی با کد «${cleanCode}» پیدا نشد.`,
      suggestions: [
        'کد را دقیق وارد کنید',
        'شماره سفارش ممکن است متفاوت باشد',
        'شماره تلفن خود را امتحان کنید'
      ],
      sample_orders: sampleOrders,
      tip: 'آیا شماره سفارش شما شبیه این‌ها است؟'
    };
    
  } catch (error) {
    console.error('❌ خطا در جستجوی سفارش:', error);
    return {
      found: false,
      message: 'خطا در سرویس پیگیری',
      error: error.message
    };
  }
}

// ==================== تابع دریافت کامل اطلاعات سفارش ====================
async function getFullOrderDetails(orderId, trackingCode) {
  try {
    console.log(`📊 دریافت اطلاعات سفارش ${orderId}...`);
    
    // ۱. اطلاعات اصلی سفارش
    const [orderBasic] = await pool.execute(`
      SELECT 
        ID as order_id,
        post_date,
        post_status,
        post_title
      FROM wp_posts 
      WHERE ID = ?
    `, [orderId]);
    
    if (orderBasic.length === 0) {
      return { found: false, message: 'سفارش پیدا نشد' };
    }
    
    const order = orderBasic[0];
    
    // ۲. تمام متادیتاهای سفارش
    const [allMeta] = await pool.execute(`
      SELECT meta_key, meta_value
      FROM wp_postmeta
      WHERE post_id = ?
    `, [orderId]);
    
    const meta = {};
    allMeta.forEach(row => {
      meta[row.meta_key] = row.meta_value;
    });
    
    // ۳. محصولات سفارش
    let products = ['محصولات سفارش'];
    try {
      const [items] = await pool.execute(`
        SELECT order_item_name
        FROM wp_woocommerce_order_items
        WHERE order_id = ? AND order_item_type = 'line_item'
      `, [orderId]);
      
      if (items.length > 0) {
        products = items.map(item => item.order_item_name);
      }
    } catch (error) {
      console.log('⚠️ خطا در دریافت محصولات:', error.message);
    }
    
    // ۴. اطلاعات مشتری
    const customerName = `${meta['_billing_first_name'] || ''} ${meta['_billing_last_name'] || ''}`.trim();
    const customerPhone = meta['_billing_phone'] || 'ندارد';
    const customerEmail = meta['_billing_email'] || 'ندارد';
    
    // ۵. اطلاعات پرداخت و ارسال
    const totalAmount = meta['_order_total'] ? parseInt(meta['_order_total']).toLocaleString('fa-IR') : '0';
    const paymentMethod = meta['_payment_method_title'] || 'آنلاین';
    const shippingMethod = meta['_shipping_method'] || 'پست پیشتاز';
    
    // ۶. کد رهگیری واقعی
    const realTrackingCode = meta['_tracking_number'] || 
                            meta['_shipping_tracking_number'] || 
                            trackingCode;
    
    // ۷. وضعیت سفارش به فارسی
    const statusMap = {
      'wc-pending': '⏳ در انتظار پرداخت',
      'wc-processing': '🔄 در حال پردازش',
      'wc-on-hold': '⏸️ در انتظار بررسی',
      'wc-completed': '✅ تکمیل شده',
      'wc-cancelled': '❌ لغو شده',
      'wc-refunded': '↩️ مرجوع شده',
      'pending': '⏳ در انتظار پرداخت',
      'processing': '🔄 در حال پردازش',
      'on-hold': '⏸️ در انتظار بررسی',
      'completed': '✅ تکمیل شده',
      'cancelled': '❌ لغو شده',
      'refunded': '↩️ مرجوع شده'
    };
    
    const status = statusMap[meta['_order_status']] || meta['_order_status'] || 'نامشخص';
    
    // ۸. تاریخ سفارش
    const orderDate = new Date(order.post_date).toLocaleDateString('fa-IR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    return {
      found: true,
      order: {
        id: order.order_id,
        order_number: order.post_title || `سفارش #${order.order_id}`,
        tracking_code: realTrackingCode,
        date: orderDate,
        status: status,
        total: totalAmount,
        customer_name: customerName || 'مشتری ناشناس',
        customer_phone: customerPhone,
        customer_email: customerEmail,
        customer_ip: meta['_customer_ip_address'] || 'ندارد',
        payment_method: paymentMethod,
        shipping_method: shippingMethod,
        shipping_address: `${meta['_shipping_address_1'] || ''} ${meta['_shipping_city'] || ''}`.trim() || 'ندارد',
        billing_address: `${meta['_billing_address_1'] || ''} ${meta['_billing_city'] || ''}`.trim() || 'ندارد',
        products: products.slice(0, 10),
        notes: meta['_order_customer_note'] || 'ندارد',
        coupon_codes: meta['_cart_discount'] ? meta['_cart_discount'] : 'ندارد'
      }
    };
    
  } catch (error) {
    console.error('❌ خطا در دریافت جزئیات سفارش:', error);
    return {
      found: false,
      message: 'خطا در دریافت اطلاعات سفارش'
    };
  }
}

// ==================== پردازشگر پیام ====================
async function processMessage(message, sessionId) {
  const cleanMsg = message.trim().toLowerCase();
  
  // تشخیص کد رهگیری
  const codeMatch = cleanMsg.match(/\b\d{3,}\b/);
  if (codeMatch) {
    const trackingCode = codeMatch[0];
    const result = await findOrderByTrackingCode(trackingCode);
    
    if (result.found) {
      const order = result.order;
      const productsText = order.products.map((p, i) => `${i + 1}. ${p}`).join('\n');
      
      return {
        type: 'order_found',
        text: `🎉 **✅ سفارش شما پیدا شد!**\n\n` +
              `📦 **کد رهگیری:** ${order.tracking_code}\n` +
              `📋 **شماره سفارش:** ${order.order_number}\n` +
              `👤 **مشتری:** ${order.customer_name}\n` +
              `📅 **تاریخ سفارش:** ${order.date}\n` +
              `📞 **تلفن:** ${order.customer_phone}\n` +
              `📧 **ایمیل:** ${order.customer_email}\n` +
              `🌐 **IP مشتری:** ${order.customer_ip}\n` +
              `📊 **وضعیت:** ${order.status}\n` +
              `💳 **روش پرداخت:** ${order.payment_method}\n` +
              `🚚 **روش ارسال:** ${order.shipping_method}\n` +
              `💰 **مبلغ کل:** ${order.total} تومان\n\n` +
              `🛍️ **محصولات سفارش:**\n${productsText}\n\n` +
              `📍 **آدرس ارسال:** ${order.shipping_address}\n` +
              `🏠 **آدرس صورتحساب:** ${order.billing_address}\n\n` +
              (order.notes !== 'ندارد' ? `📝 **یادداشت شما:** ${order.notes}\n\n` : '') +
              `⏳ *سفارش شما در حال پردازش است.*\n\n` +
              `برای پیگیری بیشتر در خدمتم! 😊`
      };
    } else {
      return {
        type: 'order_not_found',
        text: `🔍 **جستجوی کد «${trackingCode}»**\n\n` +
              `❌ متأسفانه **سفارشی با این کد پیدا نشد**.\n\n` +
              `📋 **لطفاً بررسی کنید:**\n` +
              `• کد رهگیری را دقیق وارد کرده باشید\n` +
              `• ممکن است شماره سفارش باشد\n` +
              `• سفارش ممکن است هنوز ثبت نشده باشد\n\n` +
              `💡 **راه‌های دیگر:**\n` +
              `👨‍💼 **با زدن دکمه «اتصال به اپراتور»**\n` +
              `یا شماره سفارش خود را امتحان کنید\n\n` +
              `آیا می‌خواهید با اپراتور صحبت کنید؟`
      };
    }
  }
  
  // درخواست اپراتور
  if (cleanMsg.includes('اپراتور') || cleanMsg.includes('انسان')) {
    return {
      type: 'operator_request',
      text: `👨‍💼 **درخواست اتصال به اپراتور**\n\n` +
            `✅ درخواست شما ثبت شد.\n` +
            `⏳ لطفاً منتظر بمانید...\n\n` +
            `📞 زمان انتظار: ۲-۵ دقیقه\n` +
            `💬 اپراتور از همین چت پاسخ می‌دهد`
    };
  }
  
  // سلام
  if (cleanMsg.includes('سلام')) {
    return {
      type: 'greeting',
      text: `👋 سلام عزیزم! 😊\nبه **پشتیبانی شیک‌پوشان** خوش آمدید.\n\n` +
            `✨ **چطور می‌تونم کمکتون کنم؟**\n\n` +
            `📦 **پیگیری سفارش:** کد رهگیری را وارد کنید\n` +
            `👨‍💼 **صحبت با اپراتور:** کلمه "اپراتور" را بنویسید\n` +
            `🛍️ **محصولات:** نام محصول را بگویید\n\n` +
            `لطفاً نیاز خود را انتخاب کنید...`
    };
  }
  
  // پاسخ پیش‌فرض
  return {
    type: 'general',
    text: `🤔 **لطفاً مشخص کنید:**\n\n` +
          `📦 **پیگیری سفارش:** کد رهگیری یا شماره سفارش\n` +
          `👨‍💼 **پشتیبانی:** کلمه "اپراتور"\n` +
          `🛍️ **محصولات:** نام محصول\n\n` +
          `چگونه می‌توانم کمک کنم؟ 😊`
  };
}

// ==================== تلگرام ====================
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
// پذیرش درخواست
bot.action(/accept_(.+)/, async (ctx) => {
  const short = ctx.match[1];
  const info = botSessions.get(short);
  if (!info) return ctx.answerCbQuery('منقضی شده');
  botSessions.set(short, { ...info, chatId: ctx.chat.id });
  getSession(info.fullId).connectedToHuman = true;
  await ctx.answerCbQuery('پذیرفته شد');
  await ctx.editMessageText(`
شما این گفتگو را پذیرفتید
کاربر: ${info.userInfo?.name || 'ناشناس'}
صفحه: ${info.userInfo?.page || 'نامشخص'}
آی‌پی: ${info.userInfo?.ip || 'نامشخص'}
کد: ${short}
  `.trim());
  io.to(info.fullId).emit('operator-connected', {
    message: 'اپراتور متصل شد! در حال انتقال به پشتیبان انسانی...'
  });
  const session = getSession(info.fullId);
  const history = session.messages
    .filter(m => m.role === 'user')
    .map(m => `کاربر: ${m.content}`)
    .join('\n\n') || 'کاربر هنوز پیامی نفرستاده';
  await ctx.reply(`تاریخچه چت:\n\n${history}`);
});
// رد درخواست
bot.action(/reject_(.+)/, async (ctx) => {
  const short = ctx.match[1];
  botSessions.delete(short);
  await ctx.answerCbQuery('رد شد');
});
// پیام اپراتور → ویجت
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  const entry = [...botSessions.entries()].find(([_, v]) => v.chatId === ctx.chat.id);
  if (!entry) return;
  io.to(entry[1].fullId).emit('operator-message', { message: ctx.message.text });
  await ctx.reply('ارسال شد');
});
// وب‌هوک تلگرام
app.post('/telegram-webhook', (req, res) => bot.handleUpdate(req.body, res));
// درخواست جدید از ویجت — با صفحه و آی‌پی
app.post('/webhook', async (req, res) => {
  if (req.body.event !== 'new_session') return res.json({ success: false });
  const { sessionId, userInfo, userMessage } = req.body.data;
  const short = shortId(sessionId);
  botSessions.set(short, { fullId: sessionId, userInfo: userInfo || {}, chatId: null });
  const userName = userInfo?.name || 'ناشناس';
  const userPage = userInfo?.page ? userInfo.page : 'نامشخص';
  const userIp = userInfo?.ip ? userInfo.ip : 'نامشخص';
  await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, `
درخواست پشتیبانی جدید
کد جلسه: ${short}
نام: ${userName}
صفحه: ${userPage}
آی‌پی: ${userIp}
پیام اول: ${userMessage || 'درخواست اتصال به اپراتور'}
  `.trim(), {
    reply_markup: {
      inline_keyboard: [[
        { text: 'پذیرش', callback_data: `accept_${short}` },
        { text: 'رد', callback_data: `reject_${short}` }
      ]]
    }
  });
  res.json({ success: true });
});
// اتصال به اپراتور
app.post('/api/connect-human', async (req, res) => {
  const { sessionId, userInfo } = req.body;
  getSession(sessionId).userInfo = userInfo || {};
  await axios.post(`${BASE_URL}/webhook`, {
    event: 'new_session',
    data: { sessionId, userInfo, userMessage: 'درخواست اتصال' }
  }).catch(() => {});
  res.json({ success: true, pending: true });
});

// ==================== API ها ====================

// API چت
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId: inputSessionId } = req.body;
    
    if (!message) {
      return res.json({ error: 'پیام خالی است' });
    }
    
    const sessionId = inputSessionId || uuidv4();
    const session = getSession(sessionId);
    
    session.messages.push({ role: 'user', content: message });
    cache.set(sessionId, session);
    
    // بررسی اتصال اپراتور
    if (session.connectedToHuman) {
      return res.json({ 
        operatorConnected: true,
        message: 'پیام به اپراتور ارسال شد'
      });
    }
    
    const response = await processMessage(message, sessionId);
    session.messages.push({ role: 'assistant', content: response.text });
    
    res.json({
      success: true,
      message: response.text,
      sessionId,
      type: response.type
    });
    
  } catch (error) {
    console.error('API Chat Error:', error);
    res.json({ error: 'خطا در پردازش پیام' });
  }
});

// API درخواست اپراتور
app.post('/api/request-operator', async (req, res) => {
  try {
    const { sessionId, reason = 'درخواست اپراتور' } = req.body;
    
    if (!sessionId) {
      return res.json({ error: 'شناسه جلسه لازم است' });
    }
    
    const session = getSession(sessionId);
    
    // ارسال به تلگرام
    await bot.telegram.sendMessage(
      ADMIN_TELEGRAM_ID,
      `🔔 درخواست پشتیبانی\n\n` +
      `کد: ${sessionId}\n` +
      `دلیل: ${reason}\n` +
      `زمان: ${new Date().toLocaleTimeString('fa-IR')}`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ پذیرش', callback_data: `accept_${sessionId}` },
            { text: '❌ رد', callback_data: `reject_${sessionId}` }
          ]]
        }
      }
    );
    
    res.json({
      success: true,
      message: 'درخواست ارسال شد',
      pending: true
    });
    
  } catch (error) {
    console.error('API Operator Error:', error);
    res.json({ error: 'خطا در ارسال درخواست' });
  }
});

// API پیگیری سفارش
app.post('/api/track', async (req, res) => {
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.json({ error: 'کد لازم است' });
    }
    
    const result = await findOrderByTrackingCode(code);
    res.json(result);
    
  } catch (error) {
    res.json({ error: 'خطای سرور' });
  }
});

// API وضعیت
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    status: 'online',
    sessions: cache.keys().length,
    version: '1.0.0'
  });
});

// ==================== صفحه تست ====================
app.get('/test', (req, res) => {
  res.send(`
    <html dir="rtl">
    <style>
      body { font-family: Tahoma; padding: 20px; }
      input, button { padding: 10px; margin: 5px; }
      #result { margin-top: 20px; padding: 15px; background: #f0f0f0; }
    </style>
    <h2>🧪 تست سیستم پشتیبانی</h2>
    <input id="message" placeholder="پیام خود را بنویسید">
    <button onclick="sendMessage()">💬 ارسال</button>
    <button onclick="trackOrder()">📦 پیگیری سفارش</button>
    <button onclick="requestOperator()">👨‍💼 اپراتور</button>
    <div id="result"></div>
    
    <script>
      let sessionId = 'test_' + Date.now();
      const API_URL = window.location.origin;
      
      function showResult(text) {
        document.getElementById('result').innerText = text;
      }
      
      async function sendMessage() {
        const message = document.getElementById('message').value;
        const res = await fetch(API_URL + '/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, sessionId })
        });
        const data = await res.json();
        showResult(data.operatorConnected ? 'اپراتور متصل شد' : data.message);
      }
      
      async function trackOrder() {
        const code = prompt('کد رهگیری:');
        if (!code) return;
        
        const res = await fetch(API_URL + '/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code })
        });
        const data = await res.json();
        
        if (data.found) {
          showResult(\`✅ سفارش پیدا شد!\\n\\nکد: \${data.order.tracking_code}\\nمشتری: \${data.order.customer_name}\\nوضعیت: \${data.order.status}\\nمبلغ: \${data.order.total}\`);
        } else {
          showResult(\`❌ \${data.message}\`);
        }
      }
      
      async function requestOperator() {
        const res = await fetch(API_URL + '/api/request-operator', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId })
        });
        const data = await res.json();
        showResult(data.success ? '✅ درخواست ارسال شد' : '❌ خطا');
      }
    </script>
    </html>
  `);
});

// صفحه اصلی
app.get('/', (req, res) => {
  res.redirect('/test');
});

// ==================== راه‌اندازی ====================
server.listen(PORT, async () => {
  console.log(`🚀 سرور روی پورت ${PORT}`);
  
  try {
    await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, '🤖 ربات پشتیبانی فعال شد');
    bot.launch();
  } catch (error) {
    console.log('⚠️ تلگرام: ', error.message);
  }
});

app.post('/telegram-webhook', (req, res) => {
  bot.handleUpdate(req.body, res);
});

module.exports = app;
