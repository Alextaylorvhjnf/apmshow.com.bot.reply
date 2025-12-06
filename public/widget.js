class ChatWidget {
    constructor(options = {}) {
        this.options = {
            backendUrl: options.backendUrl || window.location.origin,
            telegramBotToken: options.telegramBotToken || '',
            telegramChatId: options.telegramChatId || '',
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
            isTyping: false,
            isConnecting: false,
            isRecording: false,
            mediaRecorder: null,
            audioChunks: [],
            recordingStartTime: null,
            recordingTimer: null,
            audioStream: null,
            recordingTime: 0
        };
        
        this.tabNotificationInterval = null;
        this.originalTitle = document.title;
        this.tabNotifyText = 'پیام جدید از پشتیبانی';
        
        // بارگذاری Font Awesome
        this.loadFontAwesome();
        this.init();
    }

    loadFontAwesome() {
        if (!document.querySelector('link[href*="font-awesome"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
            document.head.appendChild(link);
        }
    }

    init() {
        this.state.sessionId = this.generateSessionId();
        this.injectStyles();
        this.injectHTML();
        this.initEvents();
        this.connectWebSocket();
        
        // پیام خوش‌آمد
        setTimeout(() => {
            this.addMessage('assistant', '👋 سلام! به پشتیبانی آنلاین خوش آمدید!');
        }, 500);
        
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
        if (!document.querySelector('#chat-widget-styles')) {
            const style = document.createElement('style');
            style.id = 'chat-widget-styles';
            style.textContent = `
                /* Chat Widget Styles */
                .chat-widget {
                    font-family: system-ui, -apple-system, sans-serif;
                    direction: rtl;
                }
                
                .chat-toggle-btn {
                    position: fixed;
                    bottom: 60px;
                    left: 20px;
                    width: 60px;
                    height: 60px;
                    border-radius: 50%;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    border: none;
                    color: white;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.2);
                    z-index: 10000;
                    transition: all 0.3s ease;
                }
                
                .chat-toggle-btn:hover {
                    transform: scale(1.1);
                }
                
                .notification-badge {
                    position: absolute;
                    top: -5px;
                    right: -5px;
                    background: #ff4757;
                    color: white;
                    width: 20px;
                    height: 20px;
                    border-radius: 50%;
                    font-size: 11px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border: 2px solid white;
                }
                
                .chat-window {
                    position: fixed;
                    bottom: 130px;
                    left: 20px;
                    width: 350px;
                    height: 500px;
                    background: white;
                    border-radius: 12px;
                    box-shadow: 0 10px 40px rgba(0,0,0,0.1);
                    z-index: 9999;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    opacity: 0;
                    transform: translateY(20px);
                    visibility: hidden;
                    transition: all 0.3s ease;
                    border: 1px solid #e0e0e0;
                }
                
                .chat-window.active {
                    opacity: 1;
                    transform: translateY(0);
                    visibility: visible;
                }
                
                .chat-header {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    padding: 15px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }
                
                .header-left {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                
                .chat-logo {
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    background: rgba(255,255,255,0.2);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .chat-title h3 {
                    font-size: 16px;
                    margin: 0;
                    font-weight: 600;
                }
                
                .chat-title p {
                    font-size: 12px;
                    margin: 2px 0 0 0;
                    opacity: 0.9;
                }
                
                .chat-status {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 12px;
                }
                
                .status-dot {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background: #4cd964;
                    animation: pulse 2s infinite;
                }
                
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
                
                .close-btn {
                    background: rgba(255,255,255,0.2);
                    border: none;
                    color: white;
                    width: 30px;
                    height: 30px;
                    border-radius: 50%;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .chat-messages {
                    flex: 1;
                    padding: 15px;
                    overflow-y: auto;
                    background: #f8f9fa;
                }
                
                .message {
                    margin-bottom: 15px;
                    max-width: 80%;
                    animation: fadeIn 0.3s ease;
                }
                
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                
                .message.user {
                    margin-left: auto;
                }
                
                .message.assistant, .message.operator {
                    margin-right: auto;
                }
                
                .message.system {
                    max-width: 90%;
                    margin: 10px auto;
                    text-align: center;
                }
                
                .message-sender {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 5px;
                    font-size: 12px;
                    color: #666;
                }
                
                .message-text {
                    padding: 10px 15px;
                    border-radius: 18px;
                    line-height: 1.5;
                    font-size: 14px;
                    word-break: break-word;
                }
                
                .message.user .message-text {
                    background: #667eea;
                    color: white;
                    border-bottom-right-radius: 5px;
                }
                
                .message.assistant .message-text {
                    background: #ffffff;
                    color: #333;
                    border-bottom-left-radius: 5px;
                    border: 1px solid #e0e0e0;
                }
                
                .message.operator .message-text {
                    background: #e8f5e9;
                    color: #333;
                    border-bottom-left-radius: 5px;
                    border: 1px solid #c8e6c9;
                }
                
                .message.system .message-text {
                    background: #e3f2fd;
                    color: #1976d2;
                    font-size: 13px;
                    padding: 8px 12px;
                    border: 1px solid #bbdefb;
                }
                
                .message-time {
                    font-size: 11px;
                    color: #999;
                    margin-top: 5px;
                    text-align: right;
                }
                
                .message.user .message-time {
                    text-align: left;
                }
                
                .chat-tools {
                    padding: 10px 15px;
                    background: white;
                    border-top: 1px solid #eee;
                    display: flex;
                    gap: 10px;
                    display: none;
                }
                
                .chat-tools.active {
                    display: flex;
                }
                
                .tool-btn {
                    flex: 1;
                    padding: 8px;
                    border: 1px solid #ddd;
                    border-radius: 8px;
                    background: white;
                    color: #666;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    font-size: 13px;
                    transition: all 0.2s;
                }
                
                .tool-btn:hover {
                    background: #f5f5f5;
                }
                
                .tool-btn.recording {
                    background: #ffebee;
                    border-color: #ffcdd2;
                    color: #c62828;
                }
                
                .file-input {
                    display: none;
                }
                
                .chat-input-area {
                    padding: 15px;
                    background: white;
                    border-top: 1px solid #eee;
                }
                
                .input-wrapper {
                    display: flex;
                    gap: 10px;
                    margin-bottom: 10px;
                }
                
                .message-input {
                    flex: 1;
                    border: 1px solid #ddd;
                    border-radius: 20px;
                    padding: 10px 15px;
                    font-size: 14px;
                    resize: none;
                    min-height: 40px;
                    max-height: 100px;
                    font-family: inherit;
                }
                
                .send-btn {
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    background: #667eea;
                    border: none;
                    color: white;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .human-support-btn {
                    width: 100%;
                    padding: 12px;
                    background: linear-gradient(135deg, #ff6b6b, #ee5a52);
                    color: white;
                    border: none;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 10px;
                }
                
                .connection-status {
                    padding: 10px 15px;
                    background: #fff8e1;
                    color: #ff8f00;
                    font-size: 13px;
                    display: none;
                }
                
                .connection-status.active {
                    display: block;
                }
                
                .typing-indicator {
                    padding: 10px 15px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    color: #666;
                    font-size: 13px;
                    display: none;
                }
                
                .typing-indicator.active {
                    display: flex;
                }
                
                .typing-dots {
                    display: flex;
                    gap: 4px;
                }
                
                .typing-dots span {
                    width: 6px;
                    height: 6px;
                    border-radius: 50%;
                    background: #667eea;
                    animation: bounce 1.4s infinite;
                }
                
                .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
                .typing-dots span:nth-child(3) { animation-delay: 0.4s; }
                
                @keyframes bounce {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-5px); }
                }
                
                .operator-info {
                    padding: 10px 15px;
                    background: #e3f2fd;
                    border-top: 1px solid #bbdefb;
                    display: none;
                }
                
                .operator-info.active {
                    display: block;
                }
                
                .operator-card {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                
                .operator-avatar {
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    background: #1976d2;
                    color: white;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .operator-details h4 {
                    font-size: 14px;
                    margin: 0 0 4px 0;
                    color: #0d47a1;
                }
                
                .operator-details p {
                    font-size: 12px;
                    margin: 0;
                    color: #1976d2;
                }
                
                /* استایل‌های ضبط صوت */
                .recording-indicator {
                    display: none;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 16px;
                    background: rgba(255, 0, 0, 0.1);
                    border-radius: 20px;
                    margin-bottom: 10px;
                    font-size: 13px;
                    color: #ff0000;
                }
                
                .recording-indicator.active {
                    display: flex;
                }
                
                .recording-dot {
                    width: 10px;
                    height: 10px;
                    background: #ff0000;
                    border-radius: 50%;
                    animation: pulse 1.5s infinite;
                }
                
                .recording-time {
                    font-family: monospace;
                    margin-right: auto;
                }
                
                /* دکمه‌های مخفی */
                .voice-btn,
                .file-btn {
                    display: none;
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    background: #f5f5f5;
                    border: 1px solid #ddd;
                    color: #666;
                    cursor: pointer;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.3s;
                }
                
                .voice-btn.active,
                .file-btn.active {
                    display: flex;
                }
                
                .voice-btn.recording {
                    background: #ff0000;
                    color: white;
                    animation: pulse 1.5s infinite;
                }
                
                .record-instruction {
                    display: none;
                    text-align: center;
                    font-size: 12px;
                    color: #666;
                    margin-bottom: 10px;
                    padding: 5px;
                    background: #f0f0f0;
                    border-radius: 8px;
                }
                
                .record-instruction.active {
                    display: block;
                }
                
                @keyframes pulse {
                    0% { transform: scale(1); }
                    50% { transform: scale(1.1); }
                    100% { transform: scale(1); }
                }
                
                .pulse {
                    animation: pulse 0.6s ease;
                }
                
                @media (max-width: 480px) {
                    .chat-window {
                        width: calc(100vw - 40px);
                        height: 70vh;
                        left: 20px;
                        bottom: 100px;
                    }
                    
                    .chat-toggle-btn {
                        left: 20px;
                        bottom: 20px;
                    }
                }
            `;
            document.head.appendChild(style);
        }
    }

    injectHTML() {
        this.container = document.createElement('div');
        this.container.className = 'chat-widget';
        this.container.innerHTML = `
            <button class="chat-toggle-btn">
                <i class="fas fa-comment-dots"></i>
                <span class="notification-badge" style="display: none">0</span>
            </button>
            
            <div class="chat-window">
                <div class="chat-header">
                    <div class="header-left">
                        <div class="chat-logo">
                            <i class="fas fa-headset"></i>
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
                
                <div class="chat-messages">
                    <div class="message system">
                        <div class="message-text">
                            سلام! من دستیار هوشمند شما هستم. چطور می‌تونم کمکتون کنم؟
                        </div>
                        <div class="message-time">همین الان</div>
                    </div>
                </div>
                
                <div class="connection-status">
                    <div class="status-message">
                        <i class="fas fa-wifi"></i>
                        <span>در حال اتصال...</span>
                    </div>
                </div>
                
                <div class="typing-indicator">
                    <div class="typing-dots">
                        <span></span><span></span><span></span>
                    </div>
                    <span>در حال تایپ...</span>
                </div>
                
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
                
                <div class="chat-tools">
                    <button class="tool-btn file-btn">
                        <i class="fas fa-paperclip"></i>
                        <span>پیوست</span>
                    </button>
                    <button class="tool-btn voice-btn">
                        <i class="fas fa-microphone"></i>
                        <span>ویس</span>
                    </button>
                    <input type="file" class="file-input" accept="image/*,video/*,.pdf,.doc,.docx,.txt,.mp3,.wav" multiple>
                </div>
                
                <div class="chat-input-area">
                    <div class="record-instruction">
                        برای ضبط صدا، دکمه میکروفون را نگه دارید و رها کنید تا ارسال شود
                    </div>
                    
                    <div class="recording-indicator">
                        <div class="recording-dot"></div>
                        <span>در حال ضبط...</span>
                        <span class="recording-time">00:00</span>
                    </div>
                    
                    <div class="input-wrapper">
                        <textarea class="message-input" placeholder="پیام خود را بنویسید..." rows="1"></textarea>
                        <button class="send-btn">
                            <i class="fas fa-paper-plane"></i>
                        </button>
                    </div>
                    
                    <button class="human-support-btn">
                        <i class="fas fa-user-headset"></i>
                        <span>اتصال به اپراتور انسانی</span>
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(this.container);
        
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
            chatStatus: this.container.querySelector('.chat-status'),
            chatTools: this.container.querySelector('.chat-tools'),
            fileBtn: this.container.querySelector('.file-btn'),
            voiceBtn: this.container.querySelector('.voice-btn'),
            fileInput: this.container.querySelector('.file-input'),
            recordingIndicator: this.container.querySelector('.recording-indicator'),
            recordingTime: this.container.querySelector('.recording-time'),
            recordInstruction: this.container.querySelector('.record-instruction')
        };
    }

    initEvents() {
        this.elements.toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleChat();
        });
        
        this.elements.closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeChat();
        });
        
        this.elements.sendBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.sendMessage();
        });
        
        this.elements.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        this.elements.messageInput.addEventListener('input', () => {
            this.resizeTextarea();
        });
        
        this.elements.humanSupportBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.connectToHuman();
        });
        
        // رویدادهای فایل
        this.elements.fileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.triggerFileInput();
        });
        
        this.elements.fileInput.addEventListener('change', (e) => {
            this.handleFileUpload(e);
        });
        
        // رویدادهای ضبط صدا (Hold to Record)
        this.elements.voiceBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            this.startRecording();
        });
        
        this.elements.voiceBtn.addEventListener('mouseup', (e) => {
            e.preventDefault();
            this.stopRecording();
        });
        
        this.elements.voiceBtn.addEventListener('mouseleave', () => {
            if (this.state.isRecording) {
                this.stopRecording();
            }
        });
        
        // رویدادهای لمسی برای موبایل
        this.elements.voiceBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.startRecording();
        });
        
        this.elements.voiceBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.stopRecording();
        });
        
        // بستن چت با کلیک خارج
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
            const wsUrl = this.options.backendUrl.replace(/^http/, 'ws');
            console.log('Connecting to WebSocket:', wsUrl);
            
            this.state.socket = io(wsUrl, {
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionAttempts: 5
            });
            
            this.state.socket.on('connect', () => {
                console.log('WebSocket connected');
                this.state.isConnected = true;
                this.updateConnectionStatus(true);
                this.state.socket.emit('join-session', this.state.sessionId);
            });
            
            this.state.socket.on('operator-connected', (data) => {
                this.handleOperatorConnected(data);
            });
            
            this.state.socket.on('operator-message', (data) => {
                this.addMessage('operator', data.message);
            });
            
            this.state.socket.on('disconnect', () => {
                console.log('WebSocket disconnected');
                this.state.isConnected = false;
                this.updateConnectionStatus(false);
            });
            
            this.state.socket.on('connect_error', (error) => {
                console.error('WebSocket connection error:', error);
                this.state.isConnected = false;
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
        if (this.state.isOpen) {
            this.elements.chatWindow.classList.add('active');
            this.elements.messageInput.focus();
            this.resetNotification();
            this.hideExternalNotification();
        } else {
            this.elements.chatWindow.classList.remove('active');
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
        
        this.addMessage('user', message);
        this.elements.messageInput.value = '';
        this.resizeTextarea();
        this.setTyping(true);
        
        try {
            if (this.state.operatorConnected && this.state.socket) {
                this.state.socket.emit('user-message', {
                    sessionId: this.state.sessionId,
                    message: message
                });
                console.log('پیام به اپراتور ارسال شد:', message);
            } else {
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
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    message, 
                    sessionId: this.state.sessionId 
                })
            });
            
            const data = await response.json();
            if (data.success) {
                this.addMessage('assistant', data.message);
                if (data.requiresHuman) {
                    this.showHumanSupportSuggestion();
                }
            }
        } catch (error) {
            this.addMessage('system', 'خطا در ارتباط با سرور');
        }
    }

    async connectToHuman() {
        if (this.state.operatorConnected || this.state.isConnecting) return;
        
        this.state.isConnecting = true;
        this.elements.humanSupportBtn.disabled = true;
        this.elements.humanSupportBtn.innerHTML = `
            <i class="fas fa-spinner fa-spin"></i>
            <span>در حال اتصال...</span>
        `;
        
        try {
            const userInfo = { 
                name: 'کاربر سایت', 
                page: window.location.href 
            };
            
            const response = await fetch(`${this.options.backendUrl}/api/connect-human`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    sessionId: this.state.sessionId, 
                    userInfo 
                })
            });
            
            const data = await response.json();
            if (data.success) {
                this.addMessage('system', 
                    '⏳ **درخواست شما ثبت شد!**\n\n' +
                    'کارشناسان ما مطلع شدند و به زودی با شما ارتباط برقرار می‌کنند.'
                );
                
                this.elements.humanSupportBtn.innerHTML = `
                    <i class="fas fa-clock"></i>
                    <span>در انتظار پذیرش</span>
                `;
                this.elements.humanSupportBtn.style.background = 'linear-gradient(135deg, #ff9500, #ff7b00)';
                
                if (this.state.socket) {
                    this.state.socket.emit('human-support-request', {
                        sessionId: this.state.sessionId,
                        userInfo: userInfo
                    });
                }
            }
        } catch (error) {
            this.addMessage('system', 'خطا در اتصال');
            this.resetHumanSupportButton();
        } finally {
            this.state.isConnecting = false;
        }
    }

    resetHumanSupportButton() {
        this.elements.humanSupportBtn.innerHTML = `
            <i class="fas fa-user-headset"></i>
            <span>اتصال به اپراتور انسانی</span>
        `;
        this.elements.humanSupportBtn.disabled = false;
        this.elements.humanSupportBtn.style.background = '';
    }

    handleOperatorConnected(data) {
        console.log('اپراتور متصل شد:', data);
        
        this.state.operatorConnected = true;
        
        // نمایش بخش اپراتور
        this.elements.operatorInfo.classList.add('active');
        
        // فعال کردن ابزارهای ارسال
        this.elements.chatTools.classList.add('active');
        this.elements.recordInstruction.classList.add('active');
        
        // تغییر دکمه اتصال
        this.elements.humanSupportBtn.innerHTML = `
            <i class="fas fa-user-check"></i>
            <span>متصل به اپراتور</span>
        `;
        this.elements.humanSupportBtn.disabled = true;
        this.elements.humanSupportBtn.style.background = 'linear-gradient(135deg, #2ecc71, #27ae60)';
        
        // نمایش پیام خوش‌آمد اپراتور
        const welcomeMessage = data.message || 
            '🎉 **به پشتیبانی انسانی خوش آمدید!**\n\n' +
            'حالا می‌توانید فایل و پیام صوتی ارسال کنید.';
        
        this.addMessage('system', welcomeMessage);
    }

    triggerFileInput() {
        if (!this.state.operatorConnected) {
            this.addMessage('system', 'برای ارسال فایل باید ابتدا به اپراتور انسانی متصل شوید.');
            return;
        }
        
        this.elements.fileInput.click();
    }

    async handleFileUpload(event) {
        const files = event.target.files;
        if (!files || files.length === 0) return;
        
        if (!this.state.operatorConnected) {
            this.addMessage('system', 'ابتدا به اپراتور انسانی متصل شوید.');
            this.elements.fileInput.value = '';
            return;
        }
        
        for (let file of files) {
            await this.processFileUpload(file);
        }
        
        this.elements.fileInput.value = '';
    }

    async processFileUpload(file) {
        // چک کردن حجم فایل (حداکثر 10MB)
        const MAX_SIZE = 10 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
            this.addMessage('system', `فایل "${file.name}" بسیار بزرگ است (حداکثر 10 مگابایت)`);
            return;
        }
        
        this.addMessage('user', `📎 ارسال فایل: ${file.name} (${this.formatFileSize(file.size)})`);
        
        try {
            const base64 = await this.fileToBase64(file);
            
            if (this.state.socket && this.state.operatorConnected) {
                this.state.socket.emit('user-file', {
                    sessionId: this.state.sessionId,
                    fileName: file.name,
                    fileBase64: base64.split(',')[1],
                    fileType: file.type,
                    fileSize: file.size
                });
                
                console.log('File sent via WebSocket:', file.name);
            }
            
        } catch (error) {
            console.error('Error uploading file:', error);
            this.addMessage('system', `خطا در آپلود فایل "${file.name}"`);
        }
    }

    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    }

    async startRecording() {
        if (!this.state.operatorConnected) {
            this.addMessage('system', 'برای ارسال ویس باید ابتدا به اپراتور انسانی متصل شوید.');
            return;
        }
        
        if (this.state.isRecording) return;
        
        try {
            // متوقف کردن استریم قبلی
            this.stopAudioStream();
            
            // درخواست دسترسی به میکروفون
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 44100
                }
            });
            
            this.state.audioStream = stream;
            this.state.mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus'
            });
            
            this.state.audioChunks = [];
            this.state.recordingTime = 0;
            this.state.isRecording = true;
            
            this.state.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.state.audioChunks.push(event.data);
                }
            };
            
            this.state.mediaRecorder.onstop = async () => {
                if (this.state.audioChunks.length === 0) {
                    this.addMessage('system', 'پیام صوتی ضبط نشد.');
                    return;
                }
                
                const audioBlob = new Blob(this.state.audioChunks, { 
                    type: 'audio/webm' 
                });
                
                // چک کردن حجم (حداکثر 5MB)
                if (audioBlob.size > 5 * 1024 * 1024) {
                    this.addMessage('system', 'پیام صوتی بسیار بزرگ است (حداکثر 5 مگابایت)');
                    return;
                }
                
                this.addMessage('user', `🎤 ارسال پیام صوتی (${this.state.recordingTime} ثانیه)`);
                
                try {
                    const base64 = await this.blobToBase64(audioBlob);
                    
                    if (this.state.socket && this.state.operatorConnected) {
                        this.state.socket.emit('user-voice', {
                            sessionId: this.state.sessionId,
                            voiceBase64: base64.split(',')[1],
                            duration: this.state.recordingTime
                        });
                        
                        console.log('Voice sent via WebSocket:', this.state.recordingTime + 's');
                    }
                    
                } catch (error) {
                    console.error('Error sending voice:', error);
                    this.addMessage('system', 'خطا در ارسال پیام صوتی');
                }
                
                // پاکسازی
                this.state.audioChunks = [];
                this.state.mediaRecorder = null;
            };
            
            this.state.mediaRecorder.start();
            
            // تغییر ظاهر دکمه
            this.elements.voiceBtn.classList.add('recording');
            this.elements.recordingIndicator.classList.add('active');
            this.elements.voiceBtn.innerHTML = '<i class="fas fa-stop-circle"></i><span>توقف ضبط</span>';
            
            // شروع تایمر
            this.state.recordingTimer = setInterval(() => {
                this.state.recordingTime++;
                const minutes = Math.floor(this.state.recordingTime / 60);
                const seconds = this.state.recordingTime % 60;
                this.elements.recordingTime.textContent = 
                    `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                
                // محدودیت زمانی (2 دقیقه)
                if (this.state.recordingTime >= 120) {
                    this.addMessage('system', 'حداکثر زمان ضبط (۲ دقیقه) به پایان رسید.');
                    this.stopRecording();
                }
            }, 1000);
            
        } catch (error) {
            console.error('Error accessing microphone:', error);
            let errorMessage = 'دسترسی به میکروفون امکان‌پذیر نیست';
            if (error.name === 'NotAllowedError') {
                errorMessage = 'لطفاً دسترسی میکروفون را در مرورگر خود فعال کنید';
            }
            this.addMessage('system', errorMessage);
        }
    }

    stopRecording() {
        if (!this.state.isRecording || !this.state.mediaRecorder) return;
        
        if (this.state.mediaRecorder.state === 'recording') {
            this.state.mediaRecorder.stop();
        }
        
        this.state.isRecording = false;
        clearInterval(this.state.recordingTimer);
        
        // توقف استریم
        this.stopAudioStream();
        
        // بازگرداندن ظاهر دکمه
        this.elements.voiceBtn.classList.remove('recording');
        this.elements.recordingIndicator.classList.remove('active');
        this.elements.voiceBtn.innerHTML = '<i class="fas fa-microphone"></i><span>ویس</span>';
    }

    stopAudioStream() {
        if (this.state.audioStream) {
            this.state.audioStream.getTracks().forEach(track => {
                track.stop();
            });
            this.state.audioStream = null;
        }
    }

    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    }

    addMessage(type, text) {
        const messageEl = document.createElement('div');
        messageEl.className = `message ${type}`;
        
        const time = new Date().toLocaleTimeString('fa-IR', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false
        });
        
        let icon = '', sender = '';
        
        switch (type) {
            case 'user':
                icon = '<i class="fas fa-user"></i>';
                sender = 'شما';
                break;
            case 'assistant':
                icon = '<i class="fas fa-robot"></i>';
                sender = 'دستیار هوشمند';
                break;
            case 'operator':
                icon = '<i class="fas fa-user-tie"></i>';
                sender = 'اپراتور انسانی';
                break;
            case 'system':
                icon = '<i class="fas fa-info-circle"></i>';
                sender = 'سیستم';
                break;
        }
        
        // فرمت‌بندی متن (تبدیل لینک‌ها و خطوط جدید)
        let formattedText = this.escapeHtml(text);
        formattedText = formattedText.replace(/\n/g, '<br>');
        
        messageEl.innerHTML = `
            <div class="message-sender">
                ${icon}
                <span>${sender}</span>
            </div>
            <div class="message-text">${formattedText}</div>
            <div class="message-time">${time}</div>
        `;
        
        this.elements.messagesContainer.appendChild(messageEl);
        
        // اسکرول به پایین
        setTimeout(() => {
            this.elements.messagesContainer.scrollTop = this.elements.messagesContainer.scrollHeight;
        }, 100);
        
        // ذخیره در تاریخچه
        this.state.messages.push({
            type,
            text,
            timestamp: new Date().toISOString(),
            sender
        });
        
        // نوتیفیکیشن برای پیام‌های غیر از کاربر
        if (type !== 'user') {
            this.playNotificationSound();
            if (!this.state.isOpen) {
                this.showNotification();
            }
            if (document.hidden) {
                this.startTabNotification();
            }
        }
    }

    setTyping(typing) {
        this.state.isTyping = typing;
        this.elements.typingIndicator.classList.toggle('active', typing);
        if (this.elements.sendBtn) this.elements.sendBtn.disabled = typing;
        if (this.elements.messageInput) this.elements.messageInput.disabled = typing;
        
        if (!typing && this.elements.messageInput) {
            this.elements.messageInput.focus();
        }
    }

    showNotification(count = 1) {
        if (!this.state.isOpen && this.elements.notificationBadge) {
            let current = parseInt(this.elements.notificationBadge.textContent) || 0;
            current += count;
            this.elements.notificationBadge.textContent = current;
            this.elements.notificationBadge.style.display = 'flex';
            
            if (this.elements.toggleBtn) {
                this.elements.toggleBtn.classList.add('pulse');
                setTimeout(() => {
                    if (this.elements.toggleBtn) {
                        this.elements.toggleBtn.classList.remove('pulse');
                    }
                }, 600);
            }
        }
    }

    resetNotification() {
        if (this.elements.notificationBadge) {
            this.elements.notificationBadge.textContent = '0';
            this.elements.notificationBadge.style.display = 'none';
            this.stopTabNotification();
        }
    }

    playNotificationSound() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(600, audioContext.currentTime + 0.1);
            
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.3);
            
        } catch (error) {
            console.log('Could not play notification sound');
        }
    }

    startTabNotification() {
        if (this.tabNotificationInterval) return;
        
        let isOriginal = true;
        this.tabNotificationInterval = setInterval(() => {
            document.title = isOriginal ? 
                `(پیام جدید) ${this.tabNotifyText}` : 
                this.originalTitle;
            isOriginal = !isOriginal;
        }, 1500);
    }

    stopTabNotification() {
        if (this.tabNotificationInterval) {
            clearInterval(this.tabNotificationInterval);
            this.tabNotificationInterval = null;
            document.title = this.originalTitle;
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 بایت';
        const k = 1024;
        const sizes = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    showHumanSupportSuggestion() {
        // اگر کاربر چند بار با AI چت کرده، پیشنهاد اتصال به اپراتور
        const aiMessages = this.state.messages.filter(m => m.type === 'assistant').length;
        if (aiMessages >= 3 && !this.state.operatorConnected && !this.state.isConnecting) {
            setTimeout(() => {
                this.addMessage('system', 
                    '💡 **پیشنهاد:**\n' +
                    'اگر نیاز به راهنمایی تخصصی دارید، می‌توانید به اپراتور انسانی متصل شوید.'
                );
            }, 2000);
        }
    }

    hideExternalNotification() {
        // اگر نوتیفیکیشن خارجی دارید اینجا مدیریت کنید
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// راه‌اندازی خودکار
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.ChatWidget = new ChatWidget();
    });
} else {
    window.ChatWidget = new ChatWidget();
}

window.initChatWidget = (options) => new ChatWidget(options);
