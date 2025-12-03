const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { Telegraf } = require('telegraf');
require('dotenv').config();

// Configuration
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;

// Validate required environment variables
console.log('🔍 Checking environment variables...');
console.log('GROQ_API_KEY:', GROQ_API_KEY ? '✓ Set' : '✗ Missing');
console.log('TELEGRAM_BOT_TOKEN:', TELEGRAM_BOT_TOKEN ? '✓ Set' : '✗ Missing');
console.log('ADMIN_TELEGRAM_ID:', ADMIN_TELEGRAM_ID ? '✓ Set' : '✗ Missing');

// Initialize App
const app = express();
const server = http.createServer(app);

// CORS Configuration
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

// Middleware
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security Headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false
}));

// Custom headers middleware
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  next();
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    } else if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
    }
  }
}));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/widget.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'widget.js'));
});

app.get('/widget.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'widget.css'));
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Chatbot API is running',
    timestamp: new Date().toISOString(),
    telegram: global.telegramBot ? 'connected' : 'disconnected',
    ai: GROQ_API_KEY ? 'enabled' : 'disabled',
    sessions: global.sessionManager ? global.sessionManager.sessions.size : 0
  });
});

// AI Service
class AIService {
  constructor() {
    this.apiKey = GROQ_API_KEY;
    this.model = 'llama-3.3-70b-versatile';
    this.baseURL = 'https://api.groq.com/openai/v1';
    
    this.axiosInstance = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    this.systemPrompt = `You are a professional Persian AI assistant. Follow these rules:
1. Answer ONLY in Persian (Farsi)
2. Be helpful, accurate, and friendly
3. If you don't know something, say so honestly
4. You specialize in:
   - Product support
   - General questions
   - User guidance
   - Technical assistance

If you cannot answer or need human help, say: "لطفاً به اپراتور انسانی متصل شوید"`;
  }

  async getAIResponse(userMessage) {
    try {
      console.log('🤖 Sending to AI:', userMessage.substring(0, 100));

      const response = await this.axiosInstance.post('/chat/completions', {
        model: this.model,
        messages: [
          { role: 'system', content: this.systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.7,
        max_tokens: 1000
      });

      if (response.data?.choices?.[0]?.message?.content) {
        const aiMessage = response.data.choices[0].message.content;
        console.log('✅ AI Response received');
        
        // Check if AI suggests human support
        if (this.shouldConnectToHuman(aiMessage)) {
          return {
            success: false,
            message: aiMessage,
            requiresHuman: true
          };
        }

        return {
          success: true,
          message: aiMessage,
          requiresHuman: false
        };
      }

      throw new Error('Invalid AI response');
    } catch (error) {
      console.error('❌ AI Error:', error.message);
      return {
        success: false,
        message: 'خطا در پردازش درخواست. لطفاً دوباره تلاش کنید.',
        requiresHuman: true
      };
    }
  }

  shouldConnectToHuman(message) {
    const triggers = [
      'نمیتوانم',
      'نمیدانم',
      'اطلاعات کافی',
      'اپراتور انسانی',
      'متخصص انسانی',
      'لطفاً به اپراتور'
    ];
    
    const lowerMessage = message.toLowerCase();
    return triggers.some(trigger => lowerMessage.includes(trigger.toLowerCase()));
  }
}

// Session Manager
class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.cleanupInterval = setInterval(() => this.cleanupSessions(), 5 * 60 * 1000);
  }

  createSession(sessionId) {
    const session = {
      id: sessionId,
      messages: [],
      createdAt: new Date(),
      lastActivity: new Date(),
      connectedToHuman: false,
      operatorId: null,
      telegramChatId: null
    };
    this.sessions.set(sessionId, session);
    console.log(`✅ Session created: ${sessionId.substring(0, 8)}...`);
    return session;
  }

  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
    }
    return session;
  }

  addMessage(sessionId, role, content) {
    const session = this.getSession(sessionId);
    if (session) {
      session.messages.push({ 
        role, 
        content, 
        timestamp: new Date(),
        id: uuidv4()
      });
      // Keep only last 50 messages
      if (session.messages.length > 50) {
        session.messages = session.messages.slice(-50);
      }
    }
  }

  connectToHuman(sessionId, operatorId, telegramChatId = null) {
    const session = this.getSession(sessionId);
    if (session) {
      session.connectedToHuman = true;
      session.operatorId = operatorId;
      session.telegramChatId = telegramChatId;
      session.lastActivity = new Date();
      console.log(`👤 Session ${sessionId.substring(0, 8)}... connected to human operator`);
    }
    return session;
  }

  disconnectFromHuman(sessionId) {
    const session = this.getSession(sessionId);
    if (session) {
      session.connectedToHuman = false;
      session.operatorId = null;
      session.telegramChatId = null;
      console.log(`👤 Session ${sessionId.substring(0, 8)}... disconnected from human operator`);
    }
    return session;
  }

  cleanupSessions() {
    const now = new Date();
    let cleanedCount = 0;
    
    for (const [sessionId, session] of this.sessions.entries()) {
      const inactiveMinutes = (now - session.lastActivity) / (1000 * 60);
      if (inactiveMinutes > 60) { // Cleanup after 60 minutes of inactivity
        this.sessions.delete(sessionId);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned ${cleanedCount} inactive sessions`);
    }
  }
}

// Telegram Bot Manager
class TelegramBotManager {
  constructor(io) {
    this.io = io;
    this.bot = null;
    this.adminId = ADMIN_TELEGRAM_ID;
    this.operatorSessions = new Map(); // operatorId -> sessionId
    this.sessionConnections = new Map(); // sessionId -> operatorId
    
    if (TELEGRAM_BOT_TOKEN && ADMIN_TELEGRAM_ID) {
      this.initializeBot();
    } else {
      console.warn('⚠️ Telegram bot token or admin ID not provided. Telegram features disabled.');
    }
  }

  initializeBot() {
    try {
      console.log('🤖 Initializing Telegram bot...');
      
      this.bot = new Telegraf(TELEGRAM_BOT_TOKEN);
      
      // Setup commands
      this.setupCommands();
      
      // Setup message handler
      this.bot.on('text', async (ctx) => {
        await this.handleOperatorMessage(ctx);
      });
      
      // Start bot
      this.bot.launch()
        .then(() => {
          console.log('✅ Telegram bot started successfully');
          
          // Send startup message to admin
          this.sendToAdmin('🚀 ربات پشتیبانی آنلاین راه‌اندازی شد\n\n'
            + '⏰ ' + new Date().toLocaleString('fa-IR') + '\n'
            + '📊 آماده دریافت پیام‌های کاربران\n\n'
            + 'دستورات:\n'
            + '/sessions - مشاهده جلسات فعال\n'
            + '/stats - آمار سیستم\n'
            + '/help - راهنمای استفاده');
        })
        .catch(error => {
          console.error('❌ Failed to start Telegram bot:', error.message);
        });

      // Enable graceful stop
      process.once('SIGINT', () => this.bot.stop('SIGINT'));
      process.once('SIGTERM', () => this.bot.stop('SIGTERM'));

    } catch (error) {
      console.error('❌ Telegram bot initialization error:', error.message);
    }
  }

  setupCommands() {
    // Start command
    this.bot.start((ctx) => {
      const welcomeMessage = `👨‍💼 پنل اپراتور پشتیبانی آنلاین\n\n`
        + `شما به عنوان اپراتور انسانی متصل شدید.\n`
        + `پیام‌های کاربران به صورت خودکار برای شما ار
