const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
require('dotenv').config();

console.log('='.repeat(60));
console.log('🤖 TELEGRAM BOT FOR RAILWAY');
console.log('='.repeat(60));

// متغیرهای محیطی - در Railway تنظیم کنید
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;
const BACKEND_URL = process.env.BACKEND_URL || 'https://ai-chat-support-production.up.railway.app';
const PORT = process.env.PORT || 3001;

// اعتبارسنجی
if (!TELEGRAM_BOT_TOKEN || !ADMIN_TELEGRAM_ID) {
  console.error('❌ خطا: TELEGRAM_BOT_TOKEN یا ADMIN_TELEGRAM_ID تنظیم نشده');
  console.error('❌ لطفاً در Railway Variables این متغیرها را تنظیم کنید');
  process.exit(1);
}

console.log('✅ Bot configured');
console.log('✅ Admin:', ADMIN_TELEGRAM_ID);
console.log('✅ Backend:', BACKEND_URL);
console.log('✅ Port:', PORT);

// ذخیره سشن‌ها
const sessions = new Map(); // sessionShortId -> {sessionId, chatId, userInfo}
const userSessions = new Map(); // chatId -> sessionShortId

// ایجاد ربات
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// Helper: تولید شناسه کوتاه
function generateShortId(sessionId) {
  return sessionId ? sessionId.substring(0, 12) : 'unknown';
}

// Helper: ذخیره سشن
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

// Helper: دریافت شناسه کامل
function getFullSessionId(shortId) {
  const session = sessions.get(shortId);
  return session ? session.fullId : null;
}

// Helper: ارسال به بک‌اند
async function sendToBackend(event, data) {
  try {
    console.log(`📤 Sending ${event} to backend...`);
    const response = await axios.post(`${BACKEND_URL}/webhook`, {
      event,
      data
    });
    console.log(`✅ ${event} sent successfully`);
    return response.data;
  } catch (error) {
    console.error(`❌ Failed to send ${event}:`, error.message);
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
    console.log('📊 Fetching active sessions...');
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
    ctx.reply('❌ خطا در دریافت جلسات از سرور اصلی');
  }
});

// Refresh sessions callback
bot.action('refresh_sessions', async (ctx) => {
  await ctx.answerCbQuery('🔄 در حال بروزرسانی...');
  await ctx.deleteMessage();
  await bot.telegram.sendChatAction(ctx.chat.id, 'typing');
  
  setTimeout(async () => {
    try {
      await ctx.reply('لطفاً دوباره /sessions را ارسال کنید.');
    } catch (error) {
      console.error('Refresh error:', error);
    }
  }, 1000);
});

