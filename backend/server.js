/**
 * سرور اصلی برای چت‌بات وبسایت و پل ارتباطی تلگرام
 * این سرور سه بخش اصلی دارد:
 * 1. ارائه فایل‌های استاتیک برای ویجت چت
 * 2. API برای پردازش پیام‌های هوش مصنوعی
 * 3. WebSocket برای ارتباط بلادرنگ با تلگرام
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ذخیره‌سازی session‌ها در حافظه (در production از Redis استفاده کنید)
const sessions = new Map(); // sessionId -> { userId, telegramChatId, status }
const userConnections = new Map(); // userId -> WebSocket connection
const adminConnections = new Map(); // adminId -> WebSocket connection

// تنظیمات API
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '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';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID || '7321524568';

// تابع برای ایجاد sessionId یکتا
function generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// تابع برای ایجاد userId یکتا
function generateUserId() {
    return 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * پردازش پیام با هوش مصنوعی Groq
 * @param {string} message - پیام کاربر
 * @param {Array} history - تاریخچه مکالمه
 * @returns {Promise<Object>} پاسخ هوش مصنوعی
 */
async function processWithAI(message, history = []) {
    try {
        const messages = [
            {
                role: "system",
                content: "شما یک دستیار هوش مصنوعی فارسی هستید. پاسخ‌ها را مختصر و مفید بدهید. اگر اطلاعات کافی برای پاسخ ندارید، صادقانه بگویید."
            },
            ...history.slice(-5), // فقط ۵ پیام آخر تاریخچه
            {
                role: "user",
                content: message
            }
        ];

        const response = await axios.post(
            GROQ_API_URL,
            {
                model: "llama3-8b-8192", // می‌توانید مدل را تغییر دهید
                messages: messages,
                temperature: 0.7,
                max_tokens: 500
            },
            {
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        return {
            success: true,
            message: response.data.choices[0].message.content,
            requiresHuman: false
        };
    } catch (error) {
        console.error('خطا در پردازش با هوش مصنوعی:', error.message);
        
        // اگر خطای خاصی رخ داد، به اپراتور انسانی ارجاع بده
        if (error.response?.status === 429 || error.response?.status >= 500) {
            return {
                success: false,
                message: "در حال حاضر سرویس هوش مصنوعی در دسترس نیست. آیا مایلید با اپراتور انسانی صحبت کنید؟",
                requiresHuman: true
            };
        }
        
        return {
            success: false,
            message: "اطلاعات کافی برای پاسخ وجود ندارد. در صورت تمایل می‌توانید به اپراتور انسانی متصل شوید.",
            requiresHuman: true
        };
    }
}

/**
 * ارسال پیام به تلگرام ادمین
 * @param {string} sessionId - شناسه session
 * @param {string} userId - شناسه کاربر
 * @param {string} message - پیام
 * @returns {Promise<boolean>} موفقیت آمیز بودن
 */
async function sendToTelegramAdmin(sessionId, userId, message) {
    try {
        const telegramMessage = `📨 پیام جدید از کاربر\n\n` +
                               `Session ID: ${sessionId}\n` +
                               `User ID: ${userId}\n` +
                               `پیام: ${message}\n\n` +
                               `برای پاسخ، از ربات تلگرام استفاده کنید.`;
        
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: ADMIN_TELEGRAM_ID,
            text: telegramMessage,
            parse_mode: 'HTML'
        });
        
        return true;
    } catch (error) {
        console.error('خطا در ارسال به تلگرام:', error.message);
        return false;
    }
}

// WebSocket connection handler
wss.on('connection', (ws, req) => {
    const userId = generateUserId();
    console.log(`اتصال جدید WebSocket: ${userId}`);
    
    // ذخیره ارتباط کاربر
    userConnections.set(userId, ws);
    
    // ارسال شناسه کاربر به کلاینت
    ws.send(JSON.stringify({
        type: 'connection',
        userId: userId
    }));
    
    // هندلر پیام‌های دریافتی از کاربر
    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data);
            
            switch (message.type) {
                case 'message':
                    await handleUserMessage(userId, message.content, message.sessionId);
                    break;
                    
                case 'connect_to_human':
                    await connectToHuman(userId, message.sessionId);
                    break;
                    
                case 'typing':
                    // اطلاع به ادمین که کاربر در حال تایپ است
                    broadcastToAdmins({
                        type: 'user_typing',
                        userId: userId,
                        sessionId: message.sessionId
                    });
                    break;
            }
        } catch (error) {
            console.error('خطا در پردازش پیام WebSocket:', error);
        }
    });
    
    // هندلر قطع ارتباط
    ws.on('close', () => {
        console.log(`قطع ارتباط: ${userId}`);
        userConnections.delete(userId);
        
        // اطلاع به ادمین‌ها
        broadcastToAdmins({
            type: 'user_disconnected',
            userId: userId
        });
    });
});

