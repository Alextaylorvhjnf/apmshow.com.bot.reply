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
const GROQ_API_KEY = process.env.GROQ_API_KEY;

let BASE_URL = process.env.RAILWAY_STATIC_URL || process.env.BACKEND_URL || '';
BASE_URL = BASE_URL.replace(/\/+$/, '').trim();
if (!BASE_URL) BASE_URL = 'https://ai-chat-support-production.up.railway.app';
if (!BASE_URL.startsWith('http')) BASE_URL = 'https://' + BASE_URL;

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

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== کش ====================
const cache = new NodeCache({ stdTTL: 3600 });
const botSessions = new Map(); // shortId → { fullId, chatId, userInfo, socketId }

const shortId = (id) => String(id).substring(0, 12);

const getSession = (id) => {
  let s = cache.get(id);
  if (!s) {
    s = {
      id,
      messages: [],
      userInfo: {},
      connectedToHuman: false,
      lastActivity: Date.now()
    };
    cache.set(id, s);
  }
  return s;
};

// ==================== ربات تلگرام ====================
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// پذیرش درخواست
bot.action(/accept_(.+)/, async (ctx) => {
  const short = ctx.match[1];
  const info = botSessions.get(short);
  if (!info) return ctx.answerCbQuery('منقضی شده');

  // ذخیره chatId اپراتور
  botSessions.set(short, {
    ...info,
    operatorChatId: ctx.chat.id,
    operatorName: ctx.from.first_name || 'اپراتور'
  });
  
  const session = getSession(info.fullId);
  session.connectedToHuman = true;
  session.operatorConnectedAt = Date.now();

  await ctx.answerCbQuery('پذیرفته شد ✅');
  await ctx.editMessageText(
    `✅ شما این گفتگو را پذیرفتید\n👤 کاربر: ${info.userInfo?.name || 'ناشناس'}\n📌 کد: ${short}\n\nاکنون می‌توانید مستقیماً چت کنید.`,
    {
      reply_markup: {
        inline_keyboard: [[
          { text: 'پایان گفتگو', callback_data: `endchat_${short}` }
        ]]
      }
    }
  );

  // اطلاع به ویجت
  io.to(info.fullId).emit('operator-connected', {
    message: '✅ اپراتور متصل شد! می‌توانید مستقیماً چت کنید.',
    operatorName: ctx.from.first_name || 'اپراتور'
  });

  // ارسال تاریخچه به اپراتور
  const history = session.messages
    .slice(-10) // فقط 10 پیام آخر
    .map(m => {
      if (m.role === 'user') return `👤 کاربر: ${m.content}`;
      if (m.role === 'assistant') return `🤖 ربات: ${m.content}`;
      return `${m.role}: ${m.content}`;
    })
    .join('\n\n') || '📝 کاربر هنوز پیامی نفرستاده';

  await ctx.reply(`📜 تاریخچه چت:\n\n${history}\n\n✍️ پیام خود را بنویسید:`);
});

// رد درخواست
bot.action(/reject_(.+)/, async (ctx) => {
  const short = ctx.match[1];
  const info = botSessions.get(short);
  if (info) {
    io.to(info.fullId).emit('operator-rejected', {
      message: 'اپراتور درخواست شما را رد کرد. لطفاً دوباره تلاش کنید.'
    });
    botSessions.delete(short);
  }
  await ctx.answerCbQuery('رد شد ❌');
  await ctx.deleteMessage();
});

// پایان گفتگو توسط اپراتور
bot.action(/endchat_(.+)/, async (ctx) => {
  const short = ctx.match[1];
  const info = botSessions.get(short);
  
  if (info) {
    // اطلاع به کاربر
    io.to(info.fullId).emit('operator-disconnected', {
      message: '👋 اپراتور گفتگو را پایان داد. در صورت نیاز دوباره درخواست دهید.'
    });
    
    // حذف از حافظه
    botSessions.delete(short);
    cache.del(info.fullId);
  }
  
  await ctx.answerCbQuery('گفتگو پایان یافت');
  await ctx.editMessageText('✅ گفتگو با کاربر به پایان رسید.');
});

