const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { Telegraf } = require('telegraf');
require('dotenv').config();

// ==================== Configuration ====================
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;

// ==================== Initialize App ====================
const app = express();
const server = http.createServer(app);

// CORS Configuration
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"]
  },
  transports: ['websocket', 'polling']
});

// ==================== Enhanced CORS Middleware ====================
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// Handle preflight requests
app.options('*', cors());

// ==================== Other Middleware ====================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// ==================== Serve Static Files ====================
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    } else if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    }
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'تعداد درخواست‌های شما زیاد شده است. لطفاً چند دقیقه صبر کنید.'
});
app.use('/api/', limiter);

// ==================== AI Service ====================
class AIService {
  constructor() {
    this.apiKey = GROQ_API_KEY;
    this.model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    this.baseURL = 'https://api.groq.com/openai/v1';
    
    this.axiosInstance = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    this.systemPrompt = `شما یک دستیار هوشمند فارسی هستید که به سوالات کاربران پاسخ می‌دهید.
قوانین:
1. فقط به زبان فارسی پاسخ دهید
2. پاسخ‌ها باید مفید، دقیق و دوستانه باشند
3. اگر اطلاعات کافی برای پاسخ ندارید، صادقانه بگویید
4. در زمینه‌های زیر تخصص دارید:
   - پشتیبانی محصولات
   - پاسخ به سوالات عمومی
   - راهنمایی کاربران
   - حل مشکلات اولیه

اگر سوال خارج از حوزه دانش شماست یا اطلاعات کافی ندارید، بگویید: "برای پاسخ به این سوال نیاز به اتصال به اپراتور انسانی دارم"`;
  }

  async getAIResponse(userMessage, context = []) {
    try {
      const messages = [
        { role: 'system', content: this.systemPrompt },
        ...context.slice(-10),
        { role: 'user', content: userMessage }
      ];

      console.log('Sending to AI:', { message: userMessage.substring(0, 100) });

      const response = await this.axiosInstance.post('/chat/completions', {
        model: this.model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 1000,
        stream: false
      });

      if (response.data?.choices?.[0]?.message?.content) {
        const aiMessage = response.data.choices[0].message.content;
        console.log('AI Response received');
        
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

      throw new Error('Invalid response from AI API');

    } catch (error) {
      console.error('AI Service Error:', error.message);
      
      return {
        success: false,
        message: 'خطا در پردازش درخواست. لطفاً با اپراتور انسانی صحبت کنید.',
        requiresHuman: true
      };
    }
  }

  shouldConnectToHuman(aiMessage) {
    const indicators = [
      'اطلاعات کافی',
      'نمیتوانم پاسخ دهم',
      'اپراتور انسانی',
      'متخصص انسانی',
      'نمیدانم',
      'مطمئن نیستم',
      'دانش کافی'
    ];
    
    const lowerMessage = aiMessage.toLowerCase();
    return indicators.some(indicator => lowerMessage.includes(indicator.toLowerCase()));
  }
}

// ==================== Session Manager ====================
class Session {
  constructor(id, userInfo = {}) {
    this.id = id;
    this.userInfo = userInfo;
    this.messages = [];
    this.createdAt = new Date();
    this.lastActivity = new Date();
    this.connectedToHuman = false;
    this.telegramChatId = null;
    this.operatorId = null;
    this.isActive = true;
  }

  addMessage(role, content) {
    const message = {
      id: uuidv4(),
      role,
      content,
      timestamp: new Date()
    };
    
    this.messages.push(message);
    this.lastActivity = new Date();
    
    if (this.messages.length > 50) {
      this.messages = this.messages.slice(-50);
    }
    
    return message;
  }

  connectToHuman(telegramChatId, operatorId) {
    this.connectedToHuman = true;
    this.telegramChatId = telegramChatId;
    this.operatorId = operatorId;
    this.addMessage('system', 'Connected to human operator');
  }

