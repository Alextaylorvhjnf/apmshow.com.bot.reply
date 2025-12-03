const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
require('dotenv').config();

console.log('='.repeat(60));
console.log('🤖 TELEGRAM BOT - COMPLETELY FIXED WEBHOOK VERSION');
console.log('='.repeat(60));

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const RAILWAY_STATIC_URL = process.env.RAILWAY_STATIC_URL;

// Validate
if (!TELEGRAM_BOT_TOKEN || !ADMIN_TELEGRAM_ID) {
  console.error('❌ Missing Telegram configuration');
  process.exit(1);
}

console.log('✅ Bot configured');
console.log('✅ Admin:', ADMIN_TELEGRAM_ID);
console.log('✅ Backend:', BACKEND_URL);
console.log('✅ Railway URL:', RAILWAY_STATIC_URL || 'Not set (using polling)');

// Store sessions
const sessions = new Map(); // sessionShortId -> {sessionId, chatId, userInfo}
const userSessions = new Map(); // chatId -> sessionShortId

// Create bot
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// Helper: Generate short session ID
function generateShortId(sessionId) {
  return sessionId.substring(0, 12);
}

// Helper: Store session
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

// Helper: Get full session ID
function getFullSessionId(shortId) {
  const session = sessions.get(shortId);
  return session ? session.fullId : null;
}

// Helper: Send event to backend
async function sendToBackend(event, data) {
  try {
    console.log(`📤 Sending ${event} to backend:`, data);
    
    const response = await axios.post(`${BACKEND_URL}/webhook`, {
      event,
      data
    });
    
    console.log(`✅ Event ${event} sent successfully`);
    return response.data;
  } catch (error) {
    console.error(`❌ Failed to send ${event} to backend:`, error.message);
    
    // Try alternative endpoint
    try {
      console.log('🔄 Trying alternative endpoint...');
      const response = await axios.post(`${BACKEND_URL}/api/telegram-event`, {
        event,
        data
      });
      return response.data;
    } catch (retryError) {
      console.error('❌ Both endpoints failed');
      return { success: false, error: retryError.message };
    }
  }
}

