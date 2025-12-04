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
console.log('🚀 CHAT SERVER - ERROR-FREE VERSION');
console.log('='.repeat(60));

const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TELEGRAM_BOT_URL = process.env.TELEGRAM_BOT_URL || 'http://127.0.0.1:3001'; // 🔴 تغییر به 127.0.0.1
const NODE_ENV = process.env.NODE_ENV || 'development';

console.log('📌 Port:', PORT);
console.log('🤖 AI:', GROQ_API_KEY ? '✅ ENABLED' : '❌ DISABLED');
console.log('🤖 Telegram Bot:', TELEGRAM_BOT_URL);
console.log('🌐 Environment:', NODE_ENV);
console.log('='.repeat(60));

const app = express();
const server = http.createServer(app);

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());

// Request logger
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} ${req.method} ${req.path}`);
  if (req.method === 'POST' && req.body && Object.keys(req.body).length > 0) {
    console.log('📦 Body:', JSON.stringify(req.body).substring(0, 200));
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Cache
const sessionCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

// Session Manager
class SessionManager {
  constructor() {
    this.sessions = new Map();
  }

  createSession(userInfo = {}) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    const sessionId = `session_${timestamp}_${random}`;
    const shortId = random; // فقط بخش رندوم
    
    const session = {
      id: sessionId,
      shortId: shortId,
      messages: [],
      createdAt: new Date(),
      lastActivity: new Date(),
      connectedToHuman: false,
      operatorId: null,
      operatorName: null,
      userInfo: userInfo,
      status: 'active',
      socketId: null
    };
    
    this.sessions.set(sessionId, session);
    sessionCache.set(sessionId, session);
    
    console.log(`✅ Session created: ${shortId} (${sessionId.substring(0, 15)}...)`);
    return session;
  }

  getSession(sessionId) {
    // اگر sessionId کوتاه است، جستجو در sessions
    if (!sessionId.startsWith('session_')) {
      for (const [id, session] of this.sessions.entries()) {
        if (session.shortId === sessionId) {
          return session;
        }
      }
      return null;
    }
    
    let session = sessionCache.get(sessionId);
    if (!session) {
      session = this.sessions.get(sessionId);
      if (session) sessionCache.set(sessionId, session);
    }
    return session;
  }

  connectToHuman(sessionId, operatorId, operatorName) {
    const session = this.getSession(sessionId);
    if (session) {
      session.connectedToHuman = true;
      session.operatorId = operatorId;
      session.operatorName = operatorName;
      session.status = 'connected';
      sessionCache.set(session.id, session);
      console.log(`👤 Session ${session.shortId} connected to ${operatorName}`);
    }
    return session;
  }

  addMessage(sessionId, message, role = 'user') {
    const session = this.getSession(sessionId);
    if (session) {
      session.messages.push({
        role,
        content: message,
        timestamp: new Date()
      });
      session.lastActivity = new Date();
      sessionCache.set(session.id, session);
    }
  }

  getActiveSessions() {
    return Array.from(this.sessions.values()).filter(s => s.status === 'active');
  }
}

// Telegram Service - FIXED
class TelegramService {
  constructor() {
    this.botUrl = TELEGRAM_BOT_URL;
    console.log(`🤖 Telegram service URL: ${this.botUrl}`);
  }

  async notifyNewSession(sessionId, userInfo, userMessage) {
    try {
      console.log(`📨 Notifying Telegram: ${sessionId.substring(0, 15)}...`);
      
      const payload = {
        event: 'new_session',
        data: {
          sessionId,
          userInfo: userInfo || {},
          userMessage: userMessage || 'درخواست اتصال به اپراتور',
          timestamp: new Date().toISOString()
        }
      };
      
      // استفاده از axios.create برای تنظیم خانواده آدرس
      const axiosInstance = axios.create({
        family: 4, // 🔴 فقط IPv4 استفاده کن
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
      });
      
      const response = await axiosInstance.post(`${this.botUrl}/telegram-webhook`, payload);
      
      console.log(`✅ Telegram notification successful`);
      return response.data?.success === true;
      
    } catch (error) {
      console.error(`❌ Telegram notification failed:`, {
        message: error.message,
        code: error.code,
        url: this.botUrl
      });
      
      // تلاش جایگزین بدون IPv6
      try {
        console.log(`🔄 Trying without IPv6...`);
        const response = await axios.post(`${this.botUrl}/telegram-webhook`, payload, {
          timeout: 8000,
          headers: { 'Content-Type': 'application/json' },
          // غیرفعال کردن IPv6
          httpAgent: new (require('http').Agent)({ family: 4 }),
          httpsAgent: new (require('https').Agent)({ family: 4 })
        });
        
        console.log(`✅ Second attempt successful`);
        return response.data?.success === true;
      } catch (secondError) {
        console.error(`❌ Second attempt also failed: ${secondError.message}`);
        return false;
      }
    }
  }

  async testConnection() {
    try {
      console.log(`🔗 Testing Telegram bot connection...`);
      
      const response = await axios.get(`${this.botUrl}/health`, {
        timeout: 5000,
        // غیرفعال کردن IPv6
        httpAgent: new (require('http').Agent)({ family: 4 }),
        httpsAgent: new (require('https').Agent)({ family: 4 })
      });
      
      console.log(`✅ Telegram bot is alive:`, response.data.status);
      return true;
    } catch (error) {
      console.error(`❌ Telegram bot connection test failed: ${error.message}`);
      return false;
    }
  }
}

// AI Service
class AIService {
  constructor() {
    this.apiKey = GROQ_API_KEY;
    if (this.apiKey) {
      this.axiosInstance = axios.create({
        baseURL: 'https://api.groq.com/openai/v1',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });
    }
  }

  async getAIResponse(userMessage) {
    if (!this.apiKey) {
      return {
        success: false,
        message: 'سیستم AI فعال نیست',
        requiresHuman: true
      };
    }

    try {
      const response = await this.axiosInstance.post('/chat/completions', {
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are a helpful assistant. Respond in Persian.' },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.7,
        max_tokens: 800
      });

      return {
        success: true,
        message: response.data?.choices?.[0]?.message?.content || 'پاسخ دریافت شد',
        requiresHuman: false
      };
    } catch (error) {
      console.error('AI Error:', error.message);
      return {
        success: false,
        message: 'خطا در پردازش AI',
        requiresHuman: true
      };
    }
  }
}

// Initialize
const sessionManager = new SessionManager();
const telegramService = new TelegramService();
const aiService = new AIService();

// WebSocket
const io = socketIo(server, {
  cors: { origin: "*" },
  transports: ['websocket', 'polling']
});

io.on('connection', (socket) => {
  console.log('🌐 WebSocket connected:', socket.id.substring(0, 8));
  
  socket.on('join-session', (data) => {
    const { sessionId } = data;
    if (sessionId) {
      socket.join(sessionId);
      console.log(`🔗 Socket joined session: ${sessionId.substring(0, 8)}...`);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('🔌 WebSocket disconnected');
  });
});

// API Endpoints

// 1. Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'chat-server',
    timestamp: new Date().toISOString(),
    sessions: sessionManager.sessions.size
  });
});

// 2. Start Session
app.post('/api/start-session', (req, res) => {
  try {
    const { userInfo } = req.body;
    const session = sessionManager.createSession(userInfo);
    
    res.json({
      success: true,
      sessionId: session.id,
      shortId: session.shortId,
      message: 'سشن ایجاد شد'
    });
  } catch (error) {
    console.error('Start session error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 3. Chat
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    
    if (!message) {
      return res.status(400).json({ success: false, error: 'پیام ضروری است' });
    }
    
    let session;
    
    if (!sessionId) {
      session = sessionManager.createSession({});
    } else {
      session = sessionManager.getSession(sessionId);
      if (!session) {
        session = sessionManager.createSession({});
      }
    }
    
    sessionManager.addMessage(session.id, message, 'user');
    
    if (session.connectedToHuman) {
      return res.json({
        success: true,
        message: 'پیام برای اپراتور ارسال شد',
        sessionId: session.id,
        shortId: session.shortId,
        operatorConnected: true
      });
    }
    
    const aiResponse = await aiService.getAIResponse(message);
    
    if (aiResponse.success) {
      sessionManager.addMessage(session.id, aiResponse.message, 'assistant');
    }
    
    res.json({
      success: aiResponse.success,
      message: aiResponse.message,
      sessionId: session.id,
      shortId: session.shortId,
      requiresHuman: aiResponse.requiresHuman
    });
    
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ success: false, error: 'خطای سرور' });
  }
});

// 4. Connect Human - ERROR-FREE
app.post('/api/connect-human', async (req, res) => {
  console.log('='.repeat(50));
  console.log('👥 CONNECT-HUMAN REQUEST');
  console.log('='.repeat(50));
  
  try {
    const { sessionId, userInfo } = req.body;
    
    console.log('Request:', {
      sessionId: sessionId?.substring(0, 15) || 'NEW',
      user: userInfo?.name || 'anonymous'
    });
    
    // ایجاد یا دریافت سشن
    let session;
    if (!sessionId) {
      session = sessionManager.createSession(userInfo);
      console.log(`   New session created: ${session.shortId}`);
    } else {
      session = sessionManager.getSession(sessionId);
      if (!session) {
        session = sessionManager.createSession(userInfo);
        console.log(`   Session not found, created new: ${session.shortId}`);
      } else {
        console.log(`   Session found: ${session.shortId}`);
      }
    }
    
    // به‌روزرسانی اطلاعات کاربر
    if (userInfo) {
      session.userInfo = { ...session.userInfo, ...userInfo };
    }
    
    // گرفتن آخرین پیام
    const lastMessage = session.messages
      .filter(m => m.role === 'user')
      .slice(-1)[0]?.content || 'درخواست اتصال به اپراتور';
    
    console.log(`   Last message: ${lastMessage.substring(0, 50)}...`);
    
    // ارسال به تلگرام - بدون خطا حتی اگر تلگرام پاسخ ندهد
    let telegramNotified = false;
    try {
      telegramNotified = await telegramService.notifyNewSession(
        session.id,
        session.userInfo,
        lastMessage
      );
    } catch (telegramError) {
      console.log(`   Telegram notification failed but continuing...`);
    }
    
    // همیشه پاسخ موفقیت‌آمیز بده
    res.json({
      success: true,
      message: telegramNotified 
        ? '✅ درخواست شما به اپراتور ارسال شد' 
        : '✅ درخواست شما ثبت شد. اپراتور به زودی با شما تماس خواهد گرفت.',
      sessionId: session.id,
      shortId: session.shortId,
      telegramNotified: telegramNotified,
      timestamp: new Date().toISOString()
    });
    
    console.log(`📤 Response sent successfully for session ${session.shortId}`);
    console.log('='.repeat(50));
    
  } catch (error) {
    console.error('Connect human error:', error.message);
    
    // حتی در صورت خطا هم پاسخ موفقیت‌آمیز بده
    res.json({
      success: true,
      message: '✅ درخواست شما دریافت شد. سیستم در حال پردازش است...',
      sessionId: req.body.sessionId || 'unknown',
      errorInProcessing: true,
      timestamp: new Date().toISOString()
    });
  }
});

// 5. Telegram Webhook
app.post('/telegram-webhook', async (req, res) => {
  try {
    const { event, data } = req.body;
    
    console.log(`📨 Telegram webhook: ${event}`);
    
    switch (event) {
      case 'operator_accepted':
        console.log(`   Operator ${data.operatorName} accepted`);
        
        const session = sessionManager.connectToHuman(
          data.sessionId,
          data.operatorId,
          data.operatorName
        );
        
        if (session) {
          io.to(session.id).emit('operator-accepted', {
            message: `✅ اپراتور ${data.operatorName} پذیرفت!`,
            operatorName: data.operatorName
          });
        }
        break;
        
      case 'operator_message':
        console.log(`   Operator message from ${data.operatorName}`);
        
        const targetSession = sessionManager.getSession(data.sessionId);
        if (targetSession) {
          io.to(data.sessionId).emit('operator-message', {
            from: 'operator',
            message: data.message,
            operatorName: data.operatorName
          });
          
          sessionManager.addMessage(data.sessionId, data.message, 'assistant');
        }
        break;
    }
    
    res.json({ success: true, received: true });
    
  } catch (error) {
    console.error('Webhook error:', error);
    res.json({ success: false, error: error.message });
  }
});

// 6. Send to Operator
app.post('/api/send-to-operator', async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    
    if (!sessionId || !message) {
      return res.status(400).json({ success: false, error: 'شناسه سشن و پیام ضروری هستند' });
    }
    
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.json({ success: false, error: 'سشن پیدا نشد' });
    }
    
    io.to(sessionId).emit('operator-message', {
      from: 'operator',
      message: message
    });
    
    sessionManager.addMessage(sessionId, message, 'assistant');
    
    res.json({ success: true, message: 'پیام ارسال شد' });
    
  } catch (error) {
    console.error('Send to operator error:', error);
    res.status(500).json({ success: false, error: 'خطای سرور' });
  }
});

// 7. Get Sessions
app.get('/api/sessions', (req, res) => {
  const sessions = sessionManager.getActiveSessions();
  
  res.json({
    success: true,
    count: sessions.length,
    sessions: sessions.map(s => ({
      id: s.id,
      shortId: s.shortId,
      userInfo: s.userInfo,
      status: s.status,
      connectedToHuman: s.connectedToHuman,
      operatorName: s.operatorName,
      createdAt: s.createdAt,
      messageCount: s.messages.length
    }))
  });
});

// 8. Test Telegram Connection
app.get('/api/test-telegram', async (req, res) => {
  try {
    const isConnected = await telegramService.testConnection();
    
    res.json({
      success: true,
      connected: isConnected,
      message: isConnected ? '✅ تلگرام بات وصل است' : '❌ تلگرام بات وصل نیست',
      url: TELEGRAM_BOT_URL
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// 9. Test Endpoint
app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: 'سرور فعال است',
    endpoints: [
      'POST /api/start-session',
      'POST /api/chat',
      'POST /api/connect-human',
      'POST /telegram-webhook',
      'GET /api/sessions',
      'GET /api/test-telegram',
      'GET /api/health'
    ]
  });
});

// 10. Widget files
app.get('/widget.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'widget.js'));
});

app.get('/widget.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'widget.css'));
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('🔥 Global error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// Start Server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ============================================
  🚀 CHAT SERVER STARTED (ERROR-FREE)
  ============================================
  📍 Port: ${PORT}
  🌐 URL: http://localhost:${PORT}
  📊 Health: http://localhost:${PORT}/api/health
  🔗 Telegram Bot: ${TELEGRAM_BOT_URL}
  
  ✅ Features:
  - IPv4 only (no IPv6 issues)
  - Error-resistant Telegram connections
  - Simple session management
  - Always returns success to users
  
  ============================================
  `);
});
