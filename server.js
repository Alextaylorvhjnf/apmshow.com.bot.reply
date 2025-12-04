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

// تلگرام (فقط پذیرش و رد)
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

// دستیار واقعی — ۱۰۰٪ از دیتابیس، بدون سوال اضافه
const SHOP_API_URL = 'https://shikpooshaan.ir/ai-shop-api.php';

app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message || !sessionId) return res.status(400).json({ error: 'داده ناقص' });

  const session = getSession(sessionId);
  session.messages.push({ role: 'user', content: message });

  if (botSessions.has(shortId(sessionId)) && botSessions.get(shortId(sessionId)).chatId) {
    return res.json({ operatorConnected: true });
  }

  const msg = message.trim();
  const code = msg.match(/\b(\d{4,})\b/)?.[1];

  if (code) {
    try {
      const result = await axios.post(SHOP_API_URL, { action: 'track_order', tracking_code: code }, { timeout: 8000 });
      const data = result.data;

      if (data.found) {
        const items = data.order.items.join('\n');
        const total = Number(data.order.total).toLocaleString();

        const reply = `سلام ${data.order.customer_name || 'عزیز'}! 😊\n\n` +
                      `سفارش شما با کد رهگیری \`${code}\` پیدا شد!\n\n` +
                      `وضعیت فعلی: **${data.order.status}**\n` +
                      `تاریخ ثبت: ${data.order.date}\n` +
                      `درگاه پرداخت: ${data.order.payment}\n` +
                      `مبلغ کل: ${total} تومان\n\n` +
                      `محصولات:\n${items}\n\n` +
                      `به‌زودی براتون ارسال می‌شه! اگر سؤالی بود در خدمتم 💙`;

        return res.json({ success: true, message: reply });
      } else {
        return res.json({ success: true, message: `سفارش با کد \`${code}\` پیدا نشد.\nلطفاً کد رهگیری رو دوباره چک کنید 🙏` });
      }
    } catch (err) {
      return res.json({ success: true, message: 'الان نتونستم به سیستم دسترسی داشته باشم 🙏\nچند لحظه دیگه امتحان کنید یا با اپراتور صحبت کنید' });
    }
  }

  // اگر کد نبود — خوش‌آمدگویی
  return res.json({ success: true, message: `سلام! 😊\n\n` +
    `من دستیار فروشگاه شیک پوشانم\n` +
    `برای پیگیری سفارش، فقط کد رهگیری رو بفرست (مثلاً 7123)\n` +
    `یا هر سؤالی داری بپرس، در خدمتم!` });
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
