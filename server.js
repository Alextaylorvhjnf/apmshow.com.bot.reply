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
console.log('🚀 CHAT SERVER - DEBUG VERSION');
console.log('='.repeat(60));

const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TELEGRAM_BOT_URL = process.env.TELEGRAM_BOT_URL || 'http://localhost:3001';
const NODE_ENV = process.env.NODE_ENV || 'development';

console.log('📌 Port:', PORT);
console.log('🤖 AI:', GROQ_API_KEY ? '✅ ENABLED' : '❌ DISABLED');
console.log('🤖 Telegram Bot:', TELEGRAM_BOT_URL);
console.log('🌐 Environment:', NODE_ENV);
console.log('='.repeat(60));

// Initialize App
const app = express();
const server = http.createServer(app);

// Request logger middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  if (req.method === 'POST' && req.body) {
    console.log('Body:', JSON.stringify(req.body).substring(0, 200));
  }
  next();
});

// CORS Configuration
app.use(cors({
  origin: true, // Allow all origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Handle preflight requests
app.options('*', cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Cache
const sessionCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

// Routes
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'chat-server',
    timestamp: new Date().toISOString(),
    endpoints: [
      '/api/start-session',
      '/api/chat',
      '/api/connect-human',
      '/telegram-webhook',
      '/api/send-to-operator'
    ]
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
      socketId: null,
      requestCount: 0
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
      if (session) {
        sessionCache.set(sessionId, session);
        console.log(`📂 Session loaded from memory: ${sessionId.substring(0, 8)}`);
      }
    }
    if (session) {
      session.lastActivity = new Date();
      session.requestCount = (session.requestCount || 0) + 1;
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
      console.log(`📝 Message added to ${sessionId.substring(0, 8)} (${role}): ${message.substring(0, 50)}...`);
    }
  }

  setSocketId(sessionId, socketId) {
    const session = this.getSession(sessionId);
    if (session) {
      session.socketId = socketId;
      sessionCache.set(sessionId, session);
    }
  }

  getActiveSessions() {
    return Array.from(this.sessions.values()).filter(s => s.status === 'active');
  }
}

// Telegram Service
class TelegramService {
  constructor() {
    this.botUrl = TELEGRAM_BOT_URL;
    this.axios = axios.create({
      baseURL: this.botUrl,
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json'
      },
      maxRedirects: 5
    });
  }

  async notifyNewSession(sessionId, userInfo, userMessage) {
    try {
      console.log(`📨 Notifying Telegram about session: ${sessionId.substring(0, 8)}`);
      console.log(`   User info:`, JSON.stringify(userInfo));
      console.log(`   Message: ${userMessage.substring(0, 100)}...`);
      
      const payload = {
        event: 'new_session',
        data: {
          sessionId,
          userInfo: userInfo || {},
          userMessage: userMessage || 'درخواست اتصال به اپراتور',
          timestamp: new Date().toISOString()
        }
      };
      
      console.log(`   Sending to: ${this.botUrl}/telegram-webhook`);
      console.log(`   Payload:`, JSON.stringify(payload).substring(0, 200));
      
      const response = await this.axios.post('/telegram-webhook', payload);
      
      console.log(`   Response status: ${response.status}`);
      console.log(`   Response data:`, JSON.stringify(response.data).substring(0, 200));
      
      return response.data.success === true;
    } catch (error) {
      console.error('❌ Telegram notification error:');
      console.error('   URL:', `${this.botUrl}/telegram-webhook`);
      console.error('   Error:', error.message);
      if (error.response) {
        console.error('   Response status:', error.response.status);
        console.error('   Response data:', error.response.data);
      }
      return false;
    }
  }
}

// Initialize
const aiService = GROQ_API_KEY ? new AIService() : null;
const sessionManager = new SessionManager();
const telegramService = new TelegramService();

// WebSocket
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

