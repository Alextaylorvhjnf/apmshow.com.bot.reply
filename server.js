const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const NodeCache = require('node-cache');
const { Telegraf, Markup } = require('telegraf');
require('dotenv').config();

console.log('='.repeat(60));
console.log('🚀 AI CHATBOT + TELEGRAM BOT - SINGLE SERVER FIXED VERSION');
console.log('='.repeat(60));

// ====================== محیط و تنظیمات ======================
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;
const BACKEND_URL = (process.env.RAILWAY_STATIC_URL || process.env.BACKEND_URL || '').replace(/\/+$/, '');

console.log('📌 Port:', PORT);
console.log('🤖 AI:', GROQ_API_KEY ? '✅ فعال' : '❌ غیرفعال');
console.log('🤖 Telegram Token:', TELEGRAM_BOT_TOKEN ? '✅ موجود' : '❌ موجود نیست');
console.log('👤 Admin ID:', ADMIN_TELEGRAM_ID);
console.log('🌐 Backend URL:', BACKEND_URL || 'محلی');

// ====================== اپلیکیشن و سرور اصلی ======================
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// ====================== میدلورها ======================
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ====================== سرویس‌های کمکی ======================
const sessionCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
const sessions = new Map(); // برای ربات تلگرام
const userSessions = new Map(); // chatId → shortId

class AIService {
  constructor() {
    this.apiKey = GROQ_API_KEY;
    this.model = 'llama-3.3-70b-versatile';
    this.baseURL = 'https://api.groq.com/openai/v1';
    this.axios = axios.create({
      baseURL: this.baseURL,
      headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      timeout: 30000
    });
    this.systemPrompt = `شما "پشتیبان هوشمند" هستید. فقط به فارسی پاسخ دهید. مفید، دقیق و دوستانه باشید. اگر نمی‌دانید، صادقانه بگویید. تخصص: پشتیبانی محصول، سوالات عمومی، راهنمایی کاربران. اگر سوال خارج از حوزه است بگویید: "برای پاسخ دقیق‌تر، لطفاً به اپراتور انسانی متصل شوید."`;
  }
  async getAIResponse(message) {
    try {
      const res = await this.axios.post('/chat/completions', {
        model: this.model,
        messages: [{ role: 'system', content: this.systemPrompt }, { role: 'user', content: message }],
        temperature: 0.7,
        max_tokens: 800
      });
      const text = res.data?.choices?.[0]?.message?.content;
      if (!text) throw new Error('No response');
      const needHuman = /اپراتور انسانی|متخصص انسانی|نمی‌تونم|نمی‌دونم|اطلاعات کافی/i.test(text);
      return { success: true, message: text.trim(), requiresHuman: needHuman };
    } catch (err) {
      console.error('AI Error:', err.message);
      return { success: false, message: 'خطا در هوش مصنوعی. در حال اتصال به اپراتور...', requiresHuman: true };
    }
  }
}

class SessionManager {
  constructor() { this.sessions = new Map(); }
  create(id, info = {}) {
    const s = { id, messages: [], createdAt: new Date(), lastActivity: new Date(), userInfo: info, connectedToHuman: false };
    this.sessions.set(id, s);
    sessionCache.set(id, s);
    return s;
  }
  get(id) {
    let s = sessionCache.get(id) || this.sessions.get(id);
    if (s) { s.lastActivity = new Date(); sessionCache.set(id, s); }
    return s || this.create(id);
  }
  addMessage(id, role, content) {
    const s = this.get(id);
    s.messages.push({ role, content, timestamp: new Date() });
    if (s.messages.length > 100) s.messages = s.messages.slice(-100);
    sessionCache.set(id, s);
  }
  connectToHuman(id, chatId) {
    const s = this.get(id);
    s.connectedToHuman = true;
    s.operatorChatId = chatId;
    sessionCache.set(id, s);
  }
}

// ====================== ایجاد سرویس‌ها ======================
const aiService = new AIService();
const sessionManager = new SessionManager();

// ====================== ربات تلگرام ======================
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// توابع کمکی ربات
function shortId(full) { return full.substring(0, 12); }
function storeBotSession(fullId, userInfo) {
  const s = shortId(fullId);
  sessions.set(s, { fullId, userInfo, status: 'pending', createdAt: new Date() });
  return s;
}

// دستورات ربات
bot.start(ctx => ctx.reply(`سلام ${ctx.from.first_name || ''}! 👋\nربات اپراتور آماده است.`, {
  parse_mode: 'Markdown',
  ...Markup.keyboard([['جلسات فعال']]).resize()
}));

