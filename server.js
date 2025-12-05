// server.js
const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const helmet = require('helmet');
const axios = require('axios');
const NodeCache = require('node-cache');
const { Telegraf } = require('telegraf');
const mysql = require('mysql2/promise');
require('dotenv').config();

// ==================== تنظیمات ====================
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = Number(process.env.ADMIN_TELEGRAM_ID);
let BASE_URL = process.env.RAILWAY_STATIC_URL || process.env.BACKEND_URL || '';
BASE_URL = BASE_URL.replace(/\/+$/, '').trim();
if (!BASE_URL.startsWith('http')) BASE_URL = 'https://' + BASE_URL;

const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ==================== اتصال دیتابیس ====================
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_NAME = process.env.DB_NAME;

let db;
(async () => {
  try {
    db = await mysql.createPool({
      host: DB_HOST,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: 'utf8mb4'
    });
    console.log('✅ اتصال دیتابیس موفق بود');
  } catch (err) {
    console.error('❌ خطا در اتصال دیتابیس', err);
  }
})();

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

// ==================== تابع هوش مصنوعی GraC ====================
async function aiReplyGraC(message, sessionId) {
  try {
    const session = getSession(sessionId);
    session.messages.push({ role: 'user', content: message });

    const payload = {
      prompt: message,
      sessionId: sessionId
    };

    const res = await axios.post('https://api.groa.ai/v1/ask', payload, {
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      timeout: 10000
    });

    if (res.data && res.data.answer) return res.data.answer;
    return 'متأسفم، الان نتونستم پاسخ مناسب پیدا کنم 😔';
  } catch (err) {
    console.error('GraC API error:', err.message);
    return 'در حال حاضر پاسخ خودکار در دسترس نیست، لطفاً کمی بعد امتحان کنید 🙏';
  }
}

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
آی‌پی: ${info.userInfo?.ip || 'نامشخص'}
کد: ${short}
  `.trim());
  io.to(info.fullId).emit('operator-connected', { message: 'اپراتور متصل شد!' });
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

// وب‌هوک تلگرام
app.post('/telegram-webhook', (req, res) => bot.handleUpdate(req.body, res));

// ==================== وب‌هوک ویجت ====================
app.post('/webhook', async (req, res) => {
  if (req.body.event !== 'new_session') return res.json({ success: false });
  const { sessionId, userInfo, userMessage } = req.body.data;
  const short = shortId(sessionId);
  botSessions.set(short, { fullId: sessionId, userInfo: userInfo || {}, chatId: null });

  const userName = userInfo?.name || 'ناشناس';
  const userPage = userInfo?.page || 'نامشخص';
  const userIp = userInfo?.ip ? userInfo.ip : 'نامشخص';

  await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, `
درخواست پشتیبانی جدید
کد جلسه: ${short}
نام: ${userName}
صفحه: ${userPage}
آی‌پی: ${userIp}
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

// ==================== اتصال اپراتور ====================
app.post('/api/connect-human', async (req, res) => {
  const { sessionId, userInfo } = req.body;
  getSession(sessionId).userInfo = userInfo || {};
  await axios.post(`${BASE_URL}/webhook`, {
    event: 'new_session',
    data: { sessionId, userInfo, userMessage: 'درخواست اتصال' }
  }).catch(() => {});
  res.json({ success: true, pending: true });
});

// ==================== جستجوی محصولات ====================
async function queryProducts(keyword, color, size) {
  if (!db) return [];
  let query = `SELECT p.ID, p.post_title,
               pm_color.meta_value AS color,
               pm_size.meta_value AS size,
               pm_stock.meta_value AS stock,
               pm_price.meta_value AS price
               FROM wp_posts p
               LEFT JOIN wp_postmeta pm_color ON pm_color.post_id = p.ID AND pm_color.meta_key='attribute_pa_color'
               LEFT JOIN wp_postmeta pm_size ON pm_size.post_id = p.ID AND pm_size.meta_key='attribute_pa_size'
               LEFT JOIN wp_postmeta pm_stock ON pm_stock.post_id = p.ID AND pm_stock.meta_key='_stock_status'
               LEFT JOIN wp_postmeta pm_price ON pm_price.post_id = p.ID AND pm_price.meta_key='_price'
               WHERE p.post_type='product' AND p.post_status='publish'`;

  if (color) query += ` AND pm_color.meta_value LIKE '%${color}%'`;
  if (size) query += ` AND pm_size.meta_value LIKE '%${size}%'`;
  if (keyword) query += ` AND p.post_title LIKE '%${keyword}%'`;
  query += ` ORDER BY p.ID DESC LIMIT 10`;

  const [rows] = await db.query(query);
  return rows;
}

