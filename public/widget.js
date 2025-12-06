class ChatWidget {
    constructor(options = {}) {
        this.options = {
            backendUrl: options.backendUrl || window.location.origin,
            position: options.position || 'bottom-left',
            theme: options.theme || 'light',
            companyName: options.companyName || 'شیک‌پوشان',
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
            link.crossOrigin = 'anonymous';
            document.head.appendChild(link);
        }
    }
    
    init() {
        this.state.sessionId = this.generateSessionId();
        this.injectStyles();
        this.injectHTML();
        this.initEvents();
        this.connectWebSocket();
        
        // پیام خوش‌آمد بعد از بارگذاری
        setTimeout(() => {
            this.addMessage('assistant', 
                '👋 سلام! به پشتیبانی آنلاین خوش آمدید!\n' +
                'من دستیار هوشمند شما هستم. چطور می‌تونم کمکتون کنم؟'
            );
        }, 500);
        
        console.log('ویجت چت با موفقیت راه‌اندازی شد');
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
        // اگر CSS خارجی وجود ندارد، آن را اضافه کن
        if (!document.querySelector('#chat-widget-styles')) {
            const style = document.createElement('style');
            style.id = 'chat-widget-styles';
            style.textContent = `
                /* Chat Widget Styles */
                .chat-widget {
                    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
                    direction: rtl;
                }
                
                /* Floating Button */
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
                    box-shadow: 0 6px 25px rgba(0,0,0,0.3);
                }
                
                .chat-toggle-btn i {
                    font-size: 24px;
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
                    font-weight: bold;
                    border: 2px solid white;
                }
                
                /* Chat Window */
                .chat-window {
                    position: fixed;
                    bottom: 90px;
                    left: 20px;
                    width: 350px;
                    height: 800px;
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
                
                /* Header */
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
                    font-size: 18px;
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
                    transition: background 0.3s;
                }
                
                .close-btn:hover {
                    background: rgba(255,255,255,0.3);
                }
                
                /* Messages */
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
                
                .message.assistant {
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
                    font-weight: 500;
                }
                
                .message-text {
                    background: white;
                    padding: 10px 15px;
                    border-radius: 18px;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.1);
                    line-height: 1.5;
                    font-size: 14px;
                }
                
                .message.user .message-text {
                    background: #667eea;
                    color: white;
                    border-bottom-right-radius: 5px;
                }
                
                .message.assistant .message-text {
                    background: white;
                    color: #333;
                    border-bottom-left-radius: 5px;
                }
                
                .message.system .message-text {
                    background: #e3f2fd;
                    color: #1976d2;
                    font-size: 13px;
                    padding: 8px 12px;
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
                
                /* Tools */
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
                    border-color: #ccc;
                }
                
                .file-input {
                    display: none;
                }
                
                /* Input Area */
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
                    outline: none;
                    transition: border 0.3s;
                }
                
                .message-input:focus {
                    border-color: #667eea;
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
                    transition: background 0.3s;
                }
                
                .send-btn:hover {
                    background: #5a67d8;
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
                    transition: all 0.3s;
                }
                
                .human-support-btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(255,107,107,0.3);
                }
                
                /* Status Indicators */
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
                
                /* Operator Info */
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
                    font-size: 18px;
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
                
                /* Scrollbar */
                .chat-messages::-webkit-scrollbar {
                    width: 6px;
                }
                
                .chat-messages::-webkit-scrollbar-track {
                    background: #f1f1f1;
                }
                
                .chat-messages::-webkit-scrollbar-thumb {
                    background: #ccc;
                    border-radius: 3px;
                }
                
                .chat-messages::-webkit-scrollbar-thumb:hover {
                    background: #aaa;
                }
                
                /* Responsive */
                @media (max-width: 480px) {
                    .chat-window {
                        width: calc(100vw - 40px);
                        height: 70vh;
                        left: 20px;
                        right: 20px;
                        bottom: 80px;
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
        // اگر ویجت از قبل وجود دارد، حذفش کن
        const existingWidget = document.querySelector('.chat-widget');
        if (existingWidget) {
            existingWidget.remove();
        }
        
        this.container = document.createElement('div');
        this.container.className = 'chat-widget';
        this.container.innerHTML = `
            <!-- دکمه شناور -->
            <button class="chat-toggle-btn">
                <i class="fas fa-comment-dots"></i>
                <span class="notification-badge" style="display: none">0</span>
            </button>
            
            <!-- پنجره چت -->
            <div class="chat-window">
                <!-- هدر -->
                <div class="chat-header">
                    <div class="header-left">
                        <div class="chat-logo">
                            <i class="fas fa-headset"></i>
                        </div>
                        <div class="chat-title">
                            <h3>${this.options.companyName}</h3>
                            <p>پشتیبانی آنلاین</p>
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
                
                <!-- پیام‌ها -->
                <div class="chat-messages"></div>
                
                <!-- وضعیت اتصال -->
                <div class="connection-status">
                    <div class="status-message">
                        <i class="fas fa-wifi"></i>
                        <span>در حال اتصال...</span>
                    </div>
                </div>
                
                <!-- نشانگر تایپ -->
                <div class="typing-indicator">
                    <div class="typing-dots">
                        <span></span><span></span><span></span>
                    </div>
                    <span>در حال تایپ...</span>
                </div>
                
                <!-- اطلاعات اپراتور -->
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
                
                <!-- ابزارهای ارسال (فایل و ویس) -->
                <div class="chat-tools">
                    <button class="tool-btn file-btn">
                        <i class="fas fa-paperclip"></i>
                        <span>ارسال فایل</span>
                    </button>
                    <button class="tool-btn voice-btn">
                        <i class="fas fa-microphone"></i>
                        <span>ضبط صوت</span>
                    </button>
                    <input type="file" class="file-input" accept="image/*,video/*,.pdf,.doc,.docx" multiple>
                </div>
                
                <!-- ناحیه ورودی -->
                <div class="chat-input-area">
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
        
        // جمع‌آوری المان‌ها
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
            fileInput: this.container.querySelector('.file-input')
        };
        
        // اطمینان از اینکه المان‌ها پیدا شدند
        if (!this.elements.toggleBtn) {
            console.error('❌ المان toggleBtn پیدا نشد!');
        }
        if (!this.elements.chatWindow) {
            console.error('❌ المان chatWindow پیدا نشد!');
        }
        
        console.log('✅ HTML ویجت با موفقیت تزریق شد');
    }
    
    initEvents() {
        // مطمئن شو که المان‌ها وجود دارند
        if (!this.elements.toggleBtn || !this.elements.chatWindow) {
            console.error('❌ المان‌های ضروری برای رویدادها پیدا نشدند');
            setTimeout(() => this.initEvents(), 100);
            return;
        }
        
        // رویداد دکمه باز کردن/بستن
        this.elements.toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleChat();
        });
        
        this.elements.closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeChat();
        });
        
        // رویدادهای ارسال پیام
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
        
        // رویداد دکمه اتصال به اپراتور
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
        
        // رویدادهای ضبط صدا
        this.elements.voiceBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this.startRecording();
        });
        
        this.elements.voiceBtn.addEventListener('mouseup', (e) => {
            e.stopPropagation();
            this.stopRecording();
        });
        
        this.elements.voiceBtn.addEventListener('mouseleave', () => {
            this.stopRecording();
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
        
        console.log('✅ رویدادهای ویجت با موفقیت تنظیم شدند');
    }
    
    connectWebSocket() {
        try {
            const wsUrl = this.options.backendUrl.replace(/^http/, 'ws');
            console.log('🔌 تلاش برای اتصال به WebSocket:', wsUrl);
            
            this.state.socket = io(wsUrl, {
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000
            });
            
            this.state.socket.on('connect', () => {
                console.log('✅ WebSocket متصل شد');
                this.state.isConnected = true;
                this.updateConnectionStatus(true);
                
                // عضویت در سشن
                this.state.socket.emit('join-session', this.state.sessionId);
            });
            
            this.state.socket.on('operator-connected', (data) => {
                console.log('🎉 اپراتور متصل شد:', data);
                this.handleOperatorConnected(data);
            });
            
            this.state.socket.on('operator-message', (data) => {
                console.log('📩 پیام از اپراتور:', data);
                this.addMessage('operator', data.message);
            });
            
            this.state.socket.on('ai-message', (data) => {
                console.log('🤖 پیام از AI:', data);
                this.addMessage('assistant', data.message);
                this.setTyping(false);
            });
            
            this.state.socket.on('disconnect', () => {
                console.log('❌ WebSocket قطع شد');
                this.state.isConnected = false;
                this.updateConnectionStatus(false);
            });
            
            this.state.socket.on('connect_error', (error) => {
                console.error('❌ خطای اتصال WebSocket:', error);
                this.state.isConnected = false;
                this.updateConnectionStatus(false);
            });
            
        } catch (error) {
            console.error('❌ خطا در اتصال WebSocket:', error);
            this.state.isConnected = false;
            this.updateConnectionStatus(false);
        }
    }
    
    updateConnectionStatus(connected) {
        if (connected) {
            this.elements.connectionStatus.classList.remove('active');
            if (this.elements.chatStatus) {
                this.elements.chatStatus.innerHTML = `
                    <span class="status-dot"></span>
                    <span>آنلاین</span>
                `;
            }
        } else {
            this.elements.connectionStatus.classList.add('active');
        }
    }
    
    toggleChat() {
        console.log('🎯 toggleChat فراخوانی شد، وضعیت فعلی:', this.state.isOpen);
        
        this.state.isOpen = !this.state.isOpen;
        const chatWindow = this.elements.chatWindow;
        
        if (chatWindow) {
            if (this.state.isOpen) {
                chatWindow.classList.add('active');
                this.elements.messageInput.focus();
                this.resetNotification();
                this.updateToolButtons();
                console.log('✅ چت باز شد');
            } else {
                chatWindow.classList.remove('active');
                console.log('✅ چت بسته شد');
            }
        } else {
            console.error('❌ chatWindow پیدا نشد!');
        }
    }
    
    openChat() {
        console.log('📖 باز کردن چت...');
        this.state.isOpen = true;
        if (this.elements.chatWindow) {
            this.elements.chatWindow.classList.add('active');
            this.elements.messageInput.focus();
            this.resetNotification();
            this.updateToolButtons();
        }
    }
    
    closeChat() {
        console.log('📕 بستن چت...');
        this.state.isOpen = false;
        if (this.elements.chatWindow) {
            this.elements.chatWindow.classList.remove('active');
        }
    }
    
    updateToolButtons() {
        if (this.elements.chatTools) {
            if (this.state.operatorConnected) {
                this.elements.chatTools.classList.add('active');
            } else {
                this.elements.chatTools.classList.remove('active');
            }
        }
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
                // ارسال به اپراتور انسانی
                this.state.socket.emit('user-message', {
                    sessionId: this.state.sessionId,
                    message: message
                });
                console.log('📤 پیام به اپراتور ارسال شد:', message);
                
            } else {
                // ارسال به هوش مصنوعی
                await this.sendToAI(message);
            }
            
        } catch (error) {
            console.error('❌ خطا در ارسال پیام:', error);
            this.addMessage('system', '⚠️ خطا در ارسال پیام. لطفاً دوباره تلاش کنید.');
            this.setTyping(false);
        }
    }
    
    async sendToAI(message) {
        try {
            console.log('🤖 ارسال به AI:', message);
            
            const response = await fetch(`${this.options.backendUrl}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    message: message,
                    sessionId: this.state.sessionId,
                    userInfo: {
                        name: 'کاربر سایت',
                        page: window.location.href
                    }
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            console.log('✅ پاسخ از AI:', data);
            
            if (data.success) {
                this.addMessage('assistant', data.message);
                
                // اگر سیستم پیشنهاد اتصال به اپراتور داد
                if (data.requiresHuman) {
                    this.showHumanSupportSuggestion();
                }
                
                // اگر وضعیت اتصال به اپراتور برگردانده شد
                if (data.connectedToHuman !== undefined) {
                    this.state.operatorConnected = data.connectedToHuman;
                    this.updateToolButtons();
                }
                
            } else {
                throw new Error(data.message || 'خطا در دریافت پاسخ');
            }
            
        } catch (error) {
            console.error('❌ خطا در ارتباط با سرور:', error);
            
            let errorMessage = '⚠️ خطا در ارتباط با سرور';
            if (error.message.includes('Failed to fetch')) {
                errorMessage = '🌐 خطا در اتصال اینترنت. لطفاً اتصال خود را بررسی کنید.';
            }
            
            this.addMessage('system', errorMessage);
            
        } finally {
            this.setTyping(false);
        }
    }
    
    async connectToHuman() {
        if (this.state.operatorConnected) {
            this.addMessage('system', '✅ شما در حال حاضر به اپراتور انسانی متصل هستید.');
            return;
        }
        
        if (this.state.isConnecting) {
            return;
        }
        
        this.state.isConnecting = true;
        const originalHTML = this.elements.humanSupportBtn.innerHTML;
        
        // تغییر ظاهر دکمه به حالت لودینگ
        this.elements.humanSupportBtn.innerHTML = `
            <i class="fas fa-spinner fa-spin"></i>
            <span>در حال اتصال...</span>
        `;
        this.elements.humanSupportBtn.disabled = true;
        
        try {
            const userInfo = {
                name: 'کاربر سایت',
                page: window.location.href,
                browser: navigator.userAgent
            };
            
            console.log('📡 درخواست اتصال به اپراتور:', userInfo);
            
            const response = await fetch(`${this.options.backendUrl}/api/connect-human`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    sessionId: this.state.sessionId,
                    userInfo: userInfo
                })
            });
            
            if (!response.ok) {
                throw new Error(`خطای HTTP: ${response.status}`);
            }
            
            const data = await response.json();
            console.log('✅ پاسخ از API اتصال:', data);
            
            if (data.success) {
                this.addMessage('system', 
                    '⏳ **درخواست شما ثبت شد!**\n\n' +
                    'کارشناسان ما مطلع شدند و به زودی با شما ارتباط برقرار می‌کنند.\n' +
                    'لطفاً منتظر بمانید...'
                );
                
                // تغییر دکمه به حالت انتظار
                this.elements.humanSupportBtn.innerHTML = `
                    <i class="fas fa-clock"></i>
                    <span>در انتظار پذیرش</span>
                `;
                this.elements.humanSupportBtn.style.background = 'linear-gradient(135deg, #ff9500, #ff7b00)';
                
                // ارسال رویداد سوکت
                if (this.state.socket) {
                    this.state.socket.emit('human-support-request', {
                        sessionId: this.state.sessionId,
                        userInfo: userInfo
                    });
                }
                
                // تایمر انتظار (30 ثانیه)
                setTimeout(() => {
                    if (!this.state.operatorConnected) {
                        this.addMessage('system', 
                            '⏰ **هنوز پاسخی دریافت نشد**\n\n' +
                            'متأسفانه در حال حاضر هیچ اپراتوری در دسترس نیست.\n' +
                            'لطفاً چند دقیقه دیگر دوباره تلاش کنید.'
                        );
                        this.resetHumanSupportButton(originalHTML);
                    }
                }, 30000);
                
            } else {
                throw new Error(data.message || 'خطا در ثبت درخواست');
            }
            
        } catch (error) {
            console.error('❌ خطا در اتصال به اپراتور:', error);
            
            let errorMessage = '⚠️ خطا در اتصال به سرور';
            if (error.message.includes('Failed to fetch')) {
                errorMessage = '🌐 خطا در ارتباط اینترنت. لطفاً اتصال خود را بررسی کنید.';
            }
            
            this.addMessage('system', errorMessage);
            
            // بازگرداندن دکمه به حالت اولیه بعد از 3 ثانیه
            setTimeout(() => {
                this.resetHumanSupportButton(originalHTML);
            }, 3000);
            
        } finally {
            this.state.isConnecting = false;
        }
    }
    
    resetHumanSupportButton(originalHTML) {
        this.elements.humanSupportBtn.innerHTML = `
            <i class="fas fa-user-headset"></i>
            <span>اتصال به اپراتور انسانی</span>
        `;
        this.elements.humanSupportBtn.disabled = false;
        this.elements.humanSupportBtn.style.background = '';
    }
    
    handleOperatorConnected(data) {
        console.log('🎉 handleOperatorConnected فراخوانی شد:', data);
        
        this.state.operatorConnected = true;
        
        // نمایش بخش اپراتور
        if (this.elements.operatorInfo) {
            this.elements.operatorInfo.classList.add('active');
        }
        
        // فعال کردن ابزارهای ارسال
        this.updateToolButtons();
        
        // تغییر دکمه اتصال
        if (this.elements.humanSupportBtn) {
            this.elements.humanSupportBtn.innerHTML = `
                <i class="fas fa-user-check"></i>
                <span>متصل به اپراتور</span>
            `;
            this.elements.humanSupportBtn.disabled = true;
            this.elements.humanSupportBtn.style.background = 'linear-gradient(135deg, #2ecc71, #27ae60)';
        }
        
        // نمایش پیام خوش‌آمد اپراتور
        const welcomeMessage = data.message || 
            '🎉 **به پشتیبانی انسانی خوش آمدید!**\n\n' +
            'حالا می‌توانید فایل‌های خود را ارسال کنید و با جزئیات کامل سوال خود را مطرح کنید.\n\n' +
            'منتظر سوال شما هستم! 😊';
        
        this.addMessage('system', welcomeMessage);
    }
    
    triggerFileInput() {
        if (!this.state.operatorConnected) {
            this.addMessage('system', '⚠️ برای ارسال فایل باید ابتدا به اپراتور انسانی متصل شوید.');
            return;
        }
        
        if (this.elements.fileInput) {
            this.elements.fileInput.click();
        }
    }
    
    async handleFileUpload(event) {
        const files = event.target.files;
        if (!files || files.length === 0) return;
        
        if (!this.state.operatorConnected) {
            this.addMessage('system', '⚠️ ابتدا به اپراتور انسانی متصل شوید.');
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
            this.addMessage('system', `❌ فایل "${file.name}" بسیار بزرگ است (حداکثر 10 مگابایت)`);
            return;
        }
        
        this.addMessage('user', `📎 ارسال فایل: ${file.name} (${this.formatFileSize(file.size)})`);
        
        try {
            const base64 = await this.fileToBase64(file);
            
            if (this.state.socket) {
                this.state.socket.emit('user-file', {
                    sessionId: this.state.sessionId,
                    fileName: file.name,
                    fileBase64: base64.split(',')[1]
                });
            }
            
        } catch (error) {
            console.error('❌ خطا در آپلود فایل:', error);
            this.addMessage('system', `❌ خطا در آپلود فایل "${file.name}"`);
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
            this.addMessage('system', '⚠️ برای ارسال ویس باید ابتدا به اپراتور انسانی متصل شوید.');
            return;
        }
        
        if (this.state.isRecording) return;
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });
            
            this.state.mediaRecorder = new MediaRecorder(stream);
            this.state.audioChunks = [];
            this.state.recordingTime = 0;
            
            this.state.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.state.audioChunks.push(event.data);
                }
            };
            
            this.state.mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(this.state.audioChunks, { 
                    type: 'audio/webm' 
                });
                
                if (audioBlob.size > 5 * 1024 * 1024) {
                    this.addMessage('system', '❌ پیام صوتی بسیار بزرگ است (حداکثر 5 مگابایت)');
                    return;
                }
                
                this.addMessage('user', `🎤 ارسال پیام صوتی (${this.state.recordingTime} ثانیه)`);
                
                try {
                    const base64 = await this.blobToBase64(audioBlob);
                    
                    if (this.state.socket) {
                        this.state.socket.emit('user-voice', {
                            sessionId: this.state.sessionId,
                            voiceBase64: base64.split(',')[1],
                            duration: this.state.recordingTime
                        });
                    }
                    
                } catch (error) {
                    console.error('❌ خطا در ارسال ویس:', error);
                    this.addMessage('system', '❌ خطا در ارسال پیام صوتی');
                }
                
                stream.getTracks().forEach(track => track.stop());
            };
            
            this.state.mediaRecorder.start();
            this.state.isRecording = true;
            this.elements.voiceBtn.classList.add('recording');
            this.elements.voiceBtn.innerHTML = '<i class="fas fa-stop-circle"></i><span>توقف ضبط</span>';
            
            this.recordingTimer = setInterval(() => {
                this.state.recordingTime++;
            }, 1000);
            
        } catch (error) {
            console.error('❌ خطا در دسترسی به میکروفون:', error);
            
            let errorMessage = '❌ دسترسی به میکروفون امکان‌پذیر نیست';
            if (error.name === 'NotAllowedError') {
                errorMessage = '⚠️ لطفاً دسترسی میکروفون را در مرورگر خود فعال کنید';
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
        clearInterval(this.recordingTimer);
        this.elements.voiceBtn.classList.remove('recording');
        this.elements.voiceBtn.innerHTML = '<i class="fas fa-microphone"></i><span>ضبط صوت</span>';
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
        
        let icon = '', sender = '', senderClass = '';
        
        switch (type) {
            case 'user':
                icon = '<i class="fas fa-user"></i>';
                sender = 'شما';
                senderClass = 'user-sender';
                break;
            case 'assistant':
                icon = '<i class="fas fa-robot"></i>';
                sender = 'دستیار هوشمند';
                senderClass = 'assistant-sender';
                break;
            case 'operator':
                icon = '<i class="fas fa-user-tie"></i>';
                sender = 'اپراتور انسانی';
                senderClass = 'operator-sender';
                break;
            case 'system':
                icon = '<i class="fas fa-info-circle"></i>';
                sender = 'سیستم';
                senderClass = 'system-sender';
                break;
        }
        
        messageEl.innerHTML = `
            ${sender ? `
                <div class="message-sender ${senderClass}">
                    ${icon}
                    <span>${sender}</span>
                </div>
            ` : ''}
            <div class="message-text">${this.formatMessage(text)}</div>
            <div class="message-time">${time}</div>
        `;
        
        if (this.elements.messagesContainer) {
            this.elements.messagesContainer.appendChild(messageEl);
            
            // اسکرول به پایین
            setTimeout(() => {
                this.elements.messagesContainer.scrollTop = this.elements.messagesContainer.scrollHeight;
            }, 100);
        }
        
        // ذخیره در تاریخچه
        this.state.messages.push({
            type,
            text,
            timestamp: new Date().toISOString(),
            sender,
            senderClass
        });
        
        // اگر چت باز نیست، نوتیفیکیشن بده
        if (!this.state.isOpen && (type === 'assistant' || type === 'operator' || type === 'system')) {
            this.state.unreadCount = (this.state.unreadCount || 0) + 1;
            this.showNotification();
            this.playNotificationSound();
            
            if (document.hidden) {
                this.startTabNotification();
            }
        }
    }
    
    formatMessage(text) {
        // تبدیل لینک‌ها به تگ <a>
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        text = text.replace(urlRegex, url => 
            `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: #667eea; text-decoration: underline;">${url}</a>`
        );
        
        // تبدیل خطوط جدید به <br>
        text = text.replace(/\n/g, '<br>');
        
        return text;
    }
    
    setTyping(typing) {
        this.state.isTyping = typing;
        if (this.elements.typingIndicator) {
            this.elements.typingIndicator.classList.toggle('active', typing);
        }
        if (this.elements.sendBtn) {
            this.elements.sendBtn.disabled = typing;
        }
        if (this.elements.messageInput) {
            this.elements.messageInput.disabled = typing;
        }
        
        if (!typing && this.elements.messageInput) {
            this.elements.messageInput.focus();
        }
    }
    
    showNotification(count = 1) {
        if (!this.state.isOpen && this.elements.notificationBadge) {
            this.state.unreadCount += count;
            this.elements.notificationBadge.textContent = this.state.unreadCount;
            this.elements.notificationBadge.style.display = 'flex';
            
            // انیمیشن دکمه
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
        this.state.unreadCount = 0;
        if (this.elements.notificationBadge) {
            this.elements.notificationBadge.textContent = '0';
            this.elements.notificationBadge.style.display = 'none';
            this.stopTabNotification();
        }
    }
    
    playNotificationSound() {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(800, audioCtx.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 0.1);
            
            gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
            
            oscillator.start(audioCtx.currentTime);
            oscillator.stop(audioCtx.currentTime + 0.3);
        } catch (error) {
            console.log('صدا پخش نشد:', error);
        }
    }
    
    startTabNotification() {
        if (this.tabNotificationInterval) return;
        
        let isOriginal = true;
        this.tabNotificationInterval = setInterval(() => {
            document.title = isOriginal ? 
                `(${this.state.unreadCount}) ${this.tabNotifyText}` : 
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
        // اگر کاربر چند بار با AI چت کرده، پیشنهاد اتصال به اپراتور بده
        const aiMessages = this.state.messages.filter(m => m.type === 'assistant').length;
        if (aiMessages >= 3 && !this.state.operatorConnected && !this.state.isConnecting) {
            setTimeout(() => {
                this.addMessage('system', 
                    '💡 **پیشنهاد:**\n\n' +
                    'اگر نیاز به راهنمایی تخصصی دارید، می‌توانید به اپراتور انسانی متصل شوید.'
                );
            }, 2000);
        }
    }
    
    // API عمومی
    open() {
        this.openChat();
    }
    
    close() {
        this.closeChat();
    }
    
    destroy() {
        // قطع اتصالات
        if (this.state.socket) {
            this.state.socket.disconnect();
        }
        
        // پاک کردن عناصر
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        
        // پاک کردن تایمرها
        this.stopTabNotification();
        
        console.log('ویجت چت از بین رفت');
    }
}

// اتولود ویجت وقتی DOM آماده است
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('🚀 DOM آماده شد - بارگذاری ویجت چت...');
        window.ChatWidget = new ChatWidget();
    });
} else {
    console.log('🚀 DOM از قبل آماده است - بارگذاری ویجت چت...');
    window.ChatWidget = new ChatWidget();
}

// API عمومی برای استفاده خارجی
window.initChatWidget = (options) => {
    console.log('🔧 بارگذاری ویجت چت با تنظیمات سفارشی...');
    return new ChatWidget(options);
};

// برای تست در کنسول
console.log('📱 ویجت چت آماده است! برای دسترسی از "ChatWidget" استفاده کنید.');
