const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const helmet = require('helmet');
const axios = require('axios');
const NodeCache = require('node-cache');
const { Telegraf } = require('telegraf');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
require('dotenv').config();

// ==================== تنظیمات ====================
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = parseInt(process.env.ADMIN_TELEGRAM_ID) || 0;
const SHOP_API_URL = process.env.SHOP_API_URL || 'https://shikpooshaan.ir/ai-shop-api.php';
const NODE_ENV = process.env.NODE_ENV || 'development';

// تنظیم BASE_URL با اولویت‌بندی صحیح
let BASE_URL = process.env.BASE_URL || '';
if (NODE_ENV === 'production' && !BASE_URL) {
  BASE_URL = process.env.RAILWAY_STATIC_URL || process.env.BACKEND_URL || '';
}
BASE_URL = BASE_URL.replace(/\/+$/, '').trim();
if (NODE_ENV === 'production' && !BASE_URL.startsWith('http')) {
  BASE_URL = 'https://' + BASE_URL;
}

// ==================== سرور ====================
const app = express();
const server = http.createServer(app);

// تنظیمات CORS امن
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
};

const io = socketIo(server, {
  cors: corsOptions,
  pingTimeout: 60000,
  pingInterval: 25000
});

// Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقیقه
  max: 100, // هر IP حداکثر 100 درخواست
  message: { error: 'تعداد درخواست‌های شما زیاد است. لطفاً کمی صبر کنید.' }
});

// میدلورها
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"]
    }
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== کش و Session Management ====================
const cache = new NodeCache({ 
  stdTTL: 3600, // 1 ساعت
  checkperiod: 600 // هر 10 دقیقه بررسی
});

const botSessions = new Map();
const sessionTimeouts = new Map();

// تولید ID کوتاه
const shortId = (id) => String(id).substring(0, 12);

// مدیریت Session
const getSession = (id) => {
  let session = cache.get(id);
  if (!session) {
    session = { 
      id, 
      messages: [], 
      userInfo: {}, 
      connectedToHuman: false,
      createdAt: Date.now(),
      lastActivity: Date.now()
    };
    cache.set(id, session);
  }
  session.lastActivity = Date.now();
  return session;
};

const cleanupExpiredSessions = () => {
  const now = Date.now();
  const expired = [];
  
  cache.keys().forEach(key => {
    const session = cache.get(key);
    if (session && (now - session.lastActivity) > 24 * 60 * 60 * 1000) {
      expired.push(key);
    }
  });
  
  expired.forEach(key => {
    cache.del(key);
    const short = shortId(key);
    botSessions.delete(short);
  });
  
  if (expired.length > 0) {
    console.log(`تمیزکاری Session: ${expired.length} Session منقضی حذف شد`);
  }
};

// هر ساعت تمیزکاری
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

// ==================== ربات تلگرام ====================
if (!TELEGRAM_BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN تعریف نشده!');
  process.exit(1);
}

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// Handler پذیرش گفتگو
bot.action(/accept_(.+)/, async (ctx) => {
  const short = ctx.match[1];
  const info = botSessions.get(short);
  
  if (!info) {
    return ctx.answerCbQuery('این درخواست منقضی شده است.');
  }

  try {
    botSessions.set(short, { ...info, chatId: ctx.chat.id, acceptedAt: Date.now() });
    const session = getSession(info.fullId);
    session.connectedToHuman = true;
    session.operatorId = ctx.from.id;

    await ctx.answerCbQuery('✅ گفتگو پذیرفته شد');
    await ctx.editMessageText(`
🎯 **شما این گفتگو را پذیرفتید**

👤 کاربر: ${info.userInfo?.name || 'ناشناس'}
📄 صفحه: ${info.userInfo?.page || 'نامشخص'}
🔢 کد: ${short}
⏰ زمان: ${new Date().toLocaleTimeString('fa-IR')}
    `.trim());

    io.to(info.fullId).emit('operator-connected', {
      message: '✅ اپراتور متصل شد! لطفاً سؤال خود را مطرح کنید.',
      operatorName: ctx.from.first_name || 'اپراتور'
    });

    // ارسال تاریخچه چت
    const history = session.messages
      .filter(m => m.role === 'user')
      .map((m, i) => `${i + 1}. ${m.content}`)
      .join('\n\n') || 'کاربر هنوز پیامی نفرستاده است.';

    await ctx.reply(`📜 **تاریخچه چت کاربر:**\n\n${history}\n\n👇 می‌توانید پاسخ دهید:`);
  } catch (error) {
    console.error('خطا در پذیرش گفتگو:', error);
    ctx.answerCbQuery('خطا در پردازش');
  }
});

