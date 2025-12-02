/**
 * ویجت چت‌بات برای قرارگیری در سایت‌های دیگر
 * استفاده: <script src="https://YOUR-DOMAIN.com/widget.js" defer></script>
 */

(function() {
    'use strict';
    
    // جلوگیری از بارگذاری تکراری
    if (window.ChatbotWidgetLoaded) {
        return;
    }
    window.ChatbotWidgetLoaded = true;
    
    // تنظیمات پیش‌فرض
    const defaultConfig = {
        position: 'bottom-right',
        primaryColor: '#4361ee',
        secondaryColor: '#3a0ca3',
        autoOpen: false,
        delay: 3000,
        showNotification: true,
        language: 'fa'
    };
    
    class ChatbotWidget {
        constructor(config = {}) {
            this.config = { ...defaultConfig, ...config };
            this.isOpen = false;
            this.isInitialized = false;
            this.chatbot = null;
            
            this.init();
        }
        
        init() {
            // بارگذاری CSS
            this.loadCSS();
            
            // ایجاد ساختار ویجت
            this.createWidget();
            
            // بارگذاری اسکریپت‌های لازم
            this.loadDependencies().then(() => {
                this.isInitialized = true;
                console.log('✅ ویجت چت‌بات بارگذاری شد');
                
                // نمایش نوتیفیکیشن در صورت فعال بودن
                if (this.config.showNotification) {
                    setTimeout(() => {
                        this.showWelcomeNotification();
                    }, this.config.delay);
                }
                
                // باز کردن خودکار در صورت فعال بودن
                if (this.config.autoOpen) {
                    setTimeout(() => {
                        this.openChat();
                    }, this.config.delay + 1000);
                }
            }).catch(error => {
                console.error('خطا در بارگذاری ویجت:', error);
            });
        }
        
        loadCSS() {
            // بارگذاری font-awesome
            const faLink = document.createElement('link');
            faLink.rel = 'stylesheet';
            faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
            document.head.appendChild(faLink);
            
            // بارگذاری فونت فارسی
            const fontLink = document.createElement('link');
            fontLink.rel = 'stylesheet';
            fontLink.href = 'https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;700&display=swap';
            document.head.appendChild(fontLink);
            
            // بارگذاری استایل چت‌بات
            const styleLink = document.createElement('link');
            styleLink.rel = 'stylesheet';
            styleLink.href = this.getBaseURL() + 'chatbox.css';
            document.head.appendChild(styleLink);
            
            // استایل‌های اختصاصی ویجت
            const widgetStyle = document.createElement('style');
            widgetStyle.textContent = this.getWidgetStyles();
            document.head.appendChild(widgetStyle);
        }
        
        getBaseURL() {
            // پیدا کردن آدرس اسکریپت جاری
            const script = document.currentScript || 
                document.querySelector('script[src*="widget.js"]');
            
            if (script) {
                const src = script.getAttribute('src');
                return src.substring(0, src.lastIndexOf('/') + 1);
            }
            
            return './';
        }
        
        async loadDependencies() {
            // بارگذاری similarity.js
            await this.loadScript(this.getBaseURL() + 'similarity.js');
            
            // بارگذاری main.js
            await this.loadScript(this.getBaseURL() + 'main.js');
        }
        
        loadScript(src) {
            return new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = src;
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }
        
        createWidget() {
            // ایجاد container ویجت
            this.container = document.createElement('div');
            this.container.id = 'chatbot-widget-container';
            this.container.className = `chatbot-widget ${this.config.position}`;
            
            // محتوای ویجت
            this.container.innerHTML = this.getWidgetHTML();
            
            // اضافه کردن به صفحه
            document.body.appendChild(this.container);
            
            // تنظیم event listeners
            this.setupEventListeners();
        }
        
        getWidgetHTML() {
            return `
                <div class="chatbot-toggle-btn" id="chatbot-toggle">
                    <i class="fas fa-comment-dots"></i>
                    <span class="notification-badge">1</span>
                    <span class="pulse-ring"></span>
                </div>
                
                <div class="chatbot-window hidden" id="chatbot-window">
                    <div class="chatbot-header">
                        <div class="chatbot-title">
                            <i class="fas fa-robot"></i>
                            <span>چت‌بات هوشمند</span>
                            <span class="status-indicator online"></span>
                        </div>
                        <div class="chatbot-actions">
                            <button class="btn-icon" id="widget-theme-toggle">
                                <i class="fas fa-moon"></i>
                            </button>
                            <button class="btn-icon" id="widget-clear-chat">
                                <i class="fas fa-trash"></i>
                            </button>
                            <button class="btn-icon" id="widget-minimize">
                                <i class="fas fa-minus"></i>
                            </button>
                        </div>
                    </div>
                    
                    <div class="chatbot-body">
                        <div class="chatbot-messages" id="widget-chat-messages">
                            <div class="message bot">
                                <div class="avatar">
                                    <i class="fas fa-robot"></i>
                                </div>
                                <div class="content">
                                    <div class="text">سلام! من چت‌بات هوشمند شما هستم. چطور می‌توانم کمک‌تان کنم؟</div>
                                    <div class="timestamp">همین حالا</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="chatbot-footer">
                        <div class="input-group">
                            <input type="text" id="widget-chat-input" 
                                   placeholder="پیام خود را بنویسید..." 
                                   autocomplete="off">
                            <button id="widget-send-btn">
                                <i class="fas fa-paper-plane"></i>
                            </button>
                        </div>
                        <div class="chatbot-options">
                            <button class="option-btn" id="widget-attachment">
                                <i class="fas fa-paperclip"></i>
                            </button>
                            <button class="option-btn" id="widget-emoji">
                                <i class="far fa-smile"></i>
                            </button>
                            <button class="option-btn" id="widget-faq">
                                <i class="fas fa-question-circle"></i>
                            </button>
                        </div>
                    </div>
                    
                    <div class="chatbot-footer-note">
                        <i class="fas fa-shield-alt"></i>
                        <span>تمامی پردازش‌ها در مرورگر شما انجام می‌شود</span>
                    </div>
                </div>
            `;
        }
        
        getWidgetStyles() {
            return `
                #chatbot-widget-container {
                    position: fixed;
                    z-index: 10000;
                    font-family: 'Vazirmatn', sans-serif;
                }
                
                #chatbot-widget-container.bottom-right {
                    bottom: 20px;
                    right: 20px;
                }
                
                #chatbot-widget-container.bottom-left {
                    bottom: 20px;
                    left: 20px;
                }
                
                #chatbot-widget-container.top-right {
                    top: 20px;
                    right: 20px;
                }
                
                #chatbot-widget-container.top-left {
                    top: 20px;
                    left: 20px;
                }
                
                .chatbot-toggle-btn {
                    width: 60px;
                    height: 60px;
                    background: ${this.config.primaryColor};
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-size: 24px;
                    cursor: pointer;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
                    transition: all 0.3s ease;
                    position: relative;
                }
                
                .chatbot-toggle-btn:hover {
                    transform: scale(1.1);
                    box-shadow: 0 6px 25px rgba(0, 0, 0, 0.3);
                }
                
                .chatbot-toggle-btn.active {
                    transform: rotate(90deg);
                }
                
                .notification-badge {
                    position: absolute;
                    top: -5px;
                    right: -5px;
                    background: #ff4757;
                    color: white;
                    font-size: 12px;
                    width: 20px;
                    height: 20px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .pulse-ring {
                    position: absolute;
                    width: 70px;
                    height: 70px;
                    border: 2px solid ${this.config.primaryColor};
                    border-radius: 50%;
                    animation: pulse 2s infinite;
                    opacity: 0;
                }
                
                @keyframes pulse {
                    0% {
                        transform: scale(0.8);
                        opacity: 0.7;
                    }
                    100% {
                        transform: scale(1.2);
                        opacity: 0;
                    }
                }
                
                .chatbot-window {
                    position: absolute;
                    bottom: 80px;
                    right: 0;
                    width: 380px;
                    max-width: 90vw;
                    height: 500px;
                    max-height: 70vh;
                    background: white;
                    border-radius: 16px;
                    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    transition: all 0.3s ease;
                }
                
                #chatbot-widget-container.bottom-left .chatbot-window {
                    right: auto;
                    left: 0;
                }
                
                #chatbot-widget-container.top-right .chatbot-window {
                    bottom: auto;
                    top: 80px;
                }
                
                #chatbot-widget-container.top-left .chatbot-window {
                    bottom: auto;
                    top: 80px;
                    right: auto;
                    left: 0;
                }
                
                .chatbot-window.hidden {
                    opacity: 0;
                    transform: translateY(20px);
                    pointer-events: none;
                }
                
                /* حالت تاریک */
                [data-theme="dark"] .chatbot-window {
                    background: #1a1a2e;
                }
                
                /* رسپانسیو */
                @media (max-width: 480px) {
                    .chatbot-window {
                        width: 100vw;
                        height: 100vh;
                        max-height: 100vh;
                        max-width: 100vw;
                        border-radius: 0;
                        bottom: 0;
                        right: 0;
                    }
                    
                    .chatbot-toggle-btn {
                        width: 50px;
                        height: 50px;
                        font-size: 20px;
                    }
                }
            `;
        }
        
        setupEventListeners() {
            // دکمه باز/بسته کردن
            const toggleBtn = document.getElementById('chatbot-toggle');
            const chatWindow = document.getElementById('chatbot-window');
            
            if (toggleBtn && chatWindow) {
                toggleBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleChat();
                });
            }
            
            // کلیک خارج از پنجره چت
            document.addEventListener('click', (e) => {
                if (this.isOpen && 
                    chatWindow && 
                    !chatWindow.contains(e.target) && 
                    toggleBtn && 
                    !toggleBtn.contains(e.target)) {
                    this.closeChat();
                }
            });
            
            // دکمه ارسال پیام
            const sendBtn = document.getElementById('widget-send-btn');
            const chatInput = document.getElementById('widget-chat-input');
            
            if (sendBtn && chatInput) {
                sendBtn.addEventListener('click', () => this.sendMessage());
                chatInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        this.sendMessage();
                    }
                });
            }
            
            // سایر دکمه‌ها
            const themeToggle = document.getElementById('widget-theme-toggle');
            if (themeToggle) {
                themeToggle.addEventListener('click', () => this.toggleTheme());
            }
            
            const clearChatBtn = document.getElementById('widget-clear-chat');
            if (clearChatBtn) {
                clearChatBtn.addEventListener('click', () => this.clearChat());
            }
            
            const minimizeBtn = document.getElementById('widget-minimize');
            if (minimizeBtn) {
                minimizeBtn.addEventListener('click', () => this.closeChat());
            }
            
            const faqBtn = document.getElementById('widget-faq');
            if (faqBtn) {
                faqBtn.addEventListener('click', () => this.showFAQ());
            }
            
            const attachmentBtn = document.getElementById('widget-attachment');
            if (attachmentBtn) {
                attachmentBtn.addEventListener('click', () => this.attachFile());
            }
            
            const emojiBtn = document.getElementById('widget-emoji');
            if (emojiBtn) {
                emojiBtn.addEventListener('click', () => this.toggleEmojiPicker());
            }
        }
        
        toggleChat() {
            const chatWindow = document.getElementById('chatbot-window');
            const toggleBtn = document.getElementById('chatbot-toggle');
            
            if (!chatWindow || !toggleBtn) return;
            
            this.isOpen = !this.isOpen;
            
            if (this.isOpen) {
                chatWindow.classList.remove('hidden');
                toggleBtn.classList.add('active');
                // فوکوس روی فیلد ورودی
                const input = document.getElementById('widget-chat-input');
                if (input) input.focus();
            } else {
                chatWindow.classList.add('hidden');
                toggleBtn.classList.remove('active');
            }
            
            // مخفی کردن نوتیفیکیشن
            const badge = document.querySelector('.notification-badge');
            if (badge && this.isOpen) {
                badge.style.display = 'none';
            }
        }
        
        openChat() {
            this.isOpen = true;
            const chatWindow = document.getElementById('chatbot-window');
            const toggleBtn = document.getElementById('chatbot-toggle');
            
            if (chatWindow) chatWindow.classList.remove('hidden');
            if (toggleBtn) toggleBtn.classList.add('active');
            
            const input = document.getElementById('widget-chat-input');
            if (input) input.focus();
        }
        
        closeChat() {
            this.isOpen = false;
            const chatWindow = document.getElementById('chatbot-window');
            const toggleBtn = document.getElementById('chatbot-toggle');
            
            if (chatWindow) chatWindow.classList.add('hidden');
            if (toggleBtn) toggleBtn.classList.remove('active');
        }
        
        sendMessage() {
            const input = document.getElementById('widget-chat-input');
            if (!input) return;
            
            const message = input.value.trim();
            if (!message) return;
            
            // استفاده از chatbot اصلی اگر بارگذاری شده
            if (window.chatbot && typeof window.chatbot.processMessage === 'function') {
                window.chatbot.processMessage(message);
            } else {
                // نمایش پیام در صورت عدم بارگذاری chatbot
                this.addMessage('user', message);
                setTimeout(() => {
                    this.addMessage('bot', 'سیستم در حال راه‌اندازی است. لطفاً چند ثانیه صبر کنید...');
                }, 500);
            }
            
            input.value = '';
            input.focus();
        }
        
        addMessage(sender, text) {
            const messagesContainer = document.getElementById('widget-chat-messages');
            if (!messagesContainer) return;
            
            const messageElement = document.createElement('div');
            messageElement.className = `message ${sender}`;
            
            const time = new Date().toLocaleTimeString('fa-IR', {
                hour: '2-digit',
                minute: '2-digit'
            });
            
            messageElement.innerHTML = `
                <div class="avatar">
                    <i class="fas fa-${sender === 'user' ? 'user' : 'robot'}"></i>
                </div>
                <div class="content">
                    <div class="text">${text}</div>
                    <div class="timestamp">${time}</div>
                </div>
            `;
            
            messagesContainer.appendChild(messageElement);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        
        toggleTheme() {
            const currentTheme = document.body.getAttribute('data-theme') || 'light';
            const newTheme = currentTheme === 'light' ? 'dark' : 'light';
            document.body.setAttribute('data-theme', newTheme);
            localStorage.setItem('chatbot-theme', newTheme);
            
            // تغییر آیکون
            const themeIcon = document.querySelector('#widget-theme-toggle i');
            if (themeIcon) {
                themeIcon.className = newTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
            }
        }
        
        clearChat() {
            if (confirm('آیا مطمئن هستید که می‌خواهید تاریخچه گفتگو پاک شود؟')) {
                const messagesContainer = document.getElementById('widget-chat-messages');
                if (messagesContainer) {
                    messagesContainer.innerHTML = '';
                }
                
                // پاک کردن LocalStorage
                localStorage.removeItem('chatbot-history');
                
                // نمایش پیام خوشامدگویی
                this.addMessage('bot', 'گفتگو جدیدی شروع شد. چطور می‌توانم کمک‌تان کنم؟');
            }
        }
        
        showFAQ() {
            // نمایش لیست FAQ
            this.addMessage('bot', 'سوالات متداول:');
            
            // بارگذاری FAQ از فایل
            fetch(this.getBaseURL() + 'faq.json')
                .then(response => response.json())
                .then(faqData => {
                    faqData.slice(0, 5).forEach((faq, index) => {
                        setTimeout(() => {
                            this.addMessage('bot', `${index + 1}. ${faq.question}`);
                        }, index * 300);
                    });
                })
                .catch(() => {
                    this.addMessage('bot', 'متأسفانه در بارگذاری FAQ مشکلی پیش آمده.');
                });
        }
        
        attachFile() {
            // ایجاد input فایل مخفی
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = 'image/*,.pdf,.doc,.docx,.txt';
            fileInput.style.display = 'none';
            
            fileInput.onchange = (e) => {
                const file = e.target.files[0];
                if (file) {
                    this.addMessage('user', `📎 فایل ارسال شد: ${file.name} (${this.formatFileSize(file.size)})`);
                    
                    // نمایش پیام در مورد قابلیت‌های فایل
                    setTimeout(() => {
                        this.addMessage('bot', `فایل ${file.name} دریافت شد. در حال حاضر امکان پردازش فایل در مرورگر محدود است.`);
                    }, 1000);
                }
                
                document.body.removeChild(fileInput);
            };
            
            document.body.appendChild(fileInput);
            fileInput.click();
        }
        
        formatFileSize(bytes) {
            if (bytes === 0) return '0 بایت';
            const k = 1024;
            const sizes = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
        }
        
        toggleEmojiPicker() {
            // نمایش/مخفی کردن انتخاب ایموجی
            const emojiPicker = document.getElementById('emoji-picker');
            
            if (emojiPicker) {
                emojiPicker.remove();
                return;
            }
            
            const picker = document.createElement('div');
            picker.id = 'emoji-picker';
            picker.className = 'emoji-picker';
            picker.innerHTML = `
                <div class="emoji-grid">
                    <span>😀</span><span>😂</span><span>😊</span><span>😍</span><span>😎</span>
                    <span>😜</span><span>🤔</span><span>😴</span><span>👍</span><span>👋</span>
                    <span>❤️</span><span>🔥</span><span>✨</span><span>🎉</span><span>✅</span>
                </div>
            `;
            
            // اضافه کردن به صفحه
            const chatWindow = document.getElementById('chatbot-window');
            if (chatWindow) {
                chatWindow.appendChild(picker);
                
                // اضافه کردن event listener برای ایموجی‌ها
                setTimeout(() => {
                    const emojis = picker.querySelectorAll('span');
                    emojis.forEach(emoji => {
                        emoji.addEventListener('click', () => {
                            const input = document.getElementById('widget-chat-input');
                            if (input) {
                                input.value += emoji.textContent;
                                input.focus();
                            }
                            picker.remove();
                        });
                    });
                }, 10);
            }
        }
        
        showWelcomeNotification() {
            // ایجاد نوتیفیکیشن خوشامدگویی
            const notification = document.createElement('div');
            notification.className = 'chatbot-welcome-notification';
            notification.innerHTML = `
                <div class="notification-content">
                    <i class="fas fa-robot"></i>
                    <div>
                        <strong>چت‌بات هوشمند</strong>
                        <p>برای پرسش سوال، روی آیکون پایین کلیک کنید</p>
                    </div>
                    <button class="close-notification">&times;</button>
                </div>
            `;
            
            document.body.appendChild(notification);
            
            // نمایش با انیمیشن
            setTimeout(() => {
                notification.classList.add('show');
            }, 100);
            
            // مخفی کردن پس از 5 ثانیه
            setTimeout(() => {
                notification.classList.remove('show');
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            }, 5000);
            
            // دکمه بستن
            const closeBtn = notification.querySelector('.close-notification');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    notification.classList.remove('show');
                    setTimeout(() => {
                        if (notification.parentNode) {
                            notification.parentNode.removeChild(notification);
                        }
                    }, 300);
                });
            }
        }
    }
    
    // راه‌اندازی ویجت هنگام بارگذاری صفحه
    document.addEventListener('DOMContentLoaded', () => {
        // خواندن تنظیمات از data attributes
        const script = document.currentScript || 
            document.querySelector('script[src*="widget.js"]');
        
        let config = {};
        
        if (script) {
            config = {
                position: script.getAttribute('data-position') || defaultConfig.position,
                primaryColor: script.getAttribute('data-primary-color') || defaultConfig.primaryColor,
                autoOpen: script.getAttribute('data-auto-open') === 'true',
                delay: parseInt(script.getAttribute('data-delay')) || defaultConfig.delay
            };
        }
        
        // ایجاد نمونه ویجت
        window.chatbotWidget = new ChatbotWidget(config);
    });
    
    // API عمومی برای کنترل ویجت از خارج
    window.ChatbotWidgetAPI = {
        open: function() {
            if (window.chatbotWidget) {
                window.chatbotWidget.openChat();
            }
        },
        close: function() {
            if (window.chatbotWidget) {
                window.chatbotWidget.closeChat();
            }
        },
        sendMessage: function(message) {
            if (window.chatbotWidget && message) {
                const input = document.getElementById('widget-chat-input');
                if (input) {
                    input.value = message;
                    window.chatbotWidget.sendMessage();
                }
            }
        },
        updateConfig: function(newConfig) {
            if (window.chatbotWidget) {
                Object.assign(window.chatbotWidget.config, newConfig);
            }
        }
    };
})();