bot.command('sessions', async ctx => {
  try {
    const res = await axios.get(`${BACKEND_URL}/api/sessions`);
    const list = res.data.sessions || [];
    if (!list.length) return ctx.reply('هیچ جلسه‌ای نیست');
    let msg = `*جلسات فعال (${list.length}):*\n\n`;
    list.forEach((s, i) => {
      msg += `${i + 1}. \`${shortId(s.id)}\` – ${s.userInfo?.name || 'ناشناس'} – ${s.connectedToHuman ? 'متصل' : 'در انتظار'}\n`;
    });
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch { ctx.reply('خطا در دریافت جلسات'); }
});

// پذیرش/رد درخواست
bot.action(/accept_(.+)/, async ctx => {
  const short = ctx.match[1];
  const ses = sessions.get(short);
  if (!ses) return ctx.answerCbQuery('جلسه منقضی شده');
  ses.status = 'accepted';
  ses.operatorChatId = ctx.chat.id;
  userSessions.set(ctx.chat.id, short);
  await ctx.answerCbQuery('پذیرفته شد ✅');
  await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ شما این گفتگو را پذیرفتید', { parse_mode: 'Markdown' });
  await axios.post(`${BACKEND_URL}/webhook`, { event: 'operator_accepted', data: { sessionId: ses.fullId } });
});

bot.action(/reject_(.+)/, async ctx => {
  const short = ctx.match[1];
  sessions.delete(short);
  await ctx.answerCbQuery('رد شد ❌');
  await axios.post(`${BACKEND_URL}/webhook`, { event: 'operator_rejected', data: { sessionId: sessions.get(short)?.fullId } });
});

// پیام اپراتور → کاربر
bot.on('text', async ctx => {
  if (ctx.message.text.startsWith('/')) return;
  const short = userSessions.get(ctx.chat.id);
  if (!short) return;
  const ses = sessions.get(short);
  if (!ses || ses.status !== 'accepted') return;
  await axios.post(`${BACKEND_URL}/api/send-to-user`, {
    sessionId: ses.fullId,
    message: ctx.message.text,
    operatorName: ctx.from.first_name || 'اپراتور'
  });
  ctx.reply('ارسال شد ✅');
});

// وب‌هوک از سایت → ربات (جلسه جدید)
app.post('/webhook', async (req, res) => {
  try {
    const { event, data } = req.body;
    if (event === 'new_session') {
      const short = storeBotSession(data.sessionId, data.userInfo || {});
      await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID,
        `درخواست جدید\nکد: \`${short}\`\nکاربر: ${data.userInfo?.name || 'ناشناس'}\nپیام: ${data.userMessage?.substring(0, 100)}...`,
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard([
          [Markup.button.callback('پذیرش', `accept_${short}`), Markup.button.callback('رد', `reject_${short}`)]
        ])}
      );
      res.json({ success: true });
    } else if (event === 'operator_accepted') {
      sessionManager.connectToHuman(data.sessionId, null);
      io.to(data.sessionId).emit('operator-connected', { message: 'اپراتور متصل شد!' });
      res.json({ success: true });
    } else if (event === 'operator_rejected') {
      io.to(data.sessionId).emit('operator-rejected', { message: 'اپراتور در دسترس نیست.' });
      res.json({ success: true });
    } else {
      res.json({ success: false });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

// ====================== وب‌هوک تلگرام (مهم‌ترین قسمت!) ======================
// این دقیقاً همون چیزیه که قبلاً روی 3001 بود – حالا روی همان سرور اصلی
app.post('/telegram-webhook', (req, res) => {
  console.log('Telegram Webhook دریافت شد!', new Date());
  bot.handleUpdate(req.body, res); // این خط همه آپدیت‌ها رو به ربات می‌ده
});

// ====================== API چت و اتصال به اپراتور ======================
app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;
  let session = sessionManager.get(sessionId);
  sessionManager.addMessage(sessionId, 'user', message);

  if (session.connectedToHuman) {
    return res.json({ success: true, message: 'در حال انتقال به اپراتور...', operatorConnected: true });
  }

  const aiRes = await aiService.getAIResponse(message);
  if (aiRes.success && !aiRes.requiresHuman) {
    sessionManager.addMessage(sessionId, 'assistant', aiRes.message);
    res.json({ success: true, message: aiRes.message, operatorConnected: false });
  } else {
    res.json({ success: false, message: aiRes.message, requiresHuman: true, operatorConnected: false });
  }
});

app.post('/api/connect-human', async (req, res) => {
  const { sessionId, userInfo } = req.body;
  let session = sessionManager.get(sessionId);
  session.userInfo = { ...session.userInfo, ...userInfo };

  const lastMsg = session.messages.filter(m => m.role === 'user').slice(-1)[0]?.content || 'درخواست اتصال';
  await axios.post(`${BACKEND_URL}/webhook`, {
    event: 'new_session',
    data: { sessionId, userInfo: session.userInfo, userMessage: lastMsg }
  });

  res.json({ success: true, message: 'درخواست به اپراتور ارسال شد...', pending: true });
});

app.post('/api/send-to-user', async (req, res) => {
  const { sessionId, message, operatorName } = req.body;
  sessionManager.addMessage(sessionId, 'operator', message);
  io.to(sessionId).emit('operator-message', { from: 'operator', message, operatorName: operatorName || 'اپراتور' });
  res.json({ success: true });
});

app.get('/api/sessions', (req, res) => {
  const active = Array.from(sessionManager.sessions.values()).filter(s => (Date.now() - new Date(s.lastActivity)) < 30*60*1000);
  res.json({ sessions: active.map(s => ({ id: s.id, userInfo: s.userInfo, connectedToHuman: s.connectedToHuman })) });
});

// صفحه اصلی و فایل‌های استاتیک
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ====================== راه‌اندازی سرور و وب‌هوک ======================
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`سرور اصلی روی پورت ${PORT} فعال شد`);

  if (BACKEND_URL && TELEGRAM_BOT_TOKEN) {
    const webhookUrl = `${BACKEND_URL}/telegram-webhook`;
    try {
      await bot.telegram.setWebhook(webhookUrl);
      const info = await bot.telegram.getWebhookInfo();
      console.log('وب‌هوک تلگرام با موفقیت تنظیم شد:', webhookUrl);
      console.log('وضعیت وب‌هوک:', info);
      bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, `ربات با وب‌هوک فعال شد\n${webhookUrl}`, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('خطا در تنظیم وب‌هوک:', err.response?.data || err.message);
    }
  } else {
    bot.launch();
    console.log('ربات با Polling راه‌اندازی شد (برای لوکال)');
  }
});