// Start command
bot.start((ctx) => {
  const welcomeMessage = `👨‍💼 *پنل اپراتور پشتیبانی*\n\n`
    + `سلام ${ctx.from.first_name || 'اپراتور'}! 👋\n\n`
    + `✅ سیستم آماده دریافت پیام‌هاست\n\n`
    + `📋 *دستورات:*\n`
    + `/sessions - جلسات فعال\n`
    + `/help - راهنما\n`
    + `/status - وضعیت سیستم`;
  
  ctx.reply(welcomeMessage, { 
    parse_mode: 'Markdown',
    ...Markup.keyboard([
      ['📋 جلسات فعال', '🆘 راهنما'],
      ['📊 وضعیت سیستم']
    ]).resize()
  });
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
      const shortId = session.shortId || generateShortId(session.id);
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

// Refresh sessions callback
bot.action('refresh_sessions', async (ctx) => {
  await ctx.answerCbQuery('🔄 در حال بروزرسانی...');
  await ctx.deleteMessage();
  setTimeout(async () => {
    await bot.telegram.sendChatAction(ctx.chat.id, 'typing');
    await bot.telegram.sendMessage(ctx.chat.id, 'لطفاً دوباره /sessions را بزنید.');
  }, 1000);
});

// Status command
bot.command('status', (ctx) => {
  const activeSessions = Array.from(sessions.values()).filter(s => s.status === 'accepted').length;
  const pendingSessions = Array.from(sessions.values()).filter(s => s.status === 'pending').length;
  
  const statusMessage = `📊 *وضعیت سیستم:*\n\n`
    + `🤖 *ربات:* فعال ✅\n`
    + `👨‍💼 *اپراتور:* ${ctx.from.first_name || 'شما'}\n`
    + `📞 *جلسات فعال:* ${activeSessions}\n`
    + `⏳ *در انتظار:* ${pendingSessions}\n`
    + `🔗 *Backend:* ${BACKEND_URL}\n`
    + `⏰ *زمان:* ${new Date().toLocaleString('fa-IR')}`;
  
  ctx.reply(statusMessage, { parse_mode: 'Markdown' });
});

// Handle new session from user
async function handleNewUserSession(sessionId, userInfo, userMessage) {
  try {
    const shortId = storeSession(sessionId, userInfo);
    
    const operatorMessage = `🔔 *درخواست اتصال جدید*\n\n`
      + `🎫 *کد:* \`${shortId}\`\n`
      + `👤 *کاربر:* ${userInfo.name || 'کاربر سایت'}\n`
      + `📧 *ایمیل:* ${userInfo.email || 'ندارد'}\n`
      + `🌐 *صفحه:* ${userInfo.page || 'نامشخص'}\n`
      + `📝 *پیام:* ${userMessage.substring(0, 100)}${userMessage.length > 100 ? '...' : ''}\n\n`
      + `💬 برای پذیرش گفتگو کلیک کنید:`;
    
    // Send to admin with working callback buttons
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
    }
    
    // Store operator chat ID
    userSessions.set(ctx.chat.id, shortId);
    
    // Acknowledge callback
    await ctx.answerCbQuery('✅ گفتگو قبول شد');
    
    // Edit message to show acceptance
    await ctx.editMessageText(
      ctx.callbackQuery.message.text + '\n\n✅ *شما این گفتگو را قبول کردید*\n\n💬 اکنون می‌توانید پیام بفرستید.',
      { 
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([])
      }
    );
    
    // Send confirmation to operator
    await ctx.reply(`✅ *شما با موفقیت به جلسه متصل شدید*\n\n`
      + `🎫 کد جلسه: \`${shortId}\`\n`
      + `👤 کاربر: ${session?.userInfo?.name || 'کاربر سایت'}\n`
      + `📝 اکنون می‌توانید پیام بفرستید.`, {
        parse_mode: 'Markdown'
      });
    
    // Notify backend
    const result = await sendToBackend('operator_accepted', {
      sessionId: fullSessionId,
      operatorId: ctx.chat.id,
      operatorName: ctx.from.first_name || 'اپراتور'
    });
    
    if (result && !result.success) {
      console.warn('⚠️ Backend notification may have failed');
    }
    
    console.log(`✅ Session ${shortId} accepted by operator ${ctx.chat.id}`);
    
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
    
    // Get session info before deleting
    const session = sessions.get(shortId);
    
    // Remove session
    sessions.delete(shortId);
    
    // Acknowledge callback
    await ctx.answerCbQuery('❌ گفتگو رد شد');
    
    // Edit message
    await ctx.editMessageText(
      ctx.callbackQuery.message.text + '\n\n❌ *شما این گفتگو را رد کردید*',
      { 
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([])
      }
    );
    
    // Send confirmation to operator
    await ctx.reply(`❌ *جلسه رد شد*\n\n`
      + `🎫 کد جلسه: \`${shortId}\`\n`
      + `👤 کاربر: ${session?.userInfo?.name || 'کاربر سایت'}\n`
      + `✅ جلسه با موفقیت رد شد.`, {
        parse_mode: 'Markdown'
      });
    
    // Notify backend
    const result = await sendToBackend('operator_rejected', {
      sessionId: fullSessionId,
      operatorId: ctx.chat.id,
      operatorName: ctx.from.first_name || 'اپراتور'
    });
    
    if (result && !result.success) {
      console.warn('⚠️ Backend notification may have failed');
    }
    
    console.log(`❌ Session ${shortId} rejected by operator`);
    
  } catch (error) {
    console.error('Reject callback error:', error.message);
    await ctx.answerCbQuery('❌ خطا در پردازش');
  }
});

