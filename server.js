const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const NodeCache = require('node-cache');
require('dotenv').config();

console.log('='.repeat(60));
console.log('🚀 AI CHATBOT WITH TELEGRAM SUPPORT - SYNCED VERSION');
console.log('='.repeat(60));

const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TELEGRAM_BOT_URL = process.env.TELEGRAM_BOT_URL || 'http://localhost:3001';

console.log('📌 Port:', PORT);
console.log('🤖 AI:', GROQ_API_KEY ? '✅ ENABLED' : '❌ DISABLED');
console.log('🤖 Telegram Bot URL:', TELEGRAM_BOT_URL);
console.log('='.repeat(60));

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
  transports: ['websocket', 'polling']
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

// Custom headers
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

// Cache for sessions
const sessionCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

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
    message: '🤖 پشتیبان هوشمند با قابلیت تلگرام',
    timestamp: new Date().toISOString(),
    features: {
      ai: !!GROQ_API_KEY,
      telegram: true,
      realtime: true
    }
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
    
    this.systemPrompt = `شما "پشتیبان هوشمند" هستید. قوانین:
1. فقط به فارسی پاسخ دهید
2. مفید، دقیق و دوستانه باشید
3. اگر نمی‌دانید، صادقانه بگویید
4. تخصص: پشتیبانی محصول، سوالات عمومی، راهنمایی کاربران

اگر سوال خارج از حوزه شماست، بگویید: "برای پاسخ دقیق‌تر، لطفاً به اپراتور انسانی متصل شوید."`;
  }

  async getAIResponse(userMessage) {
    try {
      const response = await this.axiosInstance.post('/chat/completions', {
        model: this.model,
        messages: [
          { role: 'system', content: this.systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.7,
        max_tokens: 800
      });

      if (response.data?.choices?.[0]?.message?.content) {
        const aiMessage = response.data.choices[0].message.content;
        
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
        message: '⚠️ خطا در پردازش. لطفاً با اپراتور انسانی صحبت کنید.',
        requiresHuman: true
      };
    }
  }

  shouldConnectToHuman(message) {
    const triggers = [
      'اپراتور انسانی',
      'متخصص انسانی',
      'نمیتوانم پاسخ دهم',
      'اطلاعات کافی',
      'لطفاً با اپراتور'
    ];
    
    return triggers.some(trigger => message.toLowerCase().includes(trigger.toLowerCase()));
  }
}

// Session Manager
class SessionManager {
  constructor() {
    this.sessions = new Map();
  }

  createSession(sessionId, userInfo = {}) {
    const session = {
      id: sessionId,
      messages: [],
      createdAt: new Date(),
      lastActivity: new Date(),
      connectedToHuman: false,
      operatorId: null,
      operatorChatId: null,
      userInfo: userInfo,
      status: 'active',
      telegramMessageId: null
    };
    
    this.sessions.set(sessionId, session);
    sessionCache.set(sessionId, session);
    console.log(`✅ Session created: ${sessionId.substring(0, 8)}...`);
    return session;
  }

  getSession(sessionId) {
    let session = sessionCache.get(sessionId);
    if (!session) {
      session = this.sessions.get(sessionId);
      if (session) {
        sessionCache.set(sessionId, session);
      }
    }
    
    if (session) {
      session.lastActivity = new Date();
      sessionCache.set(sessionId, session);
    }
    
    return session;
  }

  addMessage(sessionId, role, content) {
    const session = this.getSession(sessionId);
    if (session) {
      session.messages.push({
        id: uuidv4(),
        role,
        content,
        timestamp: new Date()
      });
      
      if (session.messages.length > 100) {
        session.messages = session.messages.slice(-100);
      }
      
      sessionCache.set(sessionId, session);
      return session.messages[session.messages.length - 1];
    }
    return null;
  }

  connectToHuman(sessionId, operatorChatId, operatorName) {
    const session = this.getSession(sessionId);
    if (session) {
      session.connectedToHuman = true;
      session.operatorId = 'telegram_operator';
      session.operatorChatId = operatorChatId;
      session.status = 'connected';
      
      sessionCache.set(sessionId, session);
      console.log(`👤 Session ${sessionId.substring(0, 8)}... connected to operator ${operatorChatId}`);
    }
    return session;
  }

  disconnectFromHuman(sessionId) {
    const session = this.getSession(sessionId);
    if (session) {
      session.connectedToHuman = false;
      session.operatorId = null;
      session.operatorChatId = null;
      session.status = 'active';
      sessionCache.set(sessionId, session);
    }
    return session;
  }

  getActiveSessions() {
    return Array.from(this.sessions.values())
      .filter(s => (new Date() - s.lastActivity) < 30 * 60 * 1000);
  }

  getStats() {
    const active = this.getActiveSessions();
    return {
      totalSessions: this.sessions.size,
      activeSessions: active.length,
      humanConnected: active.filter(s => s.connectedToHuman).length,
      aiEnabled: !!GROQ_API_KEY
    };
  }
}

// Telegram Service
class TelegramService {
  constructor() {
    this.botUrl = TELEGRAM_BOT_URL;
    this.axios = axios.create({
      baseURL: this.botUrl,
      timeout: 10000
    });
  }

  async notifyNewSession(sessionId, userInfo, userMessage) {
    try {
      const response = await this.axios.post('/webhook', {
        event: 'new_session',
        data: {
          sessionId,
          userInfo,
          userMessage
        }
      });
      
      return response.data.success === true;
    } catch (error) {
      console.error('❌ Telegram notification failed:', error.message);
      return false;
    }
  }

  async sendToOperator(sessionId, message, userInfo) {
    try {
      const response = await this.axios.post('/webhook', {
        event: 'user_message',
        data: {
          sessionId,
          message,
          userName: userInfo?.name || 'کاربر سایت'
        }
      });
      
      return response.data;
    } catch (error) {
      console.error('❌ Send to operator failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async checkHealth() {
    try {
      const response = await this.axios.get('/health');
      return response.data.status === 'OK';
    } catch (error) {
      console.error('❌ Telegram health check failed:', error.message);
      return false;
    }
  }
}

// Initialize services
const aiService = new AIService();
const sessionManager = new SessionManager();
const telegramService = new TelegramService();

// WebSocket
io.on('connection', (socket) => {
  console.log('🌐 WebSocket connected:', socket.id);

  socket.on('join-session', (sessionId) => {
    socket.join(sessionId);
    console.log(`🔗 Client joined session: ${sessionId.substring(0, 8)}...`);
  });

  socket.on('send-to-operator', async (data) => {
    const { sessionId, message } = data;
    const session = sessionManager.getSession(sessionId);
    
    if (session && session.connectedToHuman) {
      // Add user message to session
      sessionManager.addMessage(sessionId, 'user', message);
      
      // Forward to Telegram bot
      const result = await telegramService.sendToOperator(
        sessionId, 
        message, 
        session.userInfo
      );
      
      if (result.success) {
        socket.emit('message-sent', { success: true });
      } else {
        socket.emit('message-sent', { 
          success: false, 
          error: result.error || 'خطا در ارسال پیام به اپراتور' 
        });
      }
    } else {
      socket.emit('message-sent', { 
        success: false, 
        error: 'هنوز به اپراتور متصل نیستید' 
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('🔌 WebSocket disconnected:', socket.id);
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
    
    console.log(`💬 Chat: ${sessionId.substring(0, 8)}...`);
    
    // Get or create session
    let session = sessionManager.getSession(sessionId);
    if (!session) {
      session = sessionManager.createSession(sessionId);
    }
    
    // Add user message
    sessionManager.addMessage(sessionId, 'user', message);
    
    // Check if connected to human
    if (session.connectedToHuman) {
      return res.json({
        success: true,
        message: 'پیام شما برای اپراتور ارسال شد.',
        requiresHuman: false,
        sessionId: sessionId,
        operatorConnected: true
      });
    }
    
    // Get AI response
    const aiResponse = await aiService.getAIResponse(message);
    
    if (aiResponse.success) {
      sessionManager.addMessage(sessionId, 'assistant', aiResponse.message);
      
      res.json({
        success: true,
        message: aiResponse.message,
        requiresHuman: false,
        sessionId: sessionId,
        operatorConnected: false
      });
    } else {
      sessionManager.addMessage(sessionId, 'system', 'AI پیشنهاد اتصال به اپراتور');
      
      res.json({
        success: false,
        message: aiResponse.message,
        requiresHuman: true,
        sessionId: sessionId,
        operatorConnected: false
      });
    }
  } catch (error) {
    console.error('❌ Chat error:', error);
    res.status(500).json({ 
      success: false,
      error: 'خطا در پردازش درخواست'
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
    
    console.log(`👤 Connect human: ${sessionId.substring(0, 8)}...`);
    
    // Check Telegram bot health
    const telegramHealthy = await telegramService.checkHealth();
    if (!telegramHealthy) {
      console.warn('⚠️ Telegram bot is not responding');
      return res.json({
        success: false,
        error: 'سرویس اپراتور در دسترس نیست. لطفاً بعداً تلاش کنید.',
        operatorConnected: false
      });
    }
    
    // Get or create session
    let session = sessionManager.getSession(sessionId);
    if (!session) {
      session = sessionManager.createSession(sessionId, userInfo);
    } else {
      session.userInfo = { ...session.userInfo, ...userInfo };
    }
    
    // Get last user message
    const lastUserMessage = session.messages
      .filter(m => m.role === 'user')
      .slice(-1)[0]?.content || 'درخواست اتصال به اپراتور';
    
    // Notify Telegram bot
    const notified = await telegramService.notifyNewSession(
      sessionId,
      session.userInfo,
      lastUserMessage
    );
    
    if (notified) {
      res.json({
        success: true,
        message: '✅ درخواست شما به اپراتور ارسال شد. منتظر پذیرش باشید...',
        operatorConnected: false,
        pending: true
      });
    } else {
      res.json({
        success: false,
        error: 'خطا در ارسال درخواست به اپراتور. لطفاً دوباره تلاش کنید.',
        operatorConnected: false
      });
    }
    
  } catch (error) {
    console.error('❌ Connect human error:', error);
    res.json({
      success: false,
      error: 'خطا در اتصال به اپراتور',
      operatorConnected: false
    });
  }
});

// Webhook endpoint for receiving events from Telegram bot
app.post('/webhook', async (req, res) => {
  try {
    const { event, data } = req.body;
    console.log(`📨 Webhook from Telegram bot: ${event}`, data);
    
    switch (event) {
      case 'operator_accepted':
        // Connect session to operator
        const session = sessionManager.connectToHuman(
          data.sessionId, 
          data.operatorId, 
          data.operatorName
        );
        
        if (session) {
          // Notify user via WebSocket
          io.to(data.sessionId).emit('operator-accepted', {
            message: '✅ اپراتور درخواست شما را پذیرفت! می‌توانید گفتگو را شروع کنید.',
            operatorName: data.operatorName || 'اپراتور',
            timestamp: new Date().toISOString()
          });
          
          console.log(`✅ Operator ${data.operatorName} accepted session ${data.sessionId.substring(0, 8)}...`);
        }
        break;
        
      case 'operator_rejected':
        // Notify user via WebSocket
        io.to(data.sessionId).emit('operator-rejected', {
          message: '❌ متأسفانه اپراتور در حال حاضر مشغول است. لطفاً بعداً تلاش کنید یا سوال خود را از هوش مصنوعی بپرسید.',
          timestamp: new Date().toISOString()
        });
        console.log(`❌ Operator rejected session ${data.sessionId.substring(0, 8)}...`);
        break;
        
      case 'operator_message':
        // Message from operator to user
        console.log(`📤 Operator message for session ${data.sessionId.substring(0, 8)}...`);
        
        // Get session
        const targetSession = sessionManager.getSession(data.sessionId);
        if (targetSession) {
          // Add operator message to session
          sessionManager.addMessage(data.sessionId, 'operator', data.message);
          
          // Send to user via WebSocket
          io.to(data.sessionId).emit('operator-message', {
            from: 'operator',
            message: data.message,
            timestamp: new Date().toISOString(),
            operatorName: data.operatorName || 'اپراتور',
            sessionId: data.sessionId
          });
          
          console.log(`✅ Operator message sent to user in session ${data.sessionId.substring(0, 8)}...`);
        }
        break;
        
      case 'session_ended':
        // Session ended
        const endedSession = sessionManager.getSession(data.sessionId);
        
        if (endedSession && endedSession.operatorChatId) {
          io.to(data.sessionId).emit('session-ended', {
            message: '📭 جلسه به پایان رسید',
            timestamp: new Date().toISOString()
          });
          
          // Cleanup
          sessionManager.disconnectFromHuman(data.sessionId);
        }
        break;
        
      default:
        console.log(`⚠️ Unknown event from Telegram bot: ${event}`);
    }
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint for sending messages from user to operator
app.post('/api/send-to-operator', async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    
    if (!sessionId || !message) {
      return res.status(400).json({ 
        success: false,
        error: 'شناسه جلسه و پیام الزامی است' 
      });
    }
    
    console.log(`📤 Send to operator: ${sessionId.substring(0, 8)}...`);
    
    // Get session
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.json({
        success: false,
        error: 'جلسه پیدا نشد'
      });
    }
    
    // Check if connected to human operator
    if (!session.connectedToHuman) {
      return res.json({
        success: false,
        error: 'هنوز به اپراتور متصل نیستید'
      });
    }
    
    // Add user message
    sessionManager.addMessage(sessionId, 'user', message);
    
    // Send to Telegram bot
    const telegramResult = await telegramService.sendToOperator(
      sessionId,
      message,
      session.userInfo
    );
    
    if (telegramResult.success) {
      res.json({
        success: true,
        message: 'پیام ارسال شد'
      });
    } else {
      res.json({
        success: false,
        error: telegramResult.error || 'خطا در ارسال پیام به اپراتور'
      });
    }
    
  } catch (error) {
    console.error('❌ Send to operator error:', error);
    res.json({
      success: false,
      error: 'خطا در ارسال پیام'
    });
  }
});

// Additional API endpoints
app.get('/api/sessions', (req, res) => {
  const activeSessions = sessionManager.getActiveSessions();
  
  const sessions = activeSessions.map(session => ({
    id: session.id,
    shortId: session.id.substring(0, 12),
    createdAt: session.createdAt,
    lastActivity: session.lastActivity,
    connectedToHuman: session.connectedToHuman,
    operatorChatId: session.operatorChatId,
    userInfo: session.userInfo,
    messageCount: session.messages.length,
    duration: Math.floor((new Date() - session.createdAt) / (1000 * 60)),
    status: session.status
  }));
  
  res.json({ 
    sessions,
    total: activeSessions.length,
    connected: activeSessions.filter(s => s.connectedToHuman).length,
    pending: activeSessions.filter(s => !s.connectedToHuman).length
  });
});

app.get('/api/stats', (req, res) => {
  res.json(sessionManager.getStats());
});

// Start server
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`
  ============================================
  🚀 AI Chatbot Server Started
  ============================================
  📍 Port: ${PORT}
  🌐 URL: http://localhost:${PORT}
  🤖 AI: ${GROQ_API_KEY ? '✅ Active' : '❌ Disabled'}
  📱 Telegram Bot: ${TELEGRAM_BOT_URL}
  ============================================
  `);
  
  // Check Telegram bot health
  setTimeout(async () => {
    try {
      const healthy = await telegramService.checkHealth();
      if (healthy) {
        console.log('✅ Telegram bot is healthy and ready');
      } else {
        console.log('⚠️ Telegram bot not responding. Make sure it\'s running on port 3001');
      }
    } catch (error) {
      console.error('❌ Health check failed:', error.message);
    }
  }, 3000);
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('🔥 Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 Unhandled Rejection at:', promise, 'reason:', reason);
});
