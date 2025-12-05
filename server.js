const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const helmet = require('helmet');
const axios = require('axios');
const NodeCache = require('node-cache');
const { Telegraf } = require('telegraf');
const multer = require('multer');
require('dotenv').config();

// تنظیمات
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = Number(process.env.ADMIN_TELEGRAM_ID);

let BASE_URL = process.env.RAILWAY_STATIC_URL || process.env.BACKEND_URL || '';
BASE_URL = BASE_URL.replace(/\/+$/, '').trim();
if (!BASE_URL) BASE_URL = 'https://ai-chat-support-production.up.railway.app';
if (!BASE_URL.startsWith('http')) BASE_URL = 'https://' + BASE_URL;

console.log('Bot configured');
console.log('Admin:', ADMIN_TELEGRAM_ID);
console.log('Backend:', BASE_URL);

const app = express();
const server = http.createServer(app);

// Socket.io — بدون crash
let io;
try {
  const socketIo = require('socket.io');
  io = socketIo(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 1e8
  });
  console.log('Socket.io فعال شد');
} catch (err) {
  console.log('Socket.io غیرفعال شد، ولی سرور کار می‌کنه');
}

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(path.join(__dirname, 'public')));

const cache = new NodeCache({ stdTTL: 3600 });
const botSessions = new Map();
const shortId = (id) => String(id).substring(0, 12);

const getSession = (id) => {
  let s = cache.get(id);
  if (!s) {
    s = { id, messages: [], userInfo: {}, connectedToHuman: false };
    cache.set(id, s);
  }
  return s;
};

// تلگرام بات — بدون crash
let bot;
if (TELEGRAM_BOT_TOKEN && ADMIN_TELEGRAM_ID) {
  try {
    bot = new Telegraf(TELEGRAM_BOT_TOKEN);

    bot.action(/accept_(.+)/, async (ctx) => {
      try {
        const short = ctx.match[1];
        const info = botSessions.get(short);
        if (!info) return;
        botSessions.set(short, { ...info, chatId: ctx.chat.id });
        getSession(info.fullId).connectedToHuman = true;
        await ctx.answerCbQuery('پذیرفته شد');
        await ctx.editMessageText(`شما این گفتگو را پذیرفتید\nکاربر: ${info.userInfo?.name || 'ناشناس'}\nکد: ${short}`);
        if (io) io.to(info.fullId).emit('operator-connected', { message: 'اپراتور متصل شد!' });
        const session = getSession(info.fullId);
        const history = session.messages.filter(m => m.role === 'user').map(m => `کاربر: ${m.content}`).join('\n\n') || 'هیچ پیامی نیست';
        await ctx.reply(`تاریخچه چت:\n\n${history}`);
      } catch (err) {}
    });

    bot.action(/reject_(.+)/, async (ctx) => {
      try {
        const short = ctx.match[1];
        botSessions.delete(short);
        await ctx.answerCbQuery('رد شد');
      } catch (err) {}
    });

    bot.on('text', async (ctx) => {
      if (ctx.message.text.startsWith('/')) return;
      const entry = [...botSessions.entries()].find(([_, v]) => v.chatId === ctx.chat.id);
      if (!entry) return;
      if (io) io.to(entry[1].fullId).emit('operator-message', { message: ctx.message.text });
      await ctx.reply('ارسال شد ✅');
    });

    app.post('/telegram-webhook', (req, res) => {
      try {
        bot.handleUpdate(req.body);
        res.sendStatus(200);
      } catch (err) {
        res.sendStatus(200);
      }
    });

    console.log('ربات تلگرام فعال شد');
  } catch (err) {
    console.log('ربات تلگرام لود نشد، ولی سرور کار می‌کنه');
  }
}

// وب‌هوک ویجت
app.post('/webhook', async (req, res) => {
  try {
    if (req.body.event !== 'new_session') return res.json({ success: false });
    const { sessionId, userInfo, userMessage } = req.body.data;
    const short = shortId(sessionId);
    botSessions.set(short, { fullId: sessionId, userInfo: userInfo || {}, chatId: null });
    
    if (bot && ADMIN_TELEGRAM_ID) {
      await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, `
درخواست جدید
کد: ${short}
نام: ${userInfo?.name || 'ناشناس'}
صفحه: ${userInfo?.page || 'نامشخص'}
پیام: ${userMessage || 'درخواست اتصال'}
      `.trim(), {
        reply_markup: { inline_keyboard: [[
          { text: 'پذیرش', callback_data: `accept_${short}` },
          { text: 'رد', callback_data: `reject_${short}` }
        ]] }
      });
    }
    res.json({ success: true });
  } catch (err) {
    res.json({ success: true });
  }
});

