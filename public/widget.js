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

            // در تابع initWebSocket یا constructor:
this.state.socket.on('operator-accepted', (data) => {
  this.addMessage('system', data.message);
  this.state.operatorConnected = true;
  this.elements.operatorInfo.classList.add('active');
});

this.state.socket.on('operator-rejected', (data) => {
  this.addMessage('system', data.message);
  this.state.operatorConnected = false;
  this.elements.operatorInfo.classList.remove('active');
  this.resetHumanSupportButton();
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
                
                // If AI suggests human support
                if (data.requiresHuman) {
                    this.elements.humanSupportBtn.innerHTML = `
                        <i class="fas fa-user-headset"></i>
                        اتصال به اپراتور انسانی (پیشنهاد سیستم)
                    `;
                    this.elements.humanSupportBtn.style.background = '#ff9500';
                }
            } else {
                this.addMessage('system', data.message);
            }
            
        } catch (error) {
            console.error('AI request error:', error);
            this.addMessage('system', 'خطا در ارتباط با سرور. لطفاً دوباره تلاش کنید.');
        }
    }
    
    async sendToOperator(message) {
        try {
            const response = await fetch(`${this.options.backendUrl}/api/send-to-operator`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sessionId: this.state.sessionId,
                    message: message
                })
            });
            
            const data = await response.json();
            
            if (!data.success) {
                this.addMessage('system', 'خطا در ارسال پیام به اپراتور');
            }
            
        } catch (error) {
            console.error('Operator request error:', error);
            this.addMessage('system', 'خطا در ارتباط با اپراتور');
        }
    }
    
   async connectToHuman() {
    if (this.state.operatorConnected || this.state.isConnecting) return;
    
    this.state.isConnecting = true;
    this.elements.humanSupportBtn.disabled = true;
    this.elements.humanSupportBtn.innerHTML = `
        <i class="fas fa-spinner fa-spin"></i>
        در حال اتصال...
    `;
    
    try {
        const userInfo = {
            name: 'کاربر سایت',
            page: window.location.href,
            userAgent: navigator.userAgent,
            referrer: document.referrer
        };
        
        console.log('👤 Requesting human connection...');
        
        const response = await fetch(`${this.options.backendUrl}/api/connect-human`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                sessionId: this.state.sessionId,
                userInfo: userInfo
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            this.state.operatorConnected = true;
            this.elements.operatorInfo.classList.add('active');
            this.addMessage('system', data.message);
            
            // Update button
            this.elements.humanSupportBtn.innerHTML = `
                <i class="fas fa-user-check"></i>
                متصل به اپراتور
            `;
            this.elements.humanSupportBtn.style.background = 'linear-gradient(145deg, #2ecc71, #27ae60)';
            this.elements.humanSupportBtn.disabled = true;
            
            console.log('✅ Connected to human operator');
        } else {
            this.addMessage('system', `❌ ${data.error || 'خطا در اتصال به اپراتور'}`);
            if (data.details) {
                console.error('Connection error details:', data.details);
            }
            this.resetHumanSupportButton();
        }
        
    } catch (error) {
        console.error('❌ Connect to human error:', error);
        this.addMessage('system', '❌ خطا در ارتباط با سرور');
        this.resetHumanSupportButton();
    } finally {
        this.state.isConnecting = false;
        this.elements.humanSupportBtn.disabled = false;
    }
}
    
    resetHumanSupportButton() {
        this.elements.humanSupportBtn.innerHTML = `
            <i class="fas fa-user-headset"></i>
            اتصال به اپراتور انسانی
        `;
        this.elements.humanSupportBtn.style.background = '#ff6b6b';
    }
    
    handleOperatorConnected(data) {
        this.state.operatorConnected = true;
        this.elements.operatorInfo.classList.add('active');
        this.addMessage('operator', data.message);
        this.resetHumanSupportButton();
    }
    
    addMessage(type, text) {
        const messageEl = document.createElement('div');
        messageEl.className = `message ${type}`;
        
        const time = new Date().toLocaleTimeString('fa-IR', {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        let senderIcon = '';
        let senderText = '';
        
        switch(type) {
            case 'user':
                senderIcon = '<i class="fas fa-user"></i>';
                senderText = 'شما';
                break;
            case 'assistant':
                senderIcon = '<i class="fas fa-robot"></i>';
                senderText = 'پشتیبان هوشمند';
                break;
            case 'operator':
                senderIcon = '<i class="fas fa-user-tie"></i>';
                senderText = 'اپراتور انسانی';
                break;
        }
        
        messageEl.innerHTML = `
            ${senderIcon ? `
            <div class="message-sender">
                ${senderIcon}
                <span>${senderText}</span>
            </div>
            ` : ''}
            <div class="message-text">${this.escapeHtml(text)}</div>
            <div class="message-time">${time}</div>
        `;
        
        this.elements.messagesContainer.appendChild(messageEl);
        this.elements.messagesContainer.scrollTop = this.elements.messagesContainer.scrollHeight;
        
        // Add to state
        this.state.messages.push({ type, text, time });
        
        // Show notification if chat is closed
        if (!this.state.isOpen) {
            this.showNotification();
        }
    }
    
    setTyping(typing) {
        this.state.isTyping = typing;
        
        if (typing) {
            this.elements.typingIndicator.classList.add('active');
            this.elements.sendBtn.disabled = true;
            this.elements.messageInput.disabled = true;
        } else {
            this.elements.typingIndicator.classList.remove('active');
            this.elements.sendBtn.disabled = false;
            this.elements.messageInput.disabled = false;
            this.elements.messageInput.focus();
        }
    }
    
    showNotification() {
        const badge = this.elements.notificationBadge;
        const count = parseInt(badge.textContent) || 0;
        badge.textContent = count + 1;
        badge.style.display = 'flex';
    }
    
    resetNotification() {
        const badge = this.elements.notificationBadge;
        badge.textContent = '0';
        badge.style.display = 'none';
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.ChatWidget = new ChatWidget();
    });
} else {
    window.ChatWidget = new ChatWidget();
}

// Global initialization function
window.initChatWidget = function(options) {
    return new ChatWidget(options);
};
