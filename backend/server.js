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

// تنظیمات با اطلاعات شما
const GROQ_API_KEY = process.env.GROQ_API_KEY || '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';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8200429613:AAGTgP5hnOiRIxXc3YJmxvTqwEqhQ4crGkk';
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID || '7321524568';

console.log('🚀 Starting AI Chat Bridge...');
console.log('🤖 Groq API Key:', GROQ_API_KEY ? '✅ Loaded' : '❌ Missing');
console.log('📱 Telegram Token:', TELEGRAM_BOT_TOKEN ? '✅ Loaded' : '❌ Missing');
console.log('👤 Admin ID:', ADMIN_TELEGRAM_ID);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ذخیره‌سازی session‌ها
const sessions = new Map();
const userConnections = new Map();
const adminConnections = new Map();

// تابع برای ارسال به تلگرام
async function sendToTelegram(chatId, message) {
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
        });
        return true;
    } catch (error) {
        console.error('Telegram Error:', error.message);
        return false;
    }
}

// پردازش با هوش مصنوعی
async function processWithAI(message) {
    try {
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: "llama3-8b-8192",
                messages: [
                    {
                        role: "system",
                        content: "You are a helpful Persian assistant. Keep responses concise and friendly."
                    },
                    {
                        role: "user",
                        content: message
                    }
                ],
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
        console.error('Groq API Error:', error.message);
        return {
            success: false,
            message: "متأسفم، در حال حاضر نمی‌تونم پاسخ بدم. آیا می‌خواهید با اپراتور انسانی صحبت کنید؟",
            requiresHuman: true
        };
    }
}

// WebSocket connection handler
wss.on('connection', (ws) => {
    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`New WebSocket connection: ${userId}`);
    
    userConnections.set(userId, ws);
    
    ws.send(JSON.stringify({
        type: 'connection',
        userId: userId,
        message: 'سلام! به چت بات خوش آمدید. 🤖'
    }));
    
    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data);
            
            if (message.type === 'message') {
                const aiResponse = await processWithAI(message.content);
                
                if (aiResponse.requiresHuman) {
                    ws.send(JSON.stringify({
                        type: 'ai_response',
                        message: aiResponse.message,
                        requiresHuman: true,
                        sessionId: message.sessionId
                    }));
                } else {
                    ws.send(JSON.stringify({
                        type: 'ai_response',
                        message: aiResponse.message,
                        requiresHuman: false,
                        sessionId: message.sessionId
                    }));
                }
            }
            
            if (message.type === 'connect_to_human') {
                // اطلاع به تلگرام
                await sendToTelegram(ADMIN_TELEGRAM_ID, 
                    `🔔 درخواست پشتیبانی انسانی!\n\n` +
                    `User ID: ${userId}\n` +
                    `Session: ${message.sessionId}\n` +
                    `Time: ${new Date().toLocaleTimeString('fa-IR')}`
                );
                
                ws.send(JSON.stringify({
                    type: 'human_connected',
                    message: 'به اپراتور انسانی متصل شدید. لطفاً پیام خود را ارسال کنید.',
                    sessionId: message.sessionId
                }));
            }
        } catch (error) {
            console.error('WebSocket message error:', error);
        }
    });
    
    ws.on('close', () => {
        console.log(`WebSocket closed: ${userId}`);
        userConnections.delete(userId);
    });
});

// API Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/example.html'));
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
            websocket: true,
            groq_api: !!GROQ_API_KEY,
            telegram_bot: !!TELEGRAM_BOT_TOKEN
        }
    });
});

app.get('/widget.js', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/chat-widget.js'));
});

app.get('/widget.css', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/chat-widget.css'));
});

app.post('/api/send-message', async (req, res) => {
    try {
        const { message } = req.body;
        
        const aiResponse = await processWithAI(message);
        
        res.json({
            success: true,
            response: aiResponse.message,
            requiresHuman: aiResponse.requiresHuman
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

app.post('/api/telegram-webhook', async (req, res) => {
    try {
        const { sessionId, message } = req.body;
        
        // اینجا می‌توانید session را پیدا کرده و به کاربر پیام بفرستید
        res.json({
            success: true,
            message: 'Message received'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌐 WebSocket ready at ws://localhost:${PORT}`);
    console.log(`📱 Health check: http://localhost:${PORT}/health`);
    console.log(`🤖 Chat widget: http://localhost:${PORT}/widget.js`);
});