// Handler رد گفتگو
bot.action(/reject_(.+)/, async (ctx) => {
  const short = ctx.match[1];
  botSessions.delete(short);
  await ctx.answerCbQuery('❌ گفتگو رد شد');
});

// دریافت پیام از اپراتور
bot.on('text', async (ctx) => {
  // رد کردن دستورات
  if (ctx.message.text.startsWith('/')) return;
  
  const entry = [...botSessions.entries()]
    .find(([_, v]) => v.chatId === ctx.chat.id);
  
  if (!entry) return;
  
  const [short, info] = entry;
  
  // ارسال به کاربر
  io.to(info.fullId).emit('operator-message', {
    message: ctx.message.text,
    timestamp: new Date().toISOString()
  });
  
  await ctx.reply('✅ پیام ارسال شد');
});

// Middleware لاگ
bot.use(async (ctx, next) => {
  console.log(`📱 تلگرام: ${ctx.updateType} از ${ctx.from?.id}`);
  await next();
});

// ==================== API Routes ====================

// Route وب‌هوک تلگرام
app.post('/telegram-webhook', (req, res) => {
  bot.handleUpdate(req.body, res);
});

// Route وب‌هوک عمومی
app.post('/webhook', apiLimiter, async (req, res) => {
  try {
    if (req.body.event !== 'new_session') {
      return res.status(400).json({ success: false, error: 'رویداد نامعتبر' });
    }

    const { sessionId, userInfo, userMessage } = req.body.data || {};
    
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'شناسه جلسه الزامی است' });
    }

    const short = shortId(sessionId);
    botSessions.set(short, { 
      fullId: sessionId, 
      userInfo: userInfo || {}, 
      chatId: null,
      createdAt: Date.now()
    });

    const userName = userInfo?.name || 'ناشناس';
    const userPage = userInfo?.page || 'نامشخص';
    const userAgent = userInfo?.userAgent || 'نامشخص';

    const messageText = `
🆕 **درخواست پشتیبانی جدید**

🔢 **کد جلسه:** ${short}
👤 **نام:** ${userName}
📄 **صفحه:** ${userPage}
🌐 **مرورگر:** ${userAgent}
💬 **پیام اول:** ${userMessage || 'درخواست اتصال به اپراتور'}
🕐 **زمان:** ${new Date().toLocaleTimeString('fa-IR')}
    `.trim();

    await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, messageText, {
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ پذیرش', callback_data: `accept_${short}` },
          { text: '❌ رد', callback_data: `reject_${short}` }
        ]]
      }
    });

    res.json({ success: true, sessionId: short });
  } catch (error) {
    console.error('خطا در وب‌هوک:', error);
    res.status(500).json({ success: false, error: 'خطای سرور' });
  }
});

