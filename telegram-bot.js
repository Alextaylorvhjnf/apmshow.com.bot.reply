const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const express = require('express');
require('dotenv').config();

console.log('='.repeat(60));
console.log('🤖 TELEGRAM BOT - ERROR-FREE VERSION');
console.log('='.repeat(60));

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;
const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:3000'; // 🔴 تغییر به 127.0.0.1

if (!TELEGRAM_BOT_TOKEN || !ADMIN_TELEGRAM_ID) {
  console.error('❌ Missing Telegram configuration');
  console.log('TELEGRAM_BOT_TOKEN:', TELEGRAM_BOT_TOKEN ? '✅ Set' : '❌ Missing');
  console.log('ADMIN_TELEGRAM_ID:', ADMIN_TELEGRAM_ID ? '✅ Set' : '❌ Missing');
  process.exit(1);
}

console.log('✅ Bot configured');
console.log('✅ Admin:', ADMIN_TELEGRAM_ID);
console.log('✅ Backend:', BACKEND_URL);

// Store sessions
const sessions = new Map(); // shortId -> session data
const userSessions = new Map(); // chatId -> shortId

// Helper: Extract short ID
function getShortId(fullSessionId) {
  if (!fullSessionId) return 'unknown';
  if (!fullSessionId.startsWith('session_')) return fullSessionId;
  
  const parts = fullSessionId.split('_');
  return parts.length >= 3 ? parts[2] : fullSessionId.substring(fullSessionId.length - 8);
}

// Helper: Store session
function storeSession(fullSessionId, userInfo) {
  const shortId = getShortId(fullSessionId);
  
  sessions.set(shortId, {
    fullId: fullSessionId,
    shortId: shortId,
    userInfo: userInfo || {},
    status: 'pending',
    createdAt: new Date(),
    operatorChatId: null,
    operatorName: null
  });
  
  console.log(`✅ Session stored: ${shortId}`);
  return shortId;
}

// Helper: Get session
function getSession(sessionId) {
  const shortId = getShortId(sessionId);
  return sessions.get(shortId);
}

// Helper: Notify backend - ERROR-FREE
async function notifyBackend(event, data) {
  try {
    console.log(`📤 Notifying backend: ${event}`);
    
    // استفاده از IPv4 فقط
    const axiosInstance = axios.create({
      family: 4, // 🔴 فقط IPv4
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' }
    });
    
    const response = await axiosInstance.post(`${BACKEND_URL}/telegram-webhook`, {
      event,
      data
    });
    
    console.log(`✅ Backend notified successfully`);
    return { success: true, data: response.data };
    
  } catch (error) {
    console.error(`❌ Backend notification failed: ${error.message}`);
    
    // تلاش مجدد با تنظیمات مختلف
    try {
      console.log(`🔄 Retrying with different config...`);
      
      const response = await axios.post(`${BACKEND_URL}/telegram-webhook`, {
        event,
        data
      }, {
        timeout: 8000,
        headers: { 'Content-Type': 'application/json' },
        // غیرفعال کردن IPv6
        httpAgent: new (require('http').Agent)({ family: 4 }),
        httpsAgent: new (require('https').Agent)({ family: 4 })
      });
      
      console.log(`✅ Retry successful`);
      return { success: true, data: response.data };
    } catch (retryError) {
      console.error(`❌ Retry also failed: ${retryError.message}`);
      return { success: false, error: retryError.message };
    }
  }
}

// Create bot
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// Start command
bot.start((ctx) => {
  const welcomeMessage = `👨‍💼 *پنل اپراتور پشتیبانی*\n\n`
    + `سلام ${ctx.from.first_name || 'اپراتور'}! 👋\n\n`
    + `✅ سیستم آماده دریافت پیام‌هاست\n\n`
    + `📋 *دستورات:*\n`
    + `/sessions - نمایش جلسات فعال\n`
    + `/test - تست سیستم\n`
    + `/help - راهنمایی`;
  
  ctx.reply(welcomeMessage, { 
    parse_mode: 'Markdown',
    ...Markup.keyboard([
      ['📋 جلسات فعال', '🔧 تست سیستم'],
      ['🆘 راهنما']
    ]).resize()
  });
});

