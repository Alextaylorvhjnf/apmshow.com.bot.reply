#!/usr/bin/env node
const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const axios = require('axios');
require('dotenv').config();

// ================= CONFIG =================
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID;
const BACKEND_URL = process.env.BACKEND_URL;
const WEBHOOK_URL = process.env.TELEGRAM_WEBHOOK_URL;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN || !ADMIN_ID || !BACKEND_URL || !WEBHOOK_URL) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

// ================ SESSION STORAGE ================
const sessions = new Map();   // shortId -> { fullId, userInfo, status, operatorChatId }
const userSessions = new Map(); // chatId -> shortId

function generateShortId(id) {
  return id.slice(0, 12);
}

function storeSession(sessionId, userInfo) {
  const shortId = generateShortId(sessionId);
  sessions.set(shortId, { fullId: sessionId, userInfo, status: 'pending' });
  return shortId;
}

// ================= TELEGRAM BOT ==================
const bot = new Telegraf(BOT_TOKEN);

// Start command
bot.start(ctx => ctx.reply(`👋 سلام ${ctx.from.first_name || 'اپراتور'}!\n✅ سیستم آماده دریافت پیام‌هاست`));

// Sessions command
bot.command('sessions', async ctx => {
  try {
    const res = await axios.get(`${BACKEND_URL}/api/sessions`);
    const list = res.data.sessions || [];
    if (!list.length) return ctx.reply('📭 هیچ جلسه فعالی وجود ندارد');

    let msg = `📊 جلسات فعال (${list.length}):\n`;
    list.forEach((s, i) => {
      const shortId = generateShortId(s.id);
      const duration = Math.floor((new Date() - new Date(s.createdAt)) / 60000);
      msg += `${i + 1}. \`${shortId}\` | ${s.userInfo?.name || 'ناشناس'} | ⏱️ ${duration} دقیقه | ${s.connectedToHuman ? '✅' : '⏳'}\n`;
    });
    ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error(e.message);
    ctx.reply('❌ خطا در دریافت جلسات');
  }
});

// Handle new session
async function handleNewSession(sessionId, userInfo, userMessage) {
  const shortId = storeSession(sessionId, userInfo);
  const msg = `🔔 درخواست اتصال جدید\n🎫 کد: \`${shortId}\`\n👤 ${userInfo.name || 'کاربر'}\n💬 ${userMessage.substring(0, 100)}`;
  await bot.telegram.sendMessage(ADMIN_ID, msg, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('✅ پذیرش', `accept_${shortId}`), Markup.button.callback('❌ رد', `reject_${shortId}`)]
    ])
  });
}

// Accept callback
bot.action(/accept_(.+)/, async ctx => {
  const shortId = ctx.match[1];
  const session = sessions.get(shortId);
  if (!session) return ctx.answerCbQuery('❌ جلسه پیدا نشد');
  session.status = 'accepted';
  session.operatorChatId = ctx.chat.id;
  userSessions.set(ctx.chat.id, shortId);
  await ctx.answerCbQuery('✅ گفتگو قبول شد');
  await ctx.editMessageText(ctx.callbackQuery.message.text + '\n✅ شما این گفتگو را قبول کردید', { parse_mode: 'Markdown' });
  await axios.post(`${BACKEND_URL}/webhook`, { event: 'operator_accepted', data: { sessionId: session.fullId, operatorId: ctx.chat.id } }).catch(console.error);
});

// Reject callback
bot.action(/reject_(.+)/, async ctx => {
  const shortId = ctx.match[1];
  const session = sessions.get(shortId);
  if (!session) return ctx.answerCbQuery('❌ جلسه پیدا نشد');
  sessions.delete(shortId);
  await ctx.answerCbQuery('❌ گفتگو رد شد');
  await ctx.editMessageText(ctx.callbackQuery.message.text + '\n❌ شما این گفتگو را رد کردید', { parse_mode: 'Markdown' });
  await axios.post(`${BACKEND_URL}/webhook`, { event: 'operator_rejected', data: { sessionId: session.fullId } }).catch(console.error);
});

// Operator sends message
bot.on('text', async ctx => {
  if (ctx.message.text.startsWith('/')) return;
  const shortId = userSessions.get(ctx.chat.id);
  if (!shortId) return ctx.reply('📭 جلسه فعالی ندارید');
  const session = sessions.get(shortId);
  if (!session || session.status !== 'accepted') return ctx.reply('❌ جلسه فعال نیست');
  await axios.post(`${BACKEND_URL}/api/send-to-user`, { sessionId: session.fullId, message: ctx.message.text }).catch(console.error);
  ctx.reply('✅ پیام ارسال شد');
});

// ================= EXPRESS SERVER =================
const app = express();
app.use(express.json());

// Telegram webhook
app.post('/telegram-webhook', async (req, res) => {
  try { await bot.handleUpdate(req.body); res.sendStatus(200); } 
  catch (e) { console.error(e.message); res.sendStatus(500); }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    activeSessions: Array.from(sessions.values()).filter(s => s.status === 'accepted').length,
    pendingSessions: Array.from(sessions.values()).filter(s => s.status === 'pending').length
  });
});

// ================= START BOT =================
(async () => {
  try {
    console.log('🚀 Setting Telegram webhook...');
    await bot.telegram.setWebhook(WEBHOOK_URL);
    app.listen(PORT, () => console.log(`🤖 Bot running on port ${PORT}`));
  } catch (e) { console.error('❌ Bot startup failed:', e.message); process.exit(1); }
})();
