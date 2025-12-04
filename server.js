const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const helmet = require('helmet');
const axios = require('axios');
const NodeCache = require('node-cache');
const { Telegraf, Markup } = require('telegraf');
require('dotenv').config();

// ====================== تنظیمات ======================
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;

let BASE_URL = process.env.RAILWAY_STATIC_URL || process.env.BACKEND_URL || '';
BASE_URL = BASE_URL.replace(/\/+$/, '').trim();
if (BASE_URL && !BASE_URL.startsWith('http')) BASE_URL = 'https://' + BASE_URL;

console.log('='.repeat(60));
console.log('AI CHATBOT + TELEGRAM BOT - 100% WORKING FINAL VERSION');
console.log('='.repeat(60));
console.log('PORT:', PORT);
console.log('BASE_URL:', BASE_URL || 'Local');
console.log('GROQ:', GROQ_API_KEY ? 'فعال' : 'غیرفعال');

// ====================== سرور اصلی (فقط یک سرور!) ======================
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(cors({ origin: "*", credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ====================== کش و سشن ======================
const cache = new NodeCache({ stdTTL: 3600 });
const botSessions = new Map(); // shortId → { fullId, chatId, userInfo }

// کوتاه کردن آیدی
const shortId = id => id.substring(0, 12);

// ====================== هوش مصنوعی ======================
const getAIResponse = async (message) => {
  if (!GROQ_API_KEY) return { success: false, requiresHuman: true };
  try {
    const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'فقط فارسی جواب بده. پشتیبان هوشمند و مودب باش.' },
        { role: 'user', content: message }
      ],
      temperature: 0.7,
      max_tokens: 800
    }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` }, timeout: 30000 });
    const text = res.data.choices[0].message.content.trim();
    const needHuman = /اپراتور|انسانی|نمی‌دونم|نمی‌تونم|متخصص|نمیشه/i.test(text);
    return { success: true, message: text, requiresHuman: needHuman };
  } catch (err) {
    console.error('AI Error:', err.message);
    return { success: false, requiresHuman: true };
  }
};

// ====================== سشن منیجر ======================
const getSession = (id) => {
  let s = cache.get(id);
  if (!s) {
    s = { id, messages: [], createdAt: new Date(), userInfo: {}, connectedToHuman: false };
    cache.set(id, s);
  }
  s.lastActivity = new Date();
  cache.set(id, s);
  return s;
};

// ====================== ربات تلگرام ======================
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// دستورات پایه
bot.start(ctx => ctx.reply('سلام اپراتور! ربات فعال شد ✅', Markup.keyboard([['جلسات فعال']]).resize()));
bot.hears('جلسات فعال', ctx => ctx.reply('در حال حاضر فقط از طریق اعلان‌ها کار می‌کنه'));

// پذیرش درخواست
bot.action(/accept_(.+)/, async (ctx) => {
  const short = ctx.match[1];
  const info = botSessions.get(short);
  if (!info) return ctx.answerCbQuery('منقضی شده');

  botSessions.set(short, { ...info, chatId: ctx.chat.id });
  getSession(info.fullId).connectedToHuman = true;

  await ctx.answerCbQuery('✅ پذیرش موفق');
  await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ شما این گفتگو را پذیرفتید', { parse_mode: 'Markdown' });

  // اطلاع به کاربر سایت
  io.to(info.fullId).emit('operator-connected', { message: 'اپراتور متصل شد! حالا می‌تونید چت کنید.' });
});

// رد درخواست
bot.action(/reject_(.+)/, async (ctx) => {
  const short = ctx.match[1];
  botSessions.delete(short);
  await ctx.answerCbQuery('❌ رد شد');
  await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n❌ رد شد', { parse_mode: 'Markdown' });
  io.to(botSessions.get(short)?.fullId || '').emit('operator-rejected', { message: 'اپراتور در دسترس نیست' });
});

// پیام اپراتور → کاربر سایت
bot.on('text', async (ctx) => {
  if (ctx.message?.text?.startsWith('/')) return;
  const entry = [...botSessions.entries()].find(([_, v]) => v.chatId === ctx.chat.id);
  if (!entry) return;

  const fullId = entry[1].fullId;
  const message = ctx.message.text;

  // ارسال به ویجت از طریق سوکت
  io.to(fullId).emit('operator-message', { message, operatorName: ctx.from.first_name || 'اپراتور' });

  ctx.reply('ارسال شد ✅');
});

// ====================== وب‌هوک تلگرام (از تلگرام به سرور) ======================
app.post('/telegram-webhook', (req, res) => {
  console.log('Telegram Webhook دریافت شد:', new Date().toISOString());
  bot.handleUpdate(req.body, res);
});

// ====================== وب‌هوک داخلی (درخواست جدید از سایت) ======================
app.post('/webhook', async (req, res) => {
  try {
    const { event, data } = req.body;

    if (event === 'new_session') {
      const short = shortId(data.sessionId);
      botSessions.set(short, { fullId: data.sessionId, userInfo: data.userInfo || {} });

      await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, `
🔔 درخواست پشتیبانی جدید

کد جلسه: \`${short}\`
نام: ${data.userInfo?.name || 'ناشناس'}
پیام اول: ${data.userMessage?.substring(0, 150) || 'درخواست اتصال به اپراتور'}
      `.trim(), {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ پذیرش', callback_data: `accept_${short}` },
            { text: '❌ رد', callback_data: `reject_${short}` }
          ]]
        }
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('خطا در /webhook:', err);
    res.status(500).json({ success: false });
  }
});