// Test command
bot.command('test', async (ctx) => {
  try {
    await ctx.reply('🔍 در حال تست سیستم...');
    
    // تست ارتباط با سرور اصلی
    const healthResponse = await axios.get(`${BACKEND_URL}/api/health`, {
      timeout: 5000,
      family: 4 // فقط IPv4
    });
    
    const message = `✅ *تست موفقیت‌آمیز*\n\n`
      + `🔗 سرور: ${BACKEND_URL}\n`
      + `📊 وضعیت: ${healthResponse.data.status}\n`
      + `👥 سشن‌ها: ${healthResponse.data.sessions || 0}\n`
      + `⏰ زمان: ${new Date().toLocaleTimeString('fa-IR')}`;
    
    await ctx.reply(message, { parse_mode: 'Markdown' });
    
  } catch (error) {
    console.error('Test error:', error.message);
    
    const errorMessage = `❌ *خطا در تست سرور*\n\n`
      + `🔗 سرور: ${BACKEND_URL}\n`
      + `📛 خطا: ${error.message}\n\n`
      + `⚠️ سرور اصلی ممکن است اجرا نشده باشد.`;
    
    await ctx.reply(errorMessage, { parse_mode: 'Markdown' });
  }
});

// Sessions command
bot.command('sessions', async (ctx) => {
  try {
    const response = await axios.get(`${BACKEND_URL}/api/sessions`, { 
      timeout: 5000,
      family: 4 
    });
    const sessionsList = response.data.sessions || [];
    
    if (sessionsList.length === 0) {
      return ctx.reply('📭 *هیچ جلسه فعالی وجود ندارد*', {
        parse_mode: 'Markdown'
      });
    }
    
    let message = `📊 *جلسات فعال (${sessionsList.length}):*\n\n`;
    
    sessionsList.forEach((session, index) => {
      const shortId = session.shortId || getShortId(session.id);
      const duration = Math.floor((new Date() - new Date(session.createdAt)) / (1000 * 60));
      
      message += `*${index + 1}. جلسه:* \`${shortId}\`\n`;
      message += `   👤 *کاربر:* ${session.userInfo?.name || 'ناشناس'}\n`;
      message += `   ⏱️ *مدت:* ${duration} دقیقه\n`;
      message += `   🔗 *وضعیت:* ${session.connectedToHuman ? 'متصل ✅' : 'در انتظار'}\n\n`;
    });
    
    ctx.reply(message, { 
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 بروزرسانی', 'refresh_sessions')]
      ])
    });
    
  } catch (error) {
    console.error('Sessions error:', error.message);
    ctx.reply('❌ خطا در دریافت جلسات');
  }
});

