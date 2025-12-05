const express = require('express');
const cors = require('cors');
const http = require('http');
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

let io;
try {
  const socketIo = require('socket.io');
  io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });
} catch (err) {}

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

let bot;
if (TELEGRAM_BOT_TOKEN) {
  try {
    bot = new Telegraf(TELEGRAM_BOT_TOKEN);

    bot.action(/accept_(.+)/, async (ctx) => {
      const short = ctx.match[1];
      const info = botSessions.get(short);
      if (!info) return;
      botSessions.set(short, { ...info, chatId: ctx.chat.id });
      getSession(info.fullId).connectedToHuman = true;
      await ctx.answerCbQuery('پذیرفته شد');
      await ctx.editMessageText(`گفتگو پذیرفته شد\nکاربر: ${info.userInfo?.name || 'ناشناس'}\nکد: ${short}`);
      if (io) io.to(info.fullId).emit('operator-connected');
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
      if (io) io.to(entry[1].fullId).emit('operator-message', { message: ctx.message.text });
      await ctx.reply('ارسال شد');
    });

    app.post('/telegram-webhook', (req, res) => bot.handleUpdate(req.body, res));
  } catch (err) {}
}

app.post('/webhook', async (req, res) => {
  if (req.body.event !== 'new_session') return res.json({ success: false });
  const { sessionId, userInfo, userMessage } = req.body.data;
  const short = shortId(sessionId);
  botSessions.set(short, { fullId: sessionId, userInfo: userInfo || {}, chatId: null });
  if (bot && ADMIN_TELEGRAM_ID) {
    await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, `درخواست جدید\nکد: ${short}\nنام: ${userInfo?.name || 'ناشناس'}\nصفحه: ${userInfo?.page || 'نامشخص'}`, {
      reply_markup: { inline_keyboard: [[
        { text: 'پذیرش', callback_data: `accept_${short}` },
        { text: 'رد', callback_data: `reject_${short}` }
      ]] }
    });
  }
  res.json({ success: true });
});

app.post('/api/connect-human', async (req, res) => {
  const { sessionId } = req.body;
  getSession(sessionId).connectedToHuman = true;
  res.json({ success: true });
});

const SHOP_API_URL = 'https://shikpooshaan.ir/ai-shop-api.php';

app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message || !sessionId) return res.json({ success: false });

  const code = message.match(/\d{4,}/)?.[0];
  if (code) {
    try {
      const result = await axios.post(SHOP_API_URL, { action: 'track_order', tracking_code: code });
      const data = result.data;
      if (data.found) {
        const items = data.order.items.join('\n');
        const total = Number(data.order.total).toLocaleString();
        const reply = `سلام ${data.order.customer_name}!\n\n` +
                      `سفارش ${code}:\n` +
                      `وضعیت: ${data.order.status}\n` +
                      `تاریخ: ${data.order.date}\n` +
                      `درگاه: ${data.order.payment}\n` +
                      `مبلغ: ${total} تومان\n` +
                      `محصولات:\n${items}`;
        return res.json({ success: true, message: reply });
      }
    } catch (err) {}
    return res.json({ success: true, message: 'سفارش پیدا نشد. کد رو چک کنید.' });
  }

  return res.json({ success: true, message: 'سلام! کد رهگیری بفرستید تا وضعیت سفارشتون رو بگم 😊' });
});

if (io) {
  io.on('connection', (socket) => {
    socket.on('join-session', (sessionId) => socket.join(sessionId));
    socket.on('user-message', ({ sessionId, message }) => {
      const short = shortId(sessionId);
      const info = botSessions.get(short);
      if (info?.chatId && bot) {
        bot.telegram.sendMessage(info.chatId, `پیام جدید (${short})\n${message}`);
      }
    });
    socket.on('user-file', ({ sessionId, fileName, fileBase64 }) => {
      const short = shortId(sessionId);
      const info = botSessions.get(short);
      if (info?.chatId && bot) {
        const buffer = Buffer.from(fileBase64, 'base64');
        bot.telegram.sendDocument(info.chatId, { source: buffer, filename: fileName });
      }
    });
    socket.on('user-voice', ({ sessionId, voiceBase64 }) => {
      const short = shortId(sessionId);
      const info = botSessions.get(short);
      if (info?.chatId && bot) {
        const buffer = Buffer.from(voiceBase64, 'base64');
        bot.telegram.sendVoice(info.chatId, { source: buffer });
      }
    });
  });
}

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`سرور فعال شد — پورت ${PORT}`);
  if (bot) {
    bot.telegram.setWebhook(`${BASE_URL}/telegram-webhook`).catch(() => {});
  }
});
