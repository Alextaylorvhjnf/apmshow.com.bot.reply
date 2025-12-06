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
            // وضعیت صف
            isInQueue: false,
            queuePosition: 0,
            totalInQueue: 0,
            estimatedWaitTime: 0
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
            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(10px); }
                to { opacity: 1; transform: translateY(0); }
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
            .voice-btn:disabled,
            .file-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
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
            .fa-spinner {
                animation: spin 1s linear infinite;
            }
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
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
            /* استایل صف انتظار */
            .queue-status {
                display: none;
                background: linear-gradient(145deg, #fff3cd, #ffeaa7);
                border: 1px solid #ffc107;
                border-radius: 10px;
                padding: 12px;
                margin: 10px 0;
                animation: fadeIn 0.5s ease;
            }
            .queue-status.active {
                display: block;
            }
            .queue-info {
                display: flex;
                align-items: center;
                gap: 10px;
                margin-bottom: 8px;
            }
            .queue-icon {
                font-size: 20px;
                color: #ff9800;
            }
            .queue-position {
                font-size: 18px;
                font-weight: bold;
                color: #333;
            }
            .queue-details {
                font-size: 13px;
                color: #666;
            }
            .leave-queue-btn {
                background: #95a5a6;
                color: white;
                border: none;
                border-radius: 8px;
                padding: 8px 16px;
                font-size: 14px;
                cursor: pointer;
                margin-top: 10px;
                width: 100%;
                transition: background 0.3s;
                font-family: inherit;
            }
            .leave-queue-btn:hover {
                background: #7f8c8d;
            }
            /* استایل جدید برای دکمه شناور */
            .floating-widget-container {
                position: fixed;
                z-index: 999999;
                ${this.options.position === 'bottom-right' ? 'right: 20px; left: auto;' : 'left: 20px; right: auto;'}
                ${this.options.position.includes('bottom') ? 'bottom: 20px; top: auto;' : 'top: 20px; bottom: auto;'}
                display: flex;
                flex-direction: column;
                align-items: ${this.options.position.includes('right') ? 'flex-end' : 'flex-start'};
                gap: 10px;
            }
            .floating-message {
                background: white;
                color: #333;
                padding: 12px 16px;
                border-radius: 12px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.15);
                font-size: 14px;
                font-weight: 500;
                max-width: 250px;
                animation: fadeIn 0.5s ease;
                border-right: 4px solid #3498db;
                display: none;
            }
            .floating-message.active {
                display: block;
            }
            .chat-toggle-btn {
                width: 60px;
                height: 60px;
                border-radius: 50%;
                background: linear-gradient(145deg, #3498db, #2980b9);
                border: none;
                color: white;
                font-size: 24px;
                cursor: pointer;
                box-shadow: 0 4px 15px rgba(52, 152, 219, 0.3);
                transition: all 0.3s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                position: relative;
            }
            .chat-toggle-btn:hover {
                transform: scale(1.05);
                box-shadow: 0 6px 20px rgba(52, 152, 219, 0.4);
            }
            .chat-toggle-btn i {
                transition: transform 0.3s ease;
            }
            .chat-toggle-btn:hover i {
                transform: scale(1.1);
            }
        `;
        document.head.appendChild(style);
    }

    injectHTML() {
        this.container = document.createElement('div');
        this.container.className = 'floating-widget-container';
        this.container.innerHTML = `
            <div class="floating-message">
                <div class="welcome-text">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                        <i class="fas fa-comments" style="color: #3498db;"></i>
                        <strong style="font-size: 15px;">سلام!</strong>
                    </div>
                    <div style="font-size: 13px; line-height: 1.5;">
                        چطور می‌تونم کمکتون کنم؟ 😊
                    </div>
                </div>
            </div>
            <button class="chat-toggle-btn">
                <img src="https://shikpooshaan.ir/widjet.logo.png" 
                     alt="پشتیبانی شیک‌پوشان" 
                     style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover;"
                     onerror="this.style.display='none'; this.parentNode.innerHTML='<i class=\\'fas fa-headset\\'></i>'">
                <span class="notification-badge" style="display: none">0</span>
            </button>
            <div class="chat-window">
                <div class="chat-header">
                    <div class="header-left">
                        <div class="chat-logo">
                            <img src="https://shikpooshaan.ir/widjet.logo.png" 
                                 alt="شیک‌پوشان"
                                 style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;"
                                 onerror="this.style.display='none'; this.parentNode.innerHTML='<i class=\\'fas fa-headset\\'></i>'">
                        </div>
                        <div class="chat-title">
                            <h3>پشتیبان شیک‌پوشان</h3>
                            <p>در خدمت شما هستیم</p>
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
                
                <div class="queue-status">
                    <div class="queue-info">
                        <div class="queue-icon"><i class="fas fa-clock"></i></div>
                        <div class="queue-position">موقعیت شما: <span id="queue-position">1</span></div>
                    </div>
                    <div class="queue-details">
                        <div>🕐 تخمین زمان: <span id="queue-time">2</span> دقیقه</div>
                        <div>👥 افراد در صف: <span id="queue-total">0</span> نفر</div>
                    </div>
                    <button class="leave-queue-btn">
                        <i class="fas fa-sign-out-alt"></i> ترک صف
                    </button>
                </div>
                
                <div class="chat-messages">
                    <div class="message system">
                        <div class="message-text">
                            در حال بارگذاری تاریخچه چت...
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
            queueStatus: this.container.querySelector('.queue-status'),
            queuePosition: this.container.querySelector('#queue-position'),
            queueTime: this.container.querySelector('#queue-time'),
            queueTotal: this.container.querySelector('#queue-total'),
            leaveQueueBtn: this.container.querySelector('.leave-queue-btn'),
            floatingMessage: this.container.querySelector('.floating-message')
        };
        
        this.showFloatingMessage();
    }

    showFloatingMessage() {
        setTimeout(() => {
            this.elements.floatingMessage.classList.add('active');
            
            setTimeout(() => {
                this.elements.floatingMessage.classList.remove('active');
            }, 8000);
        }, 1000);
        
        this.elements.toggleBtn.addEventListener('mouseenter', () => {
            this.elements.floatingMessage.classList.add('active');
        });
        
        this.elements.toggleBtn.addEventListener('mouseleave', () => {
            this.elements.floatingMessage.classList.remove('active');
        });
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
        
        this.elements.leaveQueueBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.leaveQueue();
        });
        
        document.addEventListener('click', (e) => {
            if (this.state.isOpen && 
                !this.elements.chatWindow.contains(e.target) && 
                !this.elements.toggleBtn.contains(e.target)) {
                this.closeChat();
            }
        });
        
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
                console.log('File sent confirmation:', data);
                this.addMessage('system', data.message || 'فایل با موفقیت ارسال شد.');
            });
            
            this.state.socket.on('voice-sent', (data) => {
                console.log('Voice sent confirmation:', data);
                this.addMessage('system', data.message || 'پیام صوتی با موفقیت ارسال شد.');
            });
            
            this.state.socket.on('chat-history-loaded', (data) => {
                this.loadChatHistoryFromServer(data.history);
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
            
            // رویدادهای جدید برای سیستم نوبت‌دهی
            this.state.socket.on('operator-busy', (data) => {
                this.handleOperatorBusy(data);
            });
            
            this.state.socket.on('queue-update', (data) => {
                this.updateQueueStatus(data);
            });
            
            this.state.socket.on('left-queue', (data) => {
                this.handleLeftQueue(data.message);
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
            } else {
                this.showWelcomeMessage();
            }
            
        } catch (error) {
            console.log('⚠️ خطا در بارگذاری تاریخچه، نمایش پیام خوش‌آمدگویی');
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
            'سلام! من دستیار هوشمند شما هستم. چطور می‌تونم کمکتون کنم؟\n\n' +
            'می‌تونید:\n' +
            '• کد پیگیری سفارش رو وارد کنید 📦\n' +
            '• محصول خاصی رو جستجو کنید 🔍\n' +
            '• از من بخواهید پیشنهاد بدم 🎁\n' +
            '• یا برای صحبت با "اپراتور" بنویسید 👤'
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

    handleOperatorBusy(data) {
        this.state.isInQueue = true;
        this.state.queuePosition = data.position;
        this.state.totalInQueue = data.totalInQueue;
        this.state.estimatedWaitTime = data.position * 2;
        
        this.updateQueueDisplay();
        
        this.addMessage('system', data.message);
        
        this.elements.queueStatus.classList.add('active');
        
        this.elements.humanSupportBtn.innerHTML = 
            `<i class="fas fa-clock"></i> در صف انتظار (موقعیت: ${data.position})`;
        this.elements.humanSupportBtn.style.background = '#ff9500';
        this.elements.humanSupportBtn.disabled = false;
    }

    updateQueueStatus(data) {
        if (!this.state.isInQueue) return;
        
        this.state.queuePosition = data.position;
        this.state.totalInQueue = data.totalInQueue;
        this.state.estimatedWaitTime = data.estimatedTime;
        
        this.updateQueueDisplay();
        
        this.elements.humanSupportBtn.innerHTML = 
            `<i class="fas fa-clock"></i> در صف انتظار (موقعیت: ${data.position})`;
    }

    updateQueueDisplay() {
        this.elements.queuePosition.textContent = this.state.queuePosition;
        this.elements.queueTime.textContent = this.state.estimatedWaitTime;
        this.elements.queueTotal.textContent = this.state.totalInQueue;
    }

    handleLeftQueue(message) {
        this.state.isInQueue = false;
        this.elements.queueStatus.classList.remove('active');
        
        this.addMessage('system', message);
        
        this.resetHumanSupportButton();
    }

    async leaveQueue() {
        if (!this.state.isInQueue) return;
        
        try {
            const response = await fetch(`${this.options.backendUrl}/api/leave-queue`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: this.state.sessionId })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.state.isInQueue = false;
                this.elements.queueStatus.classList.remove('active');
                
                this.addMessage('system', 'شما از صف انتظار خارج شدید.');
                
                this.resetHumanSupportButton();
                
                if (this.state.socket) {
                    this.state.socket.emit('leave-queue', this.state.sessionId);
                }
            }
        } catch (error) {
            console.error('Error leaving queue:', error);
            this.addMessage('system', 'خطا در ترک صف. لطفاً دوباره تلاش کنید.');
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
        this.state.operatorConnected = true;
        this.elements.operatorInfo.classList.add('active');
        
        this.elements.voiceBtn.classList.add('active');
        this.elements.fileBtn.classList.add('active');
        
        this.elements.recordInstruction.classList.add('active');
        
        this.addMessage('system', data.message || '🎉 اپراتور متصل شد!');
        
        this.elements.humanSupportBtn.innerHTML = `<i class="fas fa-user-check"></i> متصل به اپراتور`;
        this.elements.humanSupportBtn.style.background = 'linear-gradient(145deg, #2ecc71, #27ae60)';
        this.elements.humanSupportBtn.disabled = true;
        
        if (this.state.isInQueue) {
            this.state.isInQueue = false;
            this.elements.queueStatus.classList.remove('active');
        }
        
        this.addMessage('system', '🎤 حالا می‌توانید فایل و پیام صوتی نیز ارسال کنید.');
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
            }
        } catch (error) {
            this.addMessage('system', 'خطا در ارتباط با سرور');
        }
    }

    async connectToHuman() {
        if (this.state.operatorConnected || this.state.isConnecting || this.state.isInQueue) return;
        
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
                if (data.waiting) {
                    this.state.isInQueue = true;
                    this.state.queuePosition = data.position;
                    this.state.totalInQueue = data.totalInQueue;
                    this.state.estimatedWaitTime = data.position * 2;
                    
                    this.updateQueueDisplay();
                    
                    this.addMessage('system', data.message + ` موقعیت شما در صف: ${data.position}`);
                    
                    this.elements.humanSupportBtn.innerHTML = 
                        `<i class="fas fa-clock"></i> در صف انتظار (موقعیت: ${data.position})`;
                    this.elements.humanSupportBtn.style.background = '#ff9500';
                    this.elements.humanSupportBtn.disabled = false;
                    
                    this.elements.queueStatus.classList.add('active');
                    
                } else if (data.connected) {
                    this.handleOperatorConnected({ 
                        message: data.message,
                        autoConnected: true 
                    });
                }
            } else {
                this.addMessage('system', 'خطا در اتصال به اپراتور');
                this.resetHumanSupportButton();
            }
            
        } catch (err) {
            console.error('Error connecting to human:', err);
            this.addMessage('system', 'خطا در اتصال به اپراتور');
            this.resetHumanSupportButton();
        } finally {
            this.state.isConnecting = false;
        }
    }

    resetHumanSupportButton() {
        this.elements.humanSupportBtn.innerHTML = `<i class="fas fa-user-headset"></i> اتصال به اپراتور انسانی`;
        this.elements.humanSupportBtn.style.background = 'linear-gradient(145deg, #ff6b6b, #ee5a52)';
        this.elements.humanSupportBtn.disabled = false;
    }
    
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
            
            console.log('Selected audio format for Telegram:', mimeType, 'extension:', fileExtension);
            
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
                
                console.log('Voice sent via WebSocket for Telegram:', {
                    duration: duration + 's',
                    size: this.formatFileSize(audioBlob.size),
                    type: mimeType,
                    extension: fileExtension,
                    name: fileName
                });
                
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
                
                console.log('File sent via WebSocket for Telegram:', {
                    name: file.name,
                    size: this.formatFileSize(file.size),
                    type: file.type
                });
                
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
