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
console.log('🚀 AI CHATBOT WITH SIMULATED TELEGRAM SUPPORT');
console.log('='.repeat(60));

const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

console.log('📌 Port:', PORT);
console.log('🤖 AI:', GROQ_API_KEY ? '✅ ENABLED' : '❌ DISABLED');
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
    message: '🤖 پشتیبان هوشمند',
    timestamp: new Date().toISOString(),
    features: {
      ai: !!GROQ_API_KEY,
      telegram: false,
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
    this.operators = new Map(); // operatorId -> {name, chatId, activeSession}
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
      operatorName: null
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

  addMessage(sessionId, role, content, operatorName = null) {
    const session = this.getSession(sessionId);
    if (session) {
      session.messages.push({
        id: uuidv4(),
        role,
        content,
        operatorName,
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
      session.operatorId = 'simulated_operator';
      session.operatorChatId = operatorChatId;
      session.operatorName = operatorName;
      session.status = 'connected';
      
      this.operators.set(operatorChatId, {
        name: operatorName,
        chatId: operatorChatId,
        activeSession: sessionId
      });
      
      sessionCache.set(sessionId, session);
      console.log(`👤 Session ${sessionId.substring(0, 8)}... connected to operator ${operatorName}`);
    }
    return session;
  }

  disconnectFromHuman(sessionId) {
    const session = this.getSession(sessionId);
    if (session && session.operatorChatId) {
      this.operators.delete(session.operatorChatId);
      session.connectedToHuman = false;
      session.operatorId = null;
      session.operatorChatId = null;
      session.operatorName = null;
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
      aiEnabled: !!GROQ_API_KEY,
      operators: this.operators.size
    };
  }
}

// Initialize services
const aiService = new AIService();
const sessionManager = new SessionManager();

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
      
      // For simulated mode, just acknowledge
      socket.emit('message-sent', { success: true });
      
      console.log(`📨 User message for session ${sessionId.substring(0, 8)}...: ${message.substring(0, 50)}...`);
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
    
    // در حالت شبیه‌سازی، همیشه سرویس در دسترس است
    const telegramHealthy = true;
    
    if (!telegramHealthy) {
      return res.json({
        success: false,
        error: 'سرویس اپراتور در دسترس نیست.',
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
    
    // در حالت شبیه‌سازی، همیشه موفق است
    const notified = true;
    
    if (notified) {
      res.json({
        success: true,
        message: '✅ درخواست شما ثبت شد. منتظر پذیرش باشید...',
        operatorConnected: false,
        pending: true
      });
    } else {
      res.json({
        success: false,
        error: 'خطا در ثبت درخواست.',
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

// Webhook endpoint for simulated Telegram bot
app.post('/webhook', async (req, res) => {
  try {
    const { event, data } = req.body;
    
    console.log(`📨 Simulated webhook: ${event}`, { 
      sessionId: data.sessionId ? data.sessionId.substring(0, 8) : 'N/A'
    });
    
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
        console.log(`❌ Session ${data.sessionId.substring(0, 8)}... rejected`);
        break;
        
      case 'operator_message':
        // Message from operator to user
        console.log(`📤 Operator message for session ${data.sessionId.substring(0, 8)}...`);
        
        // Get session
        const targetSession = sessionManager.getSession(data.sessionId);
        if (targetSession) {
          // Add operator message to session
          sessionManager.addMessage(data.sessionId, 'operator', data.message, data.operatorName);
          
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
        
      default:
        console.log(`⚠️ Unknown event: ${event}`);
    }
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Simulated operator endpoints
app.post('/api/simulate-accept/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const { operatorName = 'اپراتور شبیه‌سازی', operatorId = 'simulated_1' } = req.body;
  
  console.log(`🎭 Simulating operator acceptance for session: ${sessionId.substring(0, 8)}...`);
  
  // Connect session to operator
  const session = sessionManager.connectToHuman(sessionId, operatorId, operatorName);
  
  if (session) {
    // Notify user via WebSocket
    io.to(sessionId).emit('operator-accepted', {
      message: '✅ اپراتور درخواست شما را پذیرفت! می‌توانید گفتگو را شروع کنید.',
      operatorName: operatorName,
      timestamp: new Date().toISOString()
    });
    
    res.json({
      success: true,
      message: 'اپراتور به طور شبیه‌سازی شده پذیرفت',
      sessionId: sessionId,
      operatorName: operatorName
    });
  } else {
    res.json({
      success: false,
      error: 'جلسه پیدا نشد'
    });
  }
});

app.post('/api/send-to-user', async (req, res) => {
  try {
    const { sessionId, message, operatorId, operatorName } = req.body;
    
    if (!sessionId || !message) {
      return res.status(400).json({ 
        success: false,
        error: 'شناسه جلسه و پیام الزامی است' 
      });
    }
    
    console.log(`📤 Send to user: ${sessionId.substring(0, 8)}... from ${operatorName || 'اپراتور'}`);
    
    // Get session
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.json({
        success: false,
        error: 'جلسه پیدا نشد'
      });
    }
    
    // Add operator message
    sessionManager.addMessage(sessionId, 'operator', message, operatorName);
    
    // Send to user via WebSocket
    io.to(sessionId).emit('operator-message', {
      from: 'operator',
      message: message,
      timestamp: new Date().toISOString(),
      operatorName: operatorName || 'اپراتور',
      sessionId: sessionId
    });
    
    res.json({
      success: true,
      userName: session.userInfo?.name || 'کاربر سایت',
      sessionId: sessionId
    });
    
  } catch (error) {
    console.error('❌ Send to user error:', error);
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
    operatorName: session.operatorName,
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

// Test endpoint for manual operator acceptance
app.get('/api/test-accept/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const operatorName = 'اپراتور تست';
  const operatorId = 'test_operator';
  
  // Connect session
  sessionManager.connectToHuman(sessionId, operatorId, operatorName);
  
  // Notify via WebSocket
  io.to(sessionId).emit('operator-accepted', {
    message: '✅ اپراتور تست درخواست شما را پذیرفت!',
    operatorName: operatorName,
    timestamp: new Date().toISOString()
  });
  
  res.send(`
    <html>
      <body style="text-align: center; padding: 50px;">
        <h1>✅ اپراتور تست پذیرفت</h1>
        <p>Session: ${sessionId.substring(0, 12)}...</p>
        <p>اپراتور: ${operatorName}</p>
        <p>اکنون کاربر می‌تواند پیام بفرستد.</p>
      </body>
    </html>
  `);
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ============================================
  🚀 AI Chatbot Server Started
  ============================================
  📍 Port: ${PORT}
  🌐 URL: http://localhost:${PORT}
  🤖 AI: ${GROQ_API_KEY ? '✅ Active' : '❌ Disabled'}
  🔧 Telegram: Simulated Mode
  ============================================
  `);
  
  console.log('✅ Server is ready!');
  console.log('📋 Available endpoints:');
  console.log('  GET  /api/health - Health check');
  console.log('  POST /api/chat - Chat with AI');
  console.log('  POST /api/connect-human - Connect to human operator');
  console.log('  GET  /api/test-accept/:sessionId - Test operator acceptance');
  console.log('  GET  /api/sessions - Active sessions');
  console.log('  POST /webhook - Simulated Telegram webhook');
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('🔥 Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 Unhandled Rejection at:', promise, 'reason:', reason);
});
