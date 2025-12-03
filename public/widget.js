class ChatWidget {
    constructor(options = {}) {
        this.options = {
            backendUrl: options.backendUrl || window.location.origin,
            position: options.position || 'bottom-left',
            theme: options.theme || 'default',
            ...options
        };
        
        this.state = {
            isOpen: false,
            isConnected: false,
            operatorConnected: false,
            sessionId: null,
            socket: null,
            messages: [],
            isTyping: false
        };
        
        this.init();
    }
    
    init() {
        // Generate session ID
        this.state.sessionId = this.generateSessionId();
        
        // Inject CSS and HTML
        this.injectStyles();
        this.injectHTML();
        
        // Initialize event listeners
        this.initEvents();
        
        // Connect to WebSocket
        this.connectWebSocket();
        
        console.log('Chat Widget initialized with session:', this.state.sessionId);
    }
    
    generateSessionId() {
        let sessionId = localStorage.getItem('chat_session_id');
        if (!sessionId) {
            sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('chat_session_id', sessionId);
        }
        return sessionId;
    }
    
    injectStyles() {
        // CSS is already loaded via widget.css
        // Just ensure it's loaded
        if (!document.querySelector('link[href*="widget.css"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = `${this.options.backendUrl}/widget.css`;
            link.crossOrigin = 'anonymous';
            document.head.appendChild(link);
        }
    }
    
    injectHTML() {
        // Create container
        this.container = document.createElement('div');
        this.container.className = 'chat-widget';
        this.container.innerHTML = `
            <!-- Toggle Button -->
            <button class="chat-toggle-btn">
                <i class="fas fa-comment-dots"></i>
                <span class="notification-badge" style="display: none">0</span>
            </button>
            
            <!-- Chat Window -->
            <div class="chat-window">
                <!-- Header -->
                <div class="chat-header">
                    <div class="header-left">
                        <div class="chat-logo">
                            <i class="fas fa-robot"></i>
                        </div>
                        <div class="chat-title">
                            <h3>پشتیبان هوشمند</h3>
                            <p>پاسخگوی سوالات شما</p>
                        </div>
                    </div>
                    <div class="header-right">
                        <div class="chat-status">
                            <span class="status-dot"></span>
                            <span>آنلاین</span>
                        </div>
                        <button class="close-btn">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
                
                <!-- Messages -->
                <div class="chat-messages">
                    <!-- Messages will be added here dynamically -->
                    <div class="message system">
                        <div class="message-text">
                            سلام! 👋 من دستیار هوشمند شما هستم. چطور می‌تونم کمکتون کنم؟
                        </div>
                        <div class="message-time">همین الان</div>
                    </div>
                </div>
                
                <!-- Connection Status -->
                <div class="connection-status">
                    <div class="status-message">
                        <i class="fas fa-wifi"></i>
                        <span>در حال اتصال...</span>
                    </div>
                </div>
                
                <!-- Typing Indicator -->
                <div class="typing-indicator">
                    <div class="typing-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>
                    <span>در حال تایپ...</span>
                </div>
                
                <!-- Operator Info -->
                <div class="operator-info">
                    <div class="operator-card">
                        <div class="operator-avatar">
                            <i class="fas fa-user-tie"></i>
                        </div>
                        <div class="operator-details">
                            <h4><i class="fas fa-shield-alt"></i> اپراتور انسانی</h4>
                            <p>در حال حاضر با پشتیبان انسانی در ارتباط هستید</p>
                        </div>
                    </div>
                </div>
                
                <!-- Input Area -->
                <div class="chat-input-area">
                    <div class="input-wrapper">
                        <textarea class="message-input" placeholder="پیام خود را بنویسید..." rows="1"></textarea>
                        <button class="send-btn">
                            <i class="fas fa-paper-plane"></i>
                        </button>
                    </div>
                    <button class="human-support-btn">
                        <i class="fas fa-user-headset"></i>
                        اتصال به اپراتور انسانی
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(this.container);
        
        // Cache DOM elements
        this.elements = {
            toggleBtn: this.container.querySelector('.chat-toggle-btn'),
            chatWindow: this.container.querySelector('.chat-window'),
            closeBtn: this.container.querySelector('.close-btn'),
            messagesContainer: this.container.querySelector('.chat-messages'),
            messageInput: this.container.querySelector('.message-input'),
            sendBtn: this.container.querySelector('.send-btn'),
            humanSupportBtn: this.container.querySelector('.human-support-btn'),
            typingIndicator: this.container.querySelector('.typing-indicator'),
            connectionStatus: this.container.querySelector('.connection-status'),
            operatorInfo: this.container.querySelector('.operator-info'),
            notificationBadge: this.container.querySelector('.notification-badge'),
            chatStatus: this.container.querySelector('.chat-status')
        };
    }
    
    initEvents() {
        // Toggle chat
        this.elements.toggleBtn.addEventListener('click', () => this.toggleChat());
        this.elements.closeBtn.addEventListener('click', () => this.closeChat());
        
        // Send message
        this.elements.sendBtn.addEventListener('click', () => this.sendMessage());
        this.elements.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // Auto-resize textarea
        this.elements.messageInput.addEventListener('input', () => {
            this.resizeTextarea();
        });
        
        // Human support
        this.elements.humanSupportBtn.addEventListener('click', () => this.connectToHuman());
        
        // Close chat when clicking outside
        document.addEventListener('click', (e) => {
            if (this.state.isOpen && 
                !this.elements.chatWindow.contains(e.target) && 
                !this.elements.toggleBtn.contains(e.target)) {
                this.closeChat();
            }
        });
    }
    
    connectWebSocket() {
        try {
            const wsUrl = this.options.backendUrl.replace('http', 'ws');
            this.state.socket = io(wsUrl, {
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionAttempts: 5
            });
            
            this.state.socket.on('connect', () => {
                console.log('WebSocket connected');
                this.state.isConnected = true;
                this.updateConnectionStatus(true);
                
                // Join session
                this.state.socket.emit('join', this.state.sessionId);
            });
            
            this.state.socket.on('operator-connected', (data) => {
                this.handleOperatorConnected(data);
            });
            
            this.state.socket.on('operator-message', (data) => {
                this.addMessage('operator', data.message);
            });
            
            this.state.socket.on('connect_error', () => {
                this.updateConnectionStatus(false);
            });
            
        } catch (error) {
            console.error('WebSocket connection failed:', error);
        }
    }
    
    updateConnectionStatus(connected) {
        if (connected) {
            this.elements.connectionStatus.classList.remove('active');
            this.elements.chatStatus.innerHTML = `
                <span class="status-dot"></span>
                <span>آنلاین</span>
            `;
        } else {
            this.elements.connectionStatus.classList.add('active');
        }
    }
    
    toggleChat() {
        this.state.isOpen = !this.state.isOpen;
        this.elements.chatWindow.classList.toggle('active');
        
        if (this.state.isOpen) {
            this.elements.messageInput.focus();
            this.resetNotification();
        }
    }
    
    closeChat() {
        this.state.isOpen = false;
        this.elements.chatWindow.classList.remove('active');
    }
    
    resizeTextarea() {
        const textarea = this.elements.messageInput;
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
    }
    
    async sendMessage() {
        const message = this.elements.messageInput.value.trim();
        
        if (!message || this.state.isTyping) return;
        
        // Add user message
        this.addMessage('user', message);
        
        // Clear input
        this.elements.messageInput.value = '';
        this.resizeTextarea();
        
        // Disable input
        this.setTyping(true);
        
        try {
            if (this.state.operatorConnected) {
                // Send to operator via API
                await this.sendToOperator(message);
            } else {
                // Send to AI
                await this.sendToAI(message);
            }
        } catch (error) {
            console.error('Send message error:', error);
            this.addMessage('system', 'خطا در ارسال پیام. لطفاً دوباره تلاش کنید.');
        } finally {
            this.setTyping(false);
        }
    }
    
    async sendToAI(message) {
        try {
            const response = await fetch(`${this.options.backendUrl}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: message,
                    sessionId: this.state.sessionId
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.addMessage('assistant', data.message);
                
                //