// Handle operator messages
bot.on('text', async (ctx) => {
  // Skip commands
  if (ctx.message.text.startsWith('/')) return;
  
  const chatId = ctx.chat.id;
  const messageText = ctx.message.text;
  
  // Check if operator has an active session
  const shortId = userSessions.get(chatId);
  if (!shortId) {
    return ctx.reply('📭 *شما جلسه فعالی ندارید*\n\n'
      + 'منتظر درخواست کاربران باشید یا از /sessions استفاده کنید.', {
        parse_mode: 'Markdown'
      });
  }
  
  const session = sessions.get(shortId);
  if (!session || session.status !== 'accepted') {
    return ctx.reply('❌ *این جلسه فعال نیست*\n\n'
      + 'لطفاً یک جلسه جدید را از لیست جلسات بپذیرید.', {
        parse_mode: 'Markdown'
      });
  }
  
  try {
    // Send message to backend
    const result = await sendToBackend('operator_message', {
      sessionId: session.fullId,
      message: messageText,
      operatorId: chatId,
      operatorName: ctx.from.first_name || 'اپراتور'
    });
    
    if (result && result.success) {
      // Confirm to operator
      await ctx.reply(`✅ *پیام ارسال شد*\n\n`
        + `📝 پیام شما: ${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}`, {
          parse_mode: 'Markdown'
        });
      
      console.log(`📨 Operator ${chatId} sent message for session ${shortId}`);
    } else {
      await ctx.reply('❌ خطا در ارسال پیام');
    }
    
  } catch (error) {
    console.error('Send message error:', error.message);
    await ctx.reply('❌ خطا در ارتباط با سرور اصلی');
  }
});

// Help command
bot.command('help', (ctx) => {
  const helpMessage = `📖 *راهنمای اپراتور:*\n\n`
    + `1. درخواست‌های کاربران به صورت خودکار ارسال می‌شود\n`
    + `2. برای پذیرش گفتگو روی "✅ بله، می‌پذیرم" کلیک کنید\n`
    + `3. سپس می‌توانید مستقیماً پیام بفرستید\n`
    + `4. پیام‌های شما به کاربر ارسال می‌شود\n\n`
    + `⚡ *دستورات:*\n`
    + `/start - شروع\n`
    + `/sessions - جلسات فعال\n`
    + `/status - وضعیت سیستم\n`
    + `/help - این راهنما\n\n`
    + `🔔 هر پیامی که می‌نویسید به کاربر ارسال می‌شود.`;
  
  ctx.reply(helpMessage, { parse_mode: 'Markdown' });
});

// Handle callback query errors
bot.on('callback_query', async (ctx) => {
  // If no action matched, answer anyway
  await ctx.answerCbQuery();
});

// Webhook endpoint for backend
const express = require('express');
const app = express();
const webhookPort = process.env.TELEGRAM_PORT || 3001;

app.use(express.json());

// خط ۱: این endpoint برای webhook تلگرام (از خود تلگرام می‌آید)
app.post('/telegram-webhook', (req, res) => {
  console.log('📨 Telegram webhook received');
  
  try {
    // Handle update from Telegram
    bot.handleUpdate(req.body, res);
  } catch (error) {
    console.error('❌ Error handling Telegram webhook:', error);
    // Always return 200 to Telegram even if there's an error
    res.status(200).end();
  }
});

// خط ۲: این endpoint برای webhook از سرور اصلی (backend) ماست
app.post('/webhook', async (req, res) => {
  try {
    const { event, data } = req.body;
    
    console.log(`📨 Webhook from backend: ${event}`, { 
      sessionId: data.sessionId ? generateShortId(data.sessionId) : 'N/A',
      event 
    });
    
    switch (event) {
      case 'new_session':
        const success = await handleNewUserSession(
          data.sessionId,
          data.userInfo || {},
          data.userMessage || 'درخواست اتصال'
        );
        res.json({ success });
        break;
        
      case 'user_message':
        // Find which operator has this session
        const shortId = generateShortId(data.sessionId);
        const session = sessions.get(shortId);
        
        if (session && session.operatorChatId) {
          const message = `📩 *پیام از کاربر*\n\n`
            + `🎫 *کد:* \`${shortId}\`\n`
            + `👤 *کاربر:* ${data.userName || 'کاربر سایت'}\n`
            + `💬 *پیام:*\n${data.message}\n\n`
            + `✏️ برای پاسخ، پیام خود را بنویسید...`;
          
          await bot.telegram.sendMessage(session.operatorChatId, message, {
            parse_mode: 'Markdown'
          });
          
          res.json({ success: true });
        } else {
          res.json({ success: false, error: 'No operator assigned' });
        }
        break;
        
      case 'session_ended':
        const shortIdEnded = generateShortId(data.sessionId);
        const endedSession = sessions.get(shortIdEnded);
        
        if (endedSession && endedSession.operatorChatId) {
          await bot.telegram.sendMessage(endedSession.operatorChatId,
            `📭 *جلسه به پایان رسید*\n\n`
            + `🎫 کد: \`${shortIdEnded}\`\n`
            + `✅ گفتگو با موفقیت پایان یافت.`, {
              parse_mode: 'Markdown'
            });
          
          // Cleanup
          sessions.delete(shortIdEnded);
          userSessions.delete(endedSession.operatorChatId);
        }
        res.json({ success: true });
        break;
        
      default:
        console.log(`⚠️ Unknown event from backend: ${event}`);
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
    timestamp: new Date().toISOString(),
    webhookUrl: RAILWAY_STATIC_URL ? `${RAILWAY_STATIC_URL}/telegram-webhook` : 'Not set'
  });
});

