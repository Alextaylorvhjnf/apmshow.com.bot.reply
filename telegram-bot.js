const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
require('dotenv').config();
const express = require('express');

console.log('='.repeat(60));
console.log('🤖 TELEGRAM BOT - FIXED CALLBACK VERSION');
console.log('='.repeat(60));

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;
const BACKEND_URL = process.env.BACKEND_URL || 'https://ai-chat-support-production.up.railway.app';

// Validate
if (!TELEGRAM_BOT_TOKEN || !ADMIN_TELEGRAM_ID) {
  console.error('❌ Missing Telegram configuration');
  process.exit(1);
}

console.log('✅ Bot configured');
console.log('✅ Admin:', ADMIN_TELEGRAM_ID);
console.log('✅ Backend:', BACKEND_URL);

// Session storage
const sessions = new Map(); // shortId -> { fullId, userInfo, status, createdAt, operatorChatId }
const userSessions = new Map(); // chatId -> shortId

// Helper functions
function generateShortId(sessionId) {
  return sessionId.substring(0, 12);
}

function storeSession(sessionId, userInfo) {
  const shortId = generateShortId(sessionId);
  sessions.set(shortId, {
    fullId: sessionId,
    userInfo,
    status: 'pending',
    createdAt: new Date()
  });
  return shortId;
}

function getFullSessionId(shortId) {
  const session = sessions.get(shortId);
  return session ? session.fullId : null;
}

// Create bot
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// Start command
bot.start((ctx) => {
  const welcomeMessage = `👨‍💼 *پنل اپراتور پشتیبانی*\n\n` +
    `سلام ${ctx.from.first_name || 'اپراتور'}! 👋\n\n` +
    `✅ سیستم آماده دریافت پیام‌هاست\n\n` +
    `📋 *دستورات:*\n` +
    `/sessions - جلسات فعال\n` +
    `/help - راهنما`;

  ctx.reply(welcomeMessage, {
    parse_mode: 'Markdown',
    ...Markup.keyboard([['📋 جلسات فعال', '🆘 راهنما']]).resize()
  });
});

// Sessions command
bot.command('sessions', async (ctx) => {
  try {
    const response = await axios.get(`${BACKEND_URL}/api/sessions`);
    const sessionsList = response.data.sessions || [];

    if (!sessionsList.length) {
      return ctx.reply('📭 *هیچ جلسه فعالی وجود ندارد*', { parse_mode: 'Markdown' });
    }

    let message = `📊 *جلسات فعال (${sessionsList.length}):*\n\n`;

    sessionsList.forEach((session, index) => {
      const shortId = generateShortId(session.id);
      const duration = Math.floor((new Date() - new Date(session.createdAt)) / (1000 * 60));
      message += `*${index + 1}. جلسه:* \`${shortId}\`\n`;
      message += ` 👤 *کاربر:* ${session.userInfo?.name || 'ناشناس'}\n`;
      message += ` ⏱️ *مدت:* ${duration} دقیقه\n`;
      message += ` 🔗 *وضعیت:* ${session.connectedToHuman ? 'متصل ✅' : 'در انتظار'}\n\n`;
    });

    ctx.reply(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('🔄 بروزرسانی', 'refresh_sessions')]])
    });

  } catch (error) {
    console.error('Sessions error:', error.message);
    ctx.reply('❌ خطا در دریافت جلسات');
  }
});

// Handle new user session
async function handleNewUserSession(sessionId, userInfo, userMessage) {
  try {
    const shortId = storeSession(sessionId, userInfo);
    const operatorMessage = `🔔 *درخواست اتصال جدید*\n\n` +
      `🎫 *کد:* \`${shortId}\`\n` +
      `👤 *کاربر:* ${userInfo.name || 'کاربر سایت'}\n` +
      `📝 *پیام:* ${userMessage.substring(0, 100)}${userMessage.length > 100 ? '...' : ''}\n\n` +
      `💬 برای پذیرش گفتگو کلیک کنید:`;

    await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, operatorMessage, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ بله، می‌پذیرم', `accept_${shortId}`),
          Markup.button.callback('❌ نه، رد کن', `reject_${shortId}`)
        ]
      ])
    });

    console.log(`✅ New session notification sent: ${shortId}`);
    return true;

  } catch (error) {
    console.error('Error sending notification:', error.message);
    return false;
  }
}

// Accept callback
bot.action(/accept_(.+)/, async (ctx) => {
  try {
    const shortId = ctx.match[1];
    const session = sessions.get(shortId);
    if (!session) return ctx.answerCbQuery('❌ جلسه پیدا نشد');

    session.status = 'accepted';
    session.acceptedAt = new Date();
    session.operatorChatId = ctx.chat.id;
    userSessions.set(ctx.chat.id, shortId);

    await ctx.answerCbQuery('✅ گفتگو قبول شد');
    await ctx.editMessageText(
      ctx.callbackQuery.message.text + '\n\n✅ *شما این گفتگو را قبول کردید*\n💬 اکنون می‌توانید پیام بفرستید.',
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([]) }
    );

    await axios.post(`${BACKEND_URL}/webhook`, {
      event: 'operator_accepted',
      data: {
        sessionId: session.fullId,
        operatorId: ctx.chat.id,
        operatorName: ctx.from.first_name || 'اپراتور'
      }
    });

  } catch (error) {
    console.error('Accept callback error:', error.message);
    ctx.answerCbQuery('❌ خطا در پردازش');
  }
});

