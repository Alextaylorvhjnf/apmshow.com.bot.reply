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
console.log('TELEGRAM_BOT_TOKEN:', TELEGRAM_BOT_TOKEN ? '✓ Set (' + TELEGRAM_BOT_TOKEN.substring(0, 10) + '...)' : '✗ Missing');
console.log('ADMIN_TELEGRAM_ID:', ADMIN_TELEGRAM_ID ? '✓ Set (' + ADMIN_TELEGRAM_ID + ')' : '✗ Missing');

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
      'لطفاً به اپراتور',
      'نیاز به اتصال'
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
      telegramChatId: null,
      userInfo: {}
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

  updateUserInfo(sessionId, userInfo) {
    const session = this.getSession(sessionId);
    if (session) {
      session.userInfo = { ...session.userInfo, ...userInfo };
    }
    return session;
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

// Telegram Bot Manager - FIXED VERSION
class TelegramBotManager {
  constructor(io) {
    this.io = io;
    this.bot = null;
    this.adminId = ADMIN_TELEGRAM_ID;
    this.isConnected = false;
    
    if (TELEGRAM_BOT_TOKEN && ADMIN_TELEGRAM_ID) {
      this.initializeBot();
    } else {
      console.warn('⚠️ Telegram bot token or admin ID not provided. Telegram features disabled.');
    }
  }

  async initializeBot() {
    try {
      console.log('🤖 Initializing Telegram bot...');
      
      this.bot = new Telegraf(TELEGRAM_BOT_TOKEN);
      
      // Setup error handling
      this.bot.catch((err, ctx) => {
        console.error('Telegram bot error:', err);
        ctx?.reply?.('❌ خطایی رخ داد. لطفاً دوباره تلاش کنید.');
      });
      
      // Setup commands
      this.setupCommands();
      
      // Setup message handler
      this.bot.on('text', async (ctx) => {
        await this.handleOperatorMessage(ctx);
      });
      
      // Start bot
      await this.bot.launch();
      this.isConnected = true;
      
      console.log('✅ Telegram bot started successfully');
      
      // Send startup message to admin
      await this.sendToAdmin('🚀 *ربات پشتیبانی آنلاین راه‌اندازی شد*\n\n'
        + '⏰ ' + new Date().toLocaleString('fa-IR') + '\n'
        + '📊 آماده دریافت پیام‌های کاربران\n\n'
        + 'دستورات:\n'
        + '/sessions - مشاهده جلسات فعال\n'
        + '/stats - آمار سیستم\n'
        + '/help - راهنمای استفاده\n\n'
        + '✅ سیستم فعال و آماده به کار است');
        
    } catch (error) {
      console.error('❌ Failed to start Telegram bot:', error.message);
      console.error('Error details:', error);
      this.isConnected = false;
    }
  }

  setupCommands() {
    // Start command
    this.bot.start((ctx) => {
      const welcomeMessage = `👨‍💼 *پنل اپراتور پشتیبانی آنلاین*\n\n`
        + `شما به عنوان اپراتور انسانی متصل شدید.\n`
        + `پیام‌های کاربران به صورت خودکار برای شما ارسال می‌شود.\n\n`
        + `*دستورات:*\n`
        + `/sessions - مشاهده جلسات فعال\n`
        + `/stats - آمار سیستم\n`
        + `/help - راهنمایی\n\n`
        + `برای پاسخ به کاربر، فقط پیام خود را بنویسید.`;
      
      ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });
    });

    // Sessions command
    this.bot.command('sessions', (ctx) => {
      // Check if user is admin
      if (ctx.from.id.toString() !== this.adminId.toString()) {
        return ctx.reply('⚠️ شما دسترسی لازم را ندارید.');
      }

      const activeSessions = Array.from(global.sessionManager.sessions.values())
        .filter(session => session.connectedToHuman);
      
      if (activeSessions.length === 0) {
        return ctx.reply('📭 *هیچ جلسه فعالی وجود ندارد.*\n\nدر انتظار درخواست کاربران...', { parse_mode: 'Markdown' });
      }

      let message = `📊 *جلسات فعال (${activeSessions.length}):*\n\n`;
      
      activeSessions.forEach((session, index) => {
        const duration = Math.floor((new Date() - session.createdAt) / (1000 * 60));
        const messageCount = session.messages.length;
        const userName = session.userInfo?.name || 'کاربر سایت';
        
        message += `*${index + 1}. جلسه:* \`${session.id.substring(0, 12)}...\`\n`;
        message += `   👤 *کاربر:* ${userName}\n`;
        message += `   💬 *پیام‌ها:* ${messageCount}\n`;
        message += `   ⏱️ *مدت:* ${duration} دقیقه\n\n`;
      });

      ctx.reply(message, { parse_mode: 'Markdown' });
    });

    // Stats command
    this.bot.command('stats', (ctx) => {
      if (ctx.from.id.toString() !== this.adminId.toString()) {
        return ctx.reply('⚠️ شما دسترسی لازم را ندارید.');
      }

      const activeSessions = Array.from(global.sessionManager.sessions.values())
        .filter(s => (new Date() - s.lastActivity) < 30 * 60 * 1000);
      
      const statsMessage = `📈 *آمار سیستم:*\n\n`
        + `⏰ *زمان:* ${new Date().toLocaleTimeString('fa-IR')}\n`
        + `📅 *تاریخ:* ${new Date().toLocaleDateString('fa-IR')}\n\n`
        + `*📊 آمار جلسات:*\n`
        + `   • کل جلسات: ${global.sessionManager.sessions.size}\n`
        + `   • جلسات فعال: ${activeSessions.length}\n`
        + `   • متصل به اپراتور: ${activeSessions.filter(s => s.connectedToHuman).length}\n\n`
        + `*🤖 وضعیت:*\n`
        + `   • AI: ${GROQ_API_KEY ? '✅ فعال' : '❌ غیرفعال'}\n`
        + `   • تلگرام: ${this.isConnected ? '✅ متصل' : '❌ قطع'}\n\n`
        + `✅ سیستم در حال اجراست`;

      ctx.reply(statsMessage, { parse_mode: 'Markdown' });
    });

    // Help command
    this.bot.command('help', (ctx) => {
      const helpMessage = `📖 *راهنمای اپراتور:*\n\n`
        + `1. کاربران از طریق وبسایت با سیستم چت می‌کنند.\n`
        + `2. اگر AI نتواند پاسخ دهد، به شما متصل می‌شوند.\n`
        + `3. برای پاسخ، فقط پیام خود را بنویسید.\n\n`
        + `*🔧 دستورات:*\n`
        + `/start - شروع کار\n`
        + `/sessions - لیست جلسات\n`
        + `/stats - آمار سیستم\n`
        + `/help - این راهنما\n\n`
        + `💡 *نکته:* پیام‌های کاربران به صورت خودکار برای شما ارسال می‌شوند.`;

      ctx.reply(helpMessage, { parse_mode: 'Markdown' });
    });
  }

  async handleOperatorMessage(ctx) {
    const operatorId = ctx.from.id;
    const messageText = ctx.message.text;
    
    // Skip commands
    if (messageText.startsWith('/')) {
      return;
    }

    // Check if operator is authorized (only admin)
    if (operatorId.toString() !== this.adminId.toString()) {
      return ctx.reply('⚠️ شما دسترسی لازم برای پاسخ‌گویی ندارید.');
    }

    // Find session where this operator is connected
    let targetSession = null;
    for (const [sessionId, session] of global.sessionManager.sessions.entries()) {
      if (session.operatorId === operatorId && session.connectedToHuman) {
        targetSession = session;
        break;
      }
    }
    
    if (!targetSession) {
      return ctx.reply('⚠️ شما هیچ جلسه فعالی ندارید. منتظر درخواست کاربر باشید.');
    }

    try {
      // Send message to user via WebSocket
      this.io.to(targetSession.id).emit('operator-message', {
        from: 'operator',
        message: messageText,
        timestamp: new Date().toISOString(),
        operatorId: operatorId
      });

      // Add operator message to session
      global.sessionManager.addMessage(targetSession.id, 'operator', messageText);
      
      // Confirm to operator
      await ctx.reply(`✅ *پیام شما ارسال شد.*\n\n`
        + `🔗 *جلسه:* \`${targetSession.id.substring(0, 12)}...\`\n`
        + `👤 *کاربر:* ${targetSession.userInfo?.name || 'کاربر سایت'}\n\n`
        + `📝 برای پایان گفتگو، از کاربر بخواهید "پایان" بگوید.`, 
        { parse_mode: 'Markdown' });
        
    } catch (error) {
      console.error('Error sending operator message:', error);
      ctx.reply('❌ خطا در ارسال پیام به کاربر.');
    }
  }

  async connectToOperator(sessionId, userInfo = {}) {
    try {
      console.log(`🔗 Connecting session ${sessionId.substring(0, 8)}... to operator`);
      
      if (!this.isConnected || !this.bot) {
        throw new Error('Telegram bot is not connected');
      }
      
      // Get or create session
      let session = global.sessionManager.getSession(sessionId);
      if (!session) {
        session = global.sessionManager.createSession(sessionId);
      }
      
      // Update user info
      global.sessionManager.updateUserInfo(sessionId, userInfo);
      
      // Connect session to operator
      global.sessionManager.connectToHuman(sessionId, this.adminId, this.adminId);
      
      // Prepare user message for operator
      const userMessage = `🔔 *درخواست اتصال جدید*\n\n`
        + `🎫 *کد جلسه:* \`${sessionId}\`\n`
        + `👤 *کاربر:* ${userInfo.name || 'کاربر سایت'}\n`
        + `📧 *ایمیل:* ${userInfo.email || 'ندارد'}\n`
        + `📱 *تلفن:* ${userInfo.phone || 'ندارد'}\n`
        + `🌐 *صفحه:* ${userInfo.page || 'نامشخص'}\n\n`;
      
      // Add last user message if exists
      if (session.messages.length > 0) {
        const lastUserMessage = session.messages
          .filter(m => m.role === 'user')
          .slice(-1)[0];
        
        if (lastUserMessage) {
          userMessage += `📝 *آخرین پیام کاربر:*\n"${lastUserMessage.content.substring(0, 200)}${lastUserMessage.content.length > 200 ? '...' : ''}"\n\n`;
        }
      }
      
      userMessage += `💬 *برای پاسخ، پیام خود را بنویسید...*`;
      
      // Send notification to operator
      await this.sendToAdmin(userMessage);
      
      // Notify user via WebSocket
      this.io.to(sessionId).emit('operator-connected', {
        message: '✅ اپراتور انسانی متصل شد. در حال حاضر می‌توانید چت کنید.',
        operatorName: 'پشتیبان آنلاین',
        timestamp: new Date().toISOString()
      });

      console.log(`✅ Session ${sessionId.substring(0, 8)}... connected to operator`);
      
      return {
        success: true,
        operatorId: this.adminId,
        sessionId: sessionId
      };

    } catch (error) {
      console.error('❌ Error connecting to operator:', error.message);
      return {
        success: false,
        error: error.message,
        details: 'Telegram bot connection failed'
      };
    }
  }

  async sendToOperator(sessionId, message) {
    try {
      console.log(`📨 Forwarding message from session ${sessionId.substring(0, 8)}... to operator`);
      
      if (!this.isConnected || !this.bot) {
        throw new Error('Telegram bot is not connected');
      }
      
      const session = global.sessionManager.getSession(sessionId);
      if (!session || !session.connectedToHuman) {
        throw new Error('Session not connected to operator');
      }

      const operatorMessage = `📩 *پیام از کاربر*\n\n`
        + `🎫 *کد جلسه:* \`${sessionId.substring(0, 12)}...\`\n`
        + `👤 *کاربر:* ${session.userInfo?.name || 'کاربر سایت'}\n`
        + `💬 *پیام:*\n"${message}"\n\n`
        + `✏️ *برای پاسخ، پیام خود را بنویسید...*`;

      await this.bot.telegram.sendMessage(this.adminId, operatorMessage, { parse_mode: 'Markdown' });
      
      // Add user message to session
      global.sessionManager.addMessage(sessionId, 'user', message);
      
      return {
        success: true,
        message: 'پیام ارسال شد'
      };

    } catch (error) {
      console.error('❌ Error sending to operator:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async sendToAdmin(message) {
    try {
      if (!this.isConnected || !this.bot) {
        throw new Error('Telegram bot is not connected');
      }
      
      await this.bot.telegram.sendMessage(this.adminId, message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
      return true;
    } catch (error) {
      console.error('❌ Error sending to admin:', error.message);
      return false;
    }
  }
}

// Initialize services
const aiService = new AIService();
const sessionManager = new SessionManager();

// Make them globally accessible
global.aiService = aiService;
global.sessionManager = sessionManager;

// Initialize Telegram bot
let telegramBot = null;
if (TELEGRAM_BOT_TOKEN && ADMIN_TELEGRAM_ID) {
  telegramBot = new TelegramBotManager(io);
  global.telegramBot = telegramBot;
} else {
  console.warn('⚠️ Telegram bot will not be initialized due to missing configuration');
}

// WebSocket Handling
const activeConnections = new Map();

io.on('connection', (socket) => {
  console.log('🌐 New WebSocket connection:', socket.id);

  socket.on('join-session', (sessionId) => {
    socket.join(sessionId);
    activeConnections.set(socket.id, sessionId);
    console.log(`🔗 Client ${socket.id.substring(0, 8)} joined session ${sessionId.substring(0, 8)}...`);
  });

  socket.on('disconnect', () => {
    const sessionId = activeConnections.get(socket.id);
    if (sessionId) {
      socket.leave(sessionId);
      activeConnections.delete(socket.id);
      console.log(`🔌 Client ${socket.id.substring(0, 8)} disconnected from session ${sessionId.substring(0, 8)}...`);
    }
  });

  socket.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// API Endpoints
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    
    if (!message || !sessionId) {
      return res.status(400).json({ 
        success: false,
        error: 'پیام و شناسه جلسه الزامی است' 
      });
    }
    
    console.log(`💬 Chat request from ${sessionId.substring(0, 8)}...: "${message.substring(0, 50)}..."`);
    
    // Get or create session
    let session = sessionManager.getSession(sessionId);
    if (!session) {
      session = sessionManager.createSession(sessionId);
    }
    
    // Add user message
    sessionManager.addMessage(sessionId, 'user', message);
    
    // Get AI response
    const aiResponse = await aiService.getAIResponse(message);
    
    if (aiResponse.success) {
      sessionManager.addMessage(sessionId, 'assistant', aiResponse.message);
      
      res.json({
        success: true,
        message: aiResponse.message,
        requiresHuman: false,
        sessionId: sessionId
      });
    } else {
      sessionManager.addMessage(sessionId, 'system', 'AI نتوانست پاسخ دهد - پیشنهاد اتصال به اپراتور');
      
      res.json({
        success: false,
        message: aiResponse.message,
        requiresHuman: true,
        sessionId: sessionId
      });
    }
  } catch (error) {
    console.error('❌ Chat API error:', error);
    res.status(500).json({ 
      success: false,
      error: 'خطا در پردازش درخواست',
      requiresHuman: true 
    });
  }
});

app.post('/api/connect-human', async (req, res) => {
  try {
    const { sessionId, userInfo } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ 
        success: false,
        error: 'شناسه جلسه الزامی است' 
      });
    }
    
    console.log(`👤 Human connection requested for ${sessionId.substring(0, 8)}...`);
    
    // Check if Telegram bot is available
    if (!telegramBot) {
      return res.status(200).json({ 
        success: false,
        error: 'سرویس اپراتور در حال حاضر در دسترس نیست. لطفاً بعداً تلاش کنید.',
        details: 'Telegram bot not initialized'
      });
    }
    
    // Connect to operator
    const connectionResult = await telegramBot.connectToOperator(sessionId, userInfo);
    
    if (connectionResult.success) {
      res.json({ 
        success: true, 
        message: '✅ در حال اتصال به اپراتور انسانی...',
        operatorConnected: true,
        sessionId: sessionId
      });
    } else {
      res.status(200).json({ 
        success: false, 
        error: '❌ خطا در اتصال به اپراتور. لطفاً دوباره تلاش کنید.',
        details: connectionResult.error
      });
    }
  } catch (error) {
    console.error('❌ Connect human API error:', error);
    res.status(200).json({ 
      success: false,
      error: 'خطا در اتصال به اپراتور',
      details: error.message 
    });
  }
});

