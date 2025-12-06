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
            recordingTimer: null
        };
        // برای چشمک زدن تب و صدا
        this.tabNotificationInterval = null;
        this.originalTitle = document.title;
        this.tabNotifyText = 'پیام جدید از پشتیبانی';
        this.init();
    }
    init() {
        this.state.sessionId = this.generateSessionId();
        this.injectStyles();
        this.injectHTML();
        this.initEvents();
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
        if (!document.querySelector('link[href*="widget.css"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = `${this.options.backendUrl}/widget.css`;
            link.crossOrigin = 'anonymous';
            document.head.appendChild(link);
        }
        // اضافه کردن انیمیشن pulse برای دکمه
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
            /* رفع مشکل تداخل */
            .chat-window {
                display: none;
            }
            .chat-window.active {
                display: flex;
                opacity: 1;
                transform: translateY(0) scale(1);
            }
            /* استایل برای دکمه‌های مخفی */
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
            /* استایل برای حالت ضبط */
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
                        <div class="chat-logo"><i class=""></i></div>
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
                        <div class="operator-avatar"><i class="fas fa-user-tie"></i></div>
                        <div class="operator-details">
                            <h4><i class="fas fa-shield-alt"></i> اپراتور انسانی</h4>
                            <p>در حال حاضر با پشتیبان انسانی در ارتباط هستید</p>
                        </div>
                    </div>
                </div>
                <div class="chat-input-area">
                    <div class="recording-indicator">
                        <div class="recording-dot"></div>
                        <span>در حال ضبط...</span>
                        <span class="recording-time">00:00</span>
                    </div>
                    <div class="input-wrapper">
                        <button class="voice-btn"><i class="fas fa-microphone"></i></button>
                        <button class="file-btn"><i class="fas fa-paperclip"></i></button>
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
            recordingTime: this.container.querySelector('.recording-time')
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
        this.elements.voiceBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this.startVoiceRecording();
        });
        
        this.elements.voiceBtn.addEventListener('mouseup', (e) => {
            e.stopPropagation();
            this.stopVoiceRecording();
        });
        
        this.elements.voiceBtn.addEventListener('mouseleave', (e) => {
            if (this.state.isRecording) {
                this.stopVoiceRecording();
            }
        });
        
        // رویدادهای لمسی برای موبایل
        this.elements.voiceBtn.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            e.preventDefault();
            this.startVoiceRecording();
        });
        
        this.elements.voiceBtn.addEventListener('touchend', (e) => {
            e.stopPropagation();
            e.preventDefault();
            this.stopVoiceRecording();
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
                this.state.socket.emit('join-session', this.state.sessionId);
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
            this.elements.chatStatus.innerHTML = `<span class="status-dot"></span><span>آنلاین</span>`;
        } else {
            this.elements.connectionStatus.classList.add('active');
        }
    }
    toggleChat() {
        this.state.isOpen = !this.state.isOpen;
        if (this.state.isOpen) {
            this.elements.chatWindow.classList.add('active');
            this.elements.messageInput.focus();
            this.resetNotification(); // مهم: وقتی باز کرد، نوتیفیکیشن صفر بشه
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
                body: JSON.stringify({ message, sessionId: this.state.sessionId })
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
            const userInfo = { name: 'کاربر سایت', page: location.href };
            const res = await fetch(`${this.options.backendUrl}/api/connect-human`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: this.state.sessionId, userInfo })
            });
            const data = await res.json();
            if (data.success) {
                this.state.operatorConnected = true;
                this.elements.operatorInfo.classList.add('active');
                this.addMessage('system', 'در حال اتصال به اپراتور انسانی...');
                this.elements.humanSupportBtn.innerHTML = `<i class="fas fa-user-check"></i> متصل به اپراتور`;
                this.elements.humanSupportBtn.style.background = 'linear-gradient(145deg, #2ecc71, #27ae60)';
                this.elements.humanSupportBtn.disabled = true;
            } else {
                this.resetHumanSupportButton();
            }
        } catch (err) {
            this.addMessage('system', 'خطا در اتصال');
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
    handleOperatorConnected(data) {
        this.state.operatorConnected = true;
        this.elements.operatorInfo.classList.add('active');
        
        // فعال کردن دکمه‌های ویس و فایل وقتی اپراتور متصل شد
        this.elements.voiceBtn.classList.add('active');
        this.elements.fileBtn.classList.add('active');
        
        this.addMessage('system', data.message || 'اپراتور متصل شد!');
        
        // پیام اضافه برای اطلاع کاربر
        this.addMessage('system', 'حالا می‌توانید فایل و پیام صوتی نیز ارسال کنید.');
    }
    
    async startVoiceRecording() {
        // فقط اگر اپراتور متصل است
        if (!this.state.operatorConnected) {
            this.addMessage('system', 'برای ارسال پیام صوتی ابتدا به اپراتور انسانی متصل شوید.');
            return;
        }
        
        if (this.state.isRecording) return;
        
        try {
            // درخواست دسترسی به میکروفون
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: true 
            });
            
            this.state.isRecording = true;
            this.state.audioChunks = [];
            this.state.recordingStartTime = Date.now();
            
            // ایجاد MediaRecorder
            this.state.mediaRecorder = new MediaRecorder(stream);
            
            // ذخیره داده‌های ضبط شده
            this.state.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.state.audioChunks.push(event.data);
                }
            };
            
            // وقتی ضبط تمام شد
            this.state.mediaRecorder.onstop = () => {
                this.finishVoiceRecording();
            };
            
            // شروع ضبط
            this.state.mediaRecorder.start();
            
            // تغییر ظاهر دکمه
            this.elements.voiceBtn.classList.add('recording');
            this.elements.recordingIndicator.classList.add('active');
            
            // شروع تایمر
            this.startRecordingTimer();
            
            // غیرفعال کردن سایر دکمه‌ها
            this.elements.fileBtn.disabled = true;
            this.elements.sendBtn.disabled = true;
            this.elements.messageInput.disabled = true;
            
        } catch (error) {
            console.error('Error accessing microphone:', error);
            this.addMessage('system', 'خطا در دسترسی به میکروفون. لطفاً دسترسی را بررسی کنید.');
            this.state.isRecording = false;
        }
    }
    
    stopVoiceRecording() {
        if (!this.state.isRecording || !this.state.mediaRecorder) return;
        
        // متوقف کردن ضبط
        this.state.mediaRecorder.stop();
        
        // متوقف کردن تایمر
        this.stopRecordingTimer();
        
        // توقف تمام trackهای stream
        if (this.state.mediaRecorder.stream) {
            this.state.mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
        
        // بازگرداندن ظاهر دکمه
        this.elements.voiceBtn.classList.remove('recording');
        this.elements.recordingIndicator.classList.remove('active');
        
        // فعال کردن سایر دکمه‌ها
        this.elements.fileBtn.disabled = false;
        this.elements.sendBtn.disabled = false;
        this.elements.messageInput.disabled = false;
        
        this.addMessage('system', 'در حال پردازش و ارسال پیام صوتی...');
    }
    
    startRecordingTimer() {
        this.state.recordingTimer = setInterval(() => {
            if (this.state.recordingStartTime && this.elements.recordingTime) {
                const elapsed = Date.now() - this.state.recordingStartTime;
                const seconds = Math.floor(elapsed / 1000);
                const minutes = Math.floor(seconds / 60);
                const displaySeconds = seconds % 60;
                this.elements.recordingTime.textContent = 
                    `${minutes.toString().padStart(2, '0')}:${displaySeconds.toString().padStart(2, '0')}`;
                
                // محدودیت زمانی برای ضبط (5 دقیقه)
                if (seconds >= 300) {
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
    
    async finishVoiceRecording() {
        if (this.state.audioChunks.length === 0) {
            this.addMessage('system', 'پیام صوتی ضبط نشد.');
            this.state.isRecording = false;
            return;
        }
        
        const audioBlob = new Blob(this.state.audioChunks, { type: 'audio/ogg; codecs=opus' });
        const duration = Date.now() - this.state.recordingStartTime;
        const durationSeconds = Math.floor(duration / 1000);
        
        // نمایش پیام در چت
        this.addMessage('user', `پیام صوتی (${durationSeconds} ثانیه)`);
        
        // ارسال به تلگرام
        await this.sendToTelegram(audioBlob, 'voice', `پیام صوتی از کاربر - مدت: ${durationSeconds} ثانیه\nسشن: ${this.state.sessionId}\nصفحه: ${window.location.href}`);
        
        // پاکسازی
        this.state.isRecording = false;
        this.state.audioChunks = [];
        this.state.mediaRecorder = null;
    }
    
    uploadFile() {
        // فقط اگر اپراتور متصل است
        if (!this.state.operatorConnected) {
            this.addMessage('system', 'برای ارسال فایل ابتدا به اپراتور انسانی متصل شوید.');
            return;
        }
        
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*,.pdf,.doc,.docx,.txt,.mp3,.wav,.mp4,.zip,.rar';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (file) {
                // نمایش فایل در چت
                this.addMessage('user', `فایل: ${file.name} (${this.formatFileSize(file.size)})`);
                
                // نمایش پیام در حال آپلود
                this.addMessage('system', `در حال آپلود فایل "${file.name}"...`);
                
                try {
                    // ارسال فایل به تلگرام
                    await this.sendToTelegram(file, 'document', `فایل از کاربر: ${file.name}\nسشن: ${this.state.sessionId}\nصفحه: ${window.location.href}`);
                    
                    this.addMessage('system', `فایل "${file.name}" با موفقیت ارسال شد.`);
                    
                } catch (error) {
                    console.error('Error uploading file:', error);
                    this.addMessage('system', 'خطا در آپلود فایل. لطفاً دوباره تلاش کنید.');
                }
            }
        };
        input.click();
    }
    
    async sendToTelegram(file, type = 'document', caption = '') {
        // بررسی وجود توکن تلگرام
        if (!this.options.telegramBotToken || !this.options.telegramChatId) {
            console.warn('Telegram bot token or chat ID not provided');
            this.addMessage('system', 'تنظیمات تلگرام کامل نیست. لطفاً با پشتیبانی تماس بگیرید.');
            return;
        }
        
        // ایجاد FormData
        const formData = new FormData();
        formData.append('chat_id', this.options.telegramChatId);
        formData.append('caption', caption);
        
        // نام فایل برای صدا
        const fileName = type === 'voice' ? 'voice_message.ogg' : file.name;
        
        // اضافه کردن فایل به FormData
        if (type === 'voice') {
            formData.append('voice', file, fileName);
        } else {
            formData.append('document', file, fileName);
        }
        
        // URL API تلگرام
        const method = type === 'voice' ? 'sendVoice' : 'sendDocument';
        const telegramUrl = `https://api.telegram.org/bot${this.options.telegramBotToken}/${method}`;
        
        console.log('Sending to Telegram:', { 
            url: telegramUrl, 
            type, 
            fileName, 
            fileSize: file.size 
        });
        
        try {
            const response = await fetch(telegramUrl, {
                method: 'POST',
                body: formData
                // Note: Do NOT set Content-Type header for FormData
            });
            
            const result = await response.json();
            console.log('Telegram API response:', result);
            
            if (!result.ok) {
                console.error('Telegram API error:', result);
                this.addMessage('system', `خطا در ارسال به تلگرام: ${result.description || 'خطای ناشناخته'}`);
                throw new Error(`Telegram API error: ${result.description}`);
            }
            
            console.log(`${type} sent to Telegram successfully`);
            return result;
            
        } catch (error) {
            console.error('Error sending to Telegram:', error);
            
            // ارسال از طریق سرور بک‌اند به عنوان راه حل جایگزین
            await this.sendViaBackend(file, type, caption);
            
            throw error;
        }
    }
    
    async sendViaBackend(file, type, caption) {
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('type', type);
            formData.append('caption', caption);
            formData.append('sessionId', this.state.sessionId);
            formData.append('telegramBotToken', this.options.telegramBotToken);
            formData.append('telegramChatId', this.options.telegramChatId);
            
            const response = await fetch(`${this.options.backendUrl}/api/send-to-telegram`, {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.addMessage('system', 'فایل از طریق سرور ارسال شد.');
                return result;
            } else {
                throw new Error('Backend send failed');
            }
        } catch (error) {
            console.error('Backend send error:', error);
            this.addMessage('system', 'خطا در ارسال فایل. لطفاً دوباره امتحان کنید.');
        }
    }
    
    formatFileSize(bytes) {
        if (bytes === 0) return '0 بایت';
        const k = 1024;
        const sizes = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    // صدا + نوتیفیکیشن + چشمک تب
    playNotificationSound() {
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
        const time = new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
        let icon = '', sender = '';
        if (type === 'user') { icon = '<i class="fas fa-user"></i>'; sender = 'شما'; }
        if (type === 'assistant') { icon = '<i class="fas fa-robot"></i>'; sender = 'پشتیبان هوشمند'; }
        if (type === 'operator') { icon = '<i class="fas fa-user-tie"></i>'; sender = 'اپراتور انسانی'; }
        messageEl.innerHTML = `
            ${icon ? `<div class="message-sender">${icon}<span>${sender}</span></div>` : ''}
            <div class="message-text">${this.escapeHtml(text)}</div>
            <div class="message-time">${time}</div>
        `;
        this.elements.messagesContainer.appendChild(messageEl);
        this.elements.messagesContainer.scrollTop = this.elements.messagesContainer.scrollHeight;
        this.state.messages.push({ type, text, time });
        // صدا و نوتیفیکیشن فقط برای پیام‌های غیر از کاربر
        if (type === 'operator' || type === 'assistant' || type === 'system') {
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

// راه‌اندازی خودکار
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.ChatWidget = new ChatWidget());
} else {
    window.ChatWidget = new ChatWidget();
}

window.initChatWidget = (options) => new ChatWidget(options);
