/* Chat Widget Styles - Professional Design */
@font-face {
    font-family: 'Vazir';
    src: url('https://cdn.jsdelivr.net/gh/rastikerdar/vazir-font@v30.1.0/dist/Vazir.woff2') format('woff2'),
         url('https://cdn.jsdelivr.net/gh/rastikerdar/vazir-font@v30.1.0/dist/Vazir.woff') format('woff');
    font-weight: normal;
    font-style: normal;
    font-display: swap;
}

/* Reset and Base Styles */
.chat-widget * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    font-family: 'Vazir', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
}

.chat-widget {
    font-family: 'Vazir', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    direction: rtl;
}

/* Floating Button */
.chat-toggle-btn {
    position: fixed;
    bottom: 30px;
    left: 30px;
    width: 70px;
    height: 70px;
    border-radius: 50%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border: none;
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 10px 30px rgba(102, 126, 234, 0.4);
    z-index: 10000;
    transition: all 0.3s ease;
    animation: pulse 2s infinite;
}

@keyframes pulse {
    0% {
        transform: scale(1);
        box-shadow: 0 10px 30px rgba(102, 126, 234, 0.4);
    }
    50% {
        transform: scale(1.05);
        box-shadow: 0 15px 40px rgba(102, 126, 234, 0.6);
    }
    100% {
        transform: scale(1);
        box-shadow: 0 10px 30px rgba(102, 126, 234, 0.4);
    }
}

.chat-toggle-btn:hover {
    transform: scale(1.1);
    box-shadow: 0 20px 50px rgba(102, 126, 234, 0.5);
}

.chat-toggle-btn i {
    font-size: 28px;
}

.notification-badge {
    position: absolute;
    top: -5px;
    right: -5px;
    background: #ff4757;
    color: white;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
}

/* Chat Window */
.chat-window {
    position: fixed;
    bottom: 120px;
    left: 30px;
    width: 400px;
    height: 600px;
    background: white;
    border-radius: 20px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
    z-index: 9999;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transform: translateY(20px);
    opacity: 0;
    transition: all 0.3s ease;
}

.chat-window.active {
    transform: translateY(0);
    opacity: 1;
}

/* Header */
.chat-header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-radius: 20px 20px 0 0;
}

.header-left {
    display: flex;
    align-items: center;
    gap: 12px;
}

.chat-logo {
    width: 40px;
    height: 40px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
}

.chat-title h3 {
    font-size: 18px;
    font-weight: 600;
    margin: 0;
}

.chat-title p {
    font-size: 12px;
    opacity: 0.9;
    margin: 2px 0 0 0;
}

.chat-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
}

.status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #2ecc71;
    animation: blink 1.5s infinite;
}

@keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}

.close-btn {
    background: rgba(255, 255, 255, 0.2);
    border: none;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.3s ease;
}

.close-btn:hover {
    background: rgba(255, 255, 255, 0.3);
    transform: rotate(90deg);
}

/* Messages Container */
.chat-messages {
    flex: 1;
    padding: 20px;
    overflow-y: auto;
    background: #f8f9fa;
    display: flex;
    flex-direction: column;
    gap: 16px;
}

/* Message Bubbles */
.message {
    max-width: 85%;
    padding: 14px 18px;
    border-radius: 18px;
    position: relative;
    animation: slideIn 0.3s ease;
    word-wrap: break-word;
    line-height: 1.5;
}