// ====================== API های ویجت ======================
app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message || !sessionId) return res.status(400).json({ error: 'داده ناقص' });

  const session = getSession(sessionId);
  session.messages.push({ role: 'user', content: message });

  if (session.connectedToHuman) {
    // وقتی به اپراتور وصله، پیام فقط به تلگرام بره (بعداً از تلگرام میاد)
    return res.json({ operatorConnected: true });
  }

  const ai = await getAIResponse(message);
  if (ai.success && !ai.requiresHuman) {
    session.messages.push({ role: 'assistant', content: ai.message });
    return res.json({ success: true, message: ai.message });
  } else {
    return res.json({ success: false, requiresHuman: true });
  }
});

app.post('/api/connect-human', async (req, res) => {
  const { sessionId, userInfo } = req.body;
  const session = getSession(sessionId);
  session.userInfo = userInfo || {};

  // ارسال درخواست به ربات تلگرام
  await axios.post(`${BASE_URL}/webhook`, {
    event: 'new_session',
    data: { sessionId, userInfo: session.userInfo, userMessage: session.messages.slice(-1)[0]?.content || 'درخواست اتصال' }
  }).catch(() => {});

  res.json({ success: true, pending: true });
});

app.post('/api/send-to-user', (req, res) => {
  const { sessionId, message } = req.body;
  const session = getSession(sessionId);
  session.messages.push({ role: 'operator', content: message });
  io.to(sessionId).emit('operator-message', { message });
  res.json({ success: true });
});

// صفحه اصلی و استاتیک
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// سوکت برای ارتباط لحظه‌ای
io.on('connection', socket => {
  socket.on('join-session', id => socket.join(id));
});

// ====================== راه‌اندازی سرور و وب‌هوک ======================
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`سرور روی پورت ${PORT} فعال شد`);

  if (!BASE_URL || !TELEGRAM_BOT_TOKEN) {
    console.log('Polling mode');
    bot.launch();
    return;
  }

  const webhookUrl = `${BASE_URL}/telegram-webhook`;
  try {
    const info = await bot.telegram.getWebhookInfo();
    if (info.url !== webhookUrl) {
      await new Promise(r => setTimeout(r, 3000));
      await bot.telegram.setWebhook(webhookUrl);
      console.log('وب‌هوک تنظیم شد:', webhookUrl);
    } else {
      console.log('وب‌هوک قبلاً درست بود');
    }
    await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, `ربات آماده است ✅\n${webhookUrl}`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('خطا در تنظیم وب‌هوک:', err.message);
    bot.launch();
  }
});
