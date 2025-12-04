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
            isTyping: false,
            isConnecting: false
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
                        <div class="chat-logo"><i class="fas fa-robot"></i></div>
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
                    <div class="input-wrapper">
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
            humanSupportBtn: this.container.querySelector('.human-support-btn'),
            typingIndicator: this.container.querySelector('.typing-indicator'),
            connectionStatus: this.container.querySelector('.connection-status'),
            operatorInfo: this.container.querySelector('.operator-info'),
            notificationBadge: this.container.querySelector('.notification-badge'),
            chatStatus: this.container.querySelector('.chat-status')
        };
    }
    initEvents() {
        this.elements.toggleBtn.addEventListener('click', () => this.toggleChat());
        this.elements.closeBtn.addEventListener('click', () => this.closeChat());
        this.elements.sendBtn.addEventListener('click', () => this.sendMessage());
        this.elements.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        this.elements.messageInput.addEventListener('input', () => this.resizeTextarea());
        this.elements.humanSupportBtn.addEventListener('click', () => this.connectToHuman());
        document.addEventListener('click', (e) => {
            if (this.state.isOpen && !this.elements.chatWindow.contains(e.target) && !this.elements.toggleBtn.contains(e.target)) {
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
        this.elements.chatWindow.classList.toggle('active');
        if (this.state.isOpen) {
            this.elements.messageInput.focus();
            this.resetNotification(); // مهم: وقتی باز کرد، نوتیفیکیشن صفر بشه
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
        // ... همون کد قبلی (بدون تغییر)
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
        this.addMessage('system', data.message || 'اپراتور متصل شد!');
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
