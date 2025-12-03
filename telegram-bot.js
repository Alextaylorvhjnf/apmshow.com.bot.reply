const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const express = require('express');
require('dotenv').config();

console.log('='.repeat(60));
console.log('🤖 TELEGRAM BOT - FIXED VERSION');
console.log('='.repeat(60));

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

// Validate
if (!TELEGRAM_BOT_TOKEN || !ADMIN_TELEGRAM_ID) {
  console.error('❌ Missing Telegram configuration');
  process.exit(1);
}

console.log('✅ Bot configured');
console.log('✅ Admin:', ADMIN_TELEGRAM_ID);
console.log('✅ Backend:', BACKEND_URL);

// Store sessions
const sessions = new Map(); // sessionShortId -> {sessionId, chatId, userInfo}
const userSessions = new Map(); // chatId -> sessionShortId

// Create bot
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// Helper: Generate short session ID
function generateShortId(sessionId) {
  return sessionId.substring(0, 12); // Use first 12 chars
}

// Helper: Store session
function storeSession(sessionId, userInfo) {
  const shortId = generateShortId(sessionId);
  sessions.set(shortId, {
    fullId: sessionId,
    userInfo,
    status: 'pending',
    createdAt: new Date(),
    operatorChatId: null,
    operatorName: null
  });
  return shortId;
}

// Helper: Get full session ID
function getFullSessionId(shortId) {
  const session = sessions.get(shortId);
  return session ? session.fullId : null;
}