/**
 * پردازش پیام کاربر
 */
async function handleUserMessage(userId, content, sessionId) {
    const ws = userConnections.get(userId);
    if (!ws) return;
    
    let session = sessions.get(sessionId);
    
    // اگر session وجود ندارد، ایجاد کن
    if (!session) {
        session = {
            userId: userId,
            telegramChatId: null,
            status: 'ai', // ai یا human
            history: []
        };
        sessions.set(sessionId, session);
    }
    
    // اضافه کردن به تاریخچه
    session.history.push({ role: 'user', content: content });
    
    // اگر در حالت هوش مصنوعی هستیم
    if (session.status === 'ai') {
        // پردازش با هوش مصنوعی
        const aiResponse = await processWithAI(content, session.history);
        
        if (aiResponse.requiresHuman) {
            // پیشنهاد اتصال به اپراتور انسانی
            ws.send(JSON.stringify({
                type: 'ai_response',
                message: aiResponse.message,
                requiresHuman: true,
                sessionId: sessionId
            }));
        } else {
            // ارسال پاسخ هوش مصنوعی
            session.history.push({ role: 'assistant', content: aiResponse.message });
            ws.send(JSON.stringify({
                type: 'ai_response',
                message: aiResponse.message,
                requiresHuman: false,
                sessionId: sessionId
            }));
        }
    } else if (session.status === 'human' && session.telegramChatId) {
        // اگر به اپراتور انسانی متصل است، پیام را به تلگرام فوروارد کن
        const sent = await sendToTelegramAdmin(sessionId, userId, content);
        
        if (sent) {
            ws.send(JSON.stringify({
                type: 'message_sent',
                message: content,
                to: 'admin'
            }));
        } else {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'خطا در ارسال پیام به اپراتور'
            }));
        }
    }
}

/**
 * اتصال کاربر به اپراتور انسانی
 */
async function connectToHuman(userId, sessionId) {
    const ws = userConnections.get(userId);
    if (!ws) return;
    
    let session = sessions.get(sessionId);
    if (!session) {
        session = {
            userId: userId,
            telegramChatId: null,
            status: 'human',
            history: []
        };
        sessions.set(sessionId, session);
    }
    
    // تغییر وضعیت به human
    session.status = 'human';
    
    // اطلاع به کاربر
    ws.send(JSON.stringify({
        type: 'connected_to_human',
        message: 'به اپراتور انسانی متصل شدید. لطفا پیام خود را ارسال کنید.',
        sessionId: sessionId
    }));
    
    // اطلاع به ادمین‌ها
    broadcastToAdmins({
        type: 'user_connected_to_human',
        userId: userId,
        sessionId: sessionId
    });
    
    console.log(`کاربر ${userId} به اپراتور انسانی متصل شد.`);
}

/**
 * ارسال پیام به تمام ادمین‌های متصل
 */
function broadcastToAdmins(message) {
    adminConnections.forEach((adminWs, adminId) => {
        try {
            adminWs.send(JSON.stringify(message));
        } catch (error) {
            console.error(`خطا در ارسال به ادمین ${adminId}:`, error);
        }
    });
}

// API endpoint برای ارسال پیام از تلگرام به کاربر
app.post('/api/telegram-webhook', async (req, res) => {
    try {
        const { sessionId, message, fromAdmin } = req.body;
        
        if (!sessionId || !message) {
            return res.status(400).json({ error: 'sessionId و message ضروری هستند' });
        }
        
        const session = sessions.get(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'session پیدا نشد' });
        }
        
        const userWs = userConnections.get(session.userId);
        if (!userWs) {
            return res.status(404).json({ error: 'کاربر آنلاین نیست' });
        }
        
        // ارسال پیام به کاربر
        userWs.send(JSON.stringify({
            type: 'admin_message',
            message: message,
            sessionId: sessionId,
            fromAdmin: fromAdmin || 'اپراتور'
        }));
        
        res.json({ success: true });
    } catch (error) {
        console.error('خطا در webhook تلگرام:', error);
        res.status(500).json({ error: 'خطای سرور' });
    }
});

// API endpoint برای دریافت وضعیت session
app.get('/api/session/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) {
        return res.status(404).json({ error: 'session پیدا نشد' });
    }
    
    res.json({
        sessionId: req.params.sessionId,
        userId: session.userId,
        status: session.status,
        telegramChatId: session.telegramChatId
    });
});

// سرویس دهی فایل‌های فرانت‌اند
app.get('/widget.js', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/chat-widget.js'));
});

app.get('/widget.css', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/chat-widget.css'));
});

// روت تست
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/example.html'));
});

// شروع سرور
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`سرور اجرا شد روی پورت ${PORT}`);
    console.log(`ویجت چت در دسترس است: http://localhost:${PORT}/widget.js`);
    console.log(`صفحه تست: http://localhost:${PORT}/`);
});