  disconnectFromHuman() {
    this.connectedToHuman = false;
    this.telegramChatId = null;
    this.operatorId = null;
    this.addMessage('system', 'Disconnected from human operator');
  }

  getContext() {
    return this.messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
  }

  isExpired(timeoutMinutes = 30) {
    const now = new Date();
    const diffMinutes = (now - this.lastActivity) / (1000 * 60);
    return diffMinutes > timeoutMinutes;
  }
}

class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.cleanupInterval = setInterval(() => this.cleanupSessions(), 5 * 60 * 1000);
  }

  createSession(sessionId = null, userInfo = {}) {
    const id = sessionId || uuidv4();
    const session = new Session(id, userInfo);
    this.sessions.set(id, session);
    console.log(`✅ Session created: ${id}`);
    return session;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  endSession(sessionId) {
    const session = this.getSession(sessionId);
    if (session) {
      session.isActive = false;
      session.addMessage('system', 'Session ended');
    }
    return session;
  }

  getActiveSessions() {
    return Array.from(this.sessions.values())
      .filter(session => session.isActive && !session.isExpired());
  }

  getHumanConnectedSessions() {
    return this.getActiveSessions()
      .filter(session => session.connectedToHuman);
  }

  findSessionByTelegramChatId(chatId) {
    for (const session of this.sessions.values()) {
      if (session.telegramChatId === chatId && session.isActive) {
        return session;
      }
    }
    return null;
  }

  cleanupSessions() {
    let cleanedCount = 0;
    for (const [id, session] of this.sessions.entries()) {
      if (session.isExpired(60)) {
        this.sessions.delete(id);
        cleanedCount++;
      }
    }
    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned ${cleanedCount} expired sessions`);
    }
  }
}

// ==================== Telegram Bot ====================
class TelegramBotManager {
  constructor(sessionManager, io) {
    this.sessionManager = sessionManager;
    this.io = io;
    this.bot = null;
    this.adminId = ADMIN_TELEGRAM_ID;
    this.operatorSessions = new Map();
    
    this.initializeBot();
  }

  initializeBot() {
    try {
      if (!TELEGRAM_BOT_TOKEN) {
        console.warn('⚠️ Telegram bot token not provided. Telegram features disabled.');
        return;
      }

      this.bot = new Telegraf(TELEGRAM_BOT_TOKEN);
      this.setupCommands();
      this.setupMessageHandlers();
      
      this.bot.launch()
        .then(() => {
          console.log('✅ Telegram bot started successfully');
          
          // Send startup notification
          this.sendToAdmin('🚀 ربات پشتیبانی آنلاین راه‌اندازی شد\n\n'
            + 'دستورات:\n'
            + '/sessions - مشاهده جلسات فعال\n'
            + '/stats - آمار ربات\n'
            + '/help - راهنما');
        })
        .catch(error => {
          console.error('❌ Failed to start Telegram bot:', error.message);
        });

      // Graceful shutdown
      process.once('SIGINT', () => this.bot.stop('SIGINT'));
      process.once('SIGTERM', () => this.bot.stop('SIGTERM'));

    } catch (error) {
      console.error('❌ Error initializing Telegram bot:', error.message);
    }
  }

  setupCommands() {
    this.bot.start((ctx) => {
      const welcomeMessage = `👨‍💼 پنل اپراتور پشتیبانی آنلاین\n\n`
        + `شما به عنوان اپراتور انسانی متصل شدید.\n`
        + `پیام‌های کاربران به صورت خودکار برای شما ارسال می‌شود.\n\n`
        + `دستورات:\n`
        + `/sessions - مشاهده جلسات فعال\n`
        + `/stats - آمار سیستم\n`
        + `/help - راهنمایی`;
      
      ctx.reply(welcomeMessage);
    });

    this.bot.command('sessions', (ctx) => {
      if (!this.isOperator(ctx.from.id)) {
        return ctx.reply('⚠️ شما دسترسی لازم را ندارید.');
      }

      const activeSessions = this.sessionManager.getHumanConnectedSessions();
      
      if (activeSessions.length === 0) {
        return ctx.reply('📭 هیچ جلسه فعالی وجود ندارد.');
      }

      let message = `📊 جلسات فعال (${activeSessions.length}):\n\n`;
      
      activeSessions.forEach((session, index) => {
        const duration = Math.floor((new Date() - session.createdAt) / (1000 * 60));
        const messageCount = session.messages.length;
        
        message += `${index + 1}. جلسه: ${session.id.substring(0, 8)}...\n`;
        message += `   👤 کاربر: ${session.userInfo.name || 'ناشناس'}\n`;
        message += `   💬 پیام‌ها: ${messageCount}\n`;
        message += `   ⏱️ مدت: ${duration} دقیقه\n\n`;
      });

      ctx.reply(message);
    });

    this.bot.command('stats', (ctx) => {
      if (!this.isOperator(ctx.from.id)) {
        return ctx.reply('⚠️ شما دسترسی لازم را ندارید.');
      }

      const activeSessions = this.sessionManager.getActiveSessions();
      const humanSessions = this.sessionManager.getHumanConnectedSessions();
      
      const statsMessage = `📈 آمار سیستم:\n\n`
        + `⏰ زمان: ${new Date().toLocaleTimeString('fa-IR')}\n`
        + `📅 تاریخ: ${new Date().toLocaleDateString('fa-IR')}\n\n`
        + `📊 آمار جلسات:\n`
        + `   • کل جلسات: ${this.sessionManager.sessions.size}\n`
        + `   • جلسات فعال: ${activeSessions.length}\n`
        + `   • متصل به اپراتور: ${humanSessions.length}\n\n`
        + `👥 اپراتورهای آنلاین: ${this.operatorSessions.size}`;

      ctx.reply(statsMessage);
    });

    this.bot.command('help', (ctx) => {
      const helpMessage = `📖 راهنمای اپراتور:\n\n`
        + `1. کاربران از طریق وبسایت با سیستم چت می‌کنند.\n`
        + `2. اگر AI نتواند پاسخ دهد، به شما متصل می‌شوند.\n`
        + `3. برای پاسخ، فقط پیام خود را بنویسید.\n\n`
        + `🔧 دستورات:\n`
        + `/start - شروع کار\n`
        + `/sessions - لیست جلسات\n`
        + `/stats - آمار سیستم\n`
        + `/help - این راهنما`;

      ctx.reply(helpMessage);
    });
  }

  setupMessageHandlers() {
    this.bot.on('text', async (ctx) => {
      const operatorId = ctx.from.id;
      const messageText = ctx.message.text;
      
      if (messageText.startsWith('/')) return;

      if (!this.isOperator(operatorId)) {
        return ctx.reply('⚠️ شما دسترسی لازم برای پاسخ‌گویی ندارید.');
      }

      const sessionId = this.getOperatorActiveSession(operatorId);
      if (!sessionId) {
        return ctx.reply('⚠️ شما هیچ جلسه فعالی ندارید.');
      }

      await this.sendToUser(sessionId, messageText, operatorId);
      
      ctx.reply(`✅ پیام شما ارسال شد.\n\n`
        + `🔗 جلسه: ${sessionId.substring(0, 8)}...`);
    });
  }

  async connectToOperator(sessionId, userInfo = {}) {
    try {
      const session = this.sessionManager.getSession(sessionId);
      if (!session) {
        throw new Error('Session not found');
      }

      const operatorId = this.adminId;
      session.connectToHuman(ctx?.chat?.id, operatorId);
      this.operatorSessions.set(operatorId, sessionId);
      
      const userMessage = `🔔 درخواست اتصال جدید:\n\n`
        + `🎫 کد جلسه: ${sessionId}\n`
        + `👤 کاربر: ${userInfo.name || 'ناشناس'}\n`
        + `📧 ایمیل: ${userInfo.email || 'ندارد'}\n`
        + `📱 تلفن: ${userInfo.phone || 'ندارد'}\n\n`
        + `📝 آخرین پیام کاربر:\n"${session.messages.slice(-1)[0]?.content || 'بدون پیام'}"\n\n`
        + `💬 برای پاسخ، پیام خود را بنویسید...`;

      await this.sendToAdmin(userMessage);
      
      this.io.to(sessionId).emit('operator-connected', {
        message: 'اپراتور انسانی متصل شد. در حال حاضر می‌توانید چت کنید.',
        operatorName: 'پشتیبان آنلاین'
      });

      console.log(`✅ Session ${sessionId} connected to operator ${operatorId}`);
      
      return {
        success: true,
        operatorId: operatorId,
        sessionId: sessionId
      };

    } catch (error) {
      console.error('❌ Error connecting to operator:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async sendToOperator(sessionId, message) {
    try {
      const session = this.sessionManager.getSession(sessionId);
      if (!session || !session.connectedToHuman) {
        throw new Error('Session not connected to operator');
      }

      const operatorMessage = `📩 پیام از کاربر:\n\n`
        + `🎫 جلسه: ${sessionId.substring(0, 8)}...\n`
        + `👤 کاربر: ${session.userInfo.name || 'ناشناس'}\n`
        + `💬 پیام:\n"${message}"\n\n`
        + `✏️ برای پاسخ، پیام خود را بنویسید...`;

      await this.bot.telegram.sendMessage(session.operatorId, operatorMessage);
      session.addMessage('user', message);
      
      return {
        success: true,
        message: 'پیام ارسال شد'
      };

    } catch (error) {
      console.error('❌ Error sending to operator:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async sendToUser(sessionId, message, operatorId) {
    try {
      this.io.to(sessionId).emit('operator-message', {
        from: 'operator',
        message: message,
        timestamp: new Date().toISOString(),
        operatorId: operatorId
      });

      const session = this.sessionManager.getSession(sessionId);
      if (session) {
        session.addMessage('operator', message);
      }

      console.log(`📤 Message sent to user in session ${sessionId.substring(0, 8)}...`);
      return true;

    } catch (error) {
      console.error('❌ Error sending to user:', error);
      return false;
    }
  }

  async sendToAdmin(message) {
    try {
      await this.bot.telegram.sendMessage(this.adminId, message);
      return true;
    } catch (error) {
      console.error('❌ Error sending to admin:', error);
      return false;
    }
  }

  isOperator(userId) {
    return userId.toString() === this.adminId.toString();
  }

  getOperatorActiveSession(operatorId) {
    return this.operatorSessions.get(operatorId);
  }
}

// ==================== Initialize Services ====================
const aiService = new AIService();
const sessionManager = new SessionManager();
let telegramBot = null;

try {
  telegramBot = new TelegramBotManager(sessionManager, io);
} catch (error) {
  console.warn('⚠️ Telegram bot initialization failed, continuing without Telegram features');
}

// ==================== WebSocket Handling ====================
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
      console.log(`🔌 Client ${socket.id.substring(0, 8)} disconnected`);
    }
  });
});

// ==================== API Routes ====================
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    telegram: telegramBot ? 'active' : 'inactive',
    sessions: sessionManager.sessions.size,
    url: process.env.RAILWAY_STATIC_URL || `http://localhost:${PORT}`
  });
});