// پیام اپراتور → ویجت
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  
  // پیدا کردن جلسه‌ای که این اپراتور مسئول آن است
  const entry = [...botSessions.entries()].find(([_, v]) => v.operatorChatId === ctx.chat.id);
  
  if (!entry) {
    return ctx.reply('❌ شما در حال حاضر گفتگوی فعالی ندارید.');
  }
  
  const [short, info] = entry;
  const session = getSession(info.fullId);
  
  // ذخیره پیام در تاریخچه
  session.messages.push({
    role: 'operator',
    content: ctx.message.text,
    timestamp: Date.now()
  });
  
  // ارسال به ویجت از طریق سوکت
  const success = io.to(info.fullId).emit('operator-message', {
    message: ctx.message.text,
    timestamp: new Date().toISOString(),
    from: 'اپراتور'
  });
  
  if (success) {
    await ctx.reply('✅ پیام ارسال شد');
    
    // همچنین پیام را در گروه سوکت هم بفرستید
    io.to(`operator_${info.fullId}`).emit('message-sent', {
      status: 'delivered',
      message: ctx.message.text
    });
  } else {
    await ctx.reply('❌ ارسال پیام ناموفق بود. ممکن است کاربر قطع شده باشد.');
  }
});

// وب‌هوک تلگرام
app.post('/telegram-webhook', (req, res) => {
  bot.handleUpdate(req.body, res);
});

