// Chatbot Embed Script - Version 1.0
(function() {
    'use strict';
    
    // Configuration
    const CONFIG = {
        serverUrl: window.CHATBOT_SERVER_URL || window.location.origin,
        widgetUrl: window.CHATBOT_WIDGET_URL || '/widget',
        position: window.CHATBOT_POSITION || 'bottom-left',
        autoInit: window.CHATBOT_AUTO_INIT !== false,
        theme: window.CHATBOT_THEME || 'default',
        language: window.CHATBOT_LANGUAGE || 'fa'
    };
    
    // Load widget resources
    function loadResources() {
        return new Promise((resolve, reject) => {
            // Check if already loaded
            if (document.getElementById('chatbot-widget-styles')) {
                resolve();
                return;
            }
            
            // Load CSS
            const cssLink = document.createElement('link');
            cssLink.rel = 'stylesheet';
            cssLink.href = `${CONFIG.widgetUrl}/styles.css`;
            cssLink.id = 'chatbot-widget-styles';
            
            // Load Font Awesome
            const faLink = document.createElement('link');
            faLink.rel = 'stylesheet';
            faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
            
            // Load HTML
            fetch(`${CONFIG.widgetUrl}/index.html`)
                .then(response => response.text())
                .then(html => {
                    // Inject HTML
                    const container = document.createElement('div');
                    container.innerHTML = html;
                    document.body.appendChild(container);
                    
                    // Inject CSS
                    document.head.appendChild(faLink);
                    document.head.appendChild(cssLink);
                    
                    // Load JavaScript
                    const script = document.createElement('script');
                    script.src = `${CONFIG.widgetUrl}/chatbot.js`;
                    script.onload = resolve;
                    script.onerror = reject;
                    document.body.appendChild(script);
                })
                .catch(reject);
        });
    }
    
    // Initialize widget
    function initWidget() {
        loadResources()
            .then(() => {
                console.log('🤖 Chatbot widget loaded successfully');
                
                // Wait for DOM to be ready
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', () => {
                        initializeChatbot();
                    });
                } else {
                    initializeChatbot();
                }
            })
            .catch(error => {
                console.error('Failed to load chatbot widget:', error);
                
                // Show error message
                const errorDiv = document.createElement('div');
                errorDiv.style.cssText = `
                    position: fixed;
                    bottom: 20px;
                    left: 20px;
                    background: #f8d7da;
                    color: #721c24;
                    padding: 10px 15px;
                    border-radius: 5px;
                    border: 1px solid #f5c6cb;
                    font-family: sans-serif;
                    z-index: 99999;
                    max-width: 300px;
                `;
                errorDiv.textContent = 'خطا در بارگذاری پشتیبان هوشمند';
                document.body.appendChild(errorDiv);
                
                // Remove after 5 seconds
                setTimeout(() => errorDiv.remove(), 5000);
            });
    }
    
    // Initialize chatbot instance
    function initializeChatbot() {
        // Check if Chatbot class exists
        if (typeof window.Chatbot === 'undefined') {
            console.error('Chatbot class not found');
            return;
        }
        
        // Create chatbot instance
        window.chatbotInstance = new window.Chatbot({
            serverUrl: CONFIG.serverUrl,
            autoOpen: false,
            soundEnabled: true
        });
        
        // Apply position
        applyPosition(CONFIG.position);
        
        // Apply theme
        applyTheme(CONFIG.theme);
        
        // Expose public API
        window.ChatbotWidget = {
            open: () => window.chatbotInstance.open(),
            close: () => window.chatbotInstance.close(),
            send: (message) => window.chatbotInstance.send(message),
            getSessionId: () => window.chatbotInstance.getSessionId(),
            destroy: () => window.chatbotInstance.destroy()
        };
        
        // Dispatch loaded event
        document.dispatchEvent(new CustomEvent('chatbot:loaded', {
            detail: { instance: window.chatbotInstance }
        }));
        
        console.log('🚀 Chatbot widget initialized');
    }
    
    // Apply position to widget
    function applyPosition(position) {
        const container = document.getElementById('chatbot-container');
        const toggle = document.getElementById('chatToggle');
        
        if (!container || !toggle) return;
        
        const positions = {
            'bottom-right': {
                container: { right: '20px', bottom: '20px', left: 'auto' },
                toggle: { right: '20px', bottom: '20px', left: 'auto' }
            },
            'bottom-left': {
                container: { left: '20px', bottom: '20px', right: 'auto' },
                toggle: { left: '20px', bottom: '20px', right: 'auto' }
            },
            'top-right': {
                container: { right: '20px', top: '20px', bottom: 'auto' },
                toggle: { right: '20px', top: '20px', bottom: 'auto' }
            },
            'top-left': {
                container: { left: '20px', top: '20px', bottom: 'auto' },
                toggle: { left: '20px', top: '20px', bottom: 'auto' }
            }
        };
        
        const pos = positions[position] || positions['bottom-left'];
        
        Object.assign(container.style, pos.container);
        Object.assign(toggle.style, pos.toggle);
    }
    
    // Apply theme
    function applyTheme(theme) {
        const container = document.getElementById('chatbot-container');
        if (!container) return;
        
        const themes = {
            'default': {
                '--primary-color': '#4361ee',
                '--secondary-color': '#3a0ca3'
            },
            'dark': {
                '--primary-color': '#1a1a2e',
                '--secondary-color': '#16213e'
            },
            'green': {
                '--primary-color': '#2ecc71',
                '--secondary-color': '#27ae60'
            },
            'purple': {
                '--primary-color': '#9b59b6',
                '--secondary-color': '#8e44ad'
            }
        };
        
        const themeVars = themes[theme] || themes['default'];
        
        Object.entries(themeVars).forEach(([key, value]) => {
            container.style.setProperty(key, value);
        });
    }
    
    // Auto-initialize if enabled
    if (CONFIG.autoInit) {
        // Wait for page to load
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initWidget);
        } else {
            initWidget();
        }
    }
    
    // Expose initialization function
    window.initChatbotWidget = function(config = {}) {
        Object.assign(CONFIG, config);
        initWidget();
    };
    
    // Global error handler for chatbot
    window.addEventListener('error', function(event) {
        if (event.message && event.message.includes('chatbot')) {
            console.error('Chatbot error:', event.error);
            event.preventDefault();
        }
    });
    
})();

// Usage instructions in comments:
/*
// To embed the chatbot in your website, add this script tag:
<script>
    window.CHATBOT_SERVER_URL = 'https://your-backend-url.com';
    window.CHATBOT_WIDGET_URL = 'https://your-frontend-url.com/widget';
    window.CHATBOT_POSITION = 'bottom-left'; // bottom-right, top-left, top-right
    window.CHATBOT_THEME = 'default'; // dark, green, purple
</script>
<script src="https://your-frontend-url.com/embed.js" async></script>

// Or initialize manually:
<script src="https://your-frontend-url.com/embed.js"></script>
<script>
    window.initChatbotWidget({
        serverUrl: 'https://your-backend-url.com',
        widgetUrl: 'https://your-frontend-url.com/widget',
        position: 'bottom-left',
        theme: 'default',
        autoOpen: false
    });
</script>
*/