// Reject callback
bot.action(/reject_(.+)/, async (ctx) => {
  try {
    const shortId = ctx.match[1];
    const session = sessions.get(shortId);
    if (!session) return ctx.answerCbQuery('❌ جلسه پیدا نشد');

    sessions.delete(shortId);
    await ctx.answerCbQuery('❌ گفتگو رد شد');
    await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n❌ *شما این گفتگو را رد کردید*', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([])
    });

    await axios.post(`${BACKEND_URL}/webhook`, {
      event: 'operator_rejected',
      data: { sessionId: session.fullId }
    });

  } catch (error) {
    console.error('Reject callback error:', error.message);
    ctx.answerCbQuery('❌ خطا در پردازش');
  }
});

// Operator messages
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;

  const chatId = ctx.chat.id;
  const shortId = userSessions.get(chatId);
  if (!shortId) return ctx.reply('📭 *شما جلسه فعالی ندارید*', { parse_mode: 'Markdown' });

  const session = sessions.get(shortId);
  if (!session || session.status !== 'accepted') {
    return ctx.reply('❌ *این جلسه فعال نیست*', { parse_mode: 'Markdown' });
  }

  try {
    const response = await axios.post(`${BACKEND_URL}/api/send-to-user`, {
      sessionId: session.fullId,
      message: ctx.message.text,
      operatorId: chatId,
      operatorName: ctx.from.first_name || 'اپراتور'
    });

    if (response.data.success) {
      ctx.reply(`✅ *پیام ارسال شد*\n👤 به: ${response.data.userName || 'کاربر'}\n📝 پیام شما: ${ctx.message.text.substring(0, 50)}${ctx.message.text.length > 50 ? '...' : ''}`, { parse_mode: 'Markdown' });
    } else {
      ctx.reply('❌ خطا در ارسال پیام');
    }

  } catch (error) {
    console.error('Send message error:', error.message);
    ctx.reply('❌ خطا در ارتباط با سرور');
  }
});

// Help command
bot.command('help', (ctx) => {
  const helpMessage = `📖 *راهنمای اپراتور:*\n\n` +
    `1. درخواست‌های کاربران به صورت خودکار ارسال می‌شود\n` +
    `2. برای پذیرش گفتگو روی "✅ بله، می‌پذیرم" کلیک کنید\n` +
    `3. سپس می‌توانید مستقیماً پیام بفرستید\n` +
    `4. پیام‌های شما به کاربر ارسال می‌شود\n\n` +
    `⚡ *دستورات:*\n` +
    `/start - شروع\n/sessions - جلسات فعال\n/help - این راهنما\n\n` +
    `🔔 هر پیامی که می‌نویسید به کاربر ارسال می‌شود.`;
  ctx.reply(helpMessage, { parse_mode: 'Markdown' });
});

// Express server for webhook
const app = express();
app.use(express.json());
const webhookPort = process.env.TELEGRAM_PORT || 3001;

// Backend webhook
app.post('/webhook', async (req, res) => {
  const { event, data } = req.body;
  try {
    switch (event) {
      case 'new_session':
        const success = await handleNewUserSession(data.sessionId, data.userInfo || {}, data.userMessage || 'درخواست اتصال');
        res.json({ success });
        break;

      case 'user_message':
        const shortId = generateShortId(data.sessionId);
        const session = sessions.get(shortId);
        if (session && session.operatorChatId) {
          await bot.telegram.sendMessage(session.operatorChatId,
            `📩 *پیام از کاربر*\n🎫 کد: \`${shortId}\`\n👤 کاربر: ${data.userName || 'کاربر سایت'}\n💬 پیام:\n${data.message}\n\n✏️ برای پاسخ، پیام خود را بنویسید...`,
            { parse_mode: 'Markdown' });
          res.json({ success: true });
        } else res.json({ success: false, error: 'No operator assigned' });
        break;

      case 'session_ended':
        const sid = generateShortId(data.sessionId);
        const endedSession = sessions.get(sid);
        if (endedSession && endedSession.operatorChatId) {
          await bot.telegram.sendMessage(endedSession.operatorChatId,
            `📭 *جلسه به پایان رسید*\n🎫 کد: \`${sid}\`\n✅ گفتگو با موفقیت پایان یافت.`, { parse_mode: 'Markdown' });
          sessions.delete(sid);
          userSessions.delete(endedSession.operatorChatId);
        }
        res.json({ success: true });
        break;

      default:
        res.json({ success: false, error: 'Unknown event' });
    }
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    bot: 'running',
    activeSessions: Array.from(sessions.values()).filter(s => s.status === 'accepted').length,
    pendingSessions: Array.from(sessions.values()).filter(s => s.status === 'pending').length,
    timestamp: new Date().toISOString()
  });
});

// Start bot
async function startBot() {
  try {
    console.log('🚀 Starting Telegram bot...');
    const domain = process.env.RAILWAY_STATIC_URL || process.env.TELEGRAM_BOT_URL;

    if (domain) {
      const webhookUrl = `${domain}/telegram-webhook`;
      console.log(`🌐 Setting webhook to: ${webhookUrl}`);
      await bot.telegram.setWebhook(webhookUrl);
      app.post('/telegram-webhook', (req, res) => bot.handleUpdate(req.body, res));
    } else {
      await bot.launch();
      console.log('✅ Bot started with polling');
    }

    app.listen(webhookPort, () => {
      console.log(`🤖 Telegram bot server running on port ${webhookPort}`);
      bot.telegram.sendMessage(ADMIN_TELEGRAM_ID,
        `🤖 *ربات فعال شد*\n⏰ ${new Date().toLocaleString('fa-IR')}\n✅ آماده دریافت درخواست‌ها`, { parse_mode: 'Markdown' }).catch(console.error);
    });

  } catch (error) {
    console.error('❌ Bot startup failed:', error.message);
    process.exit(1);
  }
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

startBot();
