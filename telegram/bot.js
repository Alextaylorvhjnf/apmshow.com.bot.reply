/**
 * ربات تلگرام برای پشتیبانی انسانی
 * این ربات پیام‌ها را بین کاربران سایت و اپراتورهای تلگرام منتقل می‌کند
 */

require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

// تنظیمات
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8200429613:AAGTgP5hnOiRIxXc3YJmxvTqwEqhQ4crGkk';
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID || '7321524568';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const BACKEND_API_URL = `${BACKEND_URL}/api`;

// ذخیره‌سازی session‌ها (در production از دیتابیس استفاده کنید)
const activeSessions = new Map(); // sessionId -> { telegramChatId, userId, userName }
const adminSessions = new Map(); // adminId -> { currentSessionId }

// ایجاد ربات
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

/**
 * ارسال پیام به backend
 */
async function sendToBackend(sessionId, message, fromAdmin = null) {
    try {
        const response = await axios.post(`${BACKEND_API_URL}/telegram-webhook`, {
            sessionId: sessionId,
            message: message,
            fromAdmin: fromAdmin
        });
        
        return response.data.success;
    } catch (error) {
        console.error('خطا در ارسال به backend:', error.message);
        return false;
    }
}

/**
 * دریافت اطلاعات session
 */
async function getSessionInfo(sessionId) {
    try {
        const response = await axios.get(`${BACKEND_API_URL}/session/${sessionId}`);
        return response.data;
    } catch (error) {
        console.error('خطا در دریافت اطلاعات session:', error.message);
        return null;
    }
}

/**
 * نمایش لیست session‌های فعال
 */
async function showActiveSessions(ctx) {
    if (activeSessions.size === 0) {
        return await ctx.reply('❌ هیچ session فعالی وجود ندارد.');
    }
    
    let message = '📋 لیست session‌های فعال:\n\n';
    let buttons = [];
    
    activeSessions.forEach((session, sessionId) => {
        message += `🔸 Session ID: ${sessionId}\n`;
        message += `   👤 کاربر: ${session.userName || 'ناشناس'}\n`;
        message += `   ⏰ زمان شروع: ${new Date(session.startTime).toLocaleTimeString('fa-IR')}\n\n`;
        
        buttons.push([
            Markup.button.callback(
                `👤 ${session.userName || 'کاربر'} - ${sessionId.substring(0, 8)}...`,
                `select_session_${sessionId}`
            )
        ]);
    });
    
    return await ctx.reply(message, Markup.inlineKeyboard(buttons));
}

/**
 * شروع ربات
 */
bot.start(async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    
    // بررسی آیا کاربر ادمین است
    if (userId.toString() === ADMIN_TELEGRAM_ID) {
        await ctx.reply(
            '👨‍💼 سلام ادمین عزیز!\n\n' +
            'شما به پنل پشتیبانی انسانی متصل شدید.\n\n' +
            'دستورات موجود:\n' +
            '/sessions - نمایش session‌های فعال\n' +
            '/help - راهنمایی\n\n' +
            'برای پاسخ به کاربران، ابتدا یک session را انتخاب کنید.'
        );
        
        // ذخیره ادمین
        adminSessions.set(userId.toString(), {
            currentSessionId: null
        });
    } else {
        await ctx.reply(
            '🤖 سلام!\n\n' +
            'این ربات برای پشتیبانی از کاربران سایت طراحی شده است.\n' +
            'شما می‌توانید از طریق ویجت چت در سایت با ما در ارتباط باشید.'
        );
    }
});

/**
 * نمایش session‌های فعال
 */
bot.command('sessions', async (ctx) => {
    const userId = ctx.from.id.toString();
    
    if (userId !== ADMIN_TELEGRAM_ID) {
        return await ctx.reply('⛔ دسترسی denied. فقط ادمین‌ها می‌توانند از این دستور استفاده کنند.');
    }
    
    await showActiveSessions(ctx);
});

/**
 * راهنمایی
 */
bot.command('help', async (ctx) => {
    const userId = ctx.from.id.toString();
    
    if (userId === ADMIN_TELEGRAM_ID) {
        await ctx.reply(
            '📖 راهنمای ادمین:\n\n' +
            '1. برای مشاهده session‌های فعال از /sessions استفاده کنید.\n' +
            '2. روی session مورد نظر کلیک کنید تا انتخاب شود.\n' +
            '3. بعد از انتخاب session، پیام‌های شما به کاربر ارسال می‌شود.\n' +
            '4. برای خروج از session جاری از /exit استفاده کنید.\n' +
            '5. برای بستن session از /close استفاده کنید.\n\n' +
            '📍 توجه: هر پیامی که بعد از انتخاب session بنویسید، به کاربر ارسال می‌شود.'
        );
    } else {
        await ctx.reply(
            '📖 راهنمای کاربر:\n\n' +
            'شما می‌توانید از طریق ویجت چت در سایت با ما در ارتباط باشید.\n' +
            'در صورت نیاز به پشتیبانی انسانی، در چت روی "اتصال به اپراتور انسانی" کلیک کنید.'
        );
    }
});

