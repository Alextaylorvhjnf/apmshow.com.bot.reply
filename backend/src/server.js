const express = require('express');
const http = require('http');
const cors = require('cors');
require('dotenv').config();

// Import modules
const setupWebSocket = require('./websocket-manager');
const { setupTelegramBot } = require('./telegram-bot');
const SessionManager = require('./session-manager');
const { processAIMessage } = require('./ai-service');

class ChatServer {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.port = process.env.PORT || 3000;
        
        // Initialize managers
        this.sessionManager = new SessionManager();
        this.io = setupWebSocket(this.server, this.sessionManager);
        this.telegramBot = setupTelegramBot(this.sessionManager, this.io);
        
        this.setupMiddleware();
        this.setupRoutes();
        this.setupErrorHandling();
    }
    
    setupMiddleware() {
        this.app.use(cors({
            origin: '*',
            methods: ['GET', 'POST']
        }));
        
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));
        
        // Serve frontend files
        this.app.use(express.static('public'));
    }
    
    setupRoutes() {
        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({ 
                status: 'ok', 
                timestamp: new Date().toISOString(),
                sessions: this.sessionManager.getStats()
            });
        });
        
        // AI processing endpoint
        this.app.post('/api/chat', async (req, res) => {
            try {
                const { message, sessionId } = req.body;
                
                if (!message || !sessionId) {
                    return res.status(400).json({ error: 'Missing required fields' });
                }
                
                // Check if session exists
                const session = this.sessionManager.getSession(sessionId);
                if (!session) {
                    return res.status(404).json({ error: 'Session not found' });
                }
                
                // Process with AI
                const aiResponse = await processAIMessage(message, sessionId);
                
                res.json({
                    success: true,
                    response: aiResponse,
                    sessionId: sessionId
                });
                
            } catch (error) {
                console.error('Chat error:', error);
                res.status(500).json({ 
                    error: 'Internal server error',
                    needsHuman: true
                });
            }
        });
        
        // Connect to human operator
        this.app.post('/api/connect-human', async (req, res) => {
            try {
                const { sessionId } = req.body;
                
                if (!sessionId) {
                    return res.status(400).json({ error: 'Session ID required' });
                }
                
                const session = this.sessionManager.getSession(sessionId);
                if (!session) {
                    return res.status(404).json({ error: 'Session not found' });
                }
                
                // Update session to human mode
                session.mode = 'human';
                session.telegramChatId = null;
                session.connectedAt = new Date();
                
                // Notify admin via Telegram
                await this.telegramBot.notifyNewHumanSession(session);
                
                res.json({
                    success: true,
                    message: 'Connected to human operator',
                    sessionId: sessionId
                });
                
            } catch (error) {
                console.error('Connect human error:', error);
                res.status(500).json({ error: 'Failed to connect to human operator' });
            }
        });
        
        // Get session status
        this.app.get('/api/session/:sessionId', (req, res) => {
            const session = this.sessionManager.getSession(req.params.sessionId);
            
            if (!session) {
                return res.status(404).json({ error: 'Session not found' });
            }
            
            res.json({
                sessionId: session.id,
                mode: session.mode,
                connectedToHuman: session.mode === 'human',
                createdAt: session.createdAt,
                telegramChatId: session.telegramChatId
            });
        });
    }
    
    setupErrorHandling() {
        this.app.use((err, req, res, next) => {
            console.error('Server error:', err);
            res.status(500).json({ 
                error: 'Internal server error',
                message: process.env.NODE_ENV === 'development' ? err.message : undefined
            });
        });
        
        this.app.use((req, res) => {
            res.status(404).json({ error: 'Endpoint not found' });
        });
    }
    
    start() {
        this.server.listen(this.port, () => {
            console.log(`🚀 Server running on port ${this.port}`);
            console.log(`📞 Telegram bot: ${process.env.BOT_USERNAME}`);
            console.log(`🤖 AI Model: ${process.env.AI_MODEL}`);
        });
    }
}

// Start server
if (require.main === module) {
    const server = new ChatServer();
    server.start();
}

module.exports = ChatServer;
