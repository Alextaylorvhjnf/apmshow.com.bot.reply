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
            recordingTime: 0,
            chatHistoryLoaded: false,
            queuePosition: 0,
            estimatedWaitTime: 0,
            queueUpdateInterval: null
        };
        
        this.tabNotificationInterval = null;
        this.originalTitle = document.title;
        this.tabNotifyText = 'پیام جدید از پشتیبانی';
        
        this.handleVoiceMouseDown = this.handleVoiceMouseDown.bind(this);
        this.handleVoiceMouseUp = this.handleVoiceMouseUp.bind(this);
        this.handleVoiceTouchStart = this.handleVoiceTouchStart.bind(this);
        this.handleVoiceTouchEnd = this.handleVoiceTouchEnd.bind(this);
        this.handleVoiceMouseLeave = this.handleVoiceMouseLeave.bind(this);
        
        this.init();
    }

    init() {
        this.state.sessionId = this.generateSessionId();
        this.injectStyles();
        this.injectHTML();
        this.initEvents();
        this.connectWebSocket();
        this.loadChatHistory();
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
        if (!document.querySelector('link[href*="widget.css"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = `${this.options.backendUrl}/widget.css`;
            link.crossOrigin = 'anonymous';
            document.head.appendChild(link);
        }
        
        const style = document.createElement('style');
        style.textContent = `
            @keyframes pulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.18); }
                100% { transform: scale(1); }
            }
            
            @keyframes recordingPulse {
                0% { box-shadow: 0 0 0 0 rgba(255, 0, 0, 0.7); }
                70% { box-shadow: 0 0 0 10px rgba(255, 0, 0, 0); }
                100% { box-shadow: 0 0 0 0 rgba(255, 0, 0, 0); }
            }
            
            @keyframes queuePulse {
                0% { background-color: rgba(255, 193, 7, 0.1); }
                50% { background-color: rgba(255, 193, 7, 0.3); }
                100% { background-color: rgba(255, 193, 7, 0.1); }
            }
            
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            
            .chat-toggle-btn.pulse {
                animation: pulse 0.6s ease-in-out;
            }
            
            .notification-badge {
                position: absolute;
                top: -8px;
                right: -8px;
                background: #e74c3c;
                color: white;
                font-size: 11px;
                font-weight: bold;
                min-width: 18px;
                height: 18px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                border: 2px solid white;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            }
            
            .chat-window {
                display: none;
            }
            
            .chat-window.active {
                display: flex;
                opacity: 1;
                transform: translateY(0) scale(1);
            }
            
            .voice-btn,
            .file-btn {
                display: none;
                opacity: 0;
                transform: scale(0.8);
                transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            
            .voice-btn.active,
            .file-btn.active {
                display: flex;
                opacity: 1;
                transform: scale(1);
            }
            
            .voice-btn.recording {
                background: linear-gradient(145deg, #ff0000, #cc0000) !important;
                animation: recordingPulse 1.5s infinite;
            }
            
            .recording-indicator {
                display: none;
                align-items: center;
                gap: 8px;
                padding: 8px 16px;
                background: rgba(255, 0, 0, 0.1);
                border-radius: 20px;
                margin-top: 10px;
                font-size: 13px;
                font-weight: bold;
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
                animation: recordingPulse 1.5s infinite;
            }
            
            .recording-time {
                font-family: monospace;
            }
            
            .queue-indicator {
                display: none;
                align-items: center;
                gap: 10px;
                padding: 12px 16px;
                background: linear-gradient(145deg, #fff3cd, #ffeaa7);
                border-radius: 12px;
                margin: 10px 15px;
                font-size: 14px;
                font-weight: 600;
                color: #856404;
                border: 2px solid #ffc107;
                animation: queuePulse 2s infinite;
            }
            
            .queue-indicator.active {
                display: flex;
            }
            
            .queue-number {
                background: #ffc107;
                color: #000;
                font-weight: bold;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 16px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            }
            
            .queue-info {
                flex: 1;
            }
            
            .queue-title {
                font-weight: bold;
                margin-bottom: 4px;
            }
            
            .queue-time {
                font-size: 12px;
                opacity: 0.8;
            }
            
            .queue-progress {
                height: 6px;
                background: rgba(255, 193, 7, 0.2);
                border-radius: 3px;
                margin-top: 8px;
                overflow: hidden;
            }
            
            .queue-progress-bar {
                height: 100%;
                background: linear-gradient(90deg, #ffc107, #ff9800);
                border-radius: 3px;
                transition: width 0.5s ease;
            }
            
            .fa-spinner {
                animation: spin 1s linear infinite;
            }
            
            .record-instruction {
                display: none;
                text-align: center;
                font-size: 12px;
                color: #666;
                margin-top: 5px;
                padding: 5px;
                background: #f0f0f0;
                border-radius: 8px;
            }
            
            .record-instruction.active {
                display: block;
            }
            
            .chat-link {
                color: #0066cc;
                text-decoration: underline;
                word-break: break-all;
            }
            
            .chat-link:hover {
                color: #004499;
                text-decoration: none;
            }
            
            .chat-management-message {
                background: linear-gradient(145deg, #f8f9fa, #e9ecef) !important;
                border: 1px solid #dee2e6 !important;
                border-left: 4px solid #6c757d !important;
            }
            
            .chat-management-message .message-text {
                color: #495057 !important;
                font-weight: 500 !important;
            }
            
            .voice-btn:disabled,
            .file-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
        `;
        document.head.appendChild(style);
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
                        <div class="chat-logo"><i class="fas fa-headset"></i></div>
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
                        <button class="close-btn"><i class="fas fa-times"></i></button>
                    </div>
                </div>
                <div class="chat-messages">
                    <div class="message system">
                        <div class="message-text">
                            در حال بارگذاری تاریخچه چت...
                        </div>
                        <div class="message-time">همین الان</div>
                    </div>
                </div>
                
                <div class="queue-indicator">
                    <div class="queue-number">0</div>
                    <div class="queue-info">
                        <div class="queue-title">در صف انتظار</div>
                        <div class="queue-time">زمان تخمینی: 0 دقیقه</div>
                        <div class="queue-progress">
                            <div class="queue-progress-bar" style="width: 0%"></div>
                        </div>
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
                        <div class="operator-avatar"><i class="fas fa-user-tie"></i></div>
                        <div class="operator-details">
                            <h4><i class="fas fa-shield-alt"></i> اپراتور انسانی</h4>
                            <p>در حال حاضر با پشتیبان انسانی در ارتباط هستید</p>
                        </div>
                    </div>
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
                        <button class="voice-btn" title="ضبط صوت (نگه دارید)">
                            <i class="fas fa-microphone"></i>
                        </button>
                        <button class="file-btn" title="ارسال فایل">
                            <i class="fas fa-paperclip"></i>
                        </button>
                        <textarea class="message-input" placeholder="پیام خود را بنویسید..." rows="1"></textarea>
                        <button class="send-btn"><i class="fas fa-paper-plane"></i></button>
                    </div>
                    <button class="human-support-btn">
                        <i class="fas fa-user-headset"></i>
                        اتصال به اپراتور انسانی
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
            voiceBtn: this.container.querySelector('.voice-btn'),
            fileBtn: this.container.querySelector('.file-btn'),
            humanSupportBtn: this.container.querySelector('.human-support-btn'),
            typingIndicator: this.container.querySelector('.typing-indicator'),
            connectionStatus: this.container.querySelector('.connection-status'),
            operatorInfo: this.container.querySelector('.operator-info'),
            notificationBadge: this.container.querySelector('.notification-badge'),
            chatStatus: this.container.querySelector('.chat-status'),
            recordingIndicator: this.container.querySelector('.recording-indicator'),
            recordingTime: this.container.querySelector('.recording-time'),
            recordInstruction: this.container.querySelector('.record-instruction'),
            queueIndicator: this.container.querySelector('.queue-indicator'),
            queueNumber: this.container.querySelector('.queue-number'),
            queueTitle: this.container.querySelector('.queue-title'),
            queueTime: this.container.querySelector('.queue-time'),
            queueProgressBar: this.container.querySelector('.queue-progress-bar')
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
        
        // رویدادهای دکمه ویس
        this.elements.voiceBtn.addEventListener('mousedown', this.handleVoiceMouseDown);
        this.elements.voiceBtn.addEventListener('mouseup', this.handleVoiceMouseUp);
        this.elements.voiceBtn.addEventListener('mouseleave', this.handleVoiceMouseLeave);
        this.elements.voiceBtn.addEventListener('touchstart', this.handleVoiceTouchStart);
        this.elements.voiceBtn.addEventListener('touchend', this.handleVoiceTouchEnd);
        this.elements.voiceBtn.addEventListener('touchcancel', this.handleVoiceTouchEnd);
        
        this.elements.voiceBtn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            return false;
        });
        
        this.elements.fileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.uploadFile();
        });
        
        this.elements.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        this.elements.messageInput.addEventListener('input', () => this.resizeTextarea());
        
        this.elements.humanSupportBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.connectToHuman();
        });
        
        // جلوگیری از کلیک روی پنجره چت بسته
        this.elements.chatWindow.addEventListener('click', (e) => {
            if (!this.state.isOpen) {
                e.stopPropagation();
            }
        });
        
        // بستن پنجره با کلیک بیرون
        document.addEventListener('click', (e) => {
            if (this.state.isOpen && 
                !this.elements.chatWindow.contains(e.target) && 
                !this.elements.toggleBtn.contains(e.target)) {
                this.closeChat();
            }
        });
        
        // جلوگیری از انتشار رویداد روی پنجره چت
        this.elements.chatWindow.addEventListener('click', (e) => {
            if (this.state.isOpen) {
                e.stopPropagation();
            }
        });
        
        // اضافه کردن event listener برای release در سطح document
        document.addEventListener('mouseup', (e) => {
            if (this.state.isRecording && e.button === 0) {
                this.handleVoiceMouseUp();
            }
        });
        
        document.addEventListener('touchend', (e) => {
            if (this.state.isRecording) {
                this.handleVoiceTouchEnd();
            }
        });
    }

    // تابع‌های هندلر برای ضبط صدا
    handleVoiceMouseDown(e) {
        e.stopPropagation();
        e.preventDefault();
        this.startVoiceRecording();
    }

    handleVoiceMouseUp(e) {
        if (e) {
            e.stopPropagation();
            e.preventDefault();
        }
        if (this.state.isRecording) {
            this.stopVoiceRecording();
        }
    }

    handleVoiceMouseLeave(e) {
        if (this.state.isRecording) {
            this.stopVoiceRecording();
        }
    }

    handleVoiceTouchStart(e) {
        e.stopPropagation();
        e.preventDefault();
        this.startVoiceRecording();
    }

    handleVoiceTouchEnd(e) {
        if (e) {
            e.stopPropagation();
            e.preventDefault();
        }
        if (this.state.isRecording) {
            this.stopVoiceRecording();
        }
    }

    connectWebSocket() {
        try {
            const wsUrl = this.options.backendUrl.replace('http', 'ws');
            this.state.socket = io(wsUrl, {
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000
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
            
            this.state.socket.on('file-sent', (data) => {
                this.addMessage('system', data.message || '✅ فایل با موفقیت ارسال شد.');
            });
            
            this.state.socket.on('voice-sent', (data) => {
                this.addMessage('system', data.message || '✅ پیام صوتی با موفقیت ارسال شد.');
            });
            
            // رویدادهای جدید برای سیستم نوبت
            this.state.socket.on('chat-history-loaded', (data) => {
                this.loadChatHistoryFromServer(data.history);
            });
            
            this.state.socket.on('queue-status', (data) => {
                this.handleQueueStatusUpdate(data);
            });
            
            this.state.socket.on('chat-cleared', (data) => {
                this.handleChatCleared(data.message);
            });
            
            this.state.socket.on('chat-closed', (data) => {
                this.handleChatClosed(data.message);
            });
            
            this.state.socket.on('operator-disconnected', (data) => {
                this.handleOperatorDisconnected(data.message);
            });
            
            this.state.socket.on('ai-message', (data) => {
                this.addMessage('assistant', data.message);
            });
            
            this.state.socket.on('disconnect', () => {
                console.log('WebSocket disconnected');
                this.state.isConnected = false;
                this.updateConnectionStatus(false);
                this.stopQueueUpdate();
            });
            
            this.state.socket.on('connect_error', (error) => {
                console.error('WebSocket connection error:', error);
                this.state.isConnected = false;
                this.updateConnectionStatus(false);
                this.stopQueueUpdate();
            });
            
        } catch (error) {
            console.error('WebSocket connection failed:', error);
        }
    }

    updateConnectionStatus(connected) {
        if (connected) {
            this.elements.connectionStatus.classList.remove('active');
            this.elements.chatStatus.innerHTML = `<span class="status-dot"></span><span>آنلاین</span>`;
        } else {
            this.elements.connectionStatus.classList.add('active');
        }
    }

    async loadChatHistory() {
        try {
            const response = await fetch(`${this.options.backendUrl}/api/chat-history`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: this.state.sessionId })
            });
            
            const data = await response.json();
            
            if (data.success && data.history && data.history.length > 0) {
                this.elements.messagesContainer.innerHTML = '';
                
                data.history.forEach(item => {
                    let type = 'system';
                    if (item.role === 'user') type = 'user';
                    if (item.role === 'assistant') type = 'assistant';
                    if (item.role === 'operator') type = 'operator';
                    
                    this.addMessageFromHistory(type, item.content, item.timestamp);
                });
                
                this.state.chatHistoryLoaded = true;
                console.log(`✅ تاریخچه چت بارگذاری شد (${data.history.length} پیام)`);
                
                // اگر اپراتور متصل بود
                if (data.connectedToHuman) {
                    this.state.operatorConnected = true;
                    this.elements.operatorInfo.classList.add('active');
                    this.elements.voiceBtn.classList.add('active');
                    this.elements.fileBtn.classList.add('active');
                    this.elements.recordInstruction.classList.add('active');
                    this.elements.humanSupportBtn.innerHTML = `<i class="fas fa-user-check"></i> متصل به اپراتور`;
                    this.elements.humanSupportBtn.style.background = 'linear-gradient(145deg, #2ecc71, #27ae60)';
                    this.elements.humanSupportBtn.disabled = true;
                }
                
                // اگر در صف هست
                if (data.queuePosition > 0) {
                    this.handleQueueStatusUpdate({
                        position: data.queuePosition,
                        estimatedTime: data.estimatedWaitTime
                    });
                }
            } else {
                this.showWelcomeMessage();
            }
            
        } catch (error) {
            console.log('⚠️ خطا در بارگذاری تاریخچه');
            this.showWelcomeMessage();
        }
    }

    loadChatHistoryFromServer(history) {
        if (this.state.chatHistoryLoaded || !history || history.length === 0) return;
        
        this.elements.messagesContainer.innerHTML = '';
        
        history.forEach(item => {
            let type = 'system';
            if (item.role === 'user') type = 'user';
            if (item.role === 'assistant') type = 'assistant';
            if (item.role === 'operator') type = 'operator';
            
            this.addMessageFromHistory(type, item.content, item.timestamp);
        });
        
        this.state.chatHistoryLoaded = true;
        console.log(`✅ تاریخچه چت از سرور بارگذاری شد (${history.length} پیام)`);
    }

    showWelcomeMessage() {
        this.elements.messagesContainer.innerHTML = '';
        this.addMessage('system', 
            '👋 **سلام! به پشتیبانی هوشمند خوش آمدید**\n\n' +
            'من دستیار هوشمند شما هستم و می‌تونم در موارد زیر کمکتون کنم:\n\n' +
            '📦 **پیگیری سفارش** - کد رهگیری رو وارد کنید\n' +
            '🔍 **جستجوی محصول** - محصول مورد نظرتون رو جستجو کنید\n' +
            '🎁 **پیشنهاد محصول** - از من بخواید پیشنهاد بدم\n' +
            '👤 **اپراتور انسانی** - برای صحبت با پشتیبان\n\n' +
            'برای اتصال به **اپراتور انسانی** روی دکمه پایین کلیک کنید یا کلمه "اپراتور" رو تایپ کنید.'
        );
    }

    addMessageFromHistory(type, text, timestamp) {
        const messageEl = document.createElement('div');
        messageEl.className = `message ${type}`;
        
        const time = new Date(timestamp).toLocaleTimeString('fa-IR', { 
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
                sender = 'پشتیبان هوشمند';
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
        
        let formattedText = this.escapeHtml(text);
        formattedText = formattedText.replace(/\n/g, '<br>');
        
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        formattedText = formattedText.replace(urlRegex, (url) => {
            const cleanUrl = url.replace(/[.,;!?]$/, '');
            const displayUrl = cleanUrl.length > 50 ? cleanUrl.substring(0, 47) + '...' : cleanUrl;
            return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="chat-link">${displayUrl}</a>${url.slice(cleanUrl.length)}`;
        });
        
        messageEl.innerHTML = `
            ${icon ? `<div class="message-sender">${icon}<span>${sender}</span></div>` : ''}
            <div class="message-text">${formattedText}</div>
            <div class="message-time">${time}</div>
        `;
        
        this.elements.messagesContainer.appendChild(messageEl);
        this.state.messages.push({ type, text, time });
    }

    handleQueueStatusUpdate(data) {
        this.state.queuePosition = data.position;
        this.state.estimatedWaitTime = data.estimatedTime || data.position * 2;
        
        if (this.state.queuePosition > 0) {
            this.elements.queueIndicator.classList.add('active');
            this.elements.queueNumber.textContent = this.state.queuePosition;
            
            if (this.state.queuePosition === 1) {
                this.elements.queueTitle.textContent = '۱ نفر قبل از شما در صف';
                this.elements.queueTime.textContent = 'زمان تخمینی: ۲ دقیقه';
                this.elements.queueProgressBar.style.width = '90%';
            } else {
                const peopleBefore = this.state.queuePosition - 1;
                this.elements.queueTitle.textContent = `${peopleBefore} نفر قبل از شما در صف`;
                this.elements.queueTime.textContent = `زمان تخمینی: ${this.state.estimatedWaitTime} دقیقه`;
                
                const progress = Math.min(100, (1 / Math.max(this.state.queuePosition, 10)) * 100);
                this.elements.queueProgressBar.style.width = `${progress}%`;
            }
            
            this.startQueueUpdate();
        } else {
            this.elements.queueIndicator.classList.remove('active');
            this.stopQueueUpdate();
        }
        
        if (data.message) {
            this.addMessage('system', data.message);
        }
    }

    startQueueUpdate() {
        if (this.state.queueUpdateInterval) return;
        
        this.state.queueUpdateInterval = setInterval(() => {
            if (this.state.queuePosition > 0) {
                this.state.estimatedWaitTime = Math.max(1, this.state.estimatedWaitTime - 1);
                
                if (this.state.queuePosition === 1) {
                    this.elements.queueTime.textContent = 'تقریباً نوبت شماست...';
                } else {
                    const peopleBefore = this.state.queuePosition - 1;
                    this.elements.queueTime.textContent = `زمان تخمینی: ${this.state.estimatedWaitTime} دقیقه`;
                }
                
                if (this.state.estimatedWaitTime <= 0) {
                    this.checkQueueStatus();
                }
            }
        }, 60000);
    }

    stopQueueUpdate() {
        if (this.state.queueUpdateInterval) {
            clearInterval(this.state.queueUpdateInterval);
            this.state.queueUpdateInterval = null;
        }
    }

    async checkQueueStatus() {
        try {
            const response = await fetch(`${this.options.backendUrl}/api/chat-history`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: this.state.sessionId })
            });
            
            const data = await response.json();
            if (data.success) {
                if (data.queuePosition !== this.state.queuePosition) {
                    this.handleQueueStatusUpdate({
                        position: data.queuePosition,
                        estimatedTime: data.estimatedWaitTime
                    });
                }
            }
        } catch (error) {
            console.log('خطا در بررسی وضعیت صف:', error);
        }
    }

    handleChatCleared(message) {
        this.elements.messagesContainer.innerHTML = '';
        this.state.messages = [];
        
        const messageEl = document.createElement('div');
        messageEl.className = 'message system chat-management-message';
        messageEl.innerHTML = `
            <div class="message-sender"><i class="fas fa-trash-alt"></i><span>سیستم</span></div>
            <div class="message-text">${message}</div>
            <div class="message-time">${new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', hour12: false })}</div>
        `;
        
        this.elements.messagesContainer.appendChild(messageEl);
        
        this.state.operatorConnected = false;
        this.elements.operatorInfo.classList.remove('active');
        this.elements.voiceBtn.classList.remove('active');
        this.elements.fileBtn.classList.remove('active');
        this.elements.recordInstruction.classList.remove('active');
        
        this.resetHumanSupportButton();
        
        this.playNotificationSound();
        this.showNotification();
    }

    handleChatClosed(message) {
        const messageEl = document.createElement('div');
        messageEl.className = 'message system chat-management-message';
        messageEl.innerHTML = `
            <div class="message-sender"><i class="fas fa-door-closed"></i><span>سیستم</span></div>
            <div class="message-text">${message}</div>
            <div class="message-time">${new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', hour12: false })}</div>
        `;
        
        this.elements.messagesContainer.appendChild(messageEl);
        this.state.messages.push({ type: 'system', text: message });
        
        this.state.operatorConnected = false;
        this.elements.operatorInfo.classList.remove('active');
        this.elements.voiceBtn.classList.remove('active');
        this.elements.fileBtn.classList.remove('active');
        this.elements.recordInstruction.classList.remove('active');
        
        this.resetHumanSupportButton();
        
        setTimeout(() => {
            this.elements.messagesContainer.scrollTop = this.elements.messagesContainer.scrollHeight;
        }, 100);
        
        this.playNotificationSound();
        this.showNotification();
    }

    handleOperatorDisconnected(message) {
        this.addMessage('system', message);
        
        this.state.operatorConnected = false;
        this.elements.operatorInfo.classList.remove('active');
        this.elements.voiceBtn.classList.remove('active');
        this.elements.fileBtn.classList.remove('active');
        this.elements.recordInstruction.classList.remove('active');
        
        this.resetHumanSupportButton();
    }

    handleOperatorConnected(data) {
        this.elements.queueIndicator.classList.remove('active');
        this.stopQueueUpdate();
        
        this.state.operatorConnected = true;
        this.state.queuePosition = 0;
        
        this.elements.operatorInfo.classList.add('active');
        this.elements.voiceBtn.classList.add('active');
        this.elements.fileBtn.classList.add('active');
        this.elements.recordInstruction.classList.add('active');
        
        this.addMessage('system', data.message || '✅ **اپراتور به چت متصل شد**');
        
        this.elements.humanSupportBtn.innerHTML = `<i class="fas fa-user-check"></i> متصل به اپراتور`;
        this.elements.humanSupportBtn.style.background = 'linear-gradient(145deg, #2ecc71, #27ae60)';
        this.elements.humanSupportBtn.disabled = true;
        
        this.addMessage('system', '🎤 حالا می‌توانید پیام صوتی و فایل نیز ارسال کنید.');
    }

    toggleChat() {
        this.state.isOpen = !this.state.isOpen;
        if (this.state.isOpen) {
            this.elements.chatWindow.classList.add('active');
            this.elements.messageInput.focus();
            this.resetNotification();
            
            if (!this.state.chatHistoryLoaded) {
                this.loadChatHistory();
            }
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
            if (this.state.operatorConnected) {
                this.state.socket.emit('user-message', {
                    sessionId: this.state.sessionId,
                    message: message
                });
                console.log('پیام به اپراتور انسانی ارسال شد');
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
                    sessionId: this.state.sessionId,
                    userInfo: {
                        name: 'کاربر سایت',
                        page: location.href
                    }
                })
            });
            const data = await response.json();
            if (data.success) {
                this.addMessage('assistant', data.message);
                if (data.requiresHuman) {
                    this.elements.humanSupportBtn.innerHTML = `<i class="fas fa-user-headset"></i> اتصال به اپراتور انسانی (پیشنهاد سیستم)`;
                    this.elements.humanSupportBtn.style.background = '#ff9500';
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
        this.elements.humanSupportBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> در حال اتصال...`;
        
        try {
            const userInfo = { 
                name: 'کاربر سایت', 
                page: location.href 
            };
            
            const res = await fetch(`${this.options.backendUrl}/api/connect-human`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    sessionId: this.state.sessionId, 
                    userInfo 
                })
            });
            
            const data = await res.json();
            
            if (data.success) {
                if (data.queuePosition && data.queuePosition > 0) {
                    this.addMessage('system', data.message);
                    this.handleQueueStatusUpdate({
                        position: data.queuePosition,
                        estimatedTime: data.estimatedWaitTime,
                        message: data.message
                    });
                    
                    this.elements.humanSupportBtn.innerHTML = `<i class="fas fa-clock"></i> در صف انتظار`;
                    this.elements.humanSupportBtn.style.background = '#ff9500';
                    this.elements.humanSupportBtn.disabled = true;
                } else {
                    this.addMessage('system', data.message);
                    this.elements.humanSupportBtn.innerHTML = `<i class="fas fa-clock"></i> در انتظار پذیرش اپراتور`;
                    this.elements.humanSupportBtn.style.background = '#ff9500';
                    this.elements.humanSupportBtn.disabled = true;
                }
            } else {
                this.resetHumanSupportButton();
                this.addMessage('system', 'خطا در اتصال به اپراتور');
            }
        } catch (err) {
            console.error('خطا در اتصال:', err);
            this.addMessage('system', 'خطا در اتصال به اپراتور');
            this.resetHumanSupportButton();
        } finally {
            this.state.isConnecting = false;
        }
    }

    resetHumanSupportButton() {
        this.elements.humanSupportBtn.innerHTML = `<i class="fas fa-user-headset"></i> اتصال به اپراتور انسانی`;
        this.elements.humanSupportBtn.style.background = '#ff6b6b';
        this.elements.humanSupportBtn.disabled = false;
    }

    async startVoiceRecording() {
        if (!this.state.operatorConnected) {
            this.addMessage('system', 'برای ارسال پیام صوتی ابتدا به اپراتور انسانی متصل شوید.');
            return;
        }
        
        if (this.state.isRecording) return;
        
        try {
            this.stopAudioStream();
            
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 16000,
                    channelCount: 1
                }
            });
            
            this.state.audioStream = stream;
            this.state.isRecording = true;
            this.state.audioChunks = [];
            this.state.recordingStartTime = Date.now();
            this.state.recordingTime = 0;
            
            let mimeType = 'audio/mpeg';
            let fileExtension = '.mp3';
            
            if (MediaRecorder.isTypeSupported('audio/mpeg')) {
                mimeType = 'audio/mpeg';
                fileExtension = '.mp3';
            } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
                mimeType = 'audio/mp4';
                fileExtension = '.m4a';
            } else if (MediaRecorder.isTypeSupported('audio/webm')) {
                mimeType = 'audio/webm';
                fileExtension = '.webm';
            } else if (MediaRecorder.isTypeSupported('audio/ogg; codecs=opus')) {
                mimeType = 'audio/ogg; codecs=opus';
                fileExtension = '.ogg';
            }
            
            const options = { 
                mimeType: mimeType,
                audioBitsPerSecond: 64000
            };
            
            this.state.mediaRecorder = new MediaRecorder(stream, options);
            
            this.state.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.state.audioChunks.push(event.data);
                }
            };
            
            this.state.mediaRecorder.onstop = async () => {
                await this.finishVoiceRecording(fileExtension);
            };
            
            this.state.mediaRecorder.start(250);
            
            this.elements.voiceBtn.classList.add('recording');
            this.elements.recordingIndicator.classList.add('active');
            this.elements.recordInstruction.textContent = 'در حال ضبط... رها کنید تا ارسال شود';
            this.elements.voiceBtn.innerHTML = '<i class="fas fa-stop"></i>';
            
            this.startRecordingTimer();
            
            this.elements.fileBtn.disabled = true;
            this.elements.sendBtn.disabled = true;
            this.state.isTyping = true;
            this.elements.messageInput.disabled = true;
            this.elements.humanSupportBtn.disabled = true;
            
        } catch (error) {
            console.error('Error accessing microphone:', error);
            let errorMessage = 'خطا در دسترسی به میکروفون. ';
            if (error.name === 'NotAllowedError') {
                errorMessage += 'لطفاً دسترسی میکروفون را در مرورگر خود فعال کنید.';
            } else if (error.name === 'NotFoundError') {
                errorMessage += 'میکروفون پیدا نشد.';
            } else {
                errorMessage += 'لطفاً دسترسی را بررسی کنید.';
            }
            this.addMessage('system', errorMessage);
            this.state.isRecording = false;
        }
    }
    
    stopVoiceRecording() {
        if (!this.state.isRecording || !this.state.mediaRecorder) return;
        
        console.log('Stopping recording...');
        
        if (this.state.mediaRecorder.state === 'recording') {
            this.state.mediaRecorder.stop();
        }
        
        this.stopRecordingTimer();
        this.stopAudioStream();
        
        this.elements.voiceBtn.classList.remove('recording');
        this.elements.recordingIndicator.classList.remove('active');
        this.elements.recordInstruction.textContent = 'برای ضبط صدا، دکمه میکروفون را نگه دارید و رها کنید تا ارسال شود';
        this.elements.voiceBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        
        this.elements.fileBtn.disabled = false;
        this.elements.sendBtn.disabled = false;
        this.state.isTyping = false;
        this.elements.messageInput.disabled = false;
        this.elements.humanSupportBtn.disabled = false;
    }
    
    stopAudioStream() {
        if (this.state.audioStream) {
            this.state.audioStream.getTracks().forEach(track => {
                track.stop();
            });
            this.state.audioStream = null;
        }
    }
    
    startRecordingTimer() {
        this.state.recordingTimer = setInterval(() => {
            if (this.elements.recordingTime) {
                this.state.recordingTime++;
                const minutes = Math.floor(this.state.recordingTime / 60);
                const seconds = this.state.recordingTime % 60;
                this.elements.recordingTime.textContent = 
                    `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                
                if (this.state.recordingTime >= 180) {
                    this.addMessage('system', '⏰ حداکثر زمان ضبط (۳ دقیقه) به پایان رسید.');
                    this.stopVoiceRecording();
                }
            }
        }, 1000);
    }
    
    stopRecordingTimer() {
        if (this.state.recordingTimer) {
            clearInterval(this.state.recordingTimer);
            this.state.recordingTimer = null;
        }
    }
    
    async finishVoiceRecording(fileExtension) {
        if (this.state.audioChunks.length === 0) {
            this.addMessage('system', 'پیام صوتی ضبط نشد.');
            this.state.isRecording = false;
            return;
        }
        
        if (this.state.recordingTime < 1) {
            this.addMessage('system', 'پیام صوتی خیلی کوتاه بود.');
            this.state.isRecording = false;
            this.state.audioChunks = [];
            return;
        }
        
        const mimeType = this.state.mediaRecorder?.mimeType || 'audio/mpeg';
        const audioBlob = new Blob(this.state.audioChunks, { type: mimeType });
        const duration = this.state.recordingTime;
        
        this.addMessage('user', `🎤 پیام صوتی (${duration} ثانیه)`);
        
        try {
            if (audioBlob.size > 20 * 1024 * 1024) {
                this.addMessage('system', '❌ پیام صوتی بسیار بزرگ است (بیشتر از 20 مگابایت).');
                this.state.isRecording = false;
                this.state.audioChunks = [];
                this.state.mediaRecorder = null;
                return;
            }
            
            if (audioBlob.size < 100) {
                this.addMessage('system', '❌ پیام صوتی خیلی کوچک است.');
                this.state.isRecording = false;
                this.state.audioChunks = [];
                this.state.mediaRecorder = null;
                return;
            }
            
            const base64 = await this.blobToBase64(audioBlob);
            const timestamp = Date.now();
            const fileName = `voice_${timestamp}${fileExtension}`;
            
            if (this.state.socket && this.state.operatorConnected) {
                this.state.socket.emit('user-voice', {
                    sessionId: this.state.sessionId,
                    voiceBase64: base64.split(',')[1],
                    duration: duration,
                    fileName: fileName,
                    mimeType: mimeType,
                    fileSize: audioBlob.size,
                    pageUrl: window.location.href,
                    fileExtension: fileExtension,
                    forTelegram: true,
                    telegramBotToken: this.options.telegramBotToken,
                    telegramChatId: this.options.telegramChatId,
                    caption: `🎤 پیام صوتی از کاربر\n⏱ مدت: ${duration} ثانیه\n📁 حجم: ${this.formatFileSize(audioBlob.size)}`
                });
                
                console.log('Voice sent via WebSocket');
                this.addMessage('system', '✅ پیام صوتی برای ارسال به تلگرام آماده شد.');
            } else {
                this.addMessage('system', '❌ اتصال به سرور برقرار نیست.');
            }
            
        } catch (error) {
            console.error('Error sending voice via WebSocket:', error);
            this.addMessage('system', '❌ خطا در ارسال پیام صوتی.');
        }
        
        this.state.isRecording = false;
        this.state.audioChunks = [];
        this.state.mediaRecorder = null;
        this.state.recordingTime = 0;
    }
    
    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    }
    
    uploadFile() {
        if (!this.state.operatorConnected) {
            this.addMessage('system', 'برای ارسال فایل ابتدا به اپراتور انسانی متصل شوید.');
            return;
        }
        
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*,.pdf,.doc,.docx,.txt,.mp3,.wav,.ogg,.mp4,.zip,.rar';
        input.multiple = false;
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (file) {
                await this.processFileUpload(file);
            }
        };
        input.click();
    }
    
    async processFileUpload(file) {
        const MAX_SIZE = 50 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
            this.addMessage('system', `❌ فایل "${file.name}" بسیار بزرگ است (حداکثر 50 مگابایت)`);
            return;
        }
        
        this.addMessage('user', `📎 ارسال فایل: ${file.name} (${this.formatFileSize(file.size)})`);
        this.addMessage('system', `⏳ در حال آپلود فایل "${file.name}"...`);
        
        try {
            const base64 = await this.fileToBase64(file);
            
            if (this.state.socket && this.state.operatorConnected) {
                this.state.socket.emit('user-file', {
                    sessionId: this.state.sessionId,
                    fileName: file.name,
                    fileBase64: base64.split(',')[1],
                    fileType: file.type,
                    fileSize: file.size,
                    mimeType: file.type,
                    pageUrl: window.location.href,
                    forTelegram: true,
                    telegramBotToken: this.options.telegramBotToken,
                    telegramChatId: this.options.telegramChatId,
                    caption: `📎 فایل از کاربر\n📁 نام: ${file.name}\n📊 حجم: ${this.formatFileSize(file.size)}\n📄 نوع: ${file.type || 'ناشناخته'}`
                });
                
                console.log('File sent via WebSocket');
                this.addMessage('system', '✅ فایل برای ارسال به تلگرام آماده شد.');
            } else {
                this.addMessage('system', '❌ اتصال به سرور برقرار نیست.');
            }
            
        } catch (error) {
            console.error('Error uploading file:', error);
            this.addMessage('system', '❌ خطا در آپلود فایل. لطفاً دوباره تلاش کنید.');
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
    
    formatFileSize(bytes) {
        if (bytes === 0) return '0 بایت';
        const k = 1024;
        const sizes = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
    
    playNotificationSound() {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
            osc.start(audioCtx.currentTime);
            osc.stop(audioCtx.currentTime + 0.3);
        } catch (e) {
            console.log('Could not play notification sound:', e);
        }
    }
    
    showNotification(count = 1) {
        let current = parseInt(this.elements.notificationBadge.textContent) || 0;
        current += count;
        this.elements.notificationBadge.textContent = current;
        this.elements.notificationBadge.style.display = 'flex';
        this.elements.toggleBtn.classList.add('pulse');
        setTimeout(() => this.elements.toggleBtn.classList.remove('pulse'), 600);
    }
    
    resetNotification() {
        this.elements.notificationBadge.textContent = '0';
        this.elements.notificationBadge.style.display = 'none';
        this.stopTabNotification();
    }
    
    startTabNotification() {
        if (this.tabNotificationInterval) return;
        let toggled = false;
        this.tabNotificationInterval = setInterval(() => {
            document.title = toggled ? this.originalTitle : this.tabNotifyText;
            toggled = !toggled;
        }, 1500);
    }
    
    stopTabNotification() {
        if (this.tabNotificationInterval) {
            clearInterval(this.tabNotificationInterval);
            this.tabNotificationInterval = null;
            document.title = this.originalTitle;
        }
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
                sender = 'پشتیبان هوشمند';
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
        
        let formattedText = this.escapeHtml(text);
        formattedText = formattedText.replace(/\n/g, '<br>');
        
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        formattedText = formattedText.replace(urlRegex, (url) => {
            const cleanUrl = url.replace(/[.,;!?]$/, '');
            const displayUrl = cleanUrl.length > 50 ? cleanUrl.substring(0, 47) + '...' : cleanUrl;
            return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="chat-link">${displayUrl}</a>${url.slice(cleanUrl.length)}`;
        });
        
        messageEl.innerHTML = `
            ${icon ? `<div class="message-sender">${icon}<span>${sender}</span></div>` : ''}
            <div class="message-text">${formattedText}</div>
            <div class="message-time">${time}</div>
        `;
        
        this.elements.messagesContainer.appendChild(messageEl);
        
        setTimeout(() => {
            this.elements.messagesContainer.scrollTop = this.elements.messagesContainer.scrollHeight;
        }, 100);
        
        this.state.messages.push({ type, text, time });
        
        if (type !== 'user') {
            this.playNotificationSound();
            if (!this.state.isOpen) this.showNotification();
            if (document.hidden) this.startTabNotification();
        }
    }
    
    setTyping(typing) {
        this.state.isTyping = typing;
        this.elements.typingIndicator.classList.toggle('active', typing);
        this.elements.sendBtn.disabled = typing;
        this.elements.messageInput.disabled = typing;
        if (!typing) this.elements.messageInput.focus();
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// اضافه کردن Font Awesome
if (!document.querySelector('link[href*="font-awesome"]')) {
    const faLink = document.createElement('link');
    faLink.rel = 'stylesheet';
    faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
    document.head.appendChild(faLink);
}

// راه‌اندازی خودکار
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.ChatWidget = new ChatWidget());
} else {
    window.ChatWidget = new ChatWidget();
}

window.initChatWidget = (options) => new ChatWidget(options);
