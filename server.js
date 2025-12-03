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
console.log('🚀 CHAT SERVER - CLEAN VERSION');
console.log('='.repeat(60));

const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TELEGRAM_BOT_URL = process.env.TELEGRAM_BOT_URL || 'http://localhost:3001';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

console.log('📌 Port:', PORT);
console.log('🤖 AI:', GROQ_API_KEY ? '✅ ENABLED' : '❌ DISABLED');
console.log('🤖 Telegram Bot:', TELEGRAM_BOT_URL);
console.log('🌐 Client URL:', CLIENT_URL);
console.log('='.repeat(60));

// Initialize App
const app = express();
const server = http.createServer(app);

// CORS Configuration - مهم!
const corsOptions = {
  origin: function (origin, callback) {
    // Allow all origins for development
    if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
};

// CORS برای WebSocket
const io = socketIo(server, {
  cors: {
    origin: "*", // اجازه همه برای تست
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

// Middleware - CORS باید اول باشد
app.use(cors({
  origin: "*", // اجازه همه برای تست
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS']
}));

// Handle preflight requests
app.options('*', cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Cache
const sessionCache = new NodeCache({ stdTTL: 3600 });

// Routes
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'chat-server',
    timestamp: new Date().toISOString()
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
    
    this.systemPrompt = `You are a helpful assistant. Respond in Persian.`;
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
        return {
          success: true,
          message: response.data.choices[0].message.content,
          requiresHuman: false
        };
      }
      throw new Error('Invalid AI response');
    } catch (error) {
      console.error('AI Error:', error.message);
      return {
        success: false,
        message: 'خطا در پردازش',
        requiresHuman: true
      };
    }
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
      operatorName: null,
      userInfo: userInfo,
      status: 'active',
      socketId: null
    };
    
    this.sessions.set(sessionId, session);
    sessionCache.set(sessionId, session);
    console.log(`✅ Session created: ${sessionId.substring(0, 8)}`);
    return session;
  }

  getSession(sessionId) {
    let session = sessionCache.get(sessionId);
    if (!session) {
      session = this.sessions.get(sessionId);
      if (session) sessionCache.set(sessionId, session);
    }
    if (session) {
      session.lastActivity = new Date();
      sessionCache.set(sessionId, session);
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
      sessionCache.set(sessionId, session);
      console.log(`👤 Session ${sessionId.substring(0, 8)} connected to ${operatorName}`);
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
      sessionCache.set(sessionId, session);
    }
  }

  setSocketId(sessionId, socketId) {
    const session = this.getSession(sessionId);
    if (session) {
      session.socketId = socketId;
      sessionCache.set(sessionId, session);
    }
  }
}