// Handle new session
async function handleNewUserSession(sessionId, userInfo, userMessage) {
  try {
    const shortId = storeSession(sessionId, userInfo);
    
    const operatorMessage = `🔔 *درخواست اتصال جدید*\n\n`
      + `🎫 *کد جلسه:* \`${shortId}\`\n`
      + `👤 *کاربر:* ${userInfo.name || 'کاربر سایت'}\n`
      + `📝 *پیام:* ${userMessage.substring(0, 100)}${userMessage.length > 100 ? '...' : ''}\n\n`
      + `⏰ *زمان:* ${new Date().toLocaleTimeString('fa-IR')}`;
    
    await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, operatorMessage, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ پذیرش گفتگو', `accept_${shortId}`),
          Markup.button.callback('❌ رد', `reject_${shortId}`)
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

// Handle accept callback
bot.action(/accept_(.+)/, async (ctx) => {
  try {
    const shortId = ctx.match[1];
    const session = getSession(shortId);
    
    if (!session) {
      return ctx.answerCbQuery('❌ جلسه پیدا نشد');
    }
    
    console.log(`🎯 Accepting session: ${shortId}`);
    
    // Update session
    session.status = 'accepted';
    session.operatorChatId = ctx.chat.id;
    session.operatorName = ctx.from.first_name || 'اپراتور';
    userSessions.set(ctx.chat.id, shortId);
    
    await ctx.answerCbQuery('✅ گفتگو قبول شد');
    
    // Edit message
    await ctx.editMessageText(
      ctx.callbackQuery.message.text + '\n\n✅ *شما این گفتگو را قبول کردید*',
      { parse_mode: 'Markdown' }
    );
    
    // Notify backend
    await notifyBackend('operator_accepted', {
      sessionId: session.fullId,
      operatorId: ctx.from.id.toString(),
      operatorName: ctx.from.first_name || 'اپراتور'
    });
    
    // Welcome message
    const welcomeMsg = `🎉 *گفتگو آغاز شد*\n\n`
      + `🎫 *کد:* \`${shortId}\`\n`
      + `👤 *کاربر:* ${session.userInfo?.name || 'کاربر'}\n`
      + `💬 هر پیامی بنویسید به کاربر ارسال می‌شود\n`
      + `🔚 برای پایان /end`;
    
    await ctx.reply(welcomeMsg, { parse_mode: 'Markdown' });
    
  } catch (error) {
    console.error('Accept error:', error);
    await ctx.answerCbQuery('❌ خطا در پردازش');
  }
});

// Handle reject callback
bot.action(/reject_(.+)/, async (ctx) => {
  try {
    const shortId = ctx.match[1];
    
    sessions.delete(shortId);
    userSessions.delete(ctx.chat.id);
    
    await ctx.answerCbQuery('❌ گفتگو رد شد');
    
    await ctx.editMessageText(
      ctx.callbackQuery.message.text + '\n\n❌ *رد شد*',
      { parse_mode: 'Markdown' }
    );
    
    console.log(`❌ Session rejected: ${shortId}`);
    
  } catch (error) {
    console.error('Reject error:', error);
    await ctx.answerCbQuery('❌ خطا');
  }
});

// End conversation
bot.command('end', async (ctx) => {
  const chatId = ctx.chat.id;
  const shortId = userSessions.get(chatId);
  
  if (!shortId) {
    return ctx.reply('📭 *شما جلسه فعالی ندارید*', { parse_mode: 'Markdown' });
  }
  
  const session = getSession(shortId);
  if (!session) {
    return ctx.reply('❌ *جلسه پیدا نشد*', { parse_mode: 'Markdown' });
  }
  
  // Notify backend
  await notifyBackend('session_ended', {
    sessionId: session.fullId,
    operatorId: ctx.from.id.toString()
  });
  
  // Cleanup
  sessions.delete(shortId);
  userSessions.delete(chatId);
  
  await ctx.reply(`✅ *گفتگو پایان یافت*\n\nکد: \`${shortId}\``, {
    parse_mode: 'Markdown'
  });
});

// Handle operator messages
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  
  const chatId = ctx.chat.id;
  const messageText = ctx.message.text;
  const shortId = userSessions.get(chatId);
  
  if (!shortId) {
    return ctx.reply('📭 *شما جلسه فعالی ندارید*', { parse_mode: 'Markdown' });
  }
  
  const session = getSession(shortId);
  if (!session || session.status !== 'accepted') {
    userSessions.delete(chatId);
    return ctx.reply('❌ *این جلسه فعال نیست*', { parse_mode: 'Markdown' });
  }
  
  try {
    // Send to backend
    await notifyBackend('operator_message', {
      sessionId: session.fullId,
      message: messageText,
      operatorId: ctx.from.id.toString(),
      operatorName: ctx.from.first_name || 'اپراتور'
    });
    
    await ctx.reply(`✅ *پیام ارسال شد*\n\nبه کاربر: ${session.userInfo?.name || 'کاربر'}`);
    
  } catch (error) {
    console.error('Send message error:', error);
    await ctx.reply('❌ خطا در ارسال پیام');
  }
});

