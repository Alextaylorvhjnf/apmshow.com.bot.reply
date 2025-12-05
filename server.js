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

// تنظیمات
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = Number(process.env.ADMIN_TELEGRAM_ID);

let BASE_URL = process.env.RAILWAY_STATIC_URL || process.env.BACKEND_URL || '';
BASE_URL = BASE_URL.replace(/\/+$/, '').trim();
if (!BASE_URL) BASE_URL = 'https://ai-chat-support-production.up.railway.app';
if (!BASE_URL.startsWith('http')) BASE_URL = 'https://' + BASE_URL;

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// تلگرام (پذیرش و رد)
bot.action(/accept_(.+)/, async (ctx) => {
  const short = ctx.match[1];
  const info = botSessions.get(short);
  if (!info) return ctx.answerCbQuery('منقضی شده');
  botSessions.set(short, { ...info, chatId: ctx.chat.id });
  getSession(info.fullId).connectedToHuman = true;
  await ctx.answerCbQuery('پذیرفته شد');
  await ctx.editMessageText(`شما این گفتگو را پذیرفتید\nکاربر: ${info.userInfo?.name || 'ناشناس'}\nکد: ${short}`);
  io.to(info.fullId).emit('operator-connected', { message: 'اپراتور متصل شد!' });
  const session = getSession(info.fullId);
  const history = session.messages.filter(m => m.role === 'user').map(m => `کاربر: ${m.content}`).join('\n\n') || 'هیچ پیامی نیست';
  await ctx.reply(`تاریخچه چت:\n\n${history}`);
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
  io.to(entry[1].fullId).emit('operator-message', { message: ctx.message.text });
  await ctx.reply('ارسال شد ✅');
});

app.post('/telegram-webhook', (req, res) => bot.handleUpdate(req.body, res));

app.post('/webhook', async (req, res) => {
  if (req.body.event !== 'new_session') return res.json({ success: false });
  const { sessionId, userInfo, userMessage } = req.body.data;
  const short = shortId(sessionId);
  botSessions.set(short, { fullId: sessionId, userInfo: userInfo || {}, chatId: null });
  const name = userInfo?.name || 'ناشناس';
  const page = userInfo?.page || 'نامشخص';
  await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, `
درخواست جدید
کد: ${short}
نام: ${name}
صفحه: ${page}
پیام: ${userMessage || 'درخواست اتصال'}
  `.trim(), {
    reply_markup: { inline_keyboard: [[
      { text: 'پذیرش', callback_data: `accept_${short}` },
      { text: 'رد', callback_data: `reject_${short}` }
    ]] }
  });
  res.json({ success: true });
});

app.post('/api/connect-human', async (req, res) => {
  const { sessionId, userInfo } = req.body;
  getSession(sessionId).userInfo = userInfo || {};
  await axios.post(`${BASE_URL}/webhook`, {
    event: 'new_session',
    data: { sessionId, userInfo, userMessage: 'درخواست اتصال' }
  }).catch(() => {});
  res.json({ success: true, pending: true });
});

// دستیار فروشگاه — دقیقاً طبق قوانین شما، کوتاه، شفاف، کاربردی
const SHOP_API_URL = 'https://shikpooshaan.ir/ai-shop-api.php';