// Status command
bot.command('status', (ctx) => {
  const activeSessions = Array.from(sessions.values()).filter(s => s.status === 'accepted').length;
  const pendingSessions = Array.from(sessions.values()).filter(s => s.status === 'pending').length;
  
  const statusMessage = `📊 *وضعیت ربات:*\n\n`
    + `🤖 *ربات:* فعال ✅\n`
    + `👨‍💼 *اپراتور:* ${ctx.from.first_name || 'شما'}\n`
    + `📞 *جلسات فعال:* ${activeSessions}\n`
    + `⏳ *در انتظار:* ${pendingSessions}\n`
    + `🔗 *Backend:* ${BACKEND_URL}\n`
    + `🏢 *میزبان:* Railway\n`
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
    
    // ارسال به ادمین با دکمه‌های callback
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
    
    // بروزرسانی وضعیت سشن
    const session = sessions.get(shortId);
    if (session) {
      session.status = 'accepted';
      session.acceptedAt = new Date();
      session.operatorChatId = ctx.chat.id;
      session.operatorName = ctx.from.first_name || 'اپراتور';
    }
    
    // ذخیره شناسه چت اپراتور
    userSessions.set(ctx.chat.id, shortId);
    
    // تأیید callback
    await ctx.answerCbQuery('✅ گفتگو قبول شد');
    
    // ویرایش پیام برای نشان دادن پذیرش
    await ctx.editMessageText(
      ctx.callbackQuery.message.text + '\n\n✅ *شما این گفتگو را قبول کردید*\n\n💬 اکنون می‌توانید پیام بفرستید.',
      { 
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([])
      }
    );
    
    // ارسال تأیید به اپراتور
    await ctx.reply(`✅ *شما با موفقیت به جلسه متصل شدید*\n\n`
      + `🎫 کد جلسه: \`${shortId}\`\n`
      + `👤 کاربر: ${session?.userInfo?.name || 'کاربر سایت'}\n`
      + `📝 اکنون می‌توانید پیام بفرستید.`, {
        parse_mode: 'Markdown'
      });
    
    // اطلاع به بک‌اند
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
    
    // دریافت اطلاعات سشن قبل از حذف
    const session = sessions.get(shortId);
    
    // حذف سشن
    sessions.delete(shortId);
    
    // تأیید callback
    await ctx.answerCbQuery('❌ گفتگو رد شد');
    
    // ویرایش پیام
    await ctx.editMessageText(
      ctx.callbackQuery.message.text + '\n\n❌ *شما این گفتگو را رد کردید*',
      { 
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([])
      }
    );
    
    // ارسال تأیید به اپراتور
    await ctx.reply(`❌ *جلسه رد شد*\n\n`
      + `🎫 کد جلسه: \`${shortId}\`\n`
      + `👤 کاربر: ${session?.userInfo?.name || 'کاربر سایت'}\n`
      + `✅ جلسه با موفقیت رد شد.`, {
        parse_mode: 'Markdown'
      });
    
    // اطلاع به بک‌اند
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
  // رد کردن دستورات
  if (ctx.message.text.startsWith('/')) return;
  
  const chatId = ctx.chat.id;
  const messageText = ctx.message.text;
  
  // بررسی اینکه اپراتور سشن فعال دارد
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
    // ارسال پیام به بک‌اند
    const result = await sendToBackend('operator_message', {
      sessionId: session.fullId,
      message: messageText,
      operatorId: chatId,
      operatorName: ctx.from.first_name || 'اپراتور'
    });
    
    if (result && result.success) {
      // تأیید به اپراتور
      await ctx.reply(`✅ *پیام ارسال شد*\n\n`
        + `📝 پیام شما: ${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}`, {
          parse_mode: 'Markdown'
        });
      
      console.log(`📨 Operator ${chatId} sent message for session ${shortId}`);
    } else {
      await ctx.reply('❌ خطا در ارسال پیام به کاربر');
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
  // اگر هیچ action مطابق نبود، پاسخ بده
  await ctx.answerCbQuery();
});

// ایجاد سرور Express برای webhook
const express = require('express');
const app = express();
const webhookPort = PORT;

app.use(express.json());

// این endpoint برای دریافت webhook از تلگرام است
app.post('/telegram-webhook', (req, res) => {
  console.log('📨 Telegram webhook received');
  
  try {
    // پردازش update از تلگرام
    bot.handleUpdate(req.body, res);
  } catch (error) {
    console.error('❌ Error handling Telegram webhook:', error);
    // همیشه 200 به تلگرام برگردان حتی اگر خطا باشد
    res.status(200).end();
  }
});

// Webhook از بک‌اند اصلی
app.post('/webhook', async (req, res) => {
  try {
    const { event, data } = req.body;
    
    console.log(`📨 Webhook from backend: ${event}`, { 
      sessionId: data.sessionId ? generateShortId(data.sessionId) : 'N/A'
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
        // پیدا کردن اینکه کدام اپراتور این سشن را دارد
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
          res.json({ success: false, error: 'اپراتور اختصاص داده نشده' });
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
          
          // پاکسازی
          sessions.delete(shortIdEnded);
          userSessions.delete(endedSession.operatorChatId);
        }
        res.json({ success: true });
        break;
        
      default:
        console.log(`⚠️ رویداد ناشناخته از بک‌اند: ${event}`);
        res.json({ success: false, error: 'رویداد ناشناخته' });
    }
    
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check برای Railway
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'telegram-bot',
    activeSessions: Array.from(sessions.values()).filter(s => s.status === 'accepted').length,
    pendingSessions: Array.from(sessions.values()).filter(s => s.status === 'pending').length,
    timestamp: new Date().toISOString(),
    backend: BACKEND_URL
  });
});

// صفحه اصلی برای تست
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Telegram Bot Service</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        .status { color: green; font-weight: bold; }
      </style>
    </head>
    <body>
      <h1>🤖 Telegram Bot Service</h1>
      <p class="status">✅ سرویس فعال است</p>
      <p>ربات پشتیبان تلگرام برای سیستم چت هوشمند</p>
      <p><a href="/health">Health Check</a></p>
    </body>
    </html>
  `);
});

// شروع ربات
async function startBot() {
  try {
    console.log('🚀 Starting Telegram bot on Railway...');
    
    // دریافت آدرس Railway
    const RAILWAY_URL = process.env.RAILWAY_STATIC_URL || 
                       process.env.RAILWAY_PUBLIC_DOMAIN;
    
    if (RAILWAY_URL) {
      const webhookUrl = `${RAILWAY_URL}/telegram-webhook`;
      console.log(`🌐 Setting webhook to: ${webhookUrl}`);
      
      // حذف webhook قبلی
      try {
        await bot.telegram.deleteWebhook();
        console.log('✅ Old webhook deleted');
      } catch (error) {
        console.log('ℹ️ No old webhook to delete');
      }
      
      // تنظیم webhook جدید
      await bot.telegram.setWebhook(webhookUrl, {
        allowed_updates: ['message', 'callback_query', 'chat_member']
      });
      
      console.log('✅ Webhook set successfully for Railway');
    } else {
      // استفاده از polling اگر Railway URL نداریم
      await bot.launch();
      console.log('✅ Bot started with polling (local mode)');
    }
    
    // شروع سرور web
    app.listen(webhookPort, '0.0.0.0', () => {
      console.log(`🤖 Telegram bot server running on port ${webhookPort}`);
      console.log('✅ Bot is ready and listening!');
      
      console.log('\n📋 Available endpoints:');
      console.log(`  POST /telegram-webhook - Telegram webhook endpoint`);
      console.log(`  POST /webhook - Backend webhook endpoint`);
      console.log(`  GET /health - Health check`);
      console.log(`  GET / - Home page`);
      
      // ارسال پیام شروع
      setTimeout(async () => {
        try {
          await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID,
            `🤖 *ربات فعال شد*\n\n`
            + `⏰ ${new Date().toLocaleString('fa-IR')}\n`
            + `🏢 میزبان: Railway\n`
            + `🔗 Backend: ${BACKEND_URL}\n`
            + `✅ آماده دریافت درخواست‌ها\n\n`
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

// شروع
startBot();