// Help command
bot.command('help', (ctx) => {
  const helpMessage = `📖 *راهنمای اپراتور:*\n\n`
    + `🔔 *چگونه کار می‌کند:*\n`
    + `1. کاربر درخواست اتصال می‌دهد\n`
    + `2. شما اعلان را دریافت می‌کنید\n`
    + `3. روی "پذیرش گفتگو" کلیک می‌کنید\n`
    + `4. پیام‌هایتان به کاربر ارسال می‌شود\n\n`
    + `⚡ *دستورات:*\n`
    + `/start - شروع\n`
    + `/sessions - جلسات فعال\n`
    + `/test - تست سیستم\n`
    + `/end - پایان گفتگو\n`
    + `/help - راهنما`;
  
  ctx.reply(helpMessage, { parse_mode: 'Markdown' });
});

// Refresh sessions callback
bot.action('refresh_sessions', async (ctx) => {
  try {
    await ctx.answerCbQuery('در حال بروزرسانی...');
    
    // حذف پیام قبلی و ارسال مجدد
    await ctx.deleteMessage();
    const fakeCtx = {
      ...ctx,
      reply: (text, options) => ctx.telegram.sendMessage(ctx.chat.id, text, options)
    };
    
    await bot.command('sessions').middleware()(fakeCtx);
    
  } catch (error) {
    console.error('Refresh error:', error);
    await ctx.answerCbQuery('خطا در بروزرسانی');
  }
});

// Express server
const app = express();
const webhookPort = process.env.TELEGRAM_PORT || 3001;

app.use(express.json());

// Log requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Webhook endpoint
app.post('/telegram-webhook', async (req, res) => {
  try {
    const { event, data } = req.body;
    
    console.log(`📨 Webhook: ${event}`);
    
    switch (event) {
      case 'new_session':
        const success = await handleNewUserSession(
          data.sessionId,
          data.userInfo,
          data.userMessage
        );
        res.json({ success });
        break;
        
      case 'user_message':
        const shortId = getShortId(data.sessionId);
        const session = getSession(shortId);
        
        if (session && session.operatorChatId) {
          await bot.telegram.sendMessage(
            session.operatorChatId,
            `📩 *پیام از کاربر*\n\n${data.message}`,
            { parse_mode: 'Markdown' }
          );
          res.json({ success: true });
        } else {
          res.json({ success: false, error: 'اپراتور ندارد' });
        }
        break;
        
      default:
        res.json({ success: false, error: 'Event ناشناخته' });
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
    service: 'telegram-bot',
    sessions: sessions.size,
    backendUrl: BACKEND_URL
  });
});

// Start bot
async function startBot() {
  try {
    console.log('🚀 Starting Telegram bot...');
    
    // Use polling for local development
    await bot.launch();
    console.log('✅ Bot started with polling');
    
    // Start web server
    app.listen(webhookPort, '0.0.0.0', () => {
      console.log(`🤖 Telegram server on port ${webhookPort}`);
      console.log('📡 Webhook: POST /telegram-webhook');
      console.log('🏥 Health: GET /health');
      
      // Send startup message
      setTimeout(() => {
        bot.telegram.sendMessage(ADMIN_TELEGRAM_ID,
          `🤖 *ربات فعال شد*\n\n`
          + `⏰ ${new Date().toLocaleString('fa-IR')}\n`
          + `✅ آماده دریافت درخواست‌ها\n`
          + `🔗 سرور: ${BACKEND_URL}`, {
            parse_mode: 'Markdown'
          }).catch(err => console.error('Startup message error:', err.message));
      }, 1000);
    });
    
  } catch (error) {
    console.error('❌ Bot startup failed:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Error handling
bot.catch((err, ctx) => {
  console.error(`Bot error:`, err.message);
});

// Start
startBot();