// Route for widget files
app.get('/widget.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/widget.js'), {
    headers: {
      'Content-Type': 'application/javascript',
      'Access-Control-Allow-Origin': '*'
    }
  });
});

app.get('/widget.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/widget.css'), {
    headers: {
      'Content-Type': 'text/css',
      'Access-Control-Allow-Origin': '*'
    }
  });
});

// API endpoint for chat
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    
    if (!message || !sessionId) {
      return res.status(400).json({ error: 'Message and sessionId are required' });
    }

    console.log(`💬 Chat request: ${sessionId.substring(0, 8)}... - "${message.substring(0, 50)}..."`);

    let session = sessionManager.getSession(sessionId);
    if (!session) {
      session = sessionManager.createSession(sessionId);
    }

    session.addMessage('user', message);
    const aiResponse = await aiService.getAIResponse(message, session.getContext());

    if (aiResponse.success) {
      session.addMessage('ai', aiResponse.message);
      
      res.json({
        success: true,
        message: aiResponse.message,
        requiresHuman: false,
        sessionId: sessionId
      });
    } else {
      session.addMessage('system', 'AI could not answer - offering human support');
      
      res.json({
        success: false,
        message: 'اطلاعات کافی برای پاسخ وجود ندارد. در صورت تمایل می‌توانید به اپراتور انسانی متصل شوید.',
        requiresHuman: true,
        sessionId: sessionId
      });
    }
  } catch (error) {
    console.error('❌ Chat error:', error);
    res.status(500).json({ 
      error: 'خطا در پردازش درخواست',
      requiresHuman: true 
    });
  }
});