// Test endpoint
app.get('/test-webhook', (req, res) => {
  res.send(`
    <html>
      <body>
        <h1>Telegram Bot Webhook Test</h1>
        <p>Status: ✅ Active</p>
        <p>Webhook URL: ${RAILWAY_STATIC_URL ? `${RAILWAY_STATIC_URL}/telegram-webhook` : 'Not configured'}</p>
        <p>Backend URL: ${BACKEND_URL}</p>
      </body>
    </html>
  `);
});

// Start bot
async function startBot() {
  try {
    console.log('🚀 Starting Telegram bot...');
    
    // Use webhook for Railway
    if (RAILWAY_STATIC_URL) {
      const webhookUrl = `${RAILWAY_STATIC_URL}/telegram-webhook`;
      console.log(`🌐 Setting webhook to: ${webhookUrl}`);
      
      // Delete old webhook first
      try {
        await bot.telegram.deleteWebhook();
        console.log('✅ Old webhook deleted');
      } catch (error) {
        console.log('ℹ️ No old webhook to delete');
      }
      
      // Set new webhook
      await bot.telegram.setWebhook(webhookUrl, {
        allowed_updates: ['message', 'callback_query', 'chat_member']
      });
      
      console.log('✅ Webhook set successfully');
      
    } else {
      // Use polling locally
      await bot.launch();
      console.log('✅ Bot started with polling');
    }
    
    // Start web server
    app.listen(webhookPort, '0.0.0.0', () => {
      console.log(`🤖 Telegram bot server running on port ${webhookPort}`);
      console.log('✅ Bot is ready and listening!');
      
      console.log('\n📋 Available endpoints:');
      console.log(`  POST /telegram-webhook - Telegram webhook`);
      console.log(`  POST /webhook - Backend webhook`);
      console.log(`  GET /health - Health check`);
      console.log(`  GET /test-webhook - Test page`);
      
      // Send startup message
      setTimeout(async () => {
        try {
          await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID,
            `🤖 *ربات فعال شد*\n\n`
            + `⏰ ${new Date().toLocaleString('fa-IR')}\n`
            + `✅ آماده دریافت درخواست‌ها\n\n`
            + `🔗 Webhook: ${RAILWAY_STATIC_URL ? '✅ فعال' : '❌ غیرفعال'}\n`
            + `🌐 Backend: ${BACKEND_URL}\n\n`
            + `برای آزمایش، روی یک جلسه در ویجت کلیک کنید.`, {
              parse_mode: 'Markdown'
            });
        } catch (error) {
          console.error('Failed to send startup message:', error.message);
        }
      }, 2000);
    });
    
  } catch (error) {
    console.error('❌ Bot startup failed:', error.message);
    process.exit(1);
  }
}

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('🛑 Shutting down bot...');
  bot.stop('SIGINT');
  process.exit(0);
});

process.once('SIGTERM', () => {
  console.log('🛑 Terminating bot...');
  bot.stop('SIGTERM');
  process.exit(0);
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('🔥 Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start
startBot();
