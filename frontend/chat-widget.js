// ویجت چت ساده
(function() {
    'use strict';
    
    console.log('🤖 Chat Widget Loaded!');
    
    const widgetHTML = `
        <div id="ai-chat-widget" style="position: fixed; bottom: 20px; left: 20px; z-index: 9999;">
            <button id="chat-toggle" style="width: 60px; height: 60px; border-radius: 50%; background: #007bff; color: white; border: none; cursor: pointer; font-size: 24px; box-shadow: 0 4px 15px rgba(0,123,255,0.3);">💬</button>
            
            <div id="chat-window" style="position: absolute; bottom: 70px; left: 0; width: 350px; height: 500px; background: white; border-radius: 15px; box-shadow: 0 10px 40px rgba(0,0,0,0.15); display: none; flex-direction: column; border: 1px solid #e0e0e0;">
                <div style="background: #007bff; color: white; padding: 15px; border-radius: 15px 15px 0 0; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 600;">پشتیبانی آنلاین</span>
                    <button id="chat-close" style="background: none; border: none; color: white; font-size: 20px; cursor: pointer;">×</button>
                </div>
                
                <div id="chat-messages" style="flex: 1; padding: 15px; overflow-y: auto; background: #f8f9fa;"></div>
                
                <div style="padding: 15px; border-top: 1px solid #e0e0e0;">
                    <div style="display: flex; gap: 10px;">
                        <input type="text" id="chat-input" placeholder="پیام خود را بنویسید..." style="flex: 1; padding: 10px 15px; border: 1px solid #ddd; border-radius: 25px; outline: none;">
                        <button id="chat-send" style="width: 45px; height: 45px; border-radius: 50%; background: #007bff; color: white; border: none; cursor: pointer;">↗</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.addEventListener('DOMContentLoaded', function() {
        const container = document.createElement('div');
        container.innerHTML = widgetHTML;
        document.body.appendChild(container);
        
        // متغیرها
        const toggleBtn = document.getElementById('chat-toggle');
        const chatWindow = document.getElementById('chat-window');
        const closeBtn = document.getElementById('chat-close');
        const chatInput = document.getElementById('chat-input');
        const sendBtn = document.getElementById('chat-send');
        const chatMessages = document.getElementById('chat-messages');
        
        let isOpen = false;
        let ws = null;
        
        // توابع
        function toggleChat() {
            isOpen = !isOpen;
            chatWindow.style.display = isOpen ? 'flex' : 'none';
            if (isOpen) {
                chatInput.focus();
                addMessage('🤖 سلام! چطور می‌تونم کمک‌تون کنم؟', 'ai');
                connectWebSocket();
            }
        }
        
        function addMessage(text, sender) {
            const messageDiv = document.createElement('div');
            messageDiv.style.cssText = `
                margin: 10px 0;
                padding: 10px 15px;
                border-radius: 15px;
                max-width: 85%;
                background: ${sender === 'user' ? '#007bff' : '#f1f1f1'};
                color: ${sender === 'user' ? 'white' : '#333'};
                ${sender === 'user' ? 'margin-left: auto;' : 'margin-right: auto;'}
            `;
            messageDiv.textContent = text;
            chatMessages.appendChild(messageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
        
        function connectWebSocket() {
            try {
                const wsUrl = window.location.origin.replace('http://', 'ws://').replace('https://', 'wss://');
                ws = new WebSocket(wsUrl);
                
                ws.onopen = () => {
                    console.log('✅ WebSocket connected');
                };
                
                ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        if (data.type === 'welcome') {
                            addMessage(data.message, 'ai');
                        } else if (data.type === 'response') {
                            addMessage(data.message, 'ai');
                        }
                    } catch (error) {
                        console.error('Error parsing message:', error);
                    }
                };
                
                ws.onclose = () => {
                    console.log('WebSocket disconnected');
                };
            } catch (error) {
                console.error('WebSocket error:', error);
            }
        }
        
        function sendMessage() {
            const message = chatInput.value.trim();
            if (!message) return;
            
            addMessage(message, 'user');
            
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'chat',
                    text: message
                }));
            } else {
                // Fallback to API
                fetch('/api/chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        message: message
                    })
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        addMessage(data.response, 'ai');
                    }
                })
                .catch(error => {
                    addMessage('خطا در ارتباط با سرور', 'ai');
                });
            }
            
            chatInput.value = '';
        }
        
        // Event Listeners
        toggleBtn.addEventListener('click', toggleChat);
        closeBtn.addEventListener('click', toggleChat);
        sendBtn.addEventListener('click', sendMessage);
        
        chatInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
        
        console.log('✅ Chat Widget initialized!');
    });
})();