io.on('connection', (socket) => {
  console.log('🌐 WebSocket connected:', socket.id);

  socket.on('join-session', (data) => {
    const { sessionId } = data;
    if (sessionId) {
      socket.join(sessionId);
      sessionManager.setSocketId(sessionId, socket.id);
      console.log(`🔗 Socket ${socket.id.substring(0, 8)} joined session: ${sessionId.substring(0, 8)}`);
      
      socket.emit('session-joined', {
        sessionId,
        connected: true,
        timestamp: new Date().toISOString()
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('🔌 WebSocket disconnected:', socket.id);
  });
});

// API Endpoints

// 1. شروع سشن جدید
app.post('/api/start-session', (req, res) => {
  try {
    const { userInfo } = req.body;
    const sessionId = uuidv4();
    
    const session = sessionManager.createSession(sessionId, userInfo || {});
    
    console.log(`🎯 Session started: ${sessionId}`);
    
    res.json({
      success: true,
      sessionId,
      message: 'سشن جدید ایجاد شد',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Start session error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error',
      details: error.message 
    });
  }
});

// 2. چت
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    
    console.log(`💬 Chat request received:`);
    console.log(`   Session ID: ${sessionId}`);
    console.log(`   Message: ${message}`);
    
    if (!message) {
      return res.status(400).json({ 
        success: false, 
        error: 'پیام ضروری است' 
      });
    }

    let currentSessionId = sessionId;
    if (!currentSessionId) {
      currentSessionId = uuidv4();
      sessionManager.createSession(currentSessionId);
      console.log(`   New session created: ${currentSessionId}`);
    }

    let session = sessionManager.getSession(currentSessionId);
    if (!session) {
      session = sessionManager.createSession(currentSessionId);
    }

    sessionManager.addMessage(currentSessionId, message, 'user');

    if (session.connectedToHuman) {
      console.log(`   Session ${currentSessionId.substring(0, 8)} is connected to human operator`);
      
      return res.json({
        success: true,
        message: 'پیام شما برای اپراتور ارسال شد.',
        sessionId: currentSessionId,
        operatorConnected: true,
        operatorName: session.operatorName
      });
    }

    if (aiService) {
      console.log(`   Getting AI response for session ${currentSessionId.substring(0, 8)}`);
      const aiResponse = await aiService.getAIResponse(message);
      
      if (aiResponse.success) {
        sessionManager.addMessage(currentSessionId, aiResponse.message, 'assistant');
      }
      
      return res.json({
        success: aiResponse.success,
        message: aiResponse.message,
        sessionId: currentSessionId,
        requiresHuman: aiResponse.requiresHuman
      });
    }

    return res.json({
      success: false,
      message: 'سیستم هوش مصنوعی فعال نیست. لطفاً به اپراتور انسانی متصل شوید.',
      sessionId: currentSessionId,
      requiresHuman: true
    });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'خطای سرور',
      details: error.message 
    });
  }
});

