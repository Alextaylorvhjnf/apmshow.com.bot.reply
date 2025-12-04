const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const helmet = require('helmet');
const axios = require('axios');
const NodeCache = require('node-cache');
const { Telegraf } = require('telegraf');
const { nanoid } = require('nanoid');
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
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== کش و سشن‌ها ====================
const cache = new NodeCache({ stdTTL: 86400 }); // 24 ساعت
const sessionMap = new Map(); // code (یکتا) → { fullId, chatId, userInfo }

const getSession = (sessionId) => {
  let s = cache.get(sessionId);
  if (!s) {
    s = { id: sessionId, messages: [], userInfo: {}, connectedToHuman: false };
    cache.set(sessionId, s);
  }
  return s;
};

// ==================== ربات تلگرام ====================
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// پذیرش درخواست توسط اپراتور
bot.action(/accept_(.+)/, async (ctx) => {
  const code = ctx.match[1];
  const info = sessionMap.get(code);
  if (!info) return ctx.answerCbQuery('منقضی شده یا قبلاً پذیرفته شده');

  // ذخیره chatId اپراتور
  sessionMap.set(code, { ...info, chatId: ctx.chat.id });

  // علامت‌گذاری سشن که به انسان وصل شده
  const session = getSession(info.fullId);
  session.connectedToHuman = true;

  await ctx.answerCbQuery('✅ پذیرفته شد');
  await ctx.editMessageText(`✅ شما این گفتگو را پذیرفتید\nکاربر: ${info.userInfo?.name || 'ناشناس'}\nکد: \`${code}\``, { parse_mode: 'Markdown' });

  // اطلاع به ویجت
  io.to(info.fullId).emit('operator-connected', {
    message: 'اپراتور متصل شد! در حال انتقال به پشتیبان انسانی...'
  });

  // ارسال تاریخچه به اپراتور
  const history = session.messages
    .filter(m => m.role === 'user')
    .map(m => `کاربر: ${m.content}`)
    .join('\n\n') || 'کاربر هنوز پیامی نفرستاده';

  await ctx.reply(`📜 تاریخچه چت:\n\n${history}`);
});

// رد درخواست
bot.action(/reject_(.+)/, async (ctx) => {
  const code = ctx.match[1];
  sessionMap.delete(code);
  await ctx.answerCbQuery('❌ رد شد');
  await ctx.deleteMessage().catch(() => {});
});

// پیام اپراتور → کاربر (ویجت)
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;

  const entry = [...sessionMap.entries()].find(([_, v]) => v.chatId === ctx.chat.id);
  if (!entry) return;

  const [code, info] = entry;
  io.to(info.fullId).emit('operator-message', { message: ctx.message.text });
  await ctx.reply('✅ ارسال شد به کاربر');
});

// وب‌هوک تلگرام
app.post('/telegram-webhook', (req, res) => bot.handleUpdate(req.body, res));

// درخواست جدید از ویجت
app.post('/webhook', async (req, res) => {
  if (req.body.event !== 'new_session') return res.json({ success: false });

  const { sessionId, userInfo, userMessage } = req.body.data;
  if (!sessionId) return res.json({ success: false, error: 'no sessionId' });

  const code = nanoid(10); // کد یکتا و کوتاه

  sessionMap.set(code, {
    fullId: sessionId,
    chatId: null,
    userInfo: userInfo || {}
  });

  await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, `
📩 درخواست پشتیبانی جدید

کد جلسه: <code>${code}</code>
نام: ${userInfo?.name || 'ناشناس'}
پیام اول: ${userMessage || 'درخواست اتصال به اپراتور'}
  `.trim(), {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ پذیرش', callback_data: `accept_${code}` },
        { text: '❌ رد', callback_data: `reject_${code}` }
      ]]
    }
  });

  res.json({ success: true });
});

// چت با AI (وقتی هنوز اپراتور وصل نشده)
app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message || !sessionId) return res.status(400).json({ error: 'داده ناقص' });

  const session = getSession(sessionId);
  session.messages.push({ role: 'user', content: message });

  // چک کن ببین اپراتور وصل شده یا نه
  const entry = [...sessionMap.entries()].find(([_, v]) => v.fullId === sessionId);
  if (entry && entry[1].chatId) {
    return res.json({ operatorConnected: true });
  }

  // جواب AI (اختیاری)
  if (GROQ_API_KEY) {
    try {
      const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'فقط فارسی جواب بده. مودب و حرفه‌ای باش.' },
          ...session.messages
        ],
        temperature: 0.7,
        max_tokens: 800
      }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });

      const text = aiRes.data.choices[0].message.content.trim();
      session.messages.push({ role: 'assistant', content: text });
      return res.json({ success: true, message: text });
    } catch (err) {
      console.error('خطا در Groq:', err.response?.data || err.message);
    }
  }

  res.json({ success: false, requiresHuman: true });
});

// درخواست اتصال به انسان
app.post('/api/connect-human', async (req, res) => {
  const { sessionId, userInfo } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'no sessionId' });

  getSession(sessionId).userInfo = userInfo || {};

  // دوباره درخواست رو به وب‌هوک خودمون می‌فرستیم تا نوتیفیکیشن بره
  await axios.post(`${BASE_URL}/webhook`, {
    event: 'new_session',
    data: { sessionId, userInfo, userMessage: 'درخواست اتصال دستی' }
  }).catch(() => {});

  res.json({ success: true, pending: true });
});

// ==================== سوکت – ارتباط دوطرفه ====================
io.on('connection', (socket) => {
  socket.on('join-session', (sessionId) => {
    socket.join(sessionId);
    console.log(`کاربر به سشن وصل شد: ${sessionId}`);
  });

  // پیام از ویجت → تلگرام اپراتور
  socket.on('user-message', async ({ sessionId, message }) => {
    if (!sessionId || !message) return;

    console.log('پیام از ویجت:', { sessionId, message: message.substring(0, 50) });

    const session = getSession(sessionId);
    session.messages.push({ role: 'user', content: message });

    // پیدا کردن کد مرتبط با این fullId
    const entry = [...sessionMap.entries()].find(([_, v]) => v.fullId === sessionId);

    if (entry) {
      const [code, info] = entry;
      if (info.chatId) {
        try {
          await bot.telegram.sendMessage(info.chatId, `کاربر: ${message}`);
          console.log('پیام به اپراتور تلگرام ارسال شد');
        } catch (err) {
          console.error('خطا در ارسال به تلگرام:', err.message);
        }
      } else {
        console.log('اپراتور هنوز پذیرش نزده');
      }
    } else {
      console.log('کد جلسه پیدا نشد برای این sessionId');
    }
  });
});

// صفحه اصلی
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== راه‌اندازی ====================
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`سرور روی پورت ${PORT} فعال شد`);
  console.log(`آدرس: ${BASE_URL}`);

  try {
    await bot.telegram.setWebhook(`${BASE_URL}/telegram-webhook`);
    console.log('وب‌هوک تلگرام تنظیم شد:', `${BASE_URL}/telegram-webhook`);
    await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, `ربات پشتیبانی فعال شد ✅\n${BASE_URL}`);
  } catch (err) {
    console.error('خطا در تنظیم وب‌هوک، فعال‌سازی Polling...');
    bot.launch();
  }
});
