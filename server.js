// server.js
require('dotenv').config();
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

// ==================== تنظیمات ====================
const PORT = process.env.PORT || 3000;
let BASE_URL = process.env.RAILWAY_STATIC_URL || process.env.BACKEND_URL || '';
BASE_URL = BASE_URL.replace(/\/+$/, '').trim();
if (!BASE_URL.startsWith('http')) BASE_URL = 'https://' + BASE_URL;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = Number(process.env.ADMIN_TELEGRAM_ID);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// دیتابیس
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
const io = socketIo(server, { cors: { origin: "*", methods: ["GET","POST"] } });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== کش و سشن ====================
const cache = new NodeCache({ stdTTL: 3600 });
const botSessions = new Map();
const shortId = (id) => String(id).substring(0,12);
const getSession = (id) => {
  let s = cache.get(id);
  if (!s) {
    s = { id, messages: [], userInfo: {}, connectedToHuman: false };
    cache.set(id,s);
  }
  return s;
};

// ==================== ربات تلگرام ====================
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// پذیرش و رد درخواست
bot.action(/accept_(.+)/, async (ctx) => {
  const short = ctx.match[1];
  const info = botSessions.get(short);
  if (!info) return ctx.answerCbQuery('منقضی شده');
  botSessions.set(short, { ...info, chatId: ctx.chat.id });
  getSession(info.fullId).connectedToHuman = true;
  await ctx.answerCbQuery('پذیرفته شد');
  io.to(info.fullId).emit('operator-connected', { message: 'اپراتور متصل شد!'});
});

bot.action(/reject_(.+)/, async (ctx) => {
  const short = ctx.match[1];
  botSessions.delete(short);
  await ctx.answerCbQuery('رد شد');
});

// پیام اپراتور
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  const entry = [...botSessions.entries()].find(([_,v])=>v.chatId===ctx.chat.id);
  if (!entry) return;
  io.to(entry[1].fullId).emit('operator-message',{ message: ctx.message.text });
  await ctx.reply('ارسال شد');
});

// وب‌هوک تلگرام
app.post('/telegram-webhook', (req,res)=> bot.handleUpdate(req.body,res));

// ==================== تحلیل پیام ====================
function detectOrderQuery(message){
  const patterns = [/وضعیت سفارش/i,/پیگیری/i,/سفارش من/i,/کد رهگیری/i,/محصولاتم/i];
  return patterns.some(p=>p.test(message));
}

async function fetchOrder(trackingCode){
  // نمونه واکشی از دیتابیس یا API واقعی
  const [rows] = await db.query('SELECT * FROM orders WHERE tracking_code=?', [trackingCode]);
  if(rows.length===0) return null;
  return rows[0];
}

// پاسخ مرحله‌ای سفارش
async function sendOrderStatus(sessionId, trackingCode){
  const session = getSession(sessionId);
  const order = await fetchOrder(trackingCode);
  if(!order) return 'سفارشی با این کد پیدا نشد. لطفاً بررسی کنید.';
  const items = order.items.split(','); // فرضا رشته کالاها
  const total = Number(order.total).toLocaleString();

  const replies = [
    `سلام ${order.customer_name}! اطلاعات سفارش شما در حال آماده شدن است...`,
    `کد سفارش: ${trackingCode}\nتاریخ ثبت: ${order.date}`,
    `محصولات: ${items.join(', ')}\nمبلغ کل: ${total} تومان\nدرگاه پرداخت: ${order.payment}`,
    `وضعیت سفارش: ${order.status}\nبه زودی برای شما ارسال خواهد شد 😊`
  ];

  for(let r of replies){
    session.messages.push({ role:'ai', content:r });
    io.to(sessionId).emit('ai-message',{ message:r });
    await new Promise(res=>setTimeout(res,3000));
  }
  return null;
}