app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message || !sessionId) return res.status(400).json({ error: 'داده ناقص' });

  const session = getSession(sessionId);
  session.messages.push({ role: 'user', content: message });

  const short = shortId(sessionId);
  if (botSessions.get(short)?.chatId) {
    return res.json({ operatorConnected: true });
  }

  const lowerMsg = message.toLowerCase().trim();

  // تشخیص کد رهگیری
  const codeMatch = message.match(/\b(\d{4,})\b/);
  const hasOrderNumber = codeMatch || lowerMsg.includes('سفارش') || lowerMsg.includes('کد') || lowerMsg.includes('پیگیری') || lowerMsg.includes('وضعیت');

  try {
    if (hasOrderNumber) {
      const code = codeMatch ? codeMatch[1] : message.replace(/\D/g, '').trim();

      if (!code || code.length < 4) {
        return res.json({ success: true, message: 'برای بررسی دقیق سفارش، لطفاً شماره سفارش و شماره موبایل ثبت‌شده را ارسال کنید.' });
      }

      const result = await axios.post(SHOP_API_URL, { action: 'track_order', tracking_code: code }, { timeout: 8000 });
      const data = result.data;

      if (data.found) {
        const reply = `وضعیت سفارش ${code}:\n` +
                      `• وضعیت: ${data.order.status}\n` +
                      `• مرحله فعلی: ${data.order.stage}\n` +
                      `• تاریخ ثبت: ${data.order.date}\n` +
                      `• درگاه پرداخت: ${data.order.payment}\n` +
                      `• مبلغ: ${Number(data.order.total).toLocaleString()} تومان\n` +
                      `• محصولات:\n${data.order.items.join('\n')}\n\n` +
                      `زمان تقریبی ارسال: ۲۴ تا ۷۲ ساعت کاری`;

        return res.json({ success: true, message: reply });
      } else {
        return res.json({ success: true, message: 'سفارش با این شماره پیدا نشد. لطفاً شماره سفارش و شماره موبایل ثبت‌شده را ارسال کنید.' });
      }
    }

    // تاخیر یا عصبانی
    if (lowerMsg.includes('کی می‌رسه') || lowerMsg.includes('چرا دیر') || lowerMsg.includes('تاخیر') || lowerMsg.includes('چند ساعت گذشته')) {
      return res.json({ success: true, message: 'سفارش شما در حال پردازش و آماده‌سازی است. فرآیند ارسال در حال انجام است و به‌زودی تحویل خواهد شد. در صورت تاخیر، تیم پشتیبانی در حال پیگیری است.' });
    }

    // ثبت شده یا نه؟
    if (lowerMsg.includes('ثبت شده') || lowerMsg.includes('سفارشم ثبت شده')) {
      return res.json({ success: true, message: 'برای بررسی ثبت سفارش، لطفاً شماره سفارش یا شماره موبایل ثبت‌شده هنگام خرید را ارسال کنید.' });
    }

    // سوالات عمومی
    if (lowerMsg.includes('ارسال') || lowerMsg.includes('تحویل')) {
      return res.json({ success: true, message: 'ارسال سفارش‌ها معمولاً ۲۴ تا ۷۲ ساعت کاری طول می‌کشد. پس از ارسال، کد رهگیری پیامک می‌شود.' });
    }

    // سوال نامشخص
    return res.json({ success: true, message: 'دقیق‌تر بفرمایید تا بهتر راهنمایی کنم.' });

  } catch (err) {
    return res.json({ success: true, message: 'در حال حاضر نتونستم به اطلاعات دسترسی داشته باشم. لطفاً با اپراتور صحبت کنید.' });
  }
});

// سوکت
io.on('connection', (socket) => {
  socket.on('join-session', (sessionId) => socket.join(sessionId));
  socket.on('user-message', async ({ sessionId, message }) => {
    if (!sessionId || !message) return;
    const short = shortId(sessionId);
    const info = botSessions.get(short);
    if (info?.chatId) {
      const name = info.userInfo?.name || 'ناشناس';
      const page = info.userInfo?.page || 'نامشخص';
      await bot.telegram.sendMessage(info.chatId, `
پیام جدید از کاربر
کد: ${short}
نام: ${name}
صفحه: ${page}
پیام: ${message}
      `.trim());
    }
  });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`دستیار فروشگاه فعال شد — پورت ${PORT}`);
  try {
    await bot.telegram.setWebhook(`${BASE_URL}/telegram-webhook`);
    await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, `دستیار فروشگاه فعال شد ✅\n${BASE_URL}`);
  } catch (err) {
    bot.launch();
  }
});
