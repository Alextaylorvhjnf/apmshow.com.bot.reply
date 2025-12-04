// server.js - نسخه نهایی 100% کارکردی و دوطرفه - بدون سرور دوم
const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const helmet = require('helmet');
const axios = require('axios');
const { Telegraf } = require('telegraf');
require('dotenv').config();

// ====================== تنظیمات ======================
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = Number(process.env.ADMIN_TELEGRAM_ID);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

let BASE_URL = process.env.RAILWAY_STATIC_URL || process.env.BACKEND_URL || '';
BASE_URL = BASE_URL.replace(/\/+$/, '').trim();
if (BASE_URL && !BASE_URL.startsWith('http')) BASE_URL = 'https://' + BASE_URL;

// ====================== سرور اصلی (فقط یکی!) ======================
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ====================== سشن و کش ======================
const sessions = new Map(); // sessionId → { connectedToHuman: true/false, operatorChatId: number }
const shortId = id => id.slice(0, 12);

// ====================== هوش مصنوعی ======================
const getAI = async (msg) => {
  if (!GROQ_API_KEY) return { success: false, requiresHuman: true };
  try {
    const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: 'فقط فارسی جواب بده.' }, { role: 'user', content: msg }],
      temperature: 0.7,
      max_tokens: 800
    }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });
    return { success: true, message: res.data.choices[0].message.content.trim() };
  } catch {
    return { success: false, requiresHuman: true };
  }
};

// ====================== ربات تلگرام ======================
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// پذیرش
bot.action(/accept_(.+)/, async (ctx) => {
  const short = ctx.match[1];
  const sessionInfo = [...sessions.entries()].find(([_, v]) => shortId(v.sessionId) === short);
  if (!sessionInfo) return ctx.answerCbQuery('منقضی شده');

  const [sessionId, info] = sessionInfo;
  sessions.set(sessionId, { ...info, connectedToHuman: true, operatorChatId: ctx.chat.id });

  await ctx.answerCbQuery('پذیرفته شد ✅');
  await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ شما این گفتگو را پذیرفتید');
  io.to(sessionId).emit('operator-connected', { message: 'اپراتور متصل شد!' });
});

// رد
bot.action(/reject_(.+)/, async (ctx) => {
  const short = ctx.match[1];
  const sessionInfo = [...sessions.entries()].find(([_, v]) => shortId(v.sessionId) === short);
  if (sessionInfo) sessions.delete(sessionInfo[0]);
  await ctx.answerCbQuery('رد شد ❌');
  await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n❌ رد شد');
});

// پیام اپراتور → ویجت
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;

  const sessionInfo = [...sessions.values()].find(s => s.operatorChatId === ctx.chat.id);
  if (!sessionInfo) return;

  io.to(sessionInfo.sessionId).emit('operator-message', { message: ctx.message.text });
  ctx.reply('ارسال شد ✅');
});

// ====================== وب‌هوک تلگرام ======================
app.post('/telegram-webhook', (req, res) => {
  bot.handleUpdate(req.body, res);
});

// ====================== درخواست جدید از سایت ======================
app.post('/webhook', async (req, res) => {
  if (req.body.event !== 'new_session') return res.json({ success: true });

  const { sessionId, userInfo = {}, userMessage = 'درخواست اتصال' } = req.body.data;
  const short = shortId(sessionId);

  sessions.set(sessionId, { sessionId, userInfo, connectedToHuman: false });

  await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, `
درخواست جدید
کد: ${short}
نام: ${userInfo.name || 'ناشناس'}
پیام: ${userMessage}
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

// ====================== API ویجت ======================
app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;
  const session = sessions.get(sessionId) || { connectedToHuman: false };

  if (session.connectedToHuman && session.operatorChatId) {
    await bot.telegram.sendMessage(session.operatorChatId, `پیام از کاربر:\n\n${message}`);
    return res.json({ operatorConnected: true });
  }

  const ai = await getAI(message);
  if (ai.success) {
    res.json({ success: true, message: ai.message });
  } else {
    res.json({ success: false, requiresHuman: true });
  }
});

app.post('/api/connect-human', async (req, res) => {
  const { sessionId, userInfo } = req.body;
  await axios.post(`${BASE_URL}/webhook`, {
    event: 'new_session',
    data: { sessionId, userInfo, userMessage: 'درخواست اتصال' }
  }).catch(() => {});
  res.json({ success: true, pending: true });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
io.on('connection', s => s.on('join-session', id => s.join(id)));

// ====================== راه‌اندازی ======================
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`سرور روی پورت ${PORT} فعال شد`);

  if (BASE_URL && TELEGRAM_BOT_TOKEN) {
    const url = `${BASE_URL}/telegram-webhook`;
    try {
      const info = await bot.telegram.getWebhookInfo();
      if (info.url !== url) {
        await new Promise(r => setTimeout(r, 3000));
        await bot.telegram.setWebhook(url);
      }
      console.log('وب‌هوک تنظیم شد:', url);
    } catch {
      bot.launch();
    }
  } else {
    bot.launch();
  }
});
