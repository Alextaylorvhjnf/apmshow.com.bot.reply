class ChatWidget {
    constructor(options = {}) {
        this.options = {
            backendUrl: options.backendUrl || window.location.origin,
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
            unreadCount: 0
        };
        
        // بارگذاری Font Awesome
        this.loadFontAwesome();
        
        // تاخیر در اجرا برای اطمینان از بارگذاری DOM
        setTimeout(() => {
            this.init();
        }, 100);
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
        console.log('🎯 شروع راه‌اندازی ویجت...');
        
        // ابتدا مطمئن شو که document.body وجود دارد
        if (!document.body) {
            console.error('❌ document.body موجود نیست!');
            setTimeout(() => this.init(), 100);
            return;
        }
        
        // حذف ویجت قبلی اگر وجود دارد
        const oldWidget = document.querySelector('.chat-widget');
        if (oldWidget) {
            oldWidget.remove();
            console.log('🧹 ویجت قدیمی حذف شد');
        }
        
        this.state.sessionId = this.generateSessionId();
        
        // تزریق استایل‌ها
        this.injectStyles();
        
        // تزریق HTML
        this.injectHTML();
        
        // اطمینان از ایجاد المان‌ها
        setTimeout(() => {
            this.initEvents();
            
            // تست نمایش
            this.testVisibility();
            
            // اتصال WebSocket
            this.connectWebSocket();
            
            // پیام خوش‌آمد
            setTimeout(() => {
                this.addMessage('assistant', 
                    '👋 سلام! به پشتیبانی آنلاین ' + this.options.companyName + ' خوش آمدید!\n' +
                    'من دستیار هوشمند شما هستم. چطور می‌تونم کمکتون کنم؟'
                );
            }, 500);
            
            console.log('✅ ویجت با موفقیت راه‌اندازی شد. Session ID:', this.state.sessionId);
        }, 100);
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
        console.log('🎨 افزودن استایل‌های ویجت...');
        
        // حذف استایل‌های قدیمی
        const oldStyle = document.querySelector('#chat-widget-styles');
        if (oldStyle) {
            oldStyle.remove();
        }
        
        const style = document.createElement('style');
        style.id = 'chat-widget-styles';
        
        style.textContent = `
            /* ==================== استایل‌های اصلی ویجت ==================== */
            
            /* رفع کنتراست با سایت */
            .chat-widget {
                all: initial;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                direction: rtl;
                box-sizing: border-box;
            }
            
            /* ==================== دکمه شناور ==================== */
            .chat-toggle-btn {
                position: fixed !important;
                bottom: 60px !important;
                left: 20px !important;
                width: 60px !important;
                height: 60px !important;
                border-radius: 50% !important;
                background: linear-gradient(45deg, #405DE6, #5851DB, #833AB4, #C13584, #E1306C, #FD1D1D) !important;
                border: none !important;
                color: white !important;
                cursor: pointer !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                box-shadow: 0 4px 25px rgba(224, 36, 94, 0.4) !important;
                z-index: 2147483647 !important;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
                overflow: hidden !important;
            }
            
            .chat-toggle-btn:hover {
                transform: scale(1.15) !important;
                box-shadow: 0 8px 35px rgba(224, 36, 94, 0.6) !important;
            }
            
            .chat-toggle-btn i {
                font-size: 24px !important;
                position: relative !important;
                z-index: 1 !important;
            }
            
            .notification-badge {
                position: absolute !important;
                top: -6px !important;
                right: -6px !important;
                background: linear-gradient(45deg, #FF0069, #FF2D79) !important;
                color: white !important;
                width: 24px !important;
                height: 24px !important;
                border-radius: 50% !important;
                font-size: 12px !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                font-weight: bold !important;
                box-shadow: 0 2px 10px rgba(255, 0, 105, 0.4) !important;
                border: 2px solid white !important;
                z-index: 2 !important;
                animation: badgePulse 2s infinite !important;
            }
            
            @keyframes badgePulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.15); }
            }
            
            /* ==================== پنجره چت ==================== */
            .chat-window {
                position: fixed !important;
                bottom: 130px !important;
                left: 20px !important;
                width: 380px !important;
                height: 580px !important;
                background: white !important;
                border-radius: 16px !important;
                box-shadow: 0 12px 48px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(219, 219, 219, 0.3) !important;
                z-index: 2147483646 !important;
                display: flex !important;
                flex-direction: column !important;
                overflow: hidden !important;
                opacity: 0 !important;
                transform: translateY(20px) scale(0.95) !important;
                visibility: hidden !important;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
                border: 1px solid #dbdbdb !important;
            }
            
            .chat-window.active {
                opacity: 1 !important;
                transform: translateY(0) scale(1) !important;
                visibility: visible !important;
            }
            
            /* ==================== هدر ==================== */
            .chat-header {
                background: white !important;
                padding: 16px 20px !important;
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
                border-bottom: 1px solid #dbdbdb !important;
                min-height: 64px !important;
            }
            
            .header-left {
                display: flex !important;
                align-items: center !important;
                gap: 12px !important;
            }
            
            .chat-logo {
                width: 40px !important;
                height: 40px !important;
                border-radius: 50% !important;
                background: linear-gradient(45deg, #405DE6, #5851DB, #833AB4, #C13584, #E1306C, #FD1D1D) !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                color: white !important;
                font-size: 16px !important;
                font-weight: bold !important;
                position: relative !important;
                overflow: hidden !important;
            }
            
            .chat-logo img {
                width: 100% !important;
                height: 100% !important;
                object-fit: cover !important;
                border-radius: 50% !important;
            }
            
            .chat-title h3 {
                font-size: 16px !important;
                font-weight: 700 !important;
                color: #262626 !important;
                margin: 0 !important;
                line-height: 1.3 !important;
            }
            
            .chat-title p {
                font-size: 13px !important;
                color: #8e8e8e !important;
                margin: 2px 0 0 0 !important;
                line-height: 1.3 !important;
            }
            
            .chat-status {
                display: flex !important;
                align-items: center !important;
                gap: 6px !important;
                font-size: 13px !important;
                color: #8e8e8e !important;
            }
            
            .status-dot {
                width: 8px !important;
                height: 8px !important;
                border-radius: 50% !important;
                background: #4cd964 !important;
                animation: statusPulse 2s infinite !important;
            }
            
            @keyframes statusPulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.7; }
            }
            
            .close-btn {
                background: none !important;
                border: none !important;
                color: #8e8e8e !important;
                cursor: pointer !important;
                padding: 8px !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                transition: all 0.2s !important;
                border-radius: 50% !important;
                width: 36px !important;
                height: 36px !important;
            }
            
            .close-btn:hover {
                background: #fafafa !important;
                color: #262626 !important;
            }
            
            .close-btn i {
                font-size: 20px !important;
            }
            
            /* ==================== پیام‌ها ==================== */
            .chat-messages {
                flex: 1 !important;
                padding: 20px !important;
                overflow-y: auto !important;
                background: #fafafa !important;
                display: flex !important;
                flex-direction: column !important;
                gap: 12px !important;
            }
            
            .message {
                max-width: 75% !important;
                padding: 12px 16px !important;
                border-radius: 22px !important;
                position: relative !important;
                animation: messageSlide 0.3s ease !important;
                word-wrap: break-word !important;
                line-height: 1.5 !important;
                font-size: 14px !important;
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05) !important;
            }
            
            @keyframes messageSlide {
                from {
                    opacity: 0;
                    transform: translateY(12px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            
            .message.user {
                align-self: flex-end !important;
                background: linear-gradient(135deg, #0095f6, #0077cc) !important;
                color: white !important;
                border-bottom-right-radius: 6px !important;
                margin-left: auto !important;
                box-shadow: 0 2px 4px rgba(0, 149, 246, 0.15) !important;
            }
            
            .message.assistant, .message.operator {
                align-self: flex-start !important;
                background: white !important;
                color: #262626 !important;
                border: 1px solid #dbdbdb !important;
                border-bottom-left-radius: 6px !important;
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05) !important;
            }
            
            .message.system {
                align-self: center !important;
                background: rgba(0, 0, 0, 0.04) !important;
                color: #8e8e8e !important;
                border-radius: 18px !important;
                max-width: 85% !important;
                text-align: center !important;
                font-size: 13px !important;
                padding: 10px 16px !important;
                font-weight: 500 !important;
                line-height: 1.4 !important;
            }
            
            .message-time {
                font-size: 11px !important;
                color: rgba(255, 255, 255, 0.8) !important;
                margin-top: 4px !important;
                text-align: left !important;
            }
            
            .message.assistant .message-time,
            .message.operator .message-time {
                color: #8e8e8e !important;
            }
            
            .message-sender {
                display: flex !important;
                align-items: center !important;
                gap: 8px !important;
                margin-bottom: 6px !important;
                font-size: 13px !important;
                font-weight: 600 !important;
                color: #262626 !important;
            }
            
            .message-sender i {
                font-size: 12px !important;
            }
            
            /* ==================== ابزارهای ارسال ==================== */
            .chat-tools {
                padding: 12px 20px !important;
                background: white !important;
                border-top: 1px solid #dbdbdb !important;
                border-bottom: 1px solid #dbdbdb !important;
                display: flex !important;
                gap: 12px !important;
                opacity: 0 !important;
                transform: translateY(10px) !important;
                transition: all 0.3s ease !important;
            }
            
            .chat-tools.active {
                opacity: 1 !important;
                transform: translateY(0) !important;
            }
            
            .tool-btn {
                background: white !important;
                border: 1px solid #dbdbdb !important;
                border-radius: 24px !important;
                padding: 10px 20px !important;
                display: flex !important;
                align-items: center !important;
                gap: 10px !important;
                cursor: pointer !important;
                font-size: 14px !important;
                color: #262626 !important;
                transition: all 0.2s !important;
                flex: 1 !important;
                justify-content: center !important;
                font-weight: 500 !important;
            }
            
            .tool-btn:hover {
                background: #fafafa !important;
                border-color: #c7c7c7 !important;
                transform: translateY(-1px) !important;
            }
            
            .tool-btn i {
                font-size: 16px !important;
                color: #8e8e8e !important;
                transition: color 0.2s !important;
            }
            
            .tool-btn.file-btn:hover i {
                color: #0095f6 !important;
            }
            
            .tool-btn.voice-btn:hover i {
                color: #e1306c !important;
            }
            
            .file-input {
                display: none !important;
            }
            
            /* ==================== ناحیه ورودی ==================== */
            .chat-input-area {
                padding: 16px 20px !important;
                background: white !important;
            }
            
            .input-wrapper {
                display: flex !important;
                gap: 12px !important;
                align-items: center !important;
                margin-bottom: 12px !important;
            }
            
            .message-input {
                flex: 1 !important;
                border: 1px solid #dbdbdb !important;
                border-radius: 24px !important;
                padding: 14px 18px !important;
                font-size: 15px !important;
                resize: none !important;
                max-height: 120px !important;
                min-height: 48px !important;
                transition: all 0.2s !important;
                font-family: inherit !important;
                line-height: 1.5 !important;
                background: #fafafa !important;
                color: #262626 !important;
                font-weight: 400 !important;
                outline: none !important;
            }
            
            .message-input:focus {
                border-color: #a8a8a8 !important;
                background: white !important;
                box-shadow: 0 0 0 1px rgba(0, 149, 246, 0.1) !important;
            }
            
            .send-btn {
                width: 48px !important;
                height: 48px !important;
                border-radius: 50% !important;
                background: linear-gradient(135deg, #0095f6, #0077cc) !important;
                border: none !important;
                color: white !important;
                cursor: pointer !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                transition: all 0.2s !important;
                flex-shrink: 0 !important;
                box-shadow: 0 2px 8px rgba(0, 149, 246, 0.25) !important;
            }
            
            .send-btn:hover:not(:disabled) {
                background: linear-gradient(135deg, #0077cc, #005fa3) !important;
                transform: scale(1.05) !important;
                box-shadow: 0 4px 12px rgba(0, 149, 246, 0.35) !important;
            }
            
            .send-btn:disabled {
                opacity: 0.5 !important;
                cursor: not-allowed !important;
                transform: none !important;
            }
            
            .send-btn i {
                font-size: 18px !important;
            }
            
            /* ==================== دکمه اتصال به اپراتور ==================== */
            .human-support-btn {
                width: 100% !important;
                background: linear-gradient(135deg, #f0f8ff, #e3f2fd) !important;
                color: #0095f6 !important;
                border: 1px solid #0095f6 !important;
                padding: 14px 20px !important;
                border-radius: 12px !important;
                font-size: 15px !important;
                font-weight: 600 !important;
                cursor: pointer !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 12px !important;
                transition: all 0.3s !important;
                box-shadow: 0 2px 8px rgba(0, 149, 246, 0.1) !important;
            }
            
            .human-support-btn:hover:not(:disabled) {
                background: linear-gradient(135deg, #e3f2fd, #bbdefb) !important;
                transform: translateY(-2px) !important;
                box-shadow: 0 4px 16px rgba(0, 149, 246, 0.15) !important;
            }
            
            .human-support-btn:disabled {
                opacity: 0.5 !important;
                cursor: not-allowed !important;
                background: #f5f5f5 !important;
                border-color: #dbdbdb !important;
                color: #8e8e8e !important;
                transform: none !important;
            }
            
            .human-support-btn i {
                font-size: 18px !important;
                transition: transform 0.3s !important;
            }
            
            .human-support-btn:hover:not(:disabled) i {
                transform: scale(1.1) !important;
            }
            
            /* ==================== وضعیت‌ها ==================== */
            .connection-status {
                padding: 14px 20px !important;
                background: linear-gradient(135deg, #fff8e1, #ffecb3) !important;
                border-top: 1px solid #ffecb3 !important;
                display: none !important;
            }
            
            .connection-status.active {
                display: block !important;
            }
            
            .typing-indicator {
                padding: 0 20px 12px !important;
                display: flex !important;
                align-items: center !important;
                gap: 12px !important;
                font-size: 13px !important;
                color: #8e8e8e !important;
                display: none !important;
                font-weight: 500 !important;
            }
            
            .typing-indicator.active {
                display: flex !important;
            }
            
            .typing-dots {
                display: flex !important;
                gap: 4px !important;
            }
            
            .typing-dots span {
                width: 7px !important;
                height: 7px !important;
                border-radius: 50% !important;
                background: #8e8e8e !important;
                animation: typingBounce 1.4s ease-in-out infinite !important;
            }
            
            .typing-dots span:nth-child(2) {
                animation-delay: 0.2s !important;
            }
            
            .typing-dots span:nth-child(3) {
                animation-delay: 0.4s !important;
            }
            
            @keyframes typingBounce {
                0%, 100% { 
                    transform: translateY(0) !important;
                }
                50% { 
                    transform: translateY(-5px) !important;
                }
            }
            
            /* ==================== اطلاعات اپراتور ==================== */
            .operator-info {
                padding: 16px 20px !important;
                background: linear-gradient(135deg, #f8f9ff, #eef1ff) !important;
                border-top: 1px solid #e0e7ff !important;
                display: none !important;
            }
            
            .operator-info.active {
                display: block !important;
            }
            
            .operator-card {
                display: flex !important;
                align-items: center !important;
                gap: 16px !important;
            }
            
            .operator-avatar {
                width: 48px !important;
                height: 48px !important;
                border-radius: 50% !important;
                background: linear-gradient(135deg, #405DE6, #833AB4) !important;
                color: white !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                font-size: 20px !important;
                box-shadow: 0 4px 12px rgba(64, 93, 230, 0.25) !important;
                flex-shrink: 0 !important;
            }
            
            .operator-details h4 {
                color: #262626 !important;
                margin-bottom: 4px !important;
                font-size: 16px !important;
                font-weight: 700 !important;
                display: flex !important;
                align-items: center !important;
                gap: 10px !important;
            }
            
            .operator-details p {
                color: #666 !important;
                font-size: 14px !important;
                line-height: 1.4 !important;
                font-weight: 400 !important;
            }
            
            /* ==================== اسکرول بار ==================== */
            .chat-messages::-webkit-scrollbar {
                width: 6px !important;
            }
            
            .chat-messages::-webkit-scrollbar-track {
                background: transparent !important;
            }
            
            .chat-messages::-webkit-scrollbar-thumb {
                background: #dbdbdb !important;
                border-radius: 3px !important;
            }
            
            .chat-messages::-webkit-scrollbar-thumb:hover {
                background: #c7c7c7 !important;
            }
            
            /* ==================== ریسپانسیو ==================== */
            @media (max-width: 480px) {
                .chat-window {
                    width: calc(100vw - 32px) !important;
                    height: 70vh !important;
                    bottom: 88px !important;
                    left: 16px !important;
                }
                
                .chat-toggle-btn {
                    bottom: 20px !important;
                    left: 20px !important;
                    width: 56px !important;
                    height: 56px !important;
                }
                
                .message {
                    max-width: 85% !important;
                }
            }
        `;
        
        document.head.appendChild(style);
        console.log('✅ استایل‌ها با موفقیت اضافه شدند');
    }
    
    injectHTML() {
        console.log('🛠️ تزریق HTML ویجت...');
        
        // ایجاد کانتینر اصلی
        this.container = document.createElement('div');
        this.container.className = 'chat-widget';
        this.container.style.cssText = `
            position: fixed;
            z-index: 2147483647;
        `;
        
        // محتوای HTML
        this.container.innerHTML = `
            <!-- دکمه شناور اینستاگرامی -->
            <button class="chat-toggle-btn" aria-label="باز کردن چت" style="
                position: fixed;
                bottom: 20px;
                left: 20px;
                width: 60px;
                height: 60px;
                border-radius: 50%;
                background: linear-gradient(45deg, #405DE6, #833AB4, #E1306C);
                border: none;
                color: white;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 4px 20px rgba(0,0,0,0.2);
                z-index: 2147483647;
            ">
                <i class="fas fa-comment-dots"></i>
                <span class="notification-badge" style="display: none">0</span>
            </button>
            
            <!-- پنجره چت -->
            <div class="chat-window" style="
                position: fixed;
                bottom: 90px;
                left: 20px;
                width: 380px;
                height: 580px;
                background: white;
                border-radius: 16px;
                box-shadow: 0 12px 48px rgba(0,0,0,0.15);
                z-index: 2147483646;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                opacity: 0;
                transform: translateY(20px);
                visibility: hidden;
                border: 1px solid #dbdbdb;
            ">
                <!-- هدر -->
                <div class="chat-header">
                    <div class="header-left">
                        <div class="chat-logo">
                            <img src="https://shikpooshaan.ir/widjet.logo.png" alt="لوگو ${this.options.companyName}" 
                                 onerror="this.style.display='none'; this.parentElement.innerHTML='<i class=\\'fas fa-headset\\'></i>';">
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
                        <button class="close-btn" aria-label="بستن پنجره چت">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
                
                <!-- پیام‌ها -->
                <div class="chat-messages">
                    <!-- پیام‌ها اینجا اضافه می‌شوند -->
                </div>
                
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
                    <button class="tool-btn file-btn" aria-label="ارسال فایل" title="ارسال فایل">
                        <i class="fas fa-paperclip"></i>
                        <span>پیوست فایل</span>
                    </button>
                    <button class="tool-btn voice-btn" aria-label="ضبط صدا" title="ضبط صدا">
                        <i class="fas fa-microphone"></i>
                        <span>ضبط صوت</span>
                    </button>
                    <input type="file" class="file-input" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt" multiple>
                </div>
                
                <!-- ناحیه ورودی -->
                <div class="chat-input-area">
                    <div class="input-wrapper">
                        <textarea class="message-input" placeholder="پیام خود را بنویسید..." rows="1" aria-label="پیام"></textarea>
                        <button class="send-btn" aria-label="ارسال پیام">
                            <i class="fas fa-paper-plane"></i>
                        </button>
                    </div>
                    <button class="human-support-btn">
                        <i class="fas fa-user-headset"></i>
                        <span>درخواست پشتیبان انسانی</span>
                    </button>
                </div>
            </div>
        `;
        
        // اضافه کردن به body
        document.body.appendChild(this.container);
        console.log('✅ HTML به body اضافه شد');
        
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
        
        console.log('🎯 المان‌های ویجت جمع‌آوری شدند:', this.elements);
    }
    
    testVisibility() {
        console.log('🔍 تست نمایش ویجت...');
        
        if (this.elements.toggleBtn) {
            console.log('✅ دکمه شناور موجود است');
            
            // نمایش دکمه با انیمیشن
            this.elements.toggleBtn.style.opacity = '0';
            this.elements.toggleBtn.style.transform = 'scale(0.5)';
            
            setTimeout(() => {
                this.elements.toggleBtn.style.transition = 'all 0.5s cubic-bezier(0.68, -0.55, 0.27, 1.55)';
                this.elements.toggleBtn.style.opacity = '1';
                this.elements.toggleBtn.style.transform = 'scale(1)';
                
                console.log('✨ دکمه ویجت نمایش داده شد');
                
                // پخش صدای تأیید
                this.playNotificationSound();
                
            }, 300);
            
        } else {
            console.error('❌ دکمه شناور پیدا نشد!');
        }
    }
    
    initEvents() {
        console.log('⚡ راه‌اندازی رویدادها...');
        
        if (!this.elements.toggleBtn) {
            console.error('❌ المان‌های ویجت پیدا نشدند!');
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
        
        // بستن چت با کلیک خارج
        document.addEventListener('click', (e) => {
            if (this.state.isOpen && 
                !this.elements.chatWindow.contains(e.target) && 
                !this.elements.toggleBtn.contains(e.target)) {
                this.closeChat();
            }
        });
        
        console.log('✅ رویدادها با موفقیت تنظیم شدند');
    }
    
    toggleChat() {
        console.log('🎯 تغییر وضعیت چت:', this.state.isOpen ? 'بستن' : 'باز کردن');
        
        this.state.isOpen = !this.state.isOpen;
        
        if (this.state.isOpen) {
            this.openChat();
        } else {
            this.closeChat();
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
        
        this.playNotificationSound();
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
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    }
    
    async sendMessage() {
        const message = this.elements.messageInput.value.trim();
        
        if (!message || this.state.isTyping) return;
        
        // اضافه کردن پیام کاربر
        this.addMessage('user', message);
        
        // پاک کردن فیلد ورودی
        this.elements.messageInput.value = '';
        this.resizeTextarea();
        
        // نمایش نشانگر تایپ
        this.setTyping(true);
        
        try {
            if (this.state.operatorConnected && this.state.socket) {
                // ارسال به اپراتور انسانی
                this.state.socket.emit('user-message', {
                    sessionId: this.state.sessionId,
                    message: message,
                    timestamp: new Date().toISOString()
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
            
            const response = await fetch(\`\${this.options.backendUrl}/api/chat\`, {
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
                        page: window.location.href,
                        browser: navigator.userAgent
                    }
                })
            });
            
            if (!response.ok) {
                throw new Error(\`HTTP error! status: \${response.status}\`);
            }
            
            const data = await response.json();
            console.log('✅ پاسخ از AI:', data);
            
            if (data.success) {
                this.addMessage('assistant', data.message);
                
                // اگر سیستم پیشنهاد اتصال به اپراتور داد
                if (data.suggestHuman) {
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
        const originalBackground = this.elements.humanSupportBtn.style.background;
        const originalBorderColor = this.elements.humanSupportBtn.style.borderColor;
        
        // تغییر ظاهر دکمه به حالت لودینگ
        this.elements.humanSupportBtn.innerHTML = \`
            <i class="fas fa-spinner fa-spin"></i>
            <span>در حال اتصال...</span>
        \`;
        this.elements.humanSupportBtn.disabled = true;
        this.elements.humanSupportBtn.style.background = 'linear-gradient(135deg, #ff9500, #ff7b00)';
        this.elements.humanSupportBtn.style.borderColor = '#ff9500';
        
        try {
            // آماده کردن اطلاعات کاربر
            const userInfo = {
                name: 'کاربر سایت',
                page: window.location.href,
                browser: navigator.userAgent,
                referrer: document.referrer || 'مستقیم'
            };
            
            console.log('📡 درخواست اتصال به اپراتور:', userInfo);
            
            // ارسال درخواست به API
            const response = await fetch(\`\${this.options.backendUrl}/api/connect-human\`, {
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
                throw new Error(\`خطای HTTP: \${response.status}\`);
            }
            
            const data = await response.json();
            console.log('✅ درخواست اتصال ثبت شد:', data);
            
            if (data.success) {
                // ذخیره زمان درخواست
                localStorage.setItem('operator_request_time', Date.now().toString());
                
                // نمایش پیام به کاربر
                this.addMessage('system', 
                    '⏳ **درخواست شما ثبت شد!**\n\n' +
                    \`کد جلسه: **\${data.sessionCode || 'در حال انتساب'}**\n\n\` +
                    'کارشناسان ما مطلع شدند و به زودی با شما ارتباط برقرار می‌کنند.\n' +
                    'لطفاً منتظر بمانید...'
                );
                
                // تغییر دکمه به حالت انتظار
                this.elements.humanSupportBtn.innerHTML = \`
                    <i class="fas fa-clock"></i>
                    <span>در انتظار پذیرش</span>
                \`;
                this.elements.humanSupportBtn.style.background = 'linear-gradient(135deg, #ff9500, #e67e22)';
                
                // ارسال رویداد سوکت
                if (this.state.socket) {
                    this.state.socket.emit('human-support-request', {
                        sessionId: this.state.sessionId,
                        userInfo: userInfo,
                        requestTime: new Date().toISOString()
                    });
                }
                
                // تایمر انتظار (30 ثانیه)
                setTimeout(() => {
                    if (!this.state.operatorConnected) {
                        this.addMessage('system', 
                            '⏰ **هنوز پاسخی دریافت نشد**\n\n' +
                            'متأسفانه در حال حاضر هیچ اپراتوری در دسترس نیست.\n' +
                            'لطفاً:\n' +
                            '• چند دقیقه دیگر دوباره تلاش کنید\n' +
                            '• یا سوال خود را برای من بنویسید تا کمکتان کنم.'
                        );
                        this.resetHumanSupportButton(originalHTML, originalBackground, originalBorderColor);
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
            } else if (error.message.includes('خطای HTTP: 429')) {
                errorMessage = '⏳ درخواست‌های زیادی ارسال کرده‌اید. لطفاً کمی صبر کنید.';
            }
            
            this.addMessage('system', errorMessage);
            
            // بازگرداندن دکمه به حالت اولیه بعد از 3 ثانیه
            setTimeout(() => {
                this.resetHumanSupportButton(originalHTML, originalBackground, originalBorderColor);
            }, 3000);
            
        } finally {
            this.state.isConnecting = false;
        }
    }
    
    resetHumanSupportButton(originalHTML, originalBackground, originalBorderColor) {
        this.elements.humanSupportBtn.innerHTML = \`
            <i class="fas fa-user-headset"></i>
            <span>درخواست پشتیبان انسانی</span>
        \`;
        this.elements.humanSupportBtn.disabled = false;
        this.elements.humanSupportBtn.style.background = originalBackground || 'linear-gradient(135deg, #f0f8ff, #e3f2fd)';
        this.elements.humanSupportBtn.style.borderColor = originalBorderColor || '#0095f6';
    }
    
    handleOperatorConnected(data) {
        console.log('🎉 اپراتور متصل شد:', data);
        
        this.state.operatorConnected = true;
        
        // ذخیره در localStorage
        localStorage.setItem('operator_connected', 'true');
        localStorage.removeItem('operator_request_time');
        
        // نمایش بخش اپراتور
        if (this.elements.operatorInfo) {
            this.elements.operatorInfo.classList.add('active');
        }
        
        // فعال کردن ابزارهای ارسال
        this.updateToolButtons();
        
        // تغییر دکمه اتصال
        if (this.elements.humanSupportBtn) {
            this.elements.humanSupportBtn.innerHTML = \`
                <i class="fas fa-user-check"></i>
                <span>متصل به اپراتور</span>
            \`;
            this.elements.humanSupportBtn.disabled = true;
            this.elements.humanSupportBtn.style.background = 'linear-gradient(135deg, #2ecc71, #27ae60)';
            this.elements.humanSupportBtn.style.borderColor = '#27ae60';
        }
        
        // نمایش پیام خوش‌آمد اپراتور
        const welcomeMessage = data.message || 
            '🎉 **به پشتیبانی انسانی خوش آمدید!**\n\n' +
            'حالا می‌توانید:\n' +
            '📎 فایل‌های خود را ارسال کنید\n' +
            '🎤 پیام صوتی بفرستید\n' +
            '💬 با جزئیات کامل سوال خود را مطرح کنید\n\n' +
            'منتظر سوال شما هستم! 😊';
        
        this.addMessage('system', welcomeMessage);
        
        // ارسال پیام خوش‌آمد به اپراتور
        if (this.state.socket) {
            this.state.socket.emit('operator-joined', {
                sessionId: this.state.sessionId,
                message: 'کاربر به چت پیوسته است'
            });
        }
        
        // پخش صدای اتصال
        this.playNotificationSound();
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
        
        // چک کردن اتصال به اپراتور
        if (!this.state.operatorConnected) {
            this.addMessage('system', '⚠️ ابتدا به اپراتور انسانی متصل شوید.');
            this.elements.fileInput.value = '';
            return;
        }
        
        // پردازش هر فایل
        for (let file of files) {
            await this.processFileUpload(file);
        }
        
        // پاک کردن input
        this.elements.fileInput.value = '';
    }
    
    async processFileUpload(file) {
        // چک کردن حجم فایل (حداکثر 20MB)
        const MAX_SIZE = 20 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
            this.addMessage('system', \`❌ فایل "\${file.name}" بسیار بزرگ است (حداکثر 20 مگابایت)\`);
            return;
        }
        
        // چک کردن نوع فایل
        const allowedTypes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'video/mp4', 'video/quicktime',
            'audio/mpeg', 'audio/wav', 'audio/ogg',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain'
        ];
        
        if (!allowedTypes.includes(file.type) && !file.name.match(/\\.(jpg|jpeg|png|gif|webp|mp4|mov|pdf|doc|docx|txt)$/i)) {
            this.addMessage('system', \`❌ نوع فایل "\${file.name}" پشتیبانی نمی‌شود\`);
            return;
        }
        
        try {
            // تبدیل به Base64
            const base64 = await this.fileToBase64(file);
            
            // نمایش پیام در چت
            this.addMessage('user', \`📎 ارسال فایل: \${file.name} (\${this.formatFileSize(file.size)})\`);
            
            // ارسال از طریق سوکت
            if (this.state.socket) {
                this.state.socket.emit('user-file', {
                    sessionId: this.state.sessionId,
                    fileName: file.name,
                    fileType: file.type,
                    fileSize: file.size,
                    fileBase64: base64.split(',')[1]
                });
            }
            
        } catch (error) {
            console.error('❌ خطا در آپلود فایل:', error);
            this.addMessage('system', \`❌ خطا در آپلود فایل "\${file.name}"\`);
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
                    noiseSuppression: true,
                    sampleRate: 44100
                }
            });
            
            this.state.mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus',
                audioBitsPerSecond: 128000
            });
            
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
                
                // چک کردن حجم (حداکثر 5MB)
                if (audioBlob.size > 5 * 1024 * 1024) {
                    this.addMessage('system', '❌ پیام صوتی بسیار بزرگ است (حداکثر 5 مگابایت)');
                    return;
                }
                
                // نمایش پیام در چت
                this.addMessage('user', \`🎤 ارسال پیام صوتی (\${this.formatTime(this.state.recordingTime)})\`);
                
                try {
                    // تبدیل به Base64
                    const base64 = await this.blobToBase64(audioBlob);
                    
                    // ارسال از طریق سوکت
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
                
                // قطع کردن stream
                stream.getTracks().forEach(track => track.stop());
                
                // پاک کردن تایمر
                clearInterval(this.recordingTimer);
                this.recordingTimer = null;
            };
            
            // شروع ضبط
            this.state.mediaRecorder.start(1000);
            
            this.state.isRecording = true;
            
            // تغییر ظاهر دکمه
            this.elements.voiceBtn.classList.add('recording');
            this.elements.voiceBtn.innerHTML = '<i class="fas fa-stop-circle"></i><span>توقف ضبط</span>';
            
            // شروع تایمر
            this.recordingTimer = setInterval(() => {
                this.state.recordingTime++;
            }, 1000);
            
            // پخش صدای شروع ضبط
            this.playNotificationSound();
            
        } catch (error) {
            console.error('❌ خطا در دسترسی به میکروفون:', error);
            
            let errorMessage = '❌ دسترسی به میکروفون امکان‌پذیر نیست';
            if (error.name === 'NotAllowedError') {
                errorMessage = '⚠️ لطفاً دسترسی میکروفون را در مرورگر خود فعال کنید';
            } else if (error.name === 'NotFoundError') {
                errorMessage = '❌ میکروفون یافت نشد';
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
        
        // پخش صدای توقف ضبط
        this.playNotificationSound();
        
        // اگر ضبط کمتر از 1 ثانیه بود، لغو کن
        if (this.state.recordingTime < 1) {
            if (this.recordingTimer) {
                clearInterval(this.recordingTimer);
                this.recordingTimer = null;
            }
            this.elements.voiceBtn.classList.remove('recording');
            this.elements.voiceBtn.innerHTML = '<i class="fas fa-microphone"></i><span>ضبط صوت</span>';
            this.addMessage('system', 'ضبط لغو شد');
            return;
        }
        
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
    
    addMessage(type, text, timestamp = null) {
        const messageEl = document.createElement('div');
        messageEl.className = \`message \${type}\`;
        
        const time = timestamp ? new Date(timestamp) : new Date();
        const timeStr = time.toLocaleTimeString('fa-IR', { 
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
        
        messageEl.innerHTML = \`
            \${sender ? \`
                <div class="message-sender \${senderClass}">
                    \${icon}
                    <span>\${sender}</span>
                </div>
            \` : ''}
            <div class="message-text">\${this.formatMessage(text)}</div>
            <div class="message-time">\${timeStr}</div>
        \`;
        
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
            timestamp: time.toISOString(),
            sender,
            senderClass
        });
        
        // اگر چت باز نیست، نوتیفیکیشن بده
        if (!this.state.isOpen && (type === 'assistant' || type === 'operator' || type === 'system')) {
            this.state.unreadCount = (this.state.unreadCount || 0) + 1;
            this.showNotification();
            this.playNotificationSound(); // صدا اضافه شد
            
            if (document.hidden) {
                this.startTabNotification();
            }
        }
    }
    
    formatMessage(text) {
        // تبدیل لینک‌ها به تگ <a>
        const urlRegex = /(https?:\\/\\/[^\\s]+)/g;
        text = text.replace(urlRegex, url => 
            \`<a href="\${url}" target="_blank" rel="noopener noreferrer" style="color: #0095f6; text-decoration: none;">\${url}</a>\`
        );
        
        // تبدیل خطوط جدید به <br>
        text = text.replace(/\\n/g, '<br>');
        
        // هایلایت کلمات کلیدی
        const highlights = [
            { regex: /\\*\\*(.*?)\\*\\*/g, replace: '<strong>$1</strong>' },
            { regex: /\\*(.*?)\\*/g, replace: '<em>$1</em>' }
        ];
        
        highlights.forEach(highlight => {
            text = text.replace(highlight.regex, highlight.replace);
        });
        
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
                \`(\${this.state.unreadCount}) \${this.tabNotifyText}\` : 
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
    
    formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return \`\${minutes}:\${secs.toString().padStart(2, '0')}\`;
    }
    
    showHumanSupportSuggestion() {
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

console.log('📱 ویجت چت آماده است! برای دسترسی از "ChatWidget" استفاده کنید.');