/**
 * خروج از session جاری
 */
bot.command('exit', async (ctx) => {
    const userId = ctx.from.id.toString();
    
    if (userId !== ADMIN_TELEGRAM_ID) {
        return await ctx.reply('⛔ دسترسی denied.');
    }
    
    const adminSession = adminSessions.get(userId);
    if (!adminSession || !adminSession.currentSessionId) {
        return await ctx.reply('ℹ️ شما در حال حاضر هیچ sessionی انتخاب نکرده‌اید.');
    }
    
    const sessionId = adminSession.currentSessionId;
    adminSession.currentSessionId = null;
    
    await ctx.reply(`✅ از session "${sessionId.substring(0, 10)}..." خارج شدید.\n\nبرای انتخاب session جدید از /sessions استفاده کنید.`);
});

/**
 * بستن session
 */
bot.command('close', async (ctx) => {
    const userId = ctx.from.id.toString();
    
    if (userId !== ADMIN_TELEGRAM_ID) {
        return await ctx.reply('⛔ دسترسی denied.');
    }
    
    const adminSession = adminSessions.get(userId);
    if (!adminSession || !adminSession.currentSessionId) {
        return await ctx.reply('ℹ️ لطفاً ابتدا یک session انتخاب کنید.');
    }
    
    const sessionId = adminSession.currentSessionId;
    
    // ارسال پیام خداحافظی به کاربر
    await sendToBackend(sessionId, '✅ اپراتور جلسه پشتیبانی را بست. در صورت نیاز مجدد می‌توانید ارتباط برقرار کنید.', 'سیستم');
    
    // حذف session
    activeSessions.delete(sessionId);
    adminSession.currentSessionId = null;
    
    await ctx.reply(`✅ session "${sessionId.substring(0, 10)}..." با موفقیت بسته شد.`);
});

/**
 * هندلر callback برای انتخاب session
 */
bot.action(/select_session_(.+)/, async (ctx) => {
    const userId = ctx.from.id.toString();
    
    if (userId !== ADMIN_TELEGRAM_ID) {
        return await ctx.answerCbQuery('⛔ دسترسی denied.');
    }
    
    const sessionId = ctx.match[1];
    const session = activeSessions.get(sessionId);
    
    if (!session) {
        return await ctx.answerCbQuery('❌ این session منقضی شده است.');
    }
    
    // ذخیره session انتخاب شده برای ادمین
    const adminSession = adminSessions.get(userId);
    if (adminSession) {
        adminSession.currentSessionId = sessionId;
    }
    
    await ctx.answerCbQuery(`✅ session "${sessionId.substring(0, 10)}..." انتخاب شد.`);
    
    await ctx.reply(
        `✅ session انتخاب شد!\n\n` +
        `📝 اطلاعات session:\n` +
        `🔸 ID: ${sessionId}\n` +
        `👤 کاربر: ${session.userName || 'ناشناس'}\n` +
        `🆔 User ID: ${session.userId}\n` +
        `⏰ زمان شروع: ${new Date(session.startTime).toLocaleTimeString('fa-IR')}\n\n` +
        `💬 حالا می‌توانید پیام خود را بنویسید و آن را به کاربر ارسال کنید.\n` +
        `برای خروج از این session از /exit استفاده کنید.`
    );
    
    // اطلاع به کاربر
    await sendToBackend(sessionId, `👨‍💼 اپراتور "${ctx.from.first_name}" به چت شما پیوست.`, 'سیستم');
});

/**
 * هندلر دریافت پیام متنی از ادمین
 */
bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id.toString();
    const messageText = ctx.message.text;
    
    // اگر پیام از ادمین است
    if (userId === ADMIN_TELEGRAM_ID) {
        const adminSession = adminSessions.get(userId);
        
        // اگر ادمین session جاری دارد
        if (adminSession && adminSession.currentSessionId) {
            const sessionId = adminSession.currentSessionId;
            const session = activeSessions.get(sessionId);
            
            if (!session) {
                adminSession.currentSessionId = null;
                return await ctx.reply('❌ این session منقضی شده است. لطفاً session جدیدی انتخاب کنید.');
            }
            
            // ارسال پیام به کاربر
            const sent = await sendToBackend(sessionId, messageText, ctx.from.first_name);
            
            if (sent) {
                await ctx.reply('✅ پیام شما ارسال شد.');
                
                // ثبت در تاریخچه session
                if (!session.messages) session.messages = [];
                session.messages.push({
                    from: 'admin',
                    text: messageText,
                    time: new Date()
                });
            } else {
                await ctx.reply('❌ خطا در ارسال پیام. لطفاً دوباره امتحان کنید.');
            }
        }
        // اگر ادمین session جاری ندارد و پیام دستوری نیست
        else if (!messageText.startsWith('/')) {
            await ctx.reply(
                'ℹ️ لطفاً ابتدا یک session انتخاب کنید.\n\n' +
                'برای مشاهده session‌های فعال از /sessions استفاده کنید.'
            );
        }
    }
    // اگر پیام از کاربر عادی است
    else {
        await ctx.reply(
            '🤖 این ربات برای پشتیبانی از کاربران سایت طراحی شده است.\n\n' +
            'شما می‌توانید از طریق ویجت چت در سایت با ما در ارتباط باشید.'
        );
    }
});