@keyframes slideIn {
    from {
        opacity: 0;
        transform: translateY(10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.message.user {
    align-self: flex-end;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border-bottom-right-radius: 4px;
}

.message.assistant {
    align-self: flex-start;
    background: white;
    color: #333;
    border: 1px solid #e9ecef;
    border-bottom-left-radius: 4px;
}

.message.operator {
    align-self: flex-start;
    background: #e3f2fd;
    color: #1976d2;
    border: 1px solid #bbdefb;
    border-bottom-left-radius: 4px;
}

.message.system {
    align-self: center;
    background: #fff3cd;
    color: #856404;
    border: 1px solid #ffeaa7;
    border-radius: 10px;
    max-width: 90%;
    text-align: center;
    font-size: 13px;
    padding: 10px 15px;
}

.message-sender {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    font-size: 13px;
    font-weight: 600;
}

.message-sender i {
    font-size: 14px;
}

.message-time {
    font-size: 11px;
    opacity: 0.7;
    margin-top: 6px;
    text-align: left;
}

/* Typing Indicator */
.typing-indicator {
    padding: 0 20px 15px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: #666;
    display: none;
}

.typing-indicator.active {
    display: flex;
}

.typing-dots {
    display: flex;
    gap: 4px;
}

.typing-dots span {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #667eea;
    animation: typing 1.4s infinite;
}

.typing-dots span:nth-child(2) {
    animation-delay: 0.2s;
}

.typing-dots span:nth-child(3) {
    animation-delay: 0.4s;
}

@keyframes typing {
    0%, 100% { opacity: 0.2; }
    50% { opacity: 1; }
}

/* Input Area */
.chat-input-area {
    padding: 20px;
    background: white;
    border-top: 1px solid #e9ecef;
}

.input-wrapper {
    display: flex;
    gap: 10px;
    align-items: flex-end;
    margin-bottom: 12px;
}

.message-input {
    flex: 1;
    border: 2px solid #e9ecef;
    border-radius: 12px;
    padding: 14px 16px;
    font-size: 14px;
    resize: none;
    max-height: 100px;
    min-height: 52px;
    transition: all 0.3s ease;
    font-family: 'Vazir', sans-serif;
    line-height: 1.5;
}

.message-input:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.send-btn {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border: none;
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.3s ease;
    flex-shrink: 0;
}

.send-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 15px rgba(102, 126, 234, 0.3);
}

.send-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
}

/* Human Support Button */
.human-support-btn {
    background: #ff6b6b;
    color: white;
    border: none;
    padding: 12px 20px;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    transition: all 0.3s ease;
    width: 100%;
}

.human-support-btn:hover {
    background: #ff5252;
    transform: translateY(-2px);
}

.human-support-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
}

/* Operator Info */
.operator-info {
    padding: 16px 20px;
    background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
    border-top: 1px solid #90caf9;
    display: none;
}

.operator-info.active {
    display: block;
}

.operator-card {
    display: flex;
    align-items: center;
    gap: 15px;
}

.operator-avatar {
    width: 50px;
    height: 50px;
    border-radius: 50%;
    background: #1976d2;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
}

.operator-details h4 {
    color: #0d47a1;
    margin-bottom: 4px;
    font-size: 15px;
    display: flex;
    align-items: center;
    gap: 8px;
}

.operator-details p {
    color: #1976d2;
    font-size: 13px;
}

/* Connection Status */
.connection-status {
    padding: 12px 20px;
    background: #fff3cd;
    border-top: 1px solid #ffeaa7;
    display: none;
}

.connection-status.active {
    display: block;
}

.status-message {
    display: flex;
    align-items: center;
    gap: 10px;
    color: #856404;
    font-size: 13px;
}

/* Scrollbar */
.chat-messages::-webkit-scrollbar {
    width: 6px;
}

.chat-messages::-webkit-scrollbar-track {
    background: #f1f1f1;
    border-radius: 3px;
}

.chat-messages::-webkit-scrollbar-thumb {
    background: #c1c1c1;
    border-radius: 3px;
}

.chat-messages::-webkit-scrollbar-thumb:hover {
    background: #a8a8a8;
}

/* Responsive */
@media (max-width: 768px) {
    .chat-toggle-btn {
        bottom: 20px;
        left: 20px;
        width: 60px;
        height: 60px;
    }
    
    .chat-window {
        bottom: 100px;
        left: 20px;
        width: calc(100vw - 40px);
        height: 500px;
    }
    
    .message {
        max-width: 90%;
    }
}
