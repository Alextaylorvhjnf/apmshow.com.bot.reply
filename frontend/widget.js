class ChatWidget {
    constructor() {
        this.config = {
            backendUrl: 'https://web-production-4063.up.railway.app',
            sessionId: null,
            socket: null,
            isConnected: false,
            isConnectingToHuman: false,
            operatorConnected: false,
            messageCount: 0
        };

        this.init();
    }

    init() {
        // Generate session ID
        this.config.sessionId = this.generateSessionId();
        
        // Initialize DOM elements
        this.initElements();
        
        // Initialize event listeners
        this.initEvents();
        
        // Initialize WebSocket connection
        this.initWebSocket();
        
        // Load saved session if exists
        this.loadSession();
        
        console.log('Chat widget initialized with session:', this.config.sessionId);
    }

    generateSessionId() {
        const savedSession = localStorage.getItem('chat_session_id');
        if (savedSession) {
            return savedSession;
        }
        
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 9);
        const sessionId = `session_${timestamp}_${random}`;
        
        localStorage.setItem('chat_session_id', sessionId);
        return sessionId;
    }

    initElements() {
        this.elements = {
            chatToggle: document.getElementById('chat-toggle'),
            chatWindow: document.getElementById('chat-window'),
            closeChat: document.getElementById('close-chat'),
            chatMessages: document.getElementById('chat-messages'),
            messageInput: document.getElementById('message-input'),
            sendButton: document.getElementById('send-button'),
            humanSupportBtn: document.getElementById('human-support-btn'),
            typingIndicator: document.getElementById('typing-indicator'),
            connectionStatus: document.getElementById('connection-status'),
            statusMessage: document.getElementById('status-message'),
            operatorInfo: document.getElementById('operator-info'),
            notificationBadge: document.getElementById('notification-badge'),
            chatStatus: document.getElementById('chat-status')
        };
    }

    initEvents() {
        // Toggle chat window
        this.elements.chatToggle.addEventListener('click', () => {
            this.toggleChat();
        });

        // Close chat window
        this.elements.closeChat.addEventListener('click', () => {
            this.closeChat();
        });

        // Send message on button click
        this.elements.sendButton.addEventListener('click', () => {
            this.sendMessage();
        });

        // Send message on Enter key (with Shift for new line)
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

        // Connect to human support
        this.elements.humanSupportBtn.addEventListener('click', () => {
            this.connectToHuman();
        });

        // Close chat when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.elements.chatWindow.contains(e.target) && 
                !this.elements.chatToggle.contains(e.target) &&
                this.elements.chatWindow.classList.contains('active')) {
                this.closeChat();
            }
        });
    }

    initWebSocket() {
        try {
            // Update backend URL for WebSocket
            const wsUrl = this.config.backendUrl.replace('http', 'ws');
            this.config.socket = io(wsUrl, {
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000
            });

            // Socket event listeners
            this.config.socket.on('connect', () => {
                console.log('WebSocket connected');
                this.config.isConnected = true;
                this.updateConnectionStatus(true);
                
                // Join session room
                this.config.socket.emit('join-session', this.config.sessionId);
            });

            this.config.socket.on('connect_error', (error) => {
                console.error('WebSocket connection error:', error);
                this.config.isConnected = false;
                this.updateConnectionStatus(false, 'خطا در اتصال');
            });

            this.config.socket.on('disconnect', (reason) => {
                console.log('WebSocket disconnected:', reason);
                this.config.isConnected = false;
                this.updateConnectionStatus(false, 'اتصال قطع شد');
            });

            this.config.socket.on('operator-connected', (data) => {
                this.handleOperatorConnected(data);
            });

            this.config.socket.on('operator-disconnected', (data) => {
                this.handleOperatorDisconnected(data);
            });

            this.config.socket.on('operator-message', (data) => {
                this.handleOperatorMessage(data);
            });

            // Reconnect when coming back online
            window.addEventListener('online', () => {
                if (!this.config.isConnected) {
                    this.initWebSocket();
                }
            });

        } catch (error) {
            console.error('Error initializing WebSocket:', error);
        }
    }

    updateConnectionStatus(connected, message = null) {
        const statusEl = this.elements.connectionStatus;
        const messageEl = this.elements.statusMessage;
        
        if (connected) {
            statusEl.classList.remove('visible');
            this.elements.chatStatus.innerHTML = `
                <span class="status-dot online"></span>
                <span>آنلاین</span>
            `;
        } else {
            statusEl.classList.add('visible');
            if (message) {
                messageEl.innerHTML = `
                    <i class="fas fa-wifi-slash"></i>
                    <span>${message}</span>
                `;
            }
        }
    }

    toggleChat() {
        this.elements.chatWindow.classList.toggle('active');
        this.elements.chatToggle.style.opacity = this.elements.chatWindow.classList.contains('active') ? '0.7' : '1';
        
        if (this.elements.chatWindow.classList.contains('active')) {
            this.elements.messageInput.focus();
            this.resetNotificationBadge();
        }
    }

    closeChat() {
        this.elements.chatWindow.classList.remove('active');
        this.elements.chatToggle.style.opacity = '1';
    }

    resizeTextarea() {
        const textarea = this.elements.messageInput;
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
    }

    async sendMessage() {
        const message = this.elements.messageInput.value.trim();
        
        if (!message) return;
        
        // Disable input during sending
        this.elements.messageInput.disabled = true;
        this.elements.sendButton.disabled = true;
        
        // Add user message to chat
        this.addMessage('user', message);
        
        // Clear input
        this.elements.messageInput.value = '';
        this.resizeTextarea();
        
        // Show typing indicator
        this.showTypingIndicator();
        
        try {
            if (this.config.operatorConnected) {
                // Send to operator via WebSocket
                await this.sendToOperator(message);
            } else {
                // Send to AI
                await this.sendToAI(message);
            }
        } catch (error) {
            console.error('Error sending message:', error);
            this.addMessage('ai', 'خطا در ارسال پیام. لطفاً دوباره تلاش کنید.');
        } finally {
            // Re-enable input
            this.elements.messageInput.disabled = false;
            this.elements.sendButton.disabled = false;
            this.elements.messageInput.focus();
            
            // Hide typing indicator
            this.hideTypingIndicator();
        }
    }

    async sendToAI(message) {
        try {
            const response = await fetch(`${this.config.backendUrl}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: message,
                    sessionId: this.config.sessionId
                })
            });

            const data = await response.json();
            
            if (data.success) {
                this.addMessage('ai', data.message);
                
                // If AI suggests human support, update button
                if (data.requiresHuman) {
                    this.elements.humanSupportBtn.innerHTML = `
                        <i class="fas fa-user-headset"></i>
                        اتصال به اپراتور انسانی (پیشنهاد سیستم)
                    `;
                    this.elements.humanSupportBtn.style.background = '#ff9500';
                }
            } else {
                this.addMessage('ai', data.message || 'خطا در پردازش درخواست');
            }
            
        } catch (error) {
            console.error('AI request error:', error);
            this.addMessage('ai', 'خطا در ارتباط با سرور. لطفاً دوباره تلاش کنید.');
        }
    }

    async sendToOperator(message) {
        try {
            const response = await fetch(`${this.config.backendUrl}/api/send-to-operator`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sessionId: this.config.sessionId,
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
        if (this.config.isConnectingToHuman || this.config.operatorConnected) {
            return;
        }

        this.config.isConnectingToHuman = true;
        this.elements.humanSupportBtn.disabled = true;
        this.elements.humanSupportBtn.innerHTML = `
            <div class="loading"></div>
            در حال اتصال...
        `;

        try {
            // Get user info from session
            const userInfo = {
                name: localStorage.getItem('user_name') || 'کاربر سایت',
                email: localStorage.getItem('user_email') || '',
                phone: localStorage.getItem('user_phone') || '',
                page: window.location.href
            };

            const response = await fetch(`${this.config.backendUrl}/api/connect-human`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sessionId: this.config.sessionId,
                    userInfo: userInfo
                })
            });

            const data = await response.json();
            
            if (data.success) {
                this.config.operatorConnected = true;
                this.elements.operatorInfo.classList.remove('hidden');
                this.addMessage('system', 'در حال اتصال به اپراتور انسانی...');
                
                // Update button
                this.elements.humanSupportBtn.innerHTML = `
                    <i class="fas fa-user-check"></i>
                    متصل به اپراتور
                `;
                this.elements.humanSupportBtn.style.background = '#2ecc71';
                this.elements.humanSupportBtn.disabled = true;
            } else {
                this.addMessage('system', 'خطا در اتصال به اپراتور. لطفاً دوباره تلاش کنید.');
                this.resetHumanSupportButton();
            }
            
        } catch (error) {
            console.error('Connect to human error:', error);
            this.addMessage('system', 'خطا در ارتباط با سرور');
            this.resetHumanSupportButton();
        } finally {
            this.config.isConnectingToHuman = false;
        }
    }

    resetHumanSupportButton() {
        this.elements.humanSupportBtn.disabled = false;
        this.elements.humanSupportBtn.innerHTML = `
            <i class="fas fa-user-headset"></i>
            اتصال به اپراتور انسانی
        `;
        this.elements.humanSupportBtn.style.background = '#ff6b6b';
    }

    handleOperatorConnected(data) {
        this.config.operatorConnected = true;
        this.elements.operatorInfo.classList.remove('hidden');
        
        this.addMessage('operator', data.message);
        
        // Update button
        this.elements.humanSupportBtn.innerHTML = `
            <i class="fas fa-user-check"></i>
            متصل به اپراتور
        `;
        this.elements.humanSupportBtn.style.background = '#2ecc71';
        this.elements.humanSupportBtn.disabled = true;
        
        // Show notification
        this.showNotification('اپراتور انسانی متصل شد');
    }

    handleOperatorDisconnected(data) {
        this.config.operatorConnected = false;
        this.elements.operatorInfo.classList.add('hidden');
        
        this.addMessage('system', data.message);
        this.resetHumanSupportButton();
    }

    handleOperatorMessage(data) {
        this.addMessage('operator', data.message);
        this.showNotification('پیام جدید از اپراتور');
    }

    addMessage(sender, text) {
        const messagesContainer = this.elements.chatMessages;
        
        // Create message wrapper
        const messageWrapper = document.createElement('div');
        messageWrapper.className = `message-wrapper ${sender} new-message`;
        
        // Determine sender info
        let senderInfo = '';
        let bubbleClass = '';
        
        switch(sender) {
            case 'user':
                senderInfo = '<i class="fas fa-user"></i><span>شما</span>';
                bubbleClass = 'user';
                break;
            case 'ai':
                senderInfo = '<i class="fas fa-robot"></i><span>پشتیبان هوشمند</span>';
                bubbleClass = 'ai';
                break;
            case 'operator':
                senderInfo = '<i class="fas fa-user-tie"></i><span>اپراتور انسانی</span>';
                bubbleClass = 'operator';
                break;
            case 'system':
                senderInfo = '<i class="fas fa-info-circle"></i><span>سیستم</span>';
                bubbleClass = 'ai';
                break;
        }
        
        // Get current time
        const now = new Date();
        const timeString = now.toLocaleTimeString('fa-IR', {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        // Create message bubble
        messageWrapper.innerHTML = `
            <div class="message-bubble ${bubbleClass}">
                <div class="message-sender">
                    ${senderInfo}
                </div>
                <div class="message-text">
                    ${this.escapeHtml(text)}
                </div>
                <div class="message-time">
                    ${timeString}
                </div>
            </div>
        `;
        
        // Add to container
        messagesContainer.appendChild(messageWrapper);
        
        // Scroll to bottom
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        // Increment message count
        this.config.messageCount++;
        
        // Update notification badge if chat is closed
        if (!this.elements.chatWindow.classList.contains('active')) {
            this.updateNotificationBadge();
        }
        
        // Save to session
        this.saveMessage(sender, text);
    }

    showTypingIndicator() {
        this.elements.typingIndicator.classList.add('active');
        this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
    }

    hideTypingIndicator() {
        this.elements.typingIndicator.classList.remove('active');
    }

    showNotification(message) {
        // Update badge
        this.updateNotificationBadge();
        
        // Browser notification
        if (Notification.permission === 'granted') {
            new Notification('پشتیبان هوشمند', {
                body: message,
                icon: 'https://cdn-icons-png.flaticon.com/512/4712/4712035.png'
            });
        }
    }

    updateNotificationBadge() {
        const badge = this.elements.notificationBadge;
        const count = parseInt(badge.textContent) || 0;
        badge.textContent = count + 1;
        badge.style.display = 'flex';
    }

    resetNotificationBadge() {
        const badge = this.elements.notificationBadge;
        badge.textContent = '0';
        badge.style.display = 'none';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    saveMessage(sender, text) {
        const messages = JSON.parse(localStorage.getItem('chat_messages') || '[]');
        messages.push({
            sender: sender,
            text: text,
            timestamp: new Date().toISOString()
        });
        
        // Keep only last 50 messages
        if (messages.length > 50) {
            messages.splice(0, messages.length - 50);
        }
        
        localStorage.setItem('chat_messages', JSON.stringify(messages));
    }

    loadSession() {
        const messages = JSON.parse(localStorage.getItem('chat_messages') || '[]');
        
        messages.forEach(msg => {
            this.addMessage(msg.sender, msg.text);
        });
        
        // Load operator connection status
        const operatorConnected = localStorage.getItem('operator_connected');
        if (operatorConnected === 'true') {
            this.config.operatorConnected = true;
            this.elements.operatorInfo.classList.remove('hidden');
            this.elements.humanSupportBtn.innerHTML = `
                <i class="fas fa-user-check"></i>
                متصل به اپراتور
            `;
            this.elements.humanSupportBtn.style.background = '#2ecc71';
            this.elements.humanSupportBtn.disabled = true;
        }
    }

    // Request notification permission
    requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }
}

// Initialize widget when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.ChatWidget = new ChatWidget();
});

// Export for global access
if (typeof window !== 'undefined') {
    window.initChatWidget = function() {
        return new ChatWidget();
    };
}