/**
 * API برای دریافت پیام از backend (زمانی که کاربر درخواست اتصال به اپراتور می‌کند)
 * این endpoint توسط backend فراخوانی می‌شود
 */
const express = require('express');
const app = express();
const port = process.env.TELEGRAM_BOT_PORT || 3001;

app.use(express.json());

// Webhook برای دریافت پیام از backend
app.post('/webhook', async (req, res) => {
    try {
        const { type, userId, sessionId, message, userName } = req.body;
        
        if (type === 'user_connected_to_human') {
            // ذخیره session جدید
            activeSessions.set(sessionId, {
                userId: userId,
                telegramChatId: ADMIN_TELEGRAM_ID,
                userName: userName || 'کاربر سایت',
                startTime: new Date(),
                messages: []
            });
            
            // اطلاع به ادمین
            await bot.telegram.sendMessage(
                ADMIN_TELEGRAM_ID,
                `🔔 درخواست پشتیبانی جدید!\n\n` +
                `📝 اطلاعات session:\n` +
                `🔸 Session ID: ${sessionId}\n` +
                `👤 کاربر: ${userName || 'کاربر سایت'}\n` +
                `🆔 User ID: ${userId}\n` +
                `⏰ زمان: ${new Date().toLocaleTimeString('fa-IR')}\n\n` +
                `برای انتخاب این session روی دکمه زیر کلیک کنید:`,
                Markup.inlineKeyboard([
                    [Markup.button.callback('🎯 انتخاب این session', `select_session_${sessionId}`)]
                ])
            );
            
            res.json({ success: true });
        } 
        else if (type === 'user_message') {
            // ارسال پیام کاربر به ادمین
            const session = activeSessions.get(sessionId);
            if (session) {
                await bot.telegram.sendMessage(
                    ADMIN_TELEGRAM_ID,
                    `📨 پیام جدید از کاربر\n\n` +
                    `🔸 Session ID: ${sessionId}\n` +
                    `👤 کاربر: ${session.userName || 'کاربر سایت'}\n` +
                    `💬 پیام: ${message}\n\n` +
                    `برای پاسخ، ابتدا session را انتخاب کنید.`,
                    Markup.inlineKeyboard([
                        [Markup.button.callback('🎯 پاسخ به این کاربر', `select_session_${sessionId}`)]
                    ])
                );
                
                // ثبت در تاریخچه
                if (!session.messages) session.messages = [];
                session.messages.push({
                    from: 'user',
                    text: message,
                    time: new Date()
                });
            }
            
            res.json({ success: true });
        }
        else if (type === 'user_disconnected') {
            // حذف session
            activeSessions.delete(sessionId);
            
            // اطلاع به ادمین
            await bot.telegram.sendMessage(
                ADMIN_TELEGRAM_ID,
                `ℹ️ کاربر از session "${sessionId.substring(0, 10)}..." خارج شد.`
            );
            
            res.json({ success: true });
        }
        else {
            res.status(400).json({ error: 'نوع درخواست نامعتبر است' });
        }
    } catch (error) {
        console.error('خطا در webhook:', error);
        res.status(500).json({ error: 'خطای سرور' });
    }
});

// شروع ربات و سرور
async function start() {
    try {
        // شروع ربات تلگرام
        await bot.launch();
        console.log('🤖 ربات تلگرام شروع به کار کرد...');
        
        // شروع سرور Express برای webhook
        app.listen(port, () => {
            console.log(`🌐 سرور webhook روی پورت ${port} شروع به کار کرد...`);
        });
        
        // فعال‌سازی graceful shutdown
        process.once('SIGINT', () => bot.stop('SIGINT'));
        process.once('SIGTERM', () => bot.stop('SIGTERM'));
        
    } catch (error) {
        console.error('خطا در شروع ربات تلگرام:', error);
        process.exit(1);
    }
}

start();

module.exports = { bot, activeSessions };
