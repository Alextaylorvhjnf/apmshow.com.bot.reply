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
let BASE_URL = process.env.RAILWAY_STATIC_URL || process.env.BACKEND_URL || '';
BASE_URL = BASE_URL.replace(/\/+$/, '').trim();
if (!BASE_URL) BASE_URL = 'https://ai-chat-support-production.up.railway.app';
if (!BASE_URL.startsWith('http')) BASE_URL = 'https://' + BASE_URL;
// ==================== سرور ====================
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(path.join(__dirname, 'public')));
// ==================== کش ====================
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
// ==================== ربات تلگرام ====================
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
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
  await ctx.reply('ارسال شد');
});
app.post('/telegram-webhook', (req, res) => bot.handleUpdate(req.body, res));
// ==================== وب‌هوک ویجت ====================
app.post('/webhook', async (req, res) => {
  if (req.body.event !== 'new_session') return res.json({ success: false });
  const { sessionId, userInfo, userMessage } = req.body.data;
  const short = shortId(sessionId);
  botSessions.set(short, { fullId: sessionId, userInfo: userInfo || {}, chatId: null });
  const userName = userInfo?.name || 'ناشناس';
  const userPage = userInfo?.page ? userInfo.page : 'نامشخص';
  await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, `
درخواست پشتیبانی جدید
کد جلسه: ${short}
نام: ${userName}
صفحه: ${userPage}
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
// ==================== اتصال به اپراتور ====================
app.post('/api/connect-human', async (req, res) => {
  const { sessionId, userInfo } = req.body;
  getSession(sessionId).userInfo = userInfo || {};
  await axios.post(`${BASE_URL}/webhook`, {
    event: 'new_session',
    data: { sessionId, userInfo, userMessage: 'درخواست اتصال' }
  }).catch(() => {});
  res.json({ success: true, pending: true });
});
// ==================== ۱۰۰٪ به دیتابیس سایت وصل — بدون Groq ====================
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
  const lowerMsg = message.toLowerCase();
  // تشخیص کد پیگیری
  const codeMatch = message.match(/\b(\d{5,})\b|کد\s*(\d+)|پیگیری\s*(\d+)/i);
  const isTracking = codeMatch || lowerMsg.includes('پیگیری') || lowerMsg.includes('سفارش') || lowerMsg.includes('کد') || lowerMsg.includes('وضعیت');
  // تشخیص جستجوی محصول
  const isProduct = lowerMsg.includes('قیمت') || lowerMsg.includes('موجودی') || lowerMsg.includes('دارید') || lowerMsg.includes('چنده');
  try {
    if (isTracking) {
      const code = codeMatch ? (codeMatch[1] || codeMatch[2] || codeMatch[3]) : message.replace(/\D/g, '').trim();
      if (!code || code.length < 4) {
        return res.json({ success: true, message: 'لطفاً کد پیگیری معتبر وارد کنید (مثلاً 67025)' });
      }
      const result = await axios.post(SHOP_API_URL, { action: 'track_order', tracking_code: code }, { timeout: 8000 });
      const data = result.data;
      if (data.found) {
        const items = data.order.items?.join('\n') || 'ندارد';
        const total = Number(data.order.total).toLocaleString();
        const status = data.order.status || 'نامشخص';
        const reply = `سفارش شما با کد \`${code}\` پیدا شد!\n\n` +
                      `وضعیت فعلی: **${status}**\n` +
                      `مبلغ کل: ${total} تومان\n` +
                      `تاریخ سفارش: ${data.order.date}\n` +
                      `محصولات:\n${items}\n\n` +
                      `اگر سؤال دیگه‌ای دارید، در خدمتم 😊`;
        session.messages.push({ role: 'assistant', content: reply });
        return res.json({ success: true, message: reply });
      } else {
        return res.json({ success: true, message: `سفارش با کد \`${code}\` پیدا نشد. لطفاً کد را چک کنید.` });
      }
    }
    if (isProduct) {
      const result = await axios.post(SHOP_API_URL, { action: 'search_product', keyword: message }, { timeout: 8000 });
      const data = result.data;
      if (data.products && data.products.length > 0) {
        const reply = 'نتایج جستجو:\n\n' + data.products.slice(0, 4).map(p =>
          `• ${p.name}\n قیمت: ${Number(p.price).toLocaleString()} تومان\n موجودی: ${p.stock}\n 🔗 ${p.url}`
        ).join('\n\n');
        session.messages.push({ role: 'assistant', content: reply });
        return res.json({ success: true, message: reply });
      } else {
        return res.json({ success: true, message: 'متأسفانه محصولی با این نام پیدا نشد.' });
      }
    }
    // برای بقیه سؤالات
    return res.json({ success: true, message: 'سلام! چطور می‌تونم کمکتون کنم؟\n\nمی‌تونید بپرسید:\n• پیگیری سفارش با کد\n• قیمت و موجودی محصول' });
  } catch (err) {
    console.log('خطا در اتصال به دیتابیس سایت:', err.message);
    return res.json({ success: true, message: 'در حال حاضر نمی‌تونم به اطلاعات دسترسی داشته باشم. لطفاً با اپراتور صحبت کنید.' });
  }
});
// ==================== سوکت ====================
io.on('connection', (socket) => {
  socket.on('join-session', (sessionId) => socket.join(sessionId));
  socket.on('user-message', async ({ sessionId, message }) => {
    if (!sessionId || !message) return;
    const short = shortId(sessionId);
    const info = botSessions.get(short);
    if (info?.chatId) {
      const userName = info.userInfo?.name || 'ناشناس';
      const userPage = info.userInfo?.page ? info.userInfo.page : 'نامشخص';
      await bot.telegram.sendMessage(info.chatId, `
پیام جدید از کاربر
کد: ${short}
نام: ${userName}
صفحه: ${userPage}
پیام:
${message}
      `.trim());
    }
  });
});
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
// ==================== راه‌اندازی ====================
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`سرور روی پورت ${PORT} فعال شد`);
  try {
    await bot.telegram.setWebhook(`${BASE_URL}/telegram-webhook`);
    console.log('وب‌هوک تنظیم شد:', `${BASE_URL}/telegram-webhook`);
    await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, `ربات آماده است (بدون هوش مصنوعی)\n${BASE_URL}`);
  } catch (err) {
    console.error('وب‌هوک خطا داد → Polling فعال شد');
    bot.launch();
  }
});
