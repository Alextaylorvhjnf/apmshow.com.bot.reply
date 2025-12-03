class ChatWidget {
    constructor() {
        this.config = {
            // استفاده از آدرس جاری به صورت خودکار
            backendUrl: window.location.origin,
            sessionId: null,
            socket: null,
            isConnected: false,
            isConnectingToHuman: false,
            operatorConnected: false,
            messageCount: 0
        };

        console.log('🤖 Chat Widget Initializing...');
        console.log('Backend URL:', this.config.backendUrl);
        
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
        
        console.log('✅ Chat widget initialized with session:', this.config.sessionId);
        
        // Show widget after initialization
        setTimeout(() => {
            this.showWidget();
        }, 1000);
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
        
        console.log('✅ DOM elements initialized');
    }

    showWidget() {
        // Create widget container if doesn't exist
        if (!document.getElementById('chat-widget-container')) {
            this.injectWidget();
        }
        
        // Show toggle button
        if (this.elements.chatToggle) {
            this.elements.chatToggle.style.display = 'flex';
            console.log('🎯 Widget toggle button displayed');
        }
    }

    injectWidget() {
        // This will inject the widget HTML if it's not already in the page
        const container = document.createElement('div');
        container.id = 'chat-widget-container';
        document.body.appendChild(container);
        
        // Load widget HTML via fetch if needed
        fetch(`${this.config.backendUrl}/`)
            .then(response => response.text())
            .then(html => {
                container.innerHTML = html;
                this.initElements();
                this.initEvents();
                console.log('✅ Widget HTML injected successfully');
            })
            .catch(error => {
                console.error('Failed to load widget HTML:', error);
            });
    }

    // بقیه کدها مانند قبل...
    // ... [بقیه توابع بدون تغییر] ...
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.ChatWidget = new ChatWidget();
    });
} else {
    window.ChatWidget = new ChatWidget();
}

// Export for global access
if (typeof window !== 'undefined') {
    window.initChatWidget = function() {
        return new ChatWidget();
    };
}