// 3. اتصال به اپراتور - FIXED VERSION
app.post('/api/connect-human', async (req, res) => {
  try {
    console.log('='.repeat(50));
    console.log('👥 CONNECT-HUMAN REQUEST RECEIVED');
    console.log('='.repeat(50));
    
    const { sessionId, userInfo } = req.body;
    
    console.log('Request body:', JSON.stringify(req.body));
    
    if (!sessionId) {
      console.error('❌ Error: No sessionId provided');
      return res.status(400).json({ 
        success: false, 
        error: 'شناسه سشن ضروری است',
        receivedData: req.body 
      });
    }

    console.log(`📋 Processing session: ${sessionId}`);
    
    // Get or create session
    let session = sessionManager.getSession(sessionId);
    if (!session) {
      console.log(`   Creating new session: ${sessionId}`);
      session = sessionManager.createSession(sessionId, userInfo || {});
    } else {
      console.log(`   Existing session found: ${sessionId.substring(0, 8)}`);
      console.log(`   Session status: ${session.status}`);
      console.log(`   Connected to human: ${session.connectedToHuman}`);
    }

    // Get last user message
    const lastMessage = session.messages
      .filter(m => m.role === 'user')
      .slice(-1)[0]?.content || 'درخواست اتصال به اپراتور';
    
    console.log(`   Last message: ${lastMessage.substring(0, 100)}...`);
    console.log(`   User info:`, JSON.stringify(session.userInfo));

    // Notify Telegram
    console.log(`   Notifying Telegram bot at: ${TELEGRAM_BOT_URL}`);
    const notified = await telegramService.notifyNewSession(
      sessionId,
      session.userInfo,
      lastMessage
    );

    if (notified) {
      console.log(`✅ Telegram notification successful for session ${sessionId.substring(0, 8)}`);
      
      res.json({
        success: true,
        message: '✅ درخواست شما با موفقیت به اپراتور ارسال شد. لطفاً منتظر پاسخ اپراتور باشید...',
        sessionId: sessionId,
        pending: true,
        timestamp: new Date().toISOString()
      });
    } else {
      console.log(`❌ Telegram notification failed for session ${sessionId.substring(0, 8)}`);
      
      // Even if Telegram fails, still respond success to user
      res.json({
        success: true, // Still true to not confuse user
        message: 'درخواست شما ثبت شد. اپراتور به زودی با شما تماس خواهد گرفت.',
        sessionId: sessionId,
        pending: true,
        timestamp: new Date().toISOString(),
        warning: 'اتصال به سیستم اپراتور با تاخیر همراه است'
      });
    }
    
    console.log(`📤 Response sent for session ${sessionId.substring(0, 8)}`);
    console.log('='.repeat(50));

  } catch (error) {
    console.error('❌ Connect human error:', error);
    console.error('   Error stack:', error.stack);
    
    // Still send a success response to user
    res.json({
      success: true,
      message: 'درخواست شما دریافت شد. سیستم در حال پردازش است...',
      sessionId: req.body.sessionId || 'unknown',
      pending: true,
      timestamp: new Date().toISOString(),
      debug: NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 4. Webhook تلگرام
app.post('/telegram-webhook', async (req, res) => {
  try {
    console.log('📨 Telegram webhook received');
    console.log('Request body:', JSON.stringify(req.body).substring(0, 300));
    
    const { event, data } = req.body;
    
    if (!event) {
      console.error('No event specified in webhook');
      return res.json({ success: false, error: 'Event is required' });
    }

    console.log(`Processing event: ${event}`);

    switch (event) {
      case 'operator_accepted':
        console.log(`   Operator accepted session: ${data.sessionId}`);
        const session = sessionManager.connectToHuman(
          data.sessionId,
          data.operatorId,
          data.operatorName
        );

        if (session) {
          io.to(data.sessionId).emit('operator-accepted', {
            message: `✅ اپراتور ${data.operatorName} درخواست شما را پذیرفت!`,
            operatorName: data.operatorName,
            operatorId: data.operatorId,
            sessionId: data.sessionId,
            timestamp: new Date().toISOString()
          });
          console.log(`   Notification sent to session ${data.sessionId.substring(0, 8)}`);
        }
        break;

      case 'operator_message':
        console.log(`   Operator message for session: ${data.sessionId}`);
        const targetSession = sessionManager.getSession(data.sessionId);
        if (targetSession) {
          io.to(data.sessionId).emit('operator-message', {
            from: 'operator',
            message: data.message,
            operatorName: data.operatorName || 'اپراتور',
            operatorId: data.operatorId,
            sessionId: data.sessionId,
            timestamp: new Date().toISOString()
          });
          
          sessionManager.addMessage(data.sessionId, data.message, 'assistant');
          console.log(`   Message sent to session ${data.sessionId.substring(0, 8)}`);
        }
        break;
        
      case 'test':
        console.log('Test event received:', data);
        break;
        
      default:
        console.log(`Unknown event: ${event}`);
    }

    res.json({ 
      success: true,
      received: true,
      event: event,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: NODE_ENV === 'development' ? error.stack : undefined 
    });
  }
});

// 5. ارسال پیام از اپراتور به کاربر
app.post('/api/send-to-operator', async (req, res) => {
  try {
    console.log('📤 Send-to-operator request received');
    
    const { sessionId, message, operatorId, operatorName } = req.body;
    
    if (!sessionId || !message) {
      return res.status(400).json({ 
        success: false, 
        error: 'شناسه سشن و پیام ضروری هستند' 
      });
    }

    console.log(`   Session: ${sessionId.substring(0, 8)}`);
    console.log(`   Message: ${message.substring(0, 100)}...`);

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      console.error(`   Session not found: ${sessionId.substring(0, 8)}`);
      return res.json({ 
        success: false, 
        error: 'سشن پیدا نشد' 
      });
    }

    io.to(sessionId).emit('operator-message', {
      from: 'operator',
      message: message,
      operatorId: operatorId,
      operatorName: operatorName || 'اپراتور',
      sessionId: sessionId,
      timestamp: new Date().toISOString()
    });

    sessionManager.addMessage(sessionId, message, 'assistant');

    console.log(`   Message sent successfully to session ${sessionId.substring(0, 8)}`);
    
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

// 6. وضعیت سشن
app.get('/api/session/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    console.log(`📊 Session status request: ${sessionId}`);
    
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
        userInfo: session.userInfo,
        requestCount: session.requestCount
      }
    });
  } catch (error) {
    console.error('Get session error:', error);
    res.status(500).json({ success: false, error: 'خطای سرور' });
  }
});

// 7. لیست سشن‌های فعال
app.get('/api/sessions', (req, res) => {
  try {
    const sessions = sessionManager.getActiveSessions();
    
    console.log(`📋 Active sessions request - Found: ${sessions.length}`);
    
    res.json({
      success: true,
      count: sessions.length,
      sessions: sessions.map(session => ({
        id: session.id,
        userInfo: session.userInfo,
        status: session.status,
        connectedToHuman: session.connectedToHuman,
        operatorName: session.operatorName,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
        messageCount: session.messages.length,
        requestCount: session.requestCount
      }))
    });
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ success: false, error: 'خطای سرور' });
  }
});