// ==================== API چت هوشمند ====================
app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message || !sessionId) return res.status(400).json({ error: 'داده ناقص' });

  const session = getSession(sessionId);
  session.messages.push({ role: 'user', content: message });
  const short = shortId(sessionId);

  if (botSessions.get(short)?.chatId) return res.json({ operatorConnected: true });

  // بررسی اینکه پیام کاربر درخواست محصول یا سفارش هست
  const colorList = ['قرمز','آبی','سبز','سفید','مشکی','زرد','نارنجی','صورتی'];
  const sizeList = ['S','M','L','XL','XXL','۳','۴','۵','۶'];

  let color = null, size = null;
  colorList.forEach(c => { if(message.includes(c)) color=c; });
  sizeList.forEach(s => { if(message.includes(s)) size=s; });

  const keyword = message.replace(new RegExp(`(${[...colorList,...sizeList].join('|')})`, 'gi'),'').trim();

  // بررسی کد رهگیری
  const code = message.match(/\d{4,}/)?.[0];
  if (code) {
    try {
      const [orders] = await db.query(`SELECT * FROM wp_posts p
        LEFT JOIN wp_postmeta pm_code ON pm_code.post_id=p.ID AND pm_code.meta_key='tracking_code'
        LEFT JOIN wp_postmeta pm_status ON pm_status.post_id=p.ID AND pm_status.meta_key='order_status'
        WHERE pm_code.meta_value=? LIMIT 1`, [code]);

      if (orders.length > 0) {
        const order = orders[0];
        return res.json({
          success: true,
          message: `✅ سفارش شما با کد ${code} پیدا شد.\nوضعیت: ${order.order_status || 'نامشخص'}`
        });
      } else {
        return res.json({ success: true, message: `❌ سفارش با کد ${code} پیدا نشد.` });
      }
    } catch (err) {
      console.error('Order query error:', err);
      return res.json({ success: true, message: 'خطا در دریافت وضعیت سفارش، لطفاً بعداً امتحان کنید 🙏' });
    }
  }

  // جستجوی محصولات
  try {
    const products = await queryProducts(keyword, color, size);
    if (products.length > 0) {
      const items = products.map(p => `• ${p.post_title} | رنگ: ${p.color||'-'} | سایز: ${p.size||'-'} | قیمت: ${p.price||'-'} تومان | موجودی: ${p.stock||'-'}`).join('\n');
      const reply = `عالی! محصولات پیشنهادی من بر اساس درخواستت:\n\n${items}`;
      return res.json({ success: true, message: reply, items });
    }
  } catch (err) {
    console.error('DB query error:', err);
  }

  // fallback به GraC API
  const aiAnswer = await aiReplyGraC(message, sessionId);
  return res.json({ success: true, message: aiAnswer, items: [] });
});

// ==================== سوکت – فایل و ویس ====================
io.on('connection', (socket) => {
  socket.on('join-session', (sessionId) => socket.join(sessionId));
  socket.on('user-message', async ({ sessionId, message }) => {
    if (!sessionId || !message) return;
    const short = shortId(sessionId);
    const info = botSessions.get(short);
    if (info?.chatId) {
      await bot.telegram.sendMessage(info.chatId, `پیام جدید از کاربر:\n${message}`);
    }
  });

  socket.on('user-file', async ({ sessionId, fileName, fileBase64 }) => {
    const short = shortId(sessionId);
    const info = botSessions.get(short);
    if (info?.chatId) {
      const buffer = Buffer.from(fileBase64, 'base64');
      await bot.telegram.sendDocument(info.chatId, { source: buffer, filename: fileName });
    }
  });

  socket.on('user-voice', async ({ sessionId, voiceBase64 }) => {
    const short = shortId(sessionId);
    const info = botSessions.get(short);
    if (info?.chatId) {
      const buffer = Buffer.from(voiceBase64, 'base64');
      await bot.telegram.sendVoice(info.chatId, { source: buffer });
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
    await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, `ربات آماده است\n${BASE_URL}`);
  } catch (err) {
    console.error('وب‌هوک خطا داد → Polling فعال شد');
    bot.launch();
  }
});