// Helper: Notify backend
async function notifyBackend(event, data) {
  try {
    console.log(`📤 Notifying backend: ${event}`, { 
      shortId: data.sessionId ? generateShortId(data.sessionId) : 'N/A' 
    });
    
    const response = await axios.post(`${BACKEND_URL}/telegram-webhook`, {
      event,
      data
    }, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ Backend notification sent: ${event}`, response.data);
    return response.data;
  } catch (error) {
    console.error(`❌ Backend notification failed (${event}):`, error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
    }
    return { success: false, error: error.message };
  }
}

// Start command
bot.start((ctx) => {
  const welcomeMessage = `👨‍💼 *پنل اپراتور پشتیبانی*\n\n`
    + `سلام ${ctx.from.first_name || 'اپراتور'}! 👋\n\n`
    + `✅ سیستم آماده دریافت پیام‌هاست\n\n`
    + `📋 *دستورات:*\n`
    + `/sessions - نمایش جلسات فعال\n`
    + `/help - راهنمایی\n`
    + `/test - تست ارتباط با سرور`;
  
  ctx.reply(welcomeMessage, { 
    parse_mode: 'Markdown',
    ...Markup.keyboard([
      ['📋 جلسات فعال', '🆘 راهنما'],
      ['🔗 تست سرور']
    ]).resize()
  });
});

// Test command - Check backend connection
bot.command('test', async (ctx) => {
  try {
    ctx.reply('🔍 در حال تست ارتباط با سرور...');
    
    // Test backend health
    const healthResponse = await axios.get(`${BACKEND_URL}/api/health`, { timeout: 5000 });
    const sessionsResponse = await axios.get(`${BACKEND_URL}/api/sessions`, { timeout: 5000 });
    
    const message = `✅ *تست موفقیت‌آمیز*\n\n`
      + `🔗 سرور: ${BACKEND_URL}\n`
      + `📊 وضعیت: ${healthResponse.data.status}\n`
      + `👥 جلسات فعال: ${sessionsResponse.data.count || 0}\n`
      + `⏰ زمان: ${new Date().toLocaleTimeString('fa-IR')}`;
    
    ctx.reply(message, { parse_mode: 'Markdown' });
    
  } catch (error) {
    console.error('Test error:', error.message);
    
    const errorMessage = `❌ *خطا در تست سرور*\n\n`
      + `🔗 سرور: ${BACKEND_URL}\n`
      + `📛 خطا: ${error.message}\n\n`
      + `⚠️ لطفاً اتصال سرور را بررسی کنید.`;
    
    ctx.reply(errorMessage, { parse_mode: 'Markdown' });
  }
});

// Sessions command
bot.command('sessions', async (ctx) => {
  try {
    const response = await axios.get(`${BACKEND_URL}/api/sessions`);
    const sessionsList = response.data.sessions || [];
    
    if (sessionsList.length === 0) {
      return ctx.reply('📭 *هیچ جلسه فعالی وجود ندارد*', {
        parse_mode: 'Markdown'
      });
    }
    
    let message = `📊 *جلسات فعال (${sessionsList.length}):*\n\n`;
    
    sessionsList.forEach((session, index) => {
      const shortId = generateShortId(session.id);
      const duration = Math.floor((new Date() - new Date(session.createdAt)) / (1000 * 60));
      const minutes = duration % 60;
      const hours = Math.floor(duration / 60);
      
      message += `*${index + 1}. جلسه:* \`${shortId}\`\n`;
      message += `   👤 *کاربر:* ${session.userInfo?.name || 'ناشناس'}\n`;
      message += `   ⏱️ *مدت:* ${hours > 0 ? hours + ' ساعت و ' : ''}${minutes} دقیقه\n`;
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

// Handle new session from user (via webhook)
async function handleNewUserSession(sessionId, userInfo, userMessage) {
  try {
    const shortId = storeSession(sessionId, userInfo);
    
    const operatorMessage = `🔔 *درخواست اتصال جدید*\n\n`
      + `🎫 *کد جلسه:* \`${shortId}\`\n`
      + `👤 *کاربر:* ${userInfo.name || 'کاربر سایت'}\n`
      + `🌐 *صفحه:* ${userInfo.page || 'نامشخص'}\n`
      + `📝 *پیام اولیه:*\n${userMessage.substring(0, 200)}${userMessage.length > 200 ? '...' : ''}\n\n`
      + `⏰ *زمان:* ${new Date().toLocaleTimeString('fa-IR')}\n\n`
      + `💬 برای شروع گفتگو کلیک کنید:`;
    
    // Send to admin with callback buttons
    await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, operatorMessage, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ پذیرش گفتگو', `accept_${shortId}`),
          Markup.button.callback('❌ رد درخواست', `reject_${shortId}`)
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
    const fullSessionId = getFullSessionId(shortId);
    
    if (!fullSessionId) {
      return ctx.answerCbQuery('❌ جلسه پیدا نشد');
    }
    
    // Update session status
    const session = sessions.get(shortId);
    if (session) {
      session.status = 'accepted';
      session.acceptedAt = new Date();
      session.operatorChatId = ctx.chat.id;
      session.operatorName = ctx.from.first_name || 'اپراتور';
      session.operatorTelegramId = ctx.from.id;
    }
    
    // Store operator chat ID
    userSessions.set(ctx.chat.id, shortId);
    
    // Acknowledge callback
    await ctx.answerCbQuery('✅ گفتگو قبول شد');
    
    // Edit message to show acceptance
    await ctx.editMessageText(
      ctx.callbackQuery.message.text + '\n\n✅ *شما این گفتگو را قبول کردید*\n\n'
      + `👤 *اپراتور:* ${ctx.from.first_name || 'اپراتور'}\n`
      + `⏰ *زمان پذیرش:* ${new Date().toLocaleTimeString('fa-IR')}\n\n`
      + `💬 اکنون می‌توانید پیام خود را بنویسید...`,
      { 
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([]) // Remove buttons
      }
    );
    
    // Notify backend that operator accepted
    const backendResponse = await notifyBackend('operator_accepted', { 
      sessionId: fullSessionId,
      operatorId: ctx.from.id.toString(),
      operatorName: ctx.from.first_name || 'اپراتور',
      operatorChatId: ctx.chat.id
    });
    
    if (backendResponse.success) {
      console.log(`✅ Session ${shortId} accepted and backend notified`);
    } else {
      console.error(`⚠️ Session accepted but backend notification failed: ${backendResponse.error}`);
      // Still continue, user is connected
    }
    
    // Send welcome message to operator
    const sessionInfo = sessions.get(shortId);
    const welcomeMsg = `🎉 *گفتگو آغاز شد*\n\n`
      + `🎫 *کد جلسه:* \`${shortId}\`\n`
      + `👤 *کاربر:* ${sessionInfo?.userInfo?.name || 'کاربر سایت'}\n`
      + `🌐 *از صفحه:* ${sessionInfo?.userInfo?.page || 'نامشخص'}\n\n`
      + `💬 *راهنما:*\n`
      + `• هر پیامی که می‌نویسید به کاربر ارسال می‌شود\n`
      + `• برای پایان گفتگو از /end استفاده کنید\n`
      + `• برای بازگشت به منوی اصلی از /start استفاده کنید`;
    
    await ctx.reply(welcomeMsg, { parse_mode: 'Markdown' });
    
  } catch (error) {
    console.error('Accept callback error:', error.message);
    await ctx.answerCbQuery('❌ خطا در پردازش');
  }
});

// Handle reject callback
bot.action(/reject_(.+)/, async (ctx) => {
  try {
    const shortId = ctx.match[1];
    const fullSessionId = getFullSessionId(shortId);
    
    if (!fullSessionId) {
      return ctx.answerCbQuery('❌ جلسه پیدا نشد');
    }
    
    // Remove session
    sessions.delete(shortId);
    userSessions.delete(ctx.chat.id);
    
    // Acknowledge callback
    await ctx.answerCbQuery('❌ گفتگو رد شد');
    
    // Edit message
    await ctx.editMessageText(
      ctx.callbackQuery.message.text + '\n\n❌ *شما این گفتگو را رد کردید*\n\n'
      + `⏰ زمان: ${new Date().toLocaleTimeString('fa-IR')}`,
      { 
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([])
      }
    );
    
    console.log(`❌ Session ${shortId} rejected by operator`);
    
  } catch (error) {
    console.error('Reject callback error:', error.message);
    ctx.answerCbQuery('❌ خطا در پردازش');
  }
});

// End conversation command
bot.command('end', async (ctx) => {
  const chatId = ctx.chat.id;
  const shortId = userSessions.get(chatId);
  
  if (!shortId) {
    return ctx.reply('📭 *شما جلسه فعالی ندارید*', { parse_mode: 'Markdown' });
  }
  
  const session = sessions.get(shortId);
  if (!session) {
    return ctx.reply('❌ *جلسه پیدا نشد*', { parse_mode: 'Markdown' });
  }
  
  // Notify backend
  await notifyBackend('session_ended', {
    sessionId: session.fullId,
    operatorId: ctx.from.id.toString(),
    endedAt: new Date().toISOString()
  });
  
  // Cleanup
  sessions.delete(shortId);
  userSessions.delete(chatId);
  
  ctx.reply(`✅ *گفتگو پایان یافت*\n\n`
    + `🎫 کد جلسه: \`${shortId}\`\n`
    + `👤 کاربر: ${session.userInfo?.name || 'کاربر سایت'}\n`
    + `⏰ زمان پایان: ${new Date().toLocaleTimeString('fa-IR')}\n\n`
    + `برای پذیرش گفتگوهای جدید منتظر اعلان‌ها باشید.`, {
    parse_mode: 'Markdown'
  });
});

// Handle operator messages
bot.on('text', async (ctx) => {
  // Skip commands
  if (ctx.message.text.startsWith('/')) return;
  
  const chatId = ctx.chat.id;
  const messageText = ctx.message.text.trim();
  const fromName = ctx.from.first_name || 'اپراتور';
  
  // Check if operator has an active session
  const shortId = userSessions.get(chatId);
  if (!shortId) {
    return ctx.reply('📭 *شما جلسه فعالی ندارید*\n\n'
      + 'منتظر درخواست کاربران باشید یا از /sessions برای مشاهده جلسات استفاده کنید.', {
        parse_mode: 'Markdown'
      });
  }
  
  const session = sessions.get(shortId);
  if (!session || session.status !== 'accepted') {
    userSessions.delete(chatId);
    return ctx.reply('❌ *این جلسه فعال نیست*\n\n'
      + 'لطفاً یک جلسه جدید را بپذیرید.', {
        parse_mode: 'Markdown'
      });
  }
  
  try {
    // Send message to user via backend
    const response = await axios.post(`${BACKEND_URL}/api/send-to-operator`, {
      sessionId: session.fullId,
      message: messageText,
      operatorId: ctx.from.id.toString(),
      operatorName: fromName
    });
    
    if (response.data.success) {
      // Confirm to operator
      ctx.reply(`✅ *پیام ارسال شد*\n\n`
        + `👤 به کاربر: ${session.userInfo?.name || 'کاربر سایت'}\n`
        + `💬 پیام شما:\n"${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}"`, {
          parse_mode: 'Markdown'
        });
      
      console.log(`📨 Operator ${fromName} sent message for session ${shortId}`);
    } else {
      ctx.reply('❌ خطا در ارسال پیام به کاربر');
    }
    
  } catch (error) {
    console.error('Send message error:', error.message);
    
    // Try alternative endpoint
    try {
      const altResponse = await axios.post(`${BACKEND_URL}/telegram-webhook`, {
        event: 'operator_message',
        data: {
          sessionId: session.fullId,
          message: messageText,
          operatorId: ctx.from.id.toString(),
          operatorName: fromName
        }
      });
      
      if (altResponse.data.success) {
        ctx.reply(`✅ *پیام ارسال شد (راه جایگزین)*`, { parse_mode: 'Markdown' });
      } else {
        ctx.reply('❌ خطا در ارتباط با سرور کاربر');
      }
    } catch (altError) {
      ctx.reply('❌ خطا در ارتباط با سرور. لطفاً دوباره تلاش کنید.');
    }
  }
});

// Help command
bot.command('help', (ctx) => {
  const helpMessage = `📖 *راهنمای اپراتور:*\n\n`
    + `🔔 *چگونه کار می‌کند:*\n`
    + `1. کاربر در سایت روی "اتصال به اپراتور" کلیک می‌کند\n`
    + `2. درخواست به این ربات ارسال می‌شود\n`
    + `3. شما اعلان را می‌بینید و روی "پذیرش گفتگو" کلیک می‌کنید\n`
    + `4. گفتگو آغاز می‌شود و پیام‌های شما به کاربر ارسال می‌شود\n\n`
    + `⚡ *دستورات:*\n`
    + `/start - شروع مجدد\n`
    + `/sessions - نمایش جلسات فعال\n`
    + `/test - تست ارتباط با سرور\n`
    + `/end - پایان دادن به گفتگو فعلی\n`
    + `/help - این راهنما\n\n`
    + `💡 *نکات:*\n`
    + `• هر پیامی که می‌نویسید به کاربر ارسال می‌شود\n`
    + `• برای پایان گفتگو از /end استفاده کنید\n`
    + `• می‌توانید چند گفتگو را همزمان مدیریت کنید`;
  
  ctx.reply(helpMessage, { parse_mode: 'Markdown' });
});

// Handle refresh sessions callback
bot.action('refresh_sessions', async (ctx) => {
  try {
    await ctx.answerCbQuery('در حال بروزرسانی...');
    
    const response = await axios.get(`${BACKEND_URL}/api/sessions`);
    const sessionsList = response.data.sessions || [];
    
    if (sessionsList.length === 0) {
      await ctx.editMessageText('📭 *هیچ جلسه فعالی وجود ندارد*', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 بروزرسانی', 'refresh_sessions')]
        ])
      });
      return;
    }
    
    let message = `📊 *جلسات فعال (${sessionsList.length}):*\n\n`;
    
    sessionsList.forEach((session, index) => {
      const shortId = generateShortId(session.id);
      const duration = Math.floor((new Date() - new Date(session.createdAt)) / (1000 * 60));
      
      message += `*${index + 1}. جلسه:* \`${shortId}\`\n`;
      message += `   👤 *کاربر:* ${session.userInfo?.name || 'ناشناس'}\n`;
      message += `   ⏱️ *مدت:* ${duration} دقیقه\n`;
      message += `   🔗 *وضعیت:* ${session.connectedToHuman ? 'متصل ✅' : 'در انتظار'}\n\n`;
    });
    
    await ctx.editMessageText(message, { 
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 بروزرسانی', 'refresh_sessions')]
      ])
    });
    
  } catch (error) {
    console.error('Refresh sessions error:', error.message);
    await ctx.answerCbQuery('خطا در بروزرسانی');
  }
});