// درخواست جدید از ویجت
app.post('/webhook', async (req, res) => {
  try {
    if (req.body.event !== 'new_session') {
      return res.json({ success: false, error: 'رویداد نامعتبر' });
    }
    
    const { sessionId, userInfo, userMessage } = req.body.data;
    const short = shortId(sessionId);
    
    // اگر قبلاً درخواست فعال دارد
    if (botSessions.has(short)) {
      return res.json({
        success: false,
        error: 'درخواست قبلی هنوز در انتظار است'
      });
    }
    
    botSessions.set(short, {
      fullId: sessionId,
      userInfo: userInfo || {},
      requestedAt: Date.now()
    });
    
    // ثبت پیام اول در تاریخچه
    const session = getSession(sessionId);
    if (userMessage) {
      session.messages.push({
        role: 'user',
        content: userMessage,
        timestamp: Date.now()
      });
    }
    
    // ارسال به تلگرام
    await bot.telegram.sendMessage(
      ADMIN_TELEGRAM_ID,
      `🆕 درخواست پشتیبانی جدید\n\n` +
      `👤 نام: ${userInfo?.name || 'ناشناس'}\n` +
      `📧 ایمیل: ${userInfo?.email || 'ندارد'}\n` +
      `📞 تلفن: ${userInfo?.phone || 'ندارد'}\n` +
      `📌 کد جلسه: ${short}\n\n` +
      `💬 پیام اول: ${userMessage || 'درخواست اتصال به اپراتور'}`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ پذیرش', callback_data: `accept_${short}` },
            { text: '❌ رد', callback_data: `reject_${short}` }
          ]]
        }
      }
    ).catch(err => {
      console.error('خطا در ارسال به تلگرام:', err.message);
    });
    
    res.json({ success: true, sessionId: short });
  } catch (error) {
    console.error('خطا در webhook:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// وقتی هنوز اپراتور وصل نشده (AI جواب می‌دهد)
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message || !sessionId) {
      return res.status(400).json({ error: 'داده ناقص' });
    }

    const session = getSession(sessionId);
    session.messages.push({
      role: 'user',
      content: message,
      timestamp: Date.now()
    });

    const short = shortId(sessionId);
    const info = botSessions.get(short);
    
    // اگر اپراتور وصل شده، پیام را به او هم بفرست
    if (info?.operatorChatId) {
      // اول به کاربر بگو که اپراتور در حال تایپ است
      io.to(sessionId).emit('operator-typing', { status: true });
      
      // پیام را به اپراتور بفرست
      await bot.telegram.sendMessage(
        info.operatorChatId,
        `👤 کاربر:\n${message}`
      ).catch(() => {});
      
      return res.json({
        success: true,
        operatorConnected: true,
        message: 'پیام شما به اپراتور ارسال شد.'
      });
    }

    // اگر اپراتور وصل نیست و AI فعال است
    if (GROQ_API_KEY) {
      try {
        const aiRes = await axios.post(
          'https://api.groq.com/openai/v1/chat/completions',
          {
            model: 'llama-3.3-70b-versatile',
            messages: [
              {
                role: 'system',
                content: 'شما یک دستیار پشتیبانی فارسی هستید. مودب، مفید و مختصر پاسخ دهید. اگر سوالی خارج از حیطه پشتیبانی بود، مؤدبانه بگویید که فقط در زمینه پشتیبانی می‌توانید کمک کنید.'
              },
              ...session.messages.slice(-5).map(msg => ({
                role: msg.role === 'operator' ? 'assistant' : msg.role,
                content: msg.content
              }))
            ],
            temperature: 0.7,
            max_tokens: 800,
            stream: false
          },
          {
            headers: {
              'Authorization': `Bearer ${GROQ_API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 10000
          }
        );
        
        const text = aiRes.data.choices[0].message.content.trim();
        session.messages.push({
          role: 'assistant',
          content: text,
          timestamp: Date.now()
        });
        
        return res.json({ success: true, message: text, fromAI: true });
      } catch (aiError) {
        console.error('AI error:', aiError.message);
        // ادامه به حالت عادی
      }
    }

    // اگر AI جواب نداد، به کاربر بگو منتظر اپراتور باشد
    res.json({
      success: true,
      requiresHuman: true,
      message: 'درخواست شما ثبت شد. لطفاً منتظر اتصال اپراتور باشید.'
    });
  } catch (error) {
    console.error('خطا در /api/chat:', error);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// اتصال به اپراتور
app.post('/api/connect-human', async (req, res) => {
  try {
    const { sessionId, userInfo } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'شناسه جلسه ضروری است' });
    }

    const session = getSession(sessionId);
    if (userInfo) {
      session.userInfo = { ...session.userInfo, ...userInfo };
    }

    const short = shortId(sessionId);
    
    // اگر قبلاً درخواست داده
    if (botSessions.has(short)) {
      return res.json({
        success: true,
        pending: true,
        message: 'درخواست شما قبلاً ارسال شده است'
      });
    }

    // ذخیره درخواست
    botSessions.set(short, {
      fullId: sessionId,
      userInfo: session.userInfo,
      requestedAt: Date.now()
    });

    // ارسال به وب‌هوک
    try {
      await axios.post(`${BASE_URL}/webhook`, {
        event: 'new_session',
        data: {
          sessionId,
          userInfo: session.userInfo,
          userMessage: 'درخواست اتصال به اپراتور پشتیبانی'
        }
      });
    } catch (webhookError) {
      console.error('Webhook error:', webhookError.message);
    }

    res.json({
      success: true,
      pending: true,
      sessionId: short,
      message: 'درخواست شما برای اپراتور ارسال شد. لطفاً منتظر بمانید.'
    });
  } catch (error) {
    console.error('خطا در /api/connect-human:', error);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// بررسی وضعیت اپراتور
app.get('/api/operator-status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const short = shortId(sessionId);
  const info = botSessions.get(short);
  
  if (!info) {
    return res.json({ connected: false, pending: false });
  }
  
  res.json({
    connected: !!info.operatorChatId,
    pending: !info.operatorChatId,
    operatorName: info.operatorName,
    connectedSince: info.operatorConnectedAt
  });
});

// ==================== سوکت – ارتباط دوطرفه ====================
io.on('connection', (socket) => {
  console.log('🔌 کاربر متصل شد:', socket.id);

  socket.on('join-session', (sessionId) => {
    socket.join(sessionId);
    socket.join(`operator_${sessionId}`);
    console.log(`📝 کاربر به جلسه ${sessionId} پیوست`);
    
    // اطلاع به اپراتور اگر وصل است
    const short = shortId(sessionId);
    const info = botSessions.get(short);
    if (info?.operatorChatId) {
      bot.telegram.sendMessage(
        info.operatorChatId,
        '👤 کاربر آنلاین شد و منتظر پاسخ شماست.'
      ).catch(() => {});
    }
  });

  // پیام از کاربر به اپراتور
  socket.on('user-message', async ({ sessionId, message }) => {
    if (!sessionId || !message) return;

    console.log(`💬 پیام از کاربر ${sessionId}:`, message.substring(0, 50));
    
    const short = shortId(sessionId);
    const info = botSessions.get(short);
    const session = getSession(sessionId);

    // ذخیره در تاریخچه
    session.messages.push({
      role: 'user',
      content: message,
      timestamp: Date.now(),
      via: 'socket'
    });

    // اگر اپراتور وصل است، پیام را به تلگرام بفرست
    if (info?.operatorChatId) {
      try {
        await bot.telegram.sendMessage(
          info.operatorChatId,
          `👤 کاربر:\n${message}\n\n✍️ برای پاسخ دادن، مستقیماً در این چت پیام بفرستید.`
        );
        
        // تایید رسیدن پیام
        socket.emit('message-delivered', {
          status: 'delivered',
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        console.error('خطا در ارسال به تلگرام:', error.message);
        socket.emit('message-error', {
          error: 'خطا در ارسال پیام به اپراتور'
        });
      }
    } else {
      // اگر اپراتور وصل نیست، اطلاع بده
      socket.emit('operator-offline', {
        message: 'اپراتور هنوز متصل نشده است. پیام شما ذخیره شد.'
      });
    }
  });

  // تایپ کردن کاربر
  socket.on('user-typing', ({ sessionId, isTyping }) => {
    const short = shortId(sessionId);
    const info = botSessions.get(short);
    
    if (info?.operatorChatId) {
      // می‌توانید اینجا notification بفرستید (اختیاری)
      io.to(`operator_${sessionId}`).emit('user-typing', { isTyping });
    }
  });

  socket.on('disconnect', () => {
    console.log('🔌 کاربر قطع شد:', socket.id);
  });
});

// Route برای تست سلامت
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    sessions: botSessions.size,
    cacheSize: cache.keys().length
  });
});

// Route اصلی
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== راه‌اندازی ====================
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 سرور روی پورت ${PORT} فعال شد`);
  console.log(`🌐 آدرس: ${BASE_URL}`);

  try {
    await bot.telegram.setWebhook(`${BASE_URL}/telegram-webhook`);
    console.log('✅ وب‌هوک تلگرام تنظیم شد');
    
    await bot.telegram.sendMessage(
      ADMIN_TELEGRAM_ID,
      `🤖 ربات پشتیبانی فعال شد\n\n` +
      `🕒 زمان: ${new Date().toLocaleString('fa-IR')}\n` +
      `🌐 آدرس: ${BASE_URL}\n\n` +
      `آماده پذیرش درخواست‌های پشتیبانی...`
    );
  } catch (err) {
    console.error('❌ خطا در تنظیم وب‌هوک → استفاده از Polling');
    bot.launch().then(() => {
      console.log('🤖 ربات با Polling فعال شد');
    });
  }
});

// مدیریت graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 دریافت SIGTERM، خاموشی...');
  bot.stop();
  server.close();
  process.exit(0);
});