// Route اتصال به اپراتور
app.post('/api/connect-human', apiLimiter, async (req, res) => {
  try {
    const { sessionId, userInfo } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'شناسه جلسه الزامی است' });
    }

    const session = getSession(sessionId);
    session.userInfo = { ...session.userInfo, ...userInfo };
    session.connectedToHuman = false; // منتظر پذیرش اپراتور

    // اطلاع‌رسانی به وب‌هوک
    try {
      await axios.post(`${BASE_URL}/webhook`, {
        event: 'new_session',
        data: { 
          sessionId, 
          userInfo: session.userInfo, 
          userMessage: 'درخواست اتصال به اپراتور' 
        }
      }, { timeout: 5000 });
    } catch (webhookError) {
      console.warn('وب‌هوک پاسخ نداد:', webhookError.message);
    }

    res.json({ 
      success: true, 
      pending: true,
      message: 'درخواست شما برای اتصال به اپراتور ثبت شد.',
      sessionId: shortId(sessionId)
    });
  } catch (error) {
    console.error('خطا در اتصال به اپراتور:', error);
    res.status(500).json({ success: false, error: 'خطای سرور' });
  }
});

// ==================== دستیار هوشمند ====================

// کش دسته‌بندی‌ها
let categories = [];
let categoriesLastUpdated = 0;
const CATEGORIES_CACHE_TTL = 30 * 60 * 1000; // 30 دقیقه

async function loadCategories(force = false) {
  const now = Date.now();
  
  if (!force && categories.length > 0 && (now - categoriesLastUpdated) < CATEGORIES_CACHE_TTL) {
    return categories;
  }

  try {
    const response = await axios.post(
      SHOP_API_URL, 
      { action: 'get_categories' }, 
      { timeout: 10000, headers: { 'Content-Type': 'application/json' } }
    );
    
    if (response.data && Array.isArray(response.data.categories)) {
      categories = response.data.categories;
      categoriesLastUpdated = now;
      console.log(`✅ دسته‌بندی‌ها بروز شد: ${categories.length} دسته`);
    }
  } catch (error) {
    console.error('❌ خطا در دریافت دسته‌بندی‌ها:', error.message);
    // در صورت خطا، کش قبلی حفظ می‌شود
  }
  
  return categories;
}