// Handle callback query errors
bot.on('callback_query', async (ctx) => {
  // If no action matched, answer anyway
  try {
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('Callback query error:', error.message);
  }
});

// Express web server for webhooks
const app = express();
const webhookPort = process.env.TELEGRAM_PORT || 3001;

app.use(express.json());

// Log all requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  if (req.method === 'POST' && req.body && Object.keys(req.body).length > 0) {
    console.log('Body:', JSON.stringify(req.body).substring(0, 300));
  }
  next();
});

// Webhook from backend - CORRECT ENDPOINT
app.post('/telegram-webhook', async (req, res) => {
  try {
    const { event, data } = req.body;
    
    console.log(`📨 Received webhook: ${event}`, { 
      shortId: data.sessionId ? generateShortId(data.sessionId) : 'N/A' 
    });
    
    switch (event) {
      case 'new_session':
        const success = await handleNewUserSession(
          data.sessionId,
          data.userInfo || {},
          data.userMessage || 'درخواست اتصال به اپراتور'
        );
        res.json({ success, message: success ? 'Notification sent' : 'Failed to send notification' });
        break;
        
      case 'user_message':
        // Forward user message to operator
        const shortId = generateShortId(data.sessionId);
        const session = sessions.get(shortId);
        
        if (session && session.operatorChatId) {
          const message = `📩 *پیام از کاربر*\n\n`
            + `🎫 *کد جلسه:* \`${shortId}\`\n`
            + `👤 *کاربر:* ${data.userName || session.userInfo?.name || 'کاربر'}\n`
            + `💬 *پیام:*\n${data.message}\n\n`
            + `⏰ *زمان:* ${new Date().toLocaleTimeString('fa-IR')}\n\n`
            + `✏️ برای پاسخ، پیام خود را بنویسید...`;
          
          await bot.telegram.sendMessage(session.operatorChatId, message, {
            parse_mode: 'Markdown'
          });
          
          res.json({ success: true, delivered: true });
        } else {
          res.json({ 
            success: false, 
            error: 'No operator assigned to this session',
            sessionShortId: shortId 
          });
        }
        break;
        
      case 'session_ended':
        const shortIdEnded = generateShortId(data.sessionId);
        const endedSession = sessions.get(shortIdEnded);
        
        if (endedSession && endedSession.operatorChatId) {
          await bot.telegram.sendMessage(endedSession.operatorChatId,
            `📭 *جلسه به پایان رسید*\n\n`
            + `🎫 کد جلسه: \`${shortIdEnded}\`\n`
            + `👤 کاربر: ${endedSession.userInfo?.name || 'کاربر سایت'}\n`
            + `✅ گفتگو با موفقیت پایان یافت.\n\n`
            + `⏰ زمان پایان: ${new Date().toLocaleTimeString('fa-IR')}`, {
              parse_mode: 'Markdown'
            });
          
          // Cleanup
          sessions.delete(shortIdEnded);
          userSessions.delete(endedSession.operatorChatId);
        }
        res.json({ success: true });
        break;
        
      default:
        console.log(`⚠️ Unknown event: ${event}`);
        res.json({ 
          success: false, 
          error: `Unknown event: ${event}`,
          supportedEvents: ['new_session', 'user_message', 'session_ended']
        });
    }
    
  } catch (error) {
    console.error('❌ Webhook processing error:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'telegram-bot',
    activeSessions: Array.from(sessions.values()).filter(s => s.status === 'accepted').length,
    pendingSessions: Array.from(sessions.values()).filter(s => s.status === 'pending').length,
    totalOperators: new Set(Array.from(sessions.values())
      .map(s => s.operatorChatId)
      .filter(id => id)).size,
    backendUrl: BACKEND_URL,
    timestamp: new Date().toISOString()
  });
});

