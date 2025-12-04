const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { Telegraf } = require('telegraf');
const axios = require('axios');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_TELEGRAM_ID);
const BASE_URL = (process.env.RAILWAY_STATIC_URL || process.env.BACKEND_URL || '').replace(/\/+$/, '');
const FULL_URL = BASE_URL.startsWith('http') ? BASE_URL : 'https://' + BASE_URL;

// فقط یک Map برای ذخیره جلسات
const sessions = new Map(); // sessionId → { operatorChatId, shortId }

const bot = new Telegraf(BOT_TOKEN);

// پذیرش
bot.action(/accept_(.+)/, async (ctx) => {
  const shortId = ctx.match[1];
  const session = [...sessions.entries()].find(([_, v]) => v.shortId === shortId);
  if (!session) return ctx.answerCbQuery('منقضی شده');

  const [sessionId] = session;
  sessions.set(sessionId, { ...session[1], operatorChatId: ctx.chat.id });

  await ctx.answerCbQuery('پذیرفته شد ✅');
  await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ شما این گفتگو را پذیرفتید');
  io.to(sessionId).emit('operator-connected');
});

// پیام اپراتور → ویجت
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  const session = [...sessions.values()].find(s => s.operatorChatId === ctx.chat.id);
  if (!session) return;

  const sessionId = [...sessions.entries()].find(([_, v]) => v === session)[0];
  io.to(sessionId).emit('operator-message', { message: ctx.message.text });
  ctx.reply('ارسال شد ✅');
});

// وب‌هوک تلگرام
app.post('/telegram-webhook', (req, res) => bot.handleUpdate(req.body, res));

// درخواست جدید از ویجت
app.post('/webhook', async (req, res) => {
  if (req.body.event !== 'new_session') return res.json({ success: true });
  const { sessionId, userInfo = {}, userMessage = 'درخواست اتصال' } = req.body.data;
  const short = sessionId.slice(0, 12);

  sessions.set(sessionId, { shortId: short });

  await bot.telegram.sendMessage(ADMIN_ID, `درخواست جدید\n\nکد: ${short}\nنام: ${userInfo.name || 'ناشناس'}\nپیام: ${userMessage}`, {
    reply_markup: {
      inline_keyboard: [[
        { text: 'پذیرش', callback_data: `accept_${short}` }
      ]]
    }
  });

  res.json({ success: true });
});

// چت ویجت (اینجا مهم بود!)
app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;
  const session = sessions.get(sessionId);

  // اگر اپراتور وصل باشه → پیام رو به تلگرام بفرست
  if (session && session.operatorChatId) {
    await bot.telegram.sendMessage(session.operatorChatId, `پیام از کاربر:\n\n${message}`);
    return res.json({ operatorConnected: true });
  }

  // در غیر این صورت هوش مصنوعی (یا فقط requiresHuman)
  res.json({ success: false, requiresHuman: true });
});

app.post('/api/connect-human', async (req, res) => {
  const { sessionId, userInfo } = req.body;
  await axios.post(`${FULL_URL}/webhook`, {
    event: 'new_session',
    data: { sessionId, userInfo, userMessage: 'درخواست اتصال' }
  }).catch(() => {});
  res.json({ success: true, pending: true });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
io.on('connection', s => s.on('join-session', id => s.join(id)));

server.listen(PORT, '0.0.0.0', async () => {
  console.log('سرور فعال شد');
  const url = `${FULL_URL}/telegram-webhook`;
  try {
    const info = await bot.telegram.getWebhookInfo();
    if (info.url !== url) await bot.telegram.setWebhook(url);
    console.log('وب‌هوک تنظیم شد:', url);
  } catch {
    bot.launch();
  }
});