// Telegram Service
class TelegramService {
  constructor() {
    this.botUrl = TELEGRAM_BOT_URL;
    this.axios = axios.create({
      baseURL: this.botUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  async notifyNewSession(sessionId, userInfo, userMessage) {
    try {
      console.log(`📨 Notifying Telegram about session: ${sessionId.substring(0, 8)}`);
      
      const response = await this.axios.post('/telegram-webhook', {
        event: 'new_session',
        data: {
          sessionId,
          userInfo,
          userMessage: userMessage.substring(0, 200)
        }
      });
      
      return response.data.success === true;
    } catch (error) {
      console.error('Telegram notification error:', error.message);
      return false;
    }
  }

  async sendMessageToTelegram(chatId, message) {
    try {
      const response = await this.axios.post('/telegram-webhook', {
        event: 'send_message',
        data: {
          chatId,
          message
        }
      });
      return response.data.success === true;
    } catch (error) {
      console.error('Telegram send message error:', error.message);
      return false;
    }
  }
}

// Initialize
const aiService = GROQ_API_KEY ? new AIService() : null;
const sessionManager = new SessionManager();
const telegramService = new TelegramService();

// WebSocket Connection
io.on('connection', (socket) => {
  console.log('🌐 WebSocket connected:', socket.id);

  socket.on('join-session', (data) => {
    const { sessionId } = data;
    if (sessionId) {
      socket.join(sessionId);
      sessionManager.setSocketId(sessionId, socket.id);
      console.log(`🔗 Socket ${socket.id.substring(0, 8)} joined session: ${sessionId.substring(0, 8)}`);
      
      // تایید اتصال به کلاینت
      socket.emit('session-joined', {
        sessionId,
        connected: true,
        timestamp: new Date().toISOString()
      });
    }
  });

  socket.on('user-message', (data) => {
    const { sessionId, message } = data;
    if (sessionId && message) {
      console.log(`💬 Socket message for ${sessionId.substring(0, 8)}: ${message.substring(0, 50)}...`);
      
      // ارسال پیام به سایر اعضای اتاق
      socket.to(sessionId).emit('new-message', {
        from: 'user',
        message,
        sessionId,
        timestamp: new Date().toISOString()
      });
    }
  });

  socket.on('disconnect', (reason) => {
    console.log('🔌 WebSocket disconnected:', socket.id, 'Reason:', reason);
  });
});

// API Endpoints

// 1. شروع سشن جدید
app.post('/api/start-session', (req, res) => {
  try {
    const { userInfo } = req.body;
    const sessionId = uuidv4();
    
    const session = sessionManager.createSession(sessionId, userInfo);
    
    res.json({
      success: true,
      sessionId,
      message: 'سشن ایجاد شد',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Start session error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 2. چت با AI (اصلی)
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    
    if (!message) {
      return res.status(400).json({ 
        success: false, 
        error: 'پیام ضروری است' 
      });
    }

    // اگر sessionId نداشت، یک session جدید بساز
    let currentSessionId = sessionId;
    if (!currentSessionId) {
      currentSessionId = uuidv4();
      sessionManager.createSession(currentSessionId);
    }

    console.log(`💬 Chat request: ${currentSessionId.substring(0, 8)}`);

    let session = sessionManager.getSession(currentSessionId);
    if (!session) {
      session = sessionManager.createSession(currentSessionId);
    }

    // ذخیره پیام کاربر
    sessionManager.addMessage(currentSessionId, message, 'user');

    // اگر به اپراتور متصل است
    if (session.connectedToHuman && session.operatorId) {
      // ارسال پیام به اپراتور از طریق تلگرام
      await telegramService.sendMessageToTelegram(
        session.operatorId,
        `👤 کاربر (${currentSessionId.substring(0, 8)}): ${message}`
      );
      
      return res.json({
        success: true,
        message: 'پیام شما برای اپراتور ارسال شد.',
        sessionId: currentSessionId,
        operatorConnected: true,
        operatorName: session.operatorName,
        requiresHuman: false
      });
    }

    // پاسخ AI
    if (aiService) {
      const aiResponse = await aiService.getAIResponse(message);
      
      // ذخیره پاسخ AI
      if (aiResponse.success) {
        sessionManager.addMessage(currentSessionId, aiResponse.message, 'assistant');
      }
      
      return res.json({
        success: aiResponse.success,
        message: aiResponse.message,
        sessionId: currentSessionId,
        requiresHuman: aiResponse.requiresHuman,
        operatorConnected: false
      });
    }

    // اگر AI فعال نیست
    return res.json({
      success: false,
      message: 'سیستم هوش مصنوعی فعال نیست. لطفاً به اپراتور انسانی متصل شوید.',
      sessionId: currentSessionId,
      requiresHuman: true,
      operatorConnected: false
    });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'خطای سرور',
      message: error.message 
    });
  }
});

// 3. درخواست اتصال به اپراتور (مهم!)
app.post('/api/connect-human', async (req, res) => {
  try {
    const { sessionId, userInfo } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ 
        success: false, 
        error: 'شناسه سشن ضروری است' 
      });
    }

    console.log(`👤 Connect human request: ${sessionId.substring(0, 8)}`);

    let session = sessionManager.getSession(sessionId);
    if (!session) {
      session = sessionManager.createSession(sessionId, userInfo || {});
    }

    const lastMessage = session.messages
      .filter(m => m.role === 'user')
      .slice(-1)[0]?.content || 'درخواست اتصال به اپراتور';

    // اطلاع به تلگرام
    const notified = await telegramService.notifyNewSession(
      sessionId,
      session.userInfo,
      lastMessage
    );

    if (notified) {
      res.json({
        success: true,
        message: '✅ درخواست شما به اپراتور ارسال شد. لطفاً منتظر بمانید...',
        sessionId,
        pending: true
      });
    } else {
      res.json({
        success: false,
        error: 'خطا در ارسال درخواست به اپراتور',
        sessionId
      });
    }

  } catch (error) {
    console.error('Connect human error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'خطای اتصال',
      message: error.message 
    });
  }
});