// Connect to human operator
app.post('/api/connect-human', async (req, res) => {
  try {
    const { sessionId, userInfo } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (!telegramBot) {
      return res.status(500).json({ 
        success: false, 
        error: 'Telegram bot is not configured' 
      });
    }

    console.log(`👤 Human connection requested: ${sessionId.substring(0, 8)}...`);
    
    const connectionResult = await telegramBot.connectToOperator(sessionId, userInfo);
    
    if (connectionResult.success) {
      session.connectToHuman();
      res.json({ 
        success: true, 
        message: 'در حال اتصال به اپراتور انسانی...',
        operatorConnected: true 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: 'خطا در اتصال به اپراتور' 
      });
    }
  } catch (error) {
    console.error('❌ Connect human error:', error);
    res.status(500).json({ error: 'خطا در اتصال به اپراتور' });
  }
});

// Send message to operator
app.post('/api/send-to-operator', async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    
    if (!sessionId || !message) {
      return res.status(400).json({ error: 'Session ID and message are required' });
    }

    if (!telegramBot) {
      return res.status(500).json({ 
        success: false, 
        error: 'Telegram bot is not configured' 
      });
    }

    console.log(`📨 Sending to operator: ${sessionId.substring(0, 8)}... - "${message.substring(0, 50)}..."`);
    
    const result = await telegramBot.sendToOperator(sessionId, message);
    res.json(result);
  } catch (error) {
    console.error('❌ Send to operator error:', error);
    res.status(500).json({ error: 'خطا در ارسال پیام' });
  }
});

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({
    message: 'API is working!',
    serverTime: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    publicPath: path.join(__dirname, 'public')
  });
});

// ==================== Serve Frontend ====================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/widget.html'), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8'
    }
  });
});

// Catch-all route for frontend
app.get('*', (req, res) => {
  if (req.url.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'public/widget.html'));
});

// ==================== Error Handling ====================
app.use((err, req, res, next) => {
  console.error('🔥 Server error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ==================== Start Server ====================
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ============================================
  🚀 AI Chatbot Support System Started
  ============================================
  📡 Port: ${PORT}
  🌐 WebSocket: Ready
  🤖 Telegram Bot: ${telegramBot ? '✅ Active' : '⚠️ Disabled'}
  📁 Public Directory: ${path.join(__dirname, 'public')}
  🔗 Health Check: http://localhost:${PORT}/api/health
  🎯 Widget URL: http://localhost:${PORT}/widget.js
  ============================================
  `);
  
  // Log environment info
  console.log('Environment:', {
    NODE_ENV: process.env.NODE_ENV,
    HAS_GROQ_KEY: !!GROQ_API_KEY,
    HAS_TELEGRAM_TOKEN: !!TELEGRAM_BOT_TOKEN,
    HAS_ADMIN_ID: !!ADMIN_TELEGRAM_ID
  });
});
