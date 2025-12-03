// telegram/bot.js
const { Telegraf } = require('telegraf');
const fetch = require('node-fetch');
require('dotenv').config();

// Load environment variables
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8200429613:AAGTgP5hnOiRIxXc3YJmxvTqwEqhQ4crGkk';
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID || '7321524568';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';

// Initialize bot
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// Store active sessions
const activeSessions = new Map(); // Map<adminChatId, sessionId>

console.log('Telegram Bot Starting...');
console.log('Bot Token:', TELEGRAM_BOT_TOKEN ? 'Set' : 'Not Set');
console.log('Admin ID:', ADMIN_TELEGRAM_ID);
console.log('Backend URL:', BACKEND_URL);

/**
 * Send message to backend WebSocket
 */
async function sendToBackend(sessionId, message) {
  try {
    const response = await fetch(`${BACKEND_URL}/api/telegram-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: sessionId,
        message: message,
        source: 'telegram'
      })
    });
    
    return response.ok;
  } catch (error) {
    console.error('Error sending to backend:', error);
    return false;
  }
}

// Start command
bot.start(async (ctx) => {
  const chatId = ctx.chat.id;
  
  if (chatId.toString() === ADMIN_TELEGRAM_ID) {
    const welcomeMessage = `🤖 <b>ربات پشتیبانی وبسایت</b>\n\n`
      + `سلام اپراتور عزیز!\n`
      + `من ربات پل ارتباطی بین وبسایت و تلگرام هستم.\n\n`
      + `🔹 <b>دستورات موجود:</b>\n`
      + `/sessions - مشاهده جلسات فعال\n`
      + `/help - راهنمایی\n\n`
      + `هرگاه کاربری از وبسایت درخواست اتصال به اپراتور انسانی بدهد، به شما اطلاع می‌دهم.\n`
      + `شما می‌توانید با پاسخ دادن به پیام‌های من، با کاربران صحبت کنید.`;
    
    await ctx.reply(welcomeMessage, { parse_mode: 'HTML' });
  } else {
    await ctx.reply('⛔ این ربات فقط برای اپراتورهای پشتیبانی است.');
  }
});

// Sessions command
bot.command('sessions', async (ctx) => {
  const chatId = ctx.chat.id;
  
  if (chatId.toString() === ADMIN_TELEGRAM_ID) {
    if (activeSessions.size === 0) {
      await ctx.reply('📭 هیچ جلسه فعالی وجود ندارد.');
    } else {
      let message = `📊 <b>جلسات فعال</b>\n\n`;
      
      for (const [sessionId, adminChatId] of activeSessions.entries()) {
        if (adminChatId === chatId.toString()) {
          message += `🔹 جلسه: <code>${sessionId.substring(0, 8)}...</code>\n`;
        }
      }
      
      await ctx.reply(message, { parse_mode: 'HTML' });
    }
  }
});

// Help command
bot.command('help', async (ctx) => {
  const chatId = ctx.chat.id;
  
  if (chatId.toString() === ADMIN_TELEGRAM_ID) {
    const helpMessage = `📖 <b>راهنمای اپراتور</b>\n\n`
      + `شما به عنوان اپراتور پشتیبانی می‌توانید:\n\n`
      + `1. منتظر بمانید تا کاربران از وبسایت درخواست اتصال به اپراتور انسانی کنند.\n`
      + `2. زمانی که کاربر درخواست اتصال داد، به شما اطلاع می‌دهم.\n`
      + `3. می‌توانید مستقیماً به پیام‌های من پاسخ دهید و پیام شما به کاربر وبسایت ارسال می‌شود.\n`
      + `4. برای پایان دادن به جلسه، کاربر باید از وبسایت خارج شود.\n\n`
      + `🔹 <b>نکات مهم:</b>\n`
      + `• هر پیامی که می‌نویسید به کاربر ارسال می‌شود.\n`
      + `• برای ارسال عکس یا فایل، از قابلیت‌های ربات استفاده کنید.\n`
      + `• جلسه به طور خودکار پس از خروج کاربر بسته می‌شود.`;
    
    await ctx.reply(helpMessage, { parse_mode: 'HTML' });
  }
});

// Handle text messages
bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const messageText = ctx.message.text;
  const messageId = ctx.message.message_id;
  
  // Check if this is admin
  if (chatId.toString() === ADMIN_TELEGRAM_ID) {
    // Check if this is a reply to a bot message
    if (ctx.message.reply_to_message) {
      const repliedMessage = ctx.message.reply_to_message.text;
      
      // Extract session ID from bot's message (if exists)
      const sessionMatch = repliedMessage.match(/شناسه جلسه: (\S+)/);
      
      if (sessionMatch) {
        const sessionId = sessionMatch[1];
        
        // Store session
        activeSessions.set(sessionId, chatId.toString());
        
        // Send message to backend
        const success = await sendToBackend(sessionId, messageText);
        
        if (success) {
          await ctx.reply(`✅ پیام شما ارسال شد.`, {
            reply_to_message_id: messageId
          });
        } else {
          await ctx.reply(`❌ خطا در ارسال پیام.`, {
            reply_to_message_id: messageId
          });
        }
      } else {
        // Check if this session is already active
        let foundSession = null;
        for (const [sessionId, adminId] of activeSessions.entries()) {
          if (adminId === chatId.toString()) {
            foundSession = sessionId;
            break;
          }
        }
        
        if (foundSession) {
          // Send message to existing session
          const success = await sendToBackend(foundSession, messageText);
          
          if (success) {
            await ctx.reply(`✅ پیام شما ارسال شد.`, {
              reply_to_message_id: messageId
            });
          } else {
            await ctx.reply(`❌ خطا در ارسال پیام.`, {
              reply_to_message_id: messageId
            });
          }
        } else {
          await ctx.reply(`⚠️ لطفاً ابتدا به یک پیام از من پاسخ دهید تا جلسه مشخص شود.`, {
            reply_to_message_id: messageId
          });
        }
      }
    } else {
      // Not a reply, check if there's an active session
      let activeSession = null;
      for (const [sessionId, adminId] of activeSessions.entries()) {
        if (adminId === chatId.toString()) {
          activeSession = sessionId;
          break;
        }
      }
      
      if (activeSession) {
        // Send message to active session
        const success = await sendToBackend(activeSession, messageText);
        
        if (success) {
          await ctx.reply(`✅ پیام شما ارسال شد.`, {
            reply_to_message_id: messageId
          });
        } else {
          await ctx.reply(`❌ خطا در ارصال پیام.`, {
            reply_to_message_id: messageId
          });
        }
      } else {
        await ctx.reply(`ℹ️ لطفاً برای شروع مکالمه با کاربر، به یکی از پیام‌های اعلان من پاسخ دهید.`);
      }
    }
  }
});

// Handle other types of messages (photos, documents, etc.)
bot.on(['photo', 'document', 'audio', 'video'], async (ctx) => {
  const chatId = ctx.chat.id;
  
  if (chatId.toString() === ADMIN_TELEGRAM_ID) {
    await ctx.reply(`⚠️ در حال حاضر فقط پیام‌های متنی پشتیبانی می‌شوند.`, {
      reply_to_message_id: ctx.message.message_id
    });
  }
});

// Error handling
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err);
  
  if (ctx.chat && ctx.chat.id.toString() === ADMIN_TELEGRAM_ID) {
    ctx.reply(`❌ خطایی رخ داد: ${err.message}`).catch(console.error);
  }
});

// Start bot
async function startBot() {
  try {
    // Delete webhook first
    await bot.telegram.deleteWebhook();
    
    // Start polling
    await bot.launch();
    console.log('Telegram bot started successfully!');
    
    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } catch (error) {
    console.error('Failed to start bot:', error);
    process.exit(1);
  }
}

startBot();

module.exports = bot;