// 4. Webhook تلگرام (برای پاسخ اپراتور)
app.post('/telegram-webhook', async (req, res) => {
  try {
    console.log('📨 Telegram webhook received');
    
    const { event, data } = req.body;
    console.log(`Event: ${event}`);

    switch (event) {
      case 'operator_accepted':
        const session = sessionManager.connectToHuman(
          data.sessionId,
          data.operatorId,
          data.operatorName
        );

        if (session) {
          // اطلاع به کاربر از طریق WebSocket
          io.to(data.sessionId).emit('operator-accepted', {
            message: `✅ اپراتور ${data.operatorName} درخواست شما را پذیرفت!`,
            operatorName: data.operatorName,
            operatorId: data.operatorId,
            sessionId: data.sessionId,
            timestamp: new Date().toISOString()
          });
        }
        break;

      case 'operator_message':
        const targetSession = sessionManager.getSession(data.sessionId);
        if (targetSession) {
          // ارسال پیام اپراتور به کاربر
          io.to(data.sessionId).emit('operator-message', {
            from: 'operator',
            message: data.message,
            operatorName: data.operatorName || 'اپراتور',
            operatorId: data.operatorId,
            sessionId: data.sessionId,
            timestamp: new Date().toISOString()
          });
          
          // ذخیره پیام اپراتور
          sessionManager.addMessage(data.sessionId, data.message, 'assistant');
        }
        break;
        
      case 'test':
        console.log('Test event received:', data);
        break;
    }

    res.json({ 
      success: true,
      received: true,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 5. ارسال پیام از اپراتور به کاربر
app.post('/api/send-to-operator', async (req, res) => {
  try {
    const { sessionId, message, operatorId, operatorName } = req.body;
    
    if (!sessionId || !message) {
      return res.status(400).json({ 
        success: false, 
        error: 'شناسه سشن و پیام ضروری هستند' 
      });
    }

    console.log(`📤 Send to operator: ${sessionId.substring(0, 8)}`);

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.json({ 
        success: false, 
        error: 'سشن پیدا نشد' 
      });
    }

    // ارسال پیام به کاربر از طریق WebSocket
    io.to(sessionId).emit('operator-message', {
      from: 'operator',
      message: message,
      operatorId: operatorId,
      operatorName: operatorName || 'اپراتور',
      sessionId: sessionId,
      timestamp: new Date().toISOString()
    });

    // ذخیره پیام اپراتور
    sessionManager.addMessage(sessionId, message, 'assistant');

    res.json({
      success: true,
      message: 'پیام با موفقیت ارسال شد',
      sessionId
    });

  } catch (error) {
    console.error('Send to operator error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'خطای سرور' 
    });
  }
});

// 6. دریافت اطلاعات سشن
app.get('/api/session/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.getSession(sessionId);
    
    if (!session) {
      return res.status(404).json({ 
        success: false, 
        error: 'سشن پیدا نشد' 
      });
    }

    res.json({
      success: true,
      session: {
        id: session.id,
        status: session.status,
        connectedToHuman: session.connectedToHuman,
        operatorName: session.operatorName,
        operatorId: session.operatorId,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
        messageCount: session.messages.length,
        userInfo: session.userInfo
      }
    });
  } catch (error) {
    console.error('Get session error:', error);
    res.status(500).json({ success: false, error: 'خطای سرور' });
  }
});

// 7. لیست سشن‌های فعال
app.get('/api/sessions/active', (req, res) => {
  try {
    const sessions = Array.from(sessionManager.sessions.values())
      .filter(session => session.status === 'active')
      .map(session => ({
        id: session.id,
        userInfo: session.userInfo,
        status: session.status,
        connectedToHuman: session.connectedToHuman,
        operatorName: session.operatorName,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
        messageCount: session.messages.length
      }));

    res.json({
      success: true,
      count: sessions.length,
      sessions
    });
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ success: false, error: 'خطای سرور' });
  }
});