// Route چت هوشمند
app.post('/api/chat', apiLimiter, async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    
    if (!message || !sessionId) {
      return res.status(400).json({ 
        success: false, 
        error: 'پیام و شناسه جلسه الزامی هستند' 
      });
    }

    // اعتبارسنجی ورودی
    const cleanMessage = message.toString().trim().substring(0, 1000);
    const cleanSessionId = sessionId.toString().trim();

    const session = getSession(cleanSessionId);
    session.messages.push({ 
      role: 'user', 
      content: cleanMessage,
      timestamp: Date.now() 
    });

    // بررسی اتصال به اپراتور
    const short = shortId(cleanSessionId);
    const botSession = botSessions.get(short);
    
    if (botSession?.chatId) {
      return res.json({ 
        operatorConnected: true,
        operatorId: botSession.chatId,
        message: 'در حال گفتگو با اپراتور...' 
      });
    }

    const lowerMsg = cleanMessage.toLowerCase();
    
    // ۱. تشخیص کد رهگیری
    const codeMatch = cleanMessage.match(/\b(\d{5,})\b|کد\s*[:؛]?\s*(\d+)|پیگیری\s*[:؛]?\s*(\d+)/i);
    const hasOrderNumber = codeMatch || /\b(سفارش|کد|پیگیری|وضعیت|ترکینگ)\b/i.test(lowerMsg);

    // ۲. بارگیری دسته‌بندی‌ها
    const currentCategories = await loadCategories();
    const isProductQuery = currentCategories.length > 0 && 
      currentCategories.some(cat => 
        lowerMsg.includes(cat.name.toLowerCase()) || 
        lowerMsg.includes(cat.slug.toLowerCase())
      );

    // ۳. پردازش درخواست
    if (hasOrderNumber) {
      const code = codeMatch ? 
        (codeMatch[1] || codeMatch[2] || codeMatch[3]) : 
        cleanMessage.replace(/\D/g, '').trim();

      if (!code || code.length < 4) {
        return res.json({ 
          success: true, 
          message: 'لطفاً کد رهگیری کامل را وارد کنید. مثال: 67025 یا کد: 12345' 
        });
      }

      try {
        const result = await axios.post(
          SHOP_API_URL, 
          { action: 'track_order', tracking_code: code }, 
          { timeout: 10000 }
        );
        
        const data = result.data;

        if (data.found) {
          const items = data.order.items?.join('\n• ') || 'ندارد';
          const total = Number(data.order.total || 0).toLocaleString('fa-IR');
          const status = data.order.status || 'نامشخص';
          const date = data.order.date || 'نامشخص';
          const payment = data.order.payment || 'نامشخص';

          const reply = `
✅ **سفارش پیدا شد!**

🔢 **کد رهگیری:** ${code}
📊 **وضعیت:** ${status}
💰 **مبلغ:** ${total} تومان
📅 **تاریخ:** ${date}
💳 **پرداخت:** ${payment}

📦 **محصولات:**
• ${items}

🚚 به زودی ارسال خواهد شد! 😊
          `.trim();

          session.messages.push({ role: 'assistant', content: reply, timestamp: Date.now() });
          return res.json({ success: true, message: reply });
        } else {
          const reply = `❌ سفارشی با کد \`${code}\` یافت نشد.\n\nلطفاً کد را بررسی کرده و دوباره تلاش کنید. 🙏`;
          session.messages.push({ role: 'assistant', content: reply, timestamp: Date.now() });
          return res.json({ success: true, message: reply });
        }
      } catch (trackError) {
        console.error('خطا در پیگیری سفارش:', trackError.message);
        const reply = '⚠️ خطا در اتصال به سیستم پیگیری.\nلطفاً چند دقیقه دیگر تلاش کنید یا با پشتیبانی تماس بگیرید.';
        session.messages.push({ role: 'assistant', content: reply, timestamp: Date.now() });
        return res.json({ success: true, message: reply });
      }
    }

    // ۴. معرفی دسته‌بندی
    if (isProductQuery && currentCategories.length > 0) {
      const matchedCategory = currentCategories.find(cat => 
        lowerMsg.includes(cat.name.toLowerCase()) || 
        lowerMsg.includes(cat.slug.toLowerCase())
      );

      if (matchedCategory) {
        const reply = `🎯 **بله! ${matchedCategory.name} داریم!** 😍\n\n` +
          `📎 برای مشاهده محصولات اینجا کلیک کنید:\n${matchedCategory.url}\n\n` +
          `اگر محصول خاصی مد نظر دارید، نامش را بگویید تا کمک کنم!`;
        
        session.messages.push({ role: 'assistant', content: reply, timestamp: Date.now() });
        return res.json({ success: true, message: reply });
      }
    }

    // ۵. پاسخ عمومی
    const generalReply = `
👋 **سلام! خوش آمدید!** 😊

چگونه می‌توانم کمک کنم؟

🔍 **پیگیری سفارش:** کد رهگیری خود را وارد کنید
🛒 **محصولات:** نام دسته‌بندی یا محصول را بگویید
👨‍💼 **پشتیبانی:** برای گفتگو با اپراتور درخواست دهید

📝 **مثال‌ها:**
• کد سفارشم 67025
• هودی دارید؟
• شلوار جین سایز 2XL
• می‌خواهم با اپراتور صحبت کنم
    `.trim();

    session.messages.push({ role: 'assistant', content: generalReply, timestamp: Date.now() });
    res.json({ success: true, message: generalReply });

  } catch (error) {
    console.error('❌ خطا در پردازش چت:', error);
    res.status(500).json({ 
      success: false, 
      error: 'خطای سرور در پردازش درخواست' 
    });
  }
});

// Route سلامت سرور
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    sessions: cache.keys().length,
    botSessions: botSessions.size
  });
});