app.post('/api/connect-human', async (req, res) => {
  try {
    const { sessionId, userInfo } = req.body;
    getSession(sessionId).userInfo = userInfo || {};
    res.json({ success: true, pending: true });
  } catch (err) {
    res.json({ success: true });
  }
});

// دستیار — از دیتابیس
const SHOP_API_URL = 'https://shikpooshaan.ir/ai-shop-api.php';

app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message || !sessionId) return res.status(400).json({ error: 'داده ناقص' });

    const session = getSession(sessionId);
    session.messages.push({ role: 'user', content: message });

    const short = shortId(sessionId);
    if (botSessions.get(short)?.chatId) {
      return res.json({ operatorConnected: true });
    }

    const lowerMsg = message.toLowerCase().trim();
    const codeMatch = message.match(/\b(\d{4,})\b/);
    const hasOrder = codeMatch || lowerMsg.includes('سفارش') || lowerMsg.includes('کد') || lowerMsg.includes('پیگیری');

    if (hasOrder) {
      const code = codeMatch ? codeMatch[1] : message.replace(/\D/g, '').trim();
      if (code.length >= 4) {
        const result = await axios.post(SHOP_API_URL, { action: 'track_order', tracking_code: code }, { timeout: 10000 });
        const data = result.data;

        if (data.found) {
          const items = data.order.items?.join('\n') || 'ندارد';
          const total = Number(data.order.total).toLocaleString();

          const reply = `سلام ${data.order.customer_name || 'عزیز'}!\n\n` +
                        `سفارش با کد \`${code}\` پیدا شد!\n\n` +
                        `وضعیت: **${data.order.status}**\n` +
                        `تاریخ ثبت: ${data.order.date}\n` +
                        `درگاه پرداخت: ${data.order.payment}\n` +
                        `مبلغ: ${total} تومان\n` +
                        `محصولات:\n${items}`;

          return res.json({ success: true, message: reply });
        }
      }
      return res.json({ success: true, message: 'سفارش با این کد پیدا نشد. لطفاً کد رو دوباره چک کنید 🙏' });
    }

    return res.json({ success: true, message: 'سلام! 😊\n\nکد رهگیری بفرستید تا وضعیت سفارشتون رو بگم\nیا هر سؤالی دارید بپرسید!' });

  } catch (err) {
    return res.json({ success: true, message: 'الان نتونستم جواب بدم 🙏\nچند لحظه دیگه امتحان کنید' });
  }
});

// سوکت — فایل و ویس
if (io) {
  io.on('connection', (socket) => {
    socket.on('join-session', (sessionId) => socket.join(sessionId));

    socket.on('user-message', async ({ sessionId, message }) => {
      const short = shortId(sessionId);
      const info = botSessions.get(short);
      if (info?.chatId && bot) {
        await bot.telegram.sendMessage(info.chatId, `پیام جدید (کد: ${short})\n${message}`);
      }
    });

    socket.on('user-file', async ({ sessionId, fileName, fileBase64 }) => {
      const short = shortId(sessionId);
      const info = botSessions.get(short);
      if (info?.chatId && bot) {
        const buffer = Buffer.from(fileBase64, 'base64');
        await bot.telegram.sendDocument(info.chatId, { source: buffer, filename: fileName });
      }
    });

    socket.on('user-voice', async ({ sessionId, voiceBase64 }) => {
      const short = shortId(sessionId);
      const info = botSessions.get(short);
      if (info?.chatId && bot) {
        const buffer = Buffer.from(voiceBase64, 'base64');
        await bot.telegram.sendVoice(info.chatId, { source: buffer });
      }
    });
  });
}

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`سرور فعال شد — پورت ${PORT}`);
  console.log('ویجت همیشه نمایش داده میشه!');

  if (bot && TELEGRAM_BOT_TOKEN) {
    bot.telegram.setWebhook(`${BASE_URL}/telegram-webhook`).catch(() => {
      console.log('وب‌هوک تلگرام تنظیم نشد، ولی سرور کار می‌کنه');
    });
  }
});