// 8. تست WebSocket
app.get('/api/test-ws/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    
    io.to(sessionId).emit('test-message', {
      message: 'اتصال WebSocket فعال است!',
      timestamp: new Date().toISOString(),
      sessionId
    });

    res.json({
      success: true,
      message: 'پیام تست ارسال شد'
    });
  } catch (error) {
    console.error('Test WS error:', error);
    res.json({ success: false, error: error.message });
  }
});

// 9. دریافت فایل‌های استاتیک ویجت
app.get('/widget.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'widget.js'));
});

app.get('/widget.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'widget.css'));
});

// 10. صفحه تست
app.get('/test', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Test Chat Server</title>
      <style>
        body { font-family: Arial; padding: 20px; }
        button { margin: 5px; padding: 10px; }
        #log { background: #f5f5f5; padding: 10px; margin-top: 20px; }
      </style>
    </head>
    <body>
      <h1>Test Chat Server</h1>
      <button onclick="testHealth()">Test Health</button>
      <button onclick="testStartSession()">Start Session</button>
      <button onclick="testChat()">Test Chat</button>
      <button onclick="testConnectHuman()">Connect Human</button>
      <div id="log"></div>
      <script>
        const API_BASE = 'http://localhost:${PORT}/api';
        let sessionId = null;
        
        function log(msg) {
          document.getElementById('log').innerHTML += msg + '<br>';
        }
        
        async function testHealth() {
          try {
            const res = await fetch(API_BASE + '/health');
            const data = await res.json();
            log('Health: ' + JSON.stringify(data));
          } catch(e) {
            log('Error: ' + e);
          }
        }
        
        async function testStartSession() {
          try {
            const res = await fetch(API_BASE + '/start-session', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({userInfo: {name: 'Test User'}})
            });
            const data = await res.json();
            sessionId = data.sessionId;
            log('Session started: ' + sessionId);
          } catch(e) {
            log('Error: ' + e);
          }
        }
        
        async function testChat() {
          if (!sessionId) {
            log('First start a session');
            return;
          }
          try {
            const res = await fetch(API_BASE + '/chat', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({
                sessionId,
                message: 'سلام تست'
              })
            });
            const data = await res.json();
            log('Chat response: ' + JSON.stringify(data));
          } catch(e) {
            log('Error: ' + e);
          }
        }
        
        async function testConnectHuman() {
          if (!sessionId) {
            log('First start a session');
            return;
          }
          try {
            const res = await fetch(API_BASE + '/connect-human', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({sessionId})
            });
            const data = await res.json();
            log('Connect human: ' + JSON.stringify(data));
          } catch(e) {
            log('Error: ' + e);
          }
        }
      </script>
    </body>
    </html>
  `);
});

// 404 handler
app.use((req, res) => {
  console.log(`404: ${req.method} ${req.path}`);
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: err.message,
    timestamp: new Date().toISOString()
  });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ============================================
  🚀 CHAT SERVER STARTED (FIXED CONNECTION)
  ============================================
  📍 Port: ${PORT}
  🌐 URL: http://localhost:${PORT}
  🤖 AI: ${GROQ_API_KEY ? '✅ Active' : '❌ Disabled'}
  📱 Telegram Bot: ${TELEGRAM_BOT_URL}
  
  ✅ Available Endpoints:
  - GET  /api/health
  - POST /api/start-session
  - POST /api/chat
  - POST /api/connect-human
  - POST /telegram-webhook
  - POST /api/send-to-operator
  - GET  /api/session/:id
  - GET  /api/sessions/active
  - GET  /test (Test page)
  - GET  /widget.js
  - GET  /widget.css
  
  ============================================
  `);
  
  // Test endpoints
  console.log('\n🔍 Testing endpoints...');
  console.log(`Health: http://localhost:${PORT}/api/health`);
  console.log(`Test Page: http://localhost:${PORT}/test`);
});
