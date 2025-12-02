/**
 * ویجت چت برای وبسایت
 * این فایل را می‌توان با تگ <script> در فوتر سایت قرار داد
 */

(function() {
    'use strict';
    
    // تنظیمات پیش‌فرض
    const defaultConfig = {
        serverUrl: window.location.origin.replace('http://', 'ws://').replace('https://', 'wss://') + '/',
        apiUrl: window.location.origin + '/api',
        position: 'bottom-right',
        primaryColor: '#007bff',
        secondaryColor: '#6c757d',
        title: 'پشتیبانی آنلاین',
        welcomeMessage: 'سلام! چطور می‌تونم کمک‌تون کنم؟',
        aiEnabled: true,
        humanSupportEnabled: true
    };
    
    // وضعیت ویجت
    let state = {
        isOpen: false,
        isConnected: false,
        userId: null,
        sessionId: null,
        isTyping: false,
        messages: [],
        connectionStatus: 'disconnected',
        chatMode: 'ai' // 'ai' یا 'human'
    };
    
    // المان‌های DOM
    let elements = {};
    
    // WebSocket connection
    let ws = null;
    
    /**
     * ایجاد ویجت چت
     */
    function createWidget(config) {
        // ادغام تنظیمات
        const settings = Object.assign({}, defaultConfig, config);
        
        // ایجاد المان اصلی
        const widgetContainer = document.createElement('div');
        widgetContainer.id = 'ai-chat-widget';
        widgetContainer.className = 'ai-chat-widget-container';
        
        // دکمه باز کردن/بستن چت
        const toggleButton = document.createElement('button');
        toggleButton.id = 'ai-chat-toggle';
        toggleButton.className = 'ai-chat-toggle';
        toggleButton.innerHTML = '💬';
        toggleButton.title = settings.title;
        toggleButton.addEventListener('click', toggleChat);
        
        // پنجره چت
        const chatWindow = document.createElement('div');
        chatWindow.id = 'ai-chat-window';
        chatWindow.className = 'ai-chat-window hidden';
        
        // هدر چت
        const chatHeader = document.createElement('div');
        chatHeader.className = 'ai-chat-header';
        
        const titleElement = document.createElement('div');
        titleElement.className = 'ai-chat-title';
        titleElement.textContent = settings.title;
        
        const statusIndicator = document.createElement('div');
        statusIndicator.className = 'ai-chat-status';
        statusIndicator.id = 'ai-chat-status';
        statusIndicator.textContent = '● در حال اتصال...';
        
        const closeButton = document.createElement('button');
        closeButton.className = 'ai-chat-close';
        closeButton.innerHTML = '×';
        closeButton.addEventListener('click', toggleChat);
        
        chatHeader.appendChild(titleElement);
        chatHeader.appendChild(statusIndicator);
        chatHeader.appendChild(closeButton);
        
        // بدنه چت (پیام‌ها)
        const chatBody = document.createElement('div');
        chatBody.className = 'ai-chat-body';
        chatBody.id = 'ai-chat-body';
        
        // فوتر چت (ورودی پیام)
        const chatFooter = document.createElement('div');
        chatFooter.className = 'ai-chat-footer';
        
        const inputContainer = document.createElement('div');
        inputContainer.className = 'ai-chat-input-container';
        
        const messageInput = document.createElement('input');
        messageInput.type = 'text';
        messageInput.className = 'ai-chat-input';
        messageInput.id = 'ai-chat-input';
        messageInput.placeholder = 'پیام خود را بنویسید...';
        messageInput.disabled = true;
        
        messageInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && messageInput.value.trim()) {
                sendMessage(messageInput.value);
                messageInput.value = '';
            }
        });
        
        const sendButton = document.createElement('button');
        sendButton.className = 'ai-chat-send-btn';
        sendButton.id = 'ai-chat-send-btn';
        sendButton.innerHTML = '↗';
        sendButton.disabled = true;
        sendButton.addEventListener('click', function() {
            if (messageInput.value.trim()) {
                sendMessage(messageInput.value);
                messageInput.value = '';
            }
        });
        
        inputContainer.appendChild(messageInput);
        inputContainer.appendChild(sendButton);
        
        // نوار تایپینگ
        const typingIndicator = document.createElement('div');
        typingIndicator.className = 'ai-chat-typing hidden';
        typingIndicator.id = 'ai-chat-typing';
        typingIndicator.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div> در حال تایپ...';
        
        chatFooter.appendChild(inputContainer);
        chatFooter.appendChild(typingIndicator);
        
        // مونتاژ پنجره چت
        chatWindow.appendChild(chatHeader);
        chatWindow.appendChild(chatBody);
        chatWindow.appendChild(chatFooter);
        
        // مونتاژ ویجت کامل
        widgetContainer.appendChild(toggleButton);
        widgetContainer.appendChild(chatWindow);
        
        // ذخیره المان‌ها
        elements = {
            container: widgetContainer,
            toggleButton: toggleButton,
            window: chatWindow,
            body: chatBody,
            input: messageInput,
            sendButton: sendButton,
            statusIndicator: statusIndicator,
            typingIndicator: typingIndicator
        };
        
        // افزودن به صفحه
        document.body.appendChild(widgetContainer);
        
        // بارگذاری CSS اگر وجود ندارد
        if (!document.getElementById('ai-chat-widget-styles')) {
            loadCSS();
        }
        
        // ایجاد sessionId
        state.sessionId = generateSessionId();
        
        // اتصال به WebSocket
        connectWebSocket(settings.serverUrl);
        
        // افزودن پیام خوش‌آمدگویی
        addMessage({
            text: settings.welcomeMessage,
            sender: 'ai',
            timestamp: new Date()
        });
        
        // ذخیره تنظیمات
        window.aiChatWidgetSettings = settings;
        
        // باز کردن خودکار چت بعد از 3 ثانیه (اختیاری)
        setTimeout(() => {
            if (!state.isOpen && settings.autoOpen) {
                toggleChat();
            }
        }, 3000);
    }
    
    /**
     * بارگذاری CSS
     */
    function loadCSS() {
        // بررسی وجود لینک CSS
        if (document.querySelector('link[href*="chat-widget.css"]')) {
            return;
        }
        
        // ایجاد لینک CSS
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = window.aiChatWidgetSettings?.apiUrl?.replace('/api', '/widget.css') || '/widget.css';
        link.id = 'ai-chat-widget-styles';
        document.head.appendChild(link);
    }
    
    /**
     * تولید شناسه یکتا برای session
     */
    function generateSessionId() {
        return 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    
    /**
     * اتصال به WebSocket سرور
     */
    function connectWebSocket(serverUrl) {
        try {
            updateStatus('connecting', 'در حال اتصال...');
            
            ws = new WebSocket(serverUrl);
            
            ws.onopen = function() {
                console.log('WebSocket connected');
                state.isConnected = true;
                updateStatus('connected', '● آنلاین');
                enableInput();
            };
            
            ws.onmessage = function(event) {
                try {
                    const data = JSON.parse(event.data);
                    handleWebSocketMessage(data);
                } catch (error) {
                    console.error('خطا در پردازش پیام:', error);
                }
            };
            
            ws.onclose = function() {
                console.log('WebSocket disconnected');
                state.isConnected = false;
                updateStatus('disconnected', '● آفلاین');
                disableInput();
                
                // تلاش مجدد برای اتصال بعد از 5 ثانیه
                setTimeout(() => {
                    if (!state.isConnected) {
                        connectWebSocket(serverUrl);
                    }
                }, 5000);
            };
            
            ws.onerror = function(error) {
                console.error('WebSocket error:', error);
                updateStatus('error', '● خطا در اتصال');
            };
            
        } catch (error) {
            console.error('خطا در اتصال WebSocket:', error);
        }
    }
    
    /**
     * پردازش پیام‌های دریافتی از WebSocket
     */
    function handleWebSocketMessage(data) {
        switch (data.type) {
            case 'connection':
                state.userId = data.userId;
                console.log('User ID received:', state.userId);
                break;
                
            case 'ai_response':
                addMessage({
                    text: data.message,
                    sender: 'ai',
                    timestamp: new Date()
                });
                
                if (data.requiresHuman && window.aiChatWidgetSettings?.humanSupportEnabled) {
                    // نمایش دکمه اتصال به اپراتور انسانی
                    showHumanSupportButton(data.sessionId);
                }
                break;
                
            case 'connected_to_human':
                state.chatMode = 'human';
                addMessage({
                    text: data.message,
                    sender: 'system',
                    timestamp: new Date()
                });
                updateStatus('human', '● متصل به اپراتور');
                break;
                
            case 'admin_message':
                addMessage({
                    text: data.message,
                    sender: 'admin',
                    timestamp: new Date(),
                    adminName: data.fromAdmin
                });
                break;
                
            case 'message_sent':
                // تأیید ارسال پیام
                if (data.to === 'admin') {
                    addMessage({
                        text: 'پیام شما به اپراتور ارسال شد.',
                        sender: 'system',
                        timestamp: new Date()
                    });
                }
                break;
                
            case 'error':
                addMessage({
                    text: 'خطا: ' + data.message,
                    sender: 'system',
                    timestamp: new Date(),
                    isError: true
                });
                break;
        }
    }
    
    /**
     * ارسال پیام به سرور
     */
    function sendMessage(text) {
        if (!text.trim() || !state.isConnected || !ws) return;
        
        // اضافه کردن پیام کاربر به چت
        addMessage({
            text: text,
            sender: 'user',
            timestamp: new Date()
        });
        
        // ارسال از طریق WebSocket
        const messageData = {
            type: state.chatMode === 'ai' ? 'message' : 'message',
            content: text,
            sessionId: state.sessionId
        };
        
        ws.send(JSON.stringify(messageData));
        
        // اطلاع تایپینگ
        ws.send(JSON.stringify({
            type: 'typing',
            sessionId: state.sessionId
        }));
        
        // پاک کردن input
        elements.input.value = '';
    }
    
    /**
     * افزودن پیام به پنجره چت
     */
    function addMessage(message) {
        state.messages.push(message);
        
        const messageElement = document.createElement('div');
        messageElement.className = `ai-chat-message ai-chat-message-${message.sender}`;
        
        if (message.isError) {
            messageElement.classList.add('ai-chat-message-error');
        }
        
        const time = message.timestamp.toLocaleTimeString('fa-IR', {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        let senderName = 'شما';
        if (message.sender === 'ai') senderName = 'دستیار هوش مصنوعی';
        if (message.sender === 'admin') senderName = message.adminName || 'اپراتور';
        if (message.sender === 'system') senderName = 'سیستم';
        
        messageElement.innerHTML = `
            <div class="ai-chat-message-header">
                <span class="ai-chat-message-sender">${senderName}</span>
                <span class="ai-chat-message-time">${time}</span>
            </div>
            <div class="ai-chat-message-content">${escapeHtml(message.text)}</div>
        `;
        
        elements.body.appendChild(messageElement);
        
        // اسکرول به پایین
        elements.body.scrollTop = elements.body.scrollHeight;
        
        // مخفی کردن تایپینگ
        hideTypingIndicator();
    }
    
    /**
     * نمایش دکمه اتصال به اپراتور انسانی
     */
    function showHumanSupportButton(sessionId) {
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'ai-chat-human-support';
        
        buttonContainer.innerHTML = `
            <div class="ai-chat-human-support-message">
                مایلید با اپراتور انسانی صحبت کنید؟
            </div>
            <button class="ai-chat-human-support-btn" data-session-id="${sessionId}">
                اتصال به اپراتور انسانی
            </button>
        `;
        
        elements.body.appendChild(buttonContainer);
        
        // اسکرول به پایین
        elements.body.scrollTop = elements.body.scrollHeight;
        
        // اضافه کردن event listener به دکمه
        const button = buttonContainer.querySelector('.ai-chat-human-support-btn');
        button.addEventListener('click', function() {
            const sessionId = this.getAttribute('data-session-id');
            connectToHuman(sessionId);
            buttonContainer.remove();
        });
    }
    
    /**
     * اتصال به اپراتور انسانی
     */
    function connectToHuman(sessionId) {
        if (!state.isConnected || !ws) return;
        
        ws.send(JSON.stringify({
            type: 'connect_to_human',
            sessionId: sessionId
        }));
        
        addMessage({
            text: 'درخواست اتصال به اپراتور انسانی ارسال شد...',
            sender: 'system',
            timestamp: new Date()
        });
    }
    
    /**
     * به‌روزرسانی وضعیت اتصال
     */
    function updateStatus(status, text) {
        state.connectionStatus = status;
        if (elements.statusIndicator) {
            elements.statusIndicator.textContent = text;
            elements.statusIndicator.className = 'ai-chat-status ai-chat-status-' + status;
        }
    }
    
    /**
     * فعال‌سازی input
     */
    function enableInput() {
        elements.input.disabled = false;
        elements.input.placeholder = 'پیام خود را بنویسید...';
        elements.sendButton.disabled = false;
    }
    
    /**
     * غیرفعال‌سازی input
     */
    function disableInput() {
        elements.input.disabled = true;
        elements.input.placeholder = 'در حال اتصال...';
        elements.sendButton.disabled = true;
    }
    
    /**
     * نمایش نشانگر تایپ
     */
    function showTypingIndicator() {
        if (elements.typingIndicator) {
            elements.typingIndicator.classList.remove('hidden');
            state.isTyping = true;
        }
    }
    
    /**
     * مخفی کردن نشانگر تایپ
     */
    function hideTypingIndicator() {
        if (elements.typingIndicator) {
            elements.typingIndicator.classList.add('hidden');
            state.isTyping = false;
        }
    }
    
    /**
     * باز/بستن پنجره چت
     */
    function toggleChat() {
        state.isOpen = !state.isOpen;
        
        if (state.isOpen) {
            elements.window.classList.remove('hidden');
            elements.toggleButton.classList.add('active');
            // فوکوس روی input هنگام باز شدن
            setTimeout(() => {
                elements.input.focus();
            }, 100);
        } else {
            elements.window.classList.add('hidden');
            elements.toggleButton.classList.remove('active');
        }
    }
    
    /**
     * فرار از HTML برای جلوگیری از XSS
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    /**
     * API عمومی ویجت
     */
    window.AIChatWidget = {
        init: function(config) {
            // اگر ویجت قبلاً ساخته شده، بازگردان
            if (document.getElementById('ai-chat-widget')) {
                console.warn('ویجت چت قبلاً بارگذاری شده است.');
                return;
            }
            
            // صبر تا بارگذاری کامل DOM
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', function() {
                    createWidget(config);
                });
            } else {
                createWidget(config);
            }
        },
        
        open: function() {
            if (!state.isOpen) {
                toggleChat();
            }
        },
        
        close: function() {
            if (state.isOpen) {
                toggleChat();
            }
        },
        
        sendMessage: function(text) {
            if (state.isConnected) {
                sendMessage(text);
            }
        },
        
        getState: function() {
            return Object.assign({}, state);
        },
        
        destroy: function() {
            if (elements.container && elements.container.parentNode) {
                elements.container.parentNode.removeChild(elements.container);
            }
            if (ws) {
                ws.close();
            }
            state = {
                isOpen: false,
                isConnected: false,
                userId: null,
                sessionId: null,
                isTyping: false,
                messages: [],
                connectionStatus: 'disconnected'
            };
        }
    };
    
    // بارگذاری خودکار اگر data attribute وجود دارد
    if (document.currentScript && document.currentScript.getAttribute('data-auto-init') !== 'false') {
        const config = {};
        
        // خواندن تنظیمات از data attributes
        const scriptElement = document.currentScript;
        if (scriptElement) {
            config.serverUrl = scriptElement.getAttribute('data-server-url') || defaultConfig.serverUrl;
            config.apiUrl = scriptElement.getAttribute('data-api-url') || defaultConfig.apiUrl;
            config.position = scriptElement.getAttribute('data-position') || defaultConfig.position;
            config.primaryColor = scriptElement.getAttribute('data-primary-color') || defaultConfig.primaryColor;
            config.secondaryColor = scriptElement.getAttribute('data-secondary-color') || defaultConfig.secondaryColor;
            config.title = scriptElement.getAttribute('data-title') || defaultConfig.title;
            config.autoOpen = scriptElement.getAttribute('data-auto-open') === 'true';
        }
        
        window.AIChatWidget.init(config);
    }
    
})();