// Route دریافت دسته‌بندی‌ها
app.get('/api/categories', apiLimiter, async (req, res) => {
  try {
    const cats = await loadCategories();
    res.json({ 
      success: true, 
      count: cats.length,
      categories: cats,
      lastUpdated: categoriesLastUpdated 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'خطا در دریافت دسته‌بندی‌ها' });
  }
});

// ==================== سوکت ====================
io.on('connection', (socket) => {
  console.log(`🔌 سوکت متصل شد: ${socket.id}`);

  socket.on('join-session', (sessionId) => {
    if (sessionId) {
      socket.join(sessionId);
      console.log(`📌 سوکت ${socket.id} به Session ${shortId(sessionId)} پیوست`);
    }
  });

  socket.on('user-message', async ({ sessionId, message }) => {
    if (!sessionId || !message) return;

    const short = shortId(sessionId);
    const info = botSessions.get(short);

    if (info?.chatId) {
      try {
        const userName = info.userInfo?.name || 'ناشناس';
        const userPage = info.userInfo?.page || 'نامشخص';

        await bot.telegram.sendMessage(info.chatId, `
💬 **پیام جدید از کاربر**

🔢 **کد:** ${short}
👤 **نام:** ${userName}
📄 **صفحه:** ${userPage}
🕐 **زمان:** ${new Date().toLocaleTimeString('fa-IR')}

📝 **پیام:**
${message.toString().substring(0, 2000)}
        `.trim());
      } catch (error) {
        console.error('خطا در ارسال پیام به تلگرام:', error);
      }
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`🔌 سوکت قطع شد: ${socket.id} - دلیل: ${reason}`);
  });
});

// Route اصلی برای Single Page Application
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== راه‌اندازی ====================
async function startServer() {
  try {
    // بارگیری اولیه دسته‌بندی‌ها
    await loadCategories(true);
    
    // راه‌اندازی سرور
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`
🚀 **سرور دستیار فروشگاه فعال شد!**
📍 پورت: ${PORT}
🌐 محیط: ${NODE_ENV}
🔗 آدرس: ${BASE_URL || 'localhost'}
📊 Sessionهای فعال: ${cache.keys().length}
🛒 دسته‌بندی‌ها: ${categories.length}
      `);
    });

    // تنظیم وب‌هوک تلگرام
    if (BASE_URL) {
      try {
        await bot.telegram.setWebhook(`${BASE_URL}/telegram-webhook`);
        console.log(`✅ وب‌هوک تلگرام تنظیم شد: ${BASE_URL}/telegram-webhook`);
      } catch (webhookError) {
        console.warn('⚠️ وب‌هوک تلگرام تنظیم نشد، از Polling استفاده می‌شود:', webhookError.message);
        bot.launch();
      }
    } else {
      console.warn('⚠️ BASE_URL تنظیم نشده، از Polling استفاده می‌شود');
      bot.launch();
    }

    // ارسال پیام شروع به ادمین
    if (ADMIN_TELEGRAM_ID) {
      try {
        await bot.telegram.sendMessage(
          ADMIN_TELEGRAM_ID, 
          `✅ دستیار فروشگاه فعال شد!\n\n📍 ${BASE_URL || `پورت ${PORT}`}\n🕐 ${new Date().toLocaleString('fa-IR')}`
        );
      } catch (tgError) {
        console.warn('نشد به ادمین پیام داد:', tgError.message);
      }
    }

  } catch (error) {
    console.error('❌ خطا در راه‌اندازی سرور:', error);
    process.exit(1);
  }
}

// مدیریت خروج
process.on('SIGTERM', () => {
  console.log('🛑 دریافت SIGTERM، خاموش شدن...');
  server.close(() => {
    console.log('✅ سرور بسته شد');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 دریافت SIGINT، خاموش شدن...');
  bot.stop();
  server.close(() => {
    console.log('✅ سرور بسته شد');
    process.exit(0);
  });
});

// شروع سرور
startServer();
