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
if (!BASE_URL) BASE_URL = 'https://ai-chat-support-production.up.railway.app';
if (!BASE_URL.startsWith('http')) BASE_URL = 'https://' + BASE_URL;

// ==================== اتصال دیتابیس ====================
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_USER = process.env.DB_USER || 'apmsho_shikpooshan';
const DB_PASSWORD = process.env.DB_PASSWORD || '5W2nn}@tkm8926G*';
const DB_NAME = process.env.DB_NAME || 'apmsho_shikpooshan';

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
const io = socketIo(server, { cors: { origin: "*", methods: ["GET","POST"] } });
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== کش و مدیریت جلسه ====================
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

// ==================== تابع جستجوی محصولات ====================
async function queryProducts(keyword, color, size) {
  if (!db) return [];
  try {
    let query = `SELECT p.ID, p.post_title, pm_color.meta_value as color, pm_size.meta_value as size,
                        pm_stock.meta_value as stock, pm_price.meta_value as price
                 FROM wp_posts p
                 LEFT JOIN wp_postmeta pm_color ON pm_color.post_id = p.ID AND pm_color.meta_key='attribute_pa_color'
                 LEFT JOIN wp_postmeta pm_size ON pm_size.post_id = p.ID AND pm_size.meta_key='attribute_pa_size'
                 LEFT JOIN wp_postmeta pm_stock ON pm_stock.post_id = p.ID AND pm_stock.meta_key='_stock_status'
                 LEFT JOIN wp_postmeta pm_price ON pm_price.post_id = p.ID AND pm_price.meta_key='_price'
                 WHERE p.post_type='product' AND p.post_status='publish'`;

    if (color) query += ` AND pm_color.meta_value LIKE '%${color}%'`;
    if (size) query += ` AND pm_size.meta_value LIKE '%${size}%'`;
    if (keyword) query += ` AND p.post_title LIKE '%${keyword}%'`;

    query += ` ORDER BY p.ID DESC LIMIT 5`;

    const [rows] = await db.query(query);
    return rows;
  } catch (err) {
    console.error('DB queryProducts error:', err);
    return [];
  }
}

// ==================== الگوریتم هوش داخلی ====================
async function internalAI(message, session) {
  const keywords = ['لباس', 'پیراهن', 'شلوار', 'کفش', 'پیشنهاد', 'سایز', 'رنگ'];
  const hasSuggestion = keywords.some(k => message.includes(k));

  if (hasSuggestion && db) {
    try {
      // استخراج رنگ و سایز از پیام
      const colorMatch = message.match(/(قرمز|آبی|سفید|مشکی|سبز|زرد|نارنجی|صورتی)/i);
      const sizeMatch = message.match(/(S|M|L|XL|XXL|\d{1,2})/i);

      const color = colorMatch ? colorMatch[0] : null;
      const size = sizeMatch ? sizeMatch[0] : null;

      const products = await queryProducts(message, color, size);
      if (products.length > 0) {
        let reply = 'این محصولات مطابق با درخواست شما هستند:\n\n';
        products.forEach(p => {
          reply += `🛍 ${p.post_title}\nرنگ: ${p.color || 'نامشخص'} | سایز: ${p.size || 'نامشخص'} | موجودی: ${p.stock || 'نامشخص'} | قیمت: ${p.price || 'نامشخص'} تومان\n`;
          reply += `لینک محصول: ${BASE_URL}/?p=${p.ID}\n\n`;
        });
        return reply.trim();
      } else {
        return 'متأسفم 😔 محصولی با این مشخصات پیدا نشد. می‌خوای رنگ یا سایز دیگری امتحان کنیم؟';
      }
    } catch (err) {
      console.error('خطا در جستجوی محصول: ', err);
      return 'الان نتونستم محصولات رو جستجو کنم، لطفاً چند لحظه دیگر امتحان کنید 🙏';
    }
  }

  const greetings = ['سلام', 'درود', 'هی'];
  if (greetings.some(g => message.includes(g))) {
    return 'سلام دوست عزیز! 😄 چطوری؟ در مورد چی حرف بزنیم؟ سفارش داری یا پیشنهاد لباس می‌خوای؟';
  }

  session.messages.push({ role: 'ai', content: 'در حال فکر...' });
  return 'جالب بود! 😊 بیشتر بگو، دوست دارم بدونم چی تو ذهنته. یا کد رهگیری بفرست.';
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

app.post('/webhook', async (req, res) => {
  if (req.body.event !== 'new_session') return res.json({ success: false });
  const { sessionId, userInfo, userMessage } = req.body.data;
  const short = shortId(sessionId);
  botSessions.set(short, { fullId: sessionId, userInfo: userInfo || {}, chatId: null });
  const userName = userInfo?.name || 'ناشناس';
  const userPage = userInfo?.page ? userInfo.page : 'نامشخص';
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

app.post('/api/connect-human', async (req, res) => {
  const { sessionId, userInfo } = req.body;
  getSession(sessionId).userInfo = userInfo || {};
  await axios.post(`${BASE_URL}/webhook`, {
    event: 'new_session',
    data: { sessionId, userInfo, userMessage: 'درخواست اتصال' }
  }).catch(() => {});
  res.json({ success: true, pending: true });
});

// ==================== مسیر /api/chat ====================
app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message || !sessionId) return res.status(400).json({ error: 'داده ناقص' });

  const session = getSession(sessionId);
  session.messages.push({ role: 'user', content: message });
  const short = shortId(sessionId);

  if (botSessions.get(short)?.chatId) {
    return res.json({ operatorConnected: true });
  }

  try {
    const colorList = ['قرمز','آبی','سبز','سفید','مشکی','زرد','نارنجی','صورتی'];
    const sizeList = ['S','M','L','XL','XXL','۳','۴','۵','۶'];

    let color = null, size = null;
    colorList.forEach(c => { if(message.includes(c)) color=c; });
    sizeList.forEach(s => { if(message.includes(s)) size=s; });

    let keyword = message.replace(new RegExp(`(${[...colorList,...sizeList].join('|')})`, 'gi'),'').trim();

    const products = await queryProducts(keyword, color, size);
    if (products.length > 0) {
      const items = products.map(p => `• ${p.post_title} | رنگ: ${p.color||'-'} | سایز: ${p.size||'-'} | قیمت: ${p.price||'-'} تومان | موجودی: ${p.stock||'-'}`).join('\n');
      const reply = `عالی! محصولات پیشنهادی من بر اساس درخواستت:\n\n${items}`;
      return res.json({ success: true, message: reply, items });
    } else {
      const aiReply = await internalAI(message, session);
      return res.json({ success: true, message: aiReply, items: [] });
    }
  } catch (err) {
    console.error('DB query error:', err);
    const aiReply = await internalAI(message, session);
    return res.json({ success: true, message: aiReply, items: [] });
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
      const userIp = info.userInfo?.ip ? info.userInfo.ip : 'نامشخص';
      await bot.telegram.sendMessage(info.chatId, `
پیام جدید از کاربر
کد: ${short}
نام: ${userName}
صفحه: ${userPage}
آی‌پی: ${userIp}
پیام:
${message}
      `.trim());
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

// ==================== راه‌اندازی سرور ====================
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