// Test endpoint
app.get('/test-backend', async (req, res) => {
  try {
    const healthResponse = await axios.get(`${BACKEND_URL}/api/health`);
    const sessionsResponse = await axios.get(`${BACKEND_URL}/api/sessions`);
    
    res.json({
      backend: BACKEND_URL,
      health: healthResponse.data,
      sessions: sessionsResponse.data,
      connection: 'OK'
    });
  } catch (error) {
    res.status(500).json({
      backend: BACKEND_URL,
      error: error.message,
      connection: 'FAILED'
    });
  }
});

// Start bot
async function startBot() {
  try {
    console.log('🚀 Starting Telegram bot...');
    
    // Use webhook for production (Railway)
    const domain = process.env.RAILWAY_STATIC_URL;
    if (domain) {
      const webhookUrl = `${domain}/telegram-webhook`;
      console.log(`🌐 Setting webhook to: ${webhookUrl}`);
      
      await bot.telegram.setWebhook(webhookUrl);
      
      // Setup webhook endpoint
      app.post('/telegram-webhook-bot', (req, res) => {
        bot.handleUpdate(req.body, res);
      });
    } else {
      // Use polling for local development
      await bot.launch();
      console.log('✅ Bot started with polling');
    }
    
    // Start web server
    app.listen(webhookPort, '0.0.0.0', () => {
      console.log(`🤖 Telegram bot server on port ${webhookPort}`);
      console.log('✅ Bot is ready!');
      console.log('📡 Webhook endpoint: POST /telegram-webhook');
      console.log('🏥 Health check: GET /health');
      console.log('🔗 Test backend: GET /test-backend');
      
      // Send startup message to admin
      setTimeout(() => {
        bot.telegram.sendMessage(ADMIN_TELEGRAM_ID,
          `🤖 *ربات پشتیبانی فعال شد*\n\n`
          + `⏰ ${new Date().toLocaleString('fa-IR')}\n`
          + `✅ سیستم آماده دریافت درخواست‌هاست\n\n`
          + `برای آزمایش:\n`
          + `1. از /test برای تست ارتباط با سرور\n`
          + `2. منتظر درخواست از کاربران در سایت\n`
          + `3. یا از /sessions برای مشاهده جلسات`, {
            parse_mode: 'Markdown'
          }).catch(err => console.error('Startup message error:', err.message));
      }, 2000);
    });
    
  } catch (error) {
    console.error('❌ Bot startup failed:', error.message);
    process.exit(1);
  }
}

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Error handling
bot.catch((err, ctx) => {
  console.error(`Bot error for ${ctx.updateType}:`, err.message);
  if (ctx.chat && ctx.chat.id === parseInt(ADMIN_TELEGRAM_ID)) {
    ctx.reply(`❌ خطای ربات: ${err.message}`).catch(console.error);
  }
});

// Start the bot
startBot();

module.exports = {
  handleNewUserSession,
  notifyBackend,
  sessions,
  userSessions
};