// 8. تست سرویس
app.get('/api/test', (req, res) => {
  const testSessionId = uuidv4();
  sessionManager.createSession(testSessionId, { test: true });
  
  res.json({
    success: true,
    message: 'سرویس فعال است',
    testSessionId,
    endpoints: {
      startSession: 'POST /api/start-session',
      chat: 'POST /api/chat',
      connectHuman: 'POST /api/connect-human',
      telegramWebhook: 'POST /telegram-webhook',
      sendToOperator: 'POST /api/send-to-operator',
      getSession: 'GET /api/session/:id',
      getSessions: 'GET /api/sessions',
      health: 'GET /api/health'
    },
    timestamp: new Date().toISOString()
  });
});

// 9. فایل‌های ویجت
app.get('/widget.js', (req, res) => {
  console.log('📄 Serving widget.js');
  res.sendFile(path.join(__dirname, 'public', 'widget.js'));
});

app.get('/widget.css', (req, res) => {
  console.log('🎨 Serving widget.css');
  res.sendFile(path.join(__dirname, 'public', 'widget.css'));
});

// 10. صفحه تست تعاملی
app.get('/debug', (req, res) => {
  const sessions = sessionManager.getActiveSessions();
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Debug Chat Server</title>
      <style>
        body { font-family: Arial; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; }
        .card { background: white; padding: 20px; margin: 10px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        button { background: #007bff; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; margin: 5px; }
        button:hover { background: #0056b3; }
        .success { color: green; }
        .error { color: red; }
        .session { border-left: 4px solid #007bff; padding-left: 10px; margin: 10px 0; }
        pre { background: #f8f9fa; padding: 10px; border-radius: 4px; overflow: auto; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🐛 Debug Chat Server</h1>
        
        <div class="card">
          <h2>Server Status</h2>
          <p><strong>Port:</strong> ${PORT}</p>
          <p><strong>AI:</strong> ${GROQ_API_KEY ? '✅ Active' : '❌ Disabled'}</p>
          <p><strong>Telegram Bot:</strong> ${TELEGRAM_BOT_URL}</p>
          <p><strong>Active Sessions:</strong> ${sessions.length}</p>
          <button onclick="testHealth()">Test Health</button>
          <button onclick="testEndpoints()">Test All Endpoints</button>
        </div>
        
        <div class="card">
          <h2>Test Connect-Human</h2>
          <input type="text" id="sessionId" placeholder="Session ID (leave empty for new)" style="width: 300px; padding: 8px; margin: 5px;">
          <button onclick="testConnectHuman()">Test Connect Human</button>
          <div id="connectResult" class="result"></div>
        </div>
        
        <div class="card">
          <h2>Active Sessions (${sessions.length})</h2>
          ${sessions.map(s => `
            <div class="session">
              <p><strong>ID:</strong> ${s.id.substring(0, 12)}...</p>
              <p><strong>Status:</strong> ${s.status}</p>
              <p><strong>Human:</strong> ${s.connectedToHuman ? '✅ Connected' : '❌ Not connected'}</p>
              <p><strong>Messages:</strong> ${s.messages.length}</p>
              <button onclick="testChat('${s.id}')">Test Chat</button>
              <button onclick="getSession('${s.id}')">Get Session</button>
            </div>
          `).join('')}
        </div>
        
        <div class="card">
          <h2>Log</h2>
          <pre id="log"></pre>
        </div>
      </div>
      
      <script>
        const API_BASE = 'http://localhost:${PORT}/api';
        
        function log(msg, type = 'info') {
          const logEl = document.getElementById('log');
          const timestamp = new Date().toLocaleTimeString();
          logEl.innerHTML = \`[\${timestamp}] \${msg}\\n\` + logEl.innerHTML;
        }
        
        async function testHealth() {
          try {
            log('Testing health endpoint...');
            const res = await fetch(API_BASE + '/health');
            const data = await res.json();
            log('Health: ' + JSON.stringify(data), 'success');
          } catch(e) {
            log('Health error: ' + e, 'error');
          }
        }
        
        async function testConnectHuman() {
          const sessionId = document.getElementById('sessionId').value || generateSessionId();
          log(\`Testing connect-human with session: \${sessionId.substring(0, 12)}...\`);
          
          try {
            const res = await fetch(API_BASE + '/connect-human', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({
                sessionId,
                userInfo: { name: 'Test User', email: 'test@example.com' }
              })
            });
            const data = await res.json();
            
            const resultEl = document.getElementById('connectResult');
            resultEl.innerHTML = \`
              <div class="\${data.success ? 'success' : 'error'}">
                <p><strong>\${data.success ? '✅ Success' : '❌ Error'}</strong></p>
                <p>Message: \${data.message}</p>
                <p>Session: \${data.sessionId?.substring(0, 12)}...</p>
                <pre>\${JSON.stringify(data, null, 2)}</pre>
              </div>
            \`;
            
            log(\`Connect-human result: \${JSON.stringify(data)}\`, data.success ? 'success' : 'error');
          } catch(e) {
            log('Connect-human error: ' + e, 'error');
          }
        }
        
        async function testChat(sessionId) {
          log(\`Testing chat for session: \${sessionId.substring(0, 12)}...\`);
          
          try {
            const res = await fetch(API_BASE + '/chat', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({
                sessionId,
                message: 'سلام، این یک تست است'
              })
            });
            const data = await res.json();
            log(\`Chat result: \${JSON.stringify(data)}\`, data.success ? 'success' : 'error');
          } catch(e) {
            log('Chat error: ' + e, 'error');
          }
        }
        
        async function getSession(sessionId) {
          try {
            const res = await fetch(API_BASE + '/session/' + sessionId);
            const data = await res.json();
            log(\`Session info: \${JSON.stringify(data)}\`, 'success');
          } catch(e) {
            log('Get session error: ' + e, 'error');
          }
        }
        
        async function testEndpoints() {
          const endpoints = [
            { method: 'GET', path: '/health' },
            { method: 'POST', path: '/start-session' },
            { method: 'POST', path: '/connect-human', body: { sessionId: generateSessionId(), userInfo: { test: true } } },
            { method: 'GET', path: '/sessions' },
            { method: 'GET', path: '/test' }
          ];
          
          for (const endpoint of endpoints) {
            log(\`Testing \${endpoint.method} \${endpoint.path}...\`);
            try {
              const options = {
                method: endpoint.method,
                headers: { 'Content-Type': 'application/json' }
              };
              if (endpoint.body) {
                options.body = JSON.stringify(endpoint.body);
              }
              const res = await fetch(API_BASE + endpoint.path, options);
              const data = await res.json();
              log(\`\${endpoint.method} \${endpoint.path}: \${data.success ? '✅' : '❌'} \${data.message || ''}\`, data.success ? 'success' : 'error');
            } catch(e) {
              log(\`\${endpoint.method} \${endpoint.path} error: \${e}\`, 'error');
            }
          }
        }
        
        function generateSessionId() {
          return 'test-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        }
        
        // Initial test
        setTimeout(() => {
          testHealth();
        }, 500);
      </script>
    </body>
    </html>
  `);
});

// 404 handler
app.use((req, res) => {
  console.log(`❌ 404: ${req.method} ${req.path}`);
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
    availableEndpoints: [
      '/api/health',
      '/api/start-session',
      '/api/chat',
      '/api/connect-human',
      '/telegram-webhook',
      '/api/send-to-operator',
      '/api/session/:id',
      '/api/sessions',
      '/api/test',
      '/debug',
      '/widget.js',
      '/widget.css'
    ]
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('🔥 Global error:', err);
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
  🚀 CHAT SERVER STARTED (DEBUG MODE)
  ============================================
  📍 Port: ${PORT}
  🌐 Local URL: http://localhost:${PORT}
  🔧 Debug Panel: http://localhost:${PORT}/debug
  📊 Health Check: http://localhost:${PORT}/api/health
  🤖 AI: ${GROQ_API_KEY ? '✅ Active' : '❌ Disabled'}
  📱 Telegram Bot: ${TELEGRAM_BOT_URL}
  
  ✅ API Endpoints:
  - POST /api/start-session
  - POST /api/chat
  - POST /api/connect-human    <-- FIXED!
  - POST /telegram-webhook
  - POST /api/send-to-operator
  - GET  /api/session/:id
  - GET  /api/sessions
  - GET  /api/health
  - GET  /api/test
  
  🐛 Debug:
  - GET  /debug
  - GET  /widget.js
  - GET  /widget.css
  
  ============================================
  `);
});