// ==================== جستجوی محصول ====================
async function queryProducts(keyword,color,size){
  if(!db) return [];
  let query=`SELECT p.ID,p.post_title,pm_color.meta_value as color,pm_size.meta_value as size,pm_price.meta_value as price,pm_stock.meta_value as stock
             FROM wp_posts p
             LEFT JOIN wp_postmeta pm_color ON pm_color.post_id=p.ID AND pm_color.meta_key='attribute_pa_color'
             LEFT JOIN wp_postmeta pm_size ON pm_size.post_id=p.ID AND pm_size.meta_key='attribute_pa_size'
             LEFT JOIN wp_postmeta pm_price ON pm_price.post_id=p.ID AND pm_price.meta_key='_price'
             LEFT JOIN wp_postmeta pm_stock ON pm_stock.post_id=p.ID AND pm_stock.meta_key='_stock_status'
             WHERE p.post_type='product' AND p.post_status='publish'`;

  if(keyword) query+=` AND p.post_title LIKE '%${keyword}%'`;
  if(color) query+=` AND pm_color.meta_value LIKE '%${color}%'`;
  if(size) query+=` AND pm_size.meta_value LIKE '%${size}%'`;
  query+=' ORDER BY p.ID DESC LIMIT 10';
  const [rows] = await db.query(query);
  return rows;
}

// ==================== API Chat ====================
app.post('/api/chat', async (req,res)=>{
  const { message, sessionId, trackingCode } = req.body;
  if(!message || !sessionId) return res.status(400).json({ error:'داده ناقص' });

  const session = getSession(sessionId);
  session.messages.push({ role:'user', content:message });
  const short = shortId(sessionId);

  // اگر کاربر دنبال وضعیت سفارش است
  if(detectOrderQuery(message) && trackingCode){
    const orderReply = await sendOrderStatus(sessionId, trackingCode);
    if(orderReply) return res.json({ success:true, message:orderReply });
    return res.json({ success:true, message:'اطلاعات سفارش ارسال شد مرحله‌ای.'});
  }

  // جستجوی محصول
  let color=null,size=null,keyword=null;
  const colorList=['قرمز','آبی','سبز','سفید','مشکی','زرد','نارنجی','صورتی'];
  const sizeList=['S','M','L','XL','XXL','۳','۴','۵','۶'];
  colorList.forEach(c=>{ if(message.includes(c)) color=c; });
  sizeList.forEach(s=>{ if(message.includes(s)) size=s; });
  keyword = message.replace(new RegExp(`(${[...colorList,...sizeList].join('|')})`,'gi'),'').trim();

  try{
    const products = await queryProducts(keyword,color,size);
    if(products.length>0){
      const items = products.map(p=>`• ${p.post_title} | رنگ:${p.color||'-'} | سایز:${p.size||'-'} | قیمت:${p.price||'-'} تومان | موجودی:${p.stock||'-'}`).join('\n');
      const reply=`عالی! محصولات پیشنهادی:\n${items}`;
      return res.json({ success:true, message:reply, items });
    }else{
      return res.json({ success:true, message:'متأسفم، محصولی پیدا نشد. لطفا دوباره امتحان کنید.', items:[] });
    }
  }catch(err){
    console.error(err);
    return res.json({ success:true, message:'خطا در دریافت اطلاعات محصولات. لطفاً بعدا تلاش کنید.', items:[] });
  }
});

// ==================== سوکت ====================
io.on('connection',(socket)=>{
  socket.on('join-session', sessionId=> socket.join(sessionId));
  socket.on('user-message', async ({ sessionId,message,trackingCode })=>{
    if(!sessionId || !message) return;
    if(detectOrderQuery(message) && trackingCode){
      await sendOrderStatus(sessionId, trackingCode);
      return;
    }
    // می‌تونی پیام‌های دیگر را سوکت ارسال کنی
  });
});

// ==================== صفحه اصلی ====================
app.get('*',(req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));

// ==================== راه‌اندازی ====================
server.listen(PORT,'0.0.0.0', async ()=>{
  console.log(`🚀 سرور روی پورت ${PORT} فعال شد`);
  try{
    await bot.telegram.setWebhook(`${BASE_URL}/telegram-webhook`);
    console.log('وب‌هوک تنظیم شد:', `${BASE_URL}/telegram-webhook`);
    await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID,'ربات آماده است ✅');
  }catch(err){
    console.error('وب‌هوک خطا → Polling فعال شد');
    bot.launch();
  }
});
