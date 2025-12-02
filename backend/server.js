require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const { Telegraf } = require('telegraf');

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
app.use(express.static('public'));

// WebSocket
const connections = new Map();

wss.on('connection', (ws) => {
    const userId = 'user_' + Date.now();
    connections.set(userId, ws);
    
    ws.send(JSON.stringify({
        type: 'welcome',
        message: 'سلام! به چت بات خوش آمدید. 🤖'
    }));
    
    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data);
            
            if (message.type === 'chat') {
                const response = await callGroqAPI(message.text);
                
                ws.send(JSON.stringify({
                    type: 'response',
                    message: response
                }));
            }
        } catch (error) {
            console.error('WebSocket error:', error);
        }
    });
    
    ws.on('close', () => {
        connections.delete(userId);
    });
});

// تابع برای فراخوانی Groq API
async function callGroqAPI(message) {
    try {
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: "llama3-8b-8192",
                messages: [
                    {
                        role: "system",
                        content: "You are a helpful Persian assistant."
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
        
        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('Groq API Error:', error.message);
        return "متأسفم، در حال حاضر نمی‌تونم پاسخ بدم.";
    }
}

// راه‌اندازی ربات تلگرام
let bot = null;
try {
    bot = new Telegraf(TELEGRAM_BOT_TOKEN);
    
    bot.start((ctx) => {
        const userId = ctx.from.id.toString();
        
        if (userId === ADMIN_TELEGRAM_ID) {
            ctx.reply('👨‍💼 سلام ادمین! ربات پشتیبانی فعال است.');
        } else {
            ctx.reply('🤖 سلام! این ربات برای پشتیبانی از کاربران سایت است.');
        }
    });
    
    bot.on('text', (ctx) => {
        const userId = ctx.from.id.toString();
        
        if (userId === ADMIN_TELEGRAM_ID) {
            ctx.reply('پیام شما دریافت شد. در نسخه کامل به کاربران ارسال می‌شود.');
        }
    });
    
    bot.launch().then(() => {
        console.log('✅ Telegram bot started successfully!');
    });
} catch (error) {
    console.error('❌ Telegram bot error:', error.message);
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
    res.sendFile(path.join(__dirname, 'public', 'widget.js'));
});

app.get('/widget.css', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'widget.css'));
});

app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;
        
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }
        
        const response = await callGroqAPI(message);
        
        res.json({
            success: true,
            response: response
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Internal server error'
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