app.post('/api/send-to-operator', async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    
    if (!sessionId || !message) {
      return res.status(400).json({ 
        success: false,
        error: 'شناسه جلسه و پیام الزامی است' 
      });
    }
    
    console.log(`📨 Sending to operator from ${sessionId.substring(0, 8)}...: "${message.substring(0, 50)}..."`);
    
    if (!telegramBot) {
      return res.status(200).json({ 
        success: false, 
        error: 'سرویس اپراتور در دسترس نیست' 
      });
    }
    
    const result = await telegramBot.sendToOperator(sessionId, message);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(200).json(result);
    }
  } catch (error) {
    console.error('❌ Send to operator API error:', error);
    res.status(200).json({ 
      success: false,
      error: 'خطا در ارسال پیام',
      details: error.message 
    });
  }
});

// Telegram test endpoint
app.get('/api/test-telegram', async (req, res) => {
  try {
    if (!TELEGRAM_BOT_TOKEN || !ADMIN_TELEGRAM_ID) {
      return res.json({
        success: false,
        message: 'Telegram configuration missing',
        config: {
          hasToken: !!TELEGRAM_BOT_TOKEN,
          hasAdminId: !!ADMIN_TELEGRAM_ID,
          tokenPreview: TELEGRAM_BOT_TOKEN ? `${TELEGRAM_BOT_TOKEN.substring(0, 10)}...` : 'Not set',
          adminId: ADMIN_TELEGRAM_ID
        }
      });
    }
    
    const testMessage = `🧪 *تست سرویس تلگرام*\n\n`
      + `⏰ *زمان:* ${new Date().toLocaleString('fa-IR')}\n`
      + `🌐 *سرور:* ${process.env.RAILWAY_STATIC_URL || `localhost:${PORT}`}\n`
      + `✅ *وضعیت:* سیستم تست شد\n\n`
      + `اگر این پیام را دریافت می‌کنید، ربات تلگرام به درستی متصل است.`;
    
    // Try to send directly using Telegraf
    try {
      const testBot = new Telegraf(TELEGRAM_BOT_TOKEN);
      await testBot.telegram.sendMessage(ADMIN_TELEGRAM_ID, testMessage, { parse_mode: 'Markdown' });
      
      res.json({
        success: true,
        message: '✅ پیام تست با موفقیت ارسال شد',
        config: {
          tokenLength: TELEGRAM_BOT_TOKEN.length,
          adminId: ADMIN_TELEGRAM_ID,
          botStatus: 'Connected'
        }
      });
    } catch (botError) {
      res.json({
        success: false,
        message: '❌ خطا در ارسال پیام تست',
        error: botError.message,
        config: {
          tokenLength: TELEGRAM_BOT_TOKEN.length,
          adminId: ADMIN_TELEGRAM_ID,
          botStatus: 'Connection failed'
        }
      });
    }
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ============================================
  🚀 AI Chatbot Support System Started
  ============================================
  📍 Port: ${PORT}
  🌐 URL: http://localhost:${PORT}
  🤖 AI: ${GROQ_API_KEY ? '✅ Active' : '❌ Disabled'}
  📱 Telegram: ${TELEGRAM_BOT_TOKEN && ADMIN_TELEGRAM_ID ? '✅ Configured' : '❌ Not Configured'}
  📊 Sessions: 0 (initial)
  ============================================
  `);
  
  // Test Telegram connection after startup
  if (TELEGRAM_BOT_TOKEN && ADMIN_TELEGRAM_ID) {
    setTimeout(async () => {
      console.log('🔍 Testing Telegram connection...');
      try {
        const testBot = new Telegraf(TELEGRAM_BOT_TOKEN);
        const startupMessage = `🚀 *سرور راه‌اندازی شد*\n\n`
          + `⏰ ${new Date().toLocaleString('fa-IR')}\n`
          + `🌐 ${process.env.RAILWAY_STATIC_URL || `http://localhost:${PORT}`}\n`
          + `✅ *وضعیت:* آماده دریافت پیام‌ها\n\n`
          + `ربات پشتیبانی آنلاین فعال شد.`;
        
        await testBot.telegram.sendMessage(ADMIN_TELEGRAM_ID, startupMessage, { 
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        });
        
        console.log('✅ Telegram connection test passed - Bot is working!');
      } catch (error) {
        console.error('❌ Telegram connection test failed:', error.message);
        console.error('Error details:', error);
        
        // Check if token is valid
        if (error.message.includes('403')) {
          console.error('⚠️ Token may be invalid or bot is not properly configured');
        } else if (error.message.includes('ETELEGRAM')) {
          console.error('⚠️ Telegram API error - check internet connection');
        }
      }
    }, 3000);
  }
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('🔥 Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 Unhandled Rejection at:', promise, 'reason:', reason);
});
