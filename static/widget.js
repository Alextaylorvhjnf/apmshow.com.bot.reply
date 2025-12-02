// ویجت چت آنلاین برای Railway
(function() {
    // جلوگیری از لود تکراری
    if (window.ChatWidgetLoaded) return;
    window.ChatWidgetLoaded = true;
    
    // ایجاد استایل‌ها
    const style = document.createElement('style');
    style.textContent = `
        .chat-widget-container {
            position: fixed;
            bottom: 30px;
            left: 30px;
            z-index: 10000;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        
        .chat-toggle-btn {
            width: 70px;
            height: 70px;
            border-radius: 50%;
            background: linear-gradient(135deg, #4a6cf7 0%, #6a11cb 100%);
            color: white;
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 28px;
            box-shadow: 0 8px 25px rgba(74, 108, 247, 0.4);
            transition: all 0.3s ease;
            animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
            0% { box-shadow: 0 0 0 0 rgba(74, 108, 247, 0.7); }
            70% { box-shadow: 0 0 0 15px rgba(74, 108, 247, 0); }
            100% { box-shadow: 0 0 0 0 rgba(74, 108, 247, 0); }
        }
        
        .chat-toggle-btn:hover {
            transform: scale(1.1);
            box-shadow: 0 10px 30px rgba(74, 108, 247, 0.6);
        }
        
        .chat-window {
            position: absolute;
            bottom: 90px;
            left: 0;
            width: 400px;
            max-width: 90vw;
            height: 600px;
            max-height: 80vh;
            background: white;
            border-radius: 20px;
            box-shadow: 0 15px 50px rgba(0, 0, 0, 0.2);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            opacity: 0;
            transform: translateY(20px) scale(0.9);
            transition: all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
            pointer-events: none;
        }
        
        .chat-window.active {
            opacity: 1;
            transform: translateY(0) scale(1);
            pointer-events: all;
        }
        
        .chat-header {
            background: linear-gradient(135deg, #4a6cf7 0%, #6a11cb 100%);
            color: white;
            padding: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .chat-header h3 {
            margin: 0;
            font-size: 1.2rem;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .close-chat {
            background: rgba(255, 255, 255, 0.2);
            border: none;
            color: white;
            width: 35px;
            height: 35px;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.3s;
        }
        
        .close-chat:hover {
            background: rgba(255, 255, 255, 0.3);
        }
        
        .chat-messages {
            flex: 1;
            padding: 20px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 15px;
            background: #f8f9fa;
        }
        
        .chat-message {
            max-width: 85%;
            padding: 15px;
            border-radius: 18px;
            line-height: 1.5;
            animation: messageAppear 0.3s ease;
        }
        
        @keyframes messageAppear {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        .chat-message.user {
            align-self: flex-end;
            background: linear-gradient(135deg, #4a6cf7 0%, #6a11cb 100%);
            color: white;
            border-bottom-right-radius: 5px;
        }
        
        .chat-message.bot {
            align-self: flex-start;
            background: white;
            color: #333;
            border-bottom-left-radius: 5px;
            box-shadow: 0 3px 10px rgba(0, 0, 0, 0.08);
        }
        
        .chat-input-area {
            padding: 20px;
            border-top: 1px solid #e9ecef;
            display: flex;
            gap: 10px;
            background: white;
        }
        
        .chat-input {
            flex: 1;
            padding: 15px;
            border: 2px solid #e9ecef;
            border-radius: 25px;
            font-size: 14px;
            outline: none;
            transition: border-color 0.3s;
            direction: rtl;
        }
        
        .chat-input:focus {
            border-color: #4a6cf7;
        }
        
        .send-message-btn {
            width: 55px;
            height: 55px;
            border-radius: 50%;
            background: linear-gradient(135deg, #4a6cf7 0%, #6a11cb 100%);
            color: white;
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.3s;
        }
        
        .send-message-btn:hover {
            transform: scale(1.05);
        }
        
        .typing-indicator {
            display: flex;
            gap: 8px;
            padding: 15px;
            background: white;
            border-radius: 18px;
            width: fit-content;
            box-shadow: 0 3px 10px rgba(0, 0, 0, 0.08);
        }
        
        .typing-indicator span {
            width: 10px;
            height: 10px;
            background: #7f8c8d;
            border-radius: 50%;
            animation: typing 1.4s infinite;
        }
        
        @keyframes typing {
            0%, 60%, 100% { transform: translateY(0); }
            30% { transform: translateY(-10px); }
        }
        
        @media (max-width: 768px) {
            .chat-window {
                width: 350px;
                left: -150px;
            }
            
            .chat-widget-container {
                bottom: 20px;
                left: 20px;
            }
        }
        
        @media (max-width: 480px) {
            .chat-window {
                width: 320px;
                left: -130px;
                height: 500px;
            }
            
            .chat-toggle-btn {
                width: 60px;
                height: 60px;
                font-size: 24px;
            }
        }
    `;
    
    document.head.appendChild(style);
    
    // بارگذاری Font Awesome
    if (!document.querySelector('link[href*="font-awesome"]')) {
        const faLink = document.createElement('link');
        faLink.rel = 'stylesheet';
        faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
        document.head.appendChild(faLink);
    }
    
    // ایجاد ویجت
    const widgetContainer = document.createElement('div');
    widgetContainer.className = 'chat-widget-container';
    widgetContainer.innerHTML = `
        <button class="chat-toggle-btn" id="chat-toggle-btn">
            <i class="fas fa-comment-dots"></i>
        </button>
        
        <div class="chat-window" id="chat-window">
            <div class="chat-header">
                <h3>
                    <i class="fas fa-headset"></i>
                    پشتیبانی آنلاین
                </h3>
                <button class="close-chat" id="close-chat">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            
            <div class="chat-messages" id="chat-messages">
                <div class="chat-message bot">
                    سلام! 👋 به پشتیبانی آنلاین خوش آمدید. چطور می‌توانم کمکتان کنم؟
                </div>
            </div>
            
            <div class="chat-input-area">
                <input type="text" 
                       class="chat-input" 
                       id="chat-input" 
                       placeholder="پیام خود را بنویسید..."
                       dir="rtl">
                
                <button class="send-message-btn" id="send-message-btn">
                    <i class="fas fa-paper-plane"></i>
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(widgetContainer);
    
    // دریافت المان‌ها
    const toggleBtn = document.getElementById('chat-toggle-btn');
    const chatWindow = document.getElementById('chat-window');
    const closeBtn = document.getElementById('close-chat');
    const messagesContainer = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-message-btn');
    
    let isOpen = false;
    let messages = [];
    let faqData = [];
    
    // بارگذاری FAQ از API
    async function loadFAQ() {
        try {
            // استفاده از آدرس نسبی برای Railway
            const response = await fetch('/api/faq');
            faqData = await response.json();
            console.log(`Loaded ${faqData.length} FAQ items`);
        } catch (error) {
            console.error('Error loading FAQ:', error);
            faqData = [];
        }
    }
    
    // محاسبه شباهت متن
    function calculateSimilarity(text1, text2) {
        const str1 = text1.toLowerCase().replace(/\s+/g, ' ');
        const str2 = text2.toLowerCase().replace(/\s+/g, ' ');
        
        if (str1 === str2) return 1.0;
        
        const words1 = new Set(str1.split(' '));
        const words2 = new Set(str2.split(' '));
        
        const intersection = new Set([...words1].filter(x => words2.has(x)));
        const union = new Set([...words1, ...words2]);
        
        return intersection.size / union.size;
    }
    
    // پیدا کردن پاسخ در FAQ
    function findFAQAnswer(question) {
        let bestMatch = null;
        let highestSimilarity = 0;
        
        for (const faq of faqData) {
            const similarity = calculateSimilarity(question, faq.question);
            
            if (similarity > highestSimilarity && similarity >= 0.6) {
                highestSimilarity = similarity;
                bestMatch = faq;
            }
        }
        
        return bestMatch ? bestMatch.answer : null;
    }
    
    // پردازش سوال کاربر
    async function processQuestion(question) {
        // جستجو در FAQ
        const faqAnswer = findFAQAnswer(question);
        
        if (faqAnswer) {
            return {
                text: faqAnswer,
                source: 'faq',
                confidence: 'high'
            };
        }
        
        // اگر در FAQ پیدا نشد، از API استفاده می‌کنیم
        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message: question })
            });
            
            const data = await response.json();
            return {
                text: data.reply || "پیام شما دریافت شد. به زودی پاسخ می‌دهم.",
                source: 'api',
                confidence: 'medium'
            };
        } catch (error) {
            // پاسخ پیش‌فرض
            const defaultAnswers = [
                "متأسفانه پاسخی برای سوال شما پیدا نکردم. لطفاً سوال خود را به صورت واضح‌تر مطرح کنید.",
                "برای اطلاعات بیشتر می‌توانید با پشتیبانی تماس بگیرید.",
                "سوال خوبی پرسیدید! در حال حاضر اطلاعات کافی برای پاسخ ندارم."
            ];
            
            const randomAnswer = defaultAnswers[Math.floor(Math.random() * defaultAnswers.length)];
            
            return {
                text: randomAnswer,
                source: 'default',
                confidence: 'low'
            };
        }
    }
    
    // اضافه کردن پیام به چت
    function addMessage(sender, text) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${sender}`;
        messageDiv.textContent = text;
        
        messagesContainer.appendChild(messageDiv);
        scrollToBottom();
        
        messages.push({ sender, text, time: new Date() });
    }
    
    // نمایش نشانگر تایپ
    function showTypingIndicator() {
        const typingDiv = document.createElement('div');
        typingDiv.className = 'typing-indicator';
        typingDiv.id = 'typing-indicator';
        
        typingDiv.innerHTML = `
            <span></span>
            <span></span>
            <span></span>
        `;
        
        messagesContainer.appendChild(typingDiv);
        scrollToBottom();
    }
    
    // پنهان کردن نشانگر تایپ
    function hideTypingIndicator() {
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }
    
    // اسکرول به پایین
    function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    // ارسال پیام
    async function sendMessage() {
        const text = chatInput.value.trim();
        
        if (!text) return;
        
        chatInput.value = '';
        addMessage('user', text);
        
        showTypingIndicator();
        
        try {
            const response = await processQuestion(text);
            
            setTimeout(() => {
                hideTypingIndicator();
                addMessage('bot', response.text);
            }, 1000 + Math.random() * 500);
            
        } catch (error) {
            console.error('Error processing message:', error);
            hideTypingIndicator();
            
            setTimeout(() => {
                addMessage('bot', 'خطایی در پردازش سوال شما رخ داد. لطفاً دوباره تلاش کنید.');
            }, 300);
        }
    }
    
    // راه‌اندازی event listeners
    toggleBtn.addEventListener('click', () => {
        isOpen = !isOpen;
        
        if (isOpen) {
            chatWindow.classList.add('active');
            toggleBtn.classList.add('active');
            chatInput.focus();
            scrollToBottom();
        } else {
            chatWindow.classList.remove('active');
            toggleBtn.classList.remove('active');
        }
    });
    
    closeBtn.addEventListener('click', () => {
        isOpen = false;
        chatWindow.classList.remove('active');
        toggleBtn.classList.remove('active');
    });
    
    sendBtn.addEventListener('click', sendMessage);
    
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    // بستن چت با کلیک خارج
    document.addEventListener('click', (e) => {
        if (isOpen && 
            !chatWindow.contains(e.target) && 
            !toggleBtn.contains(e.target)) {
            isOpen = false;
            chatWindow.classList.remove('active');
            toggleBtn.classList.remove('active');
        }
    });
    
    // بارگذاری FAQ
    loadFAQ();
    
    // API عمومی
    window.ChatWidget = {
        open: () => {
            isOpen = true;
            chatWindow.classList.add('active');
            toggleBtn.classList.add('active');
            chatInput.focus();
            scrollToBottom();
        },
        
        close: () => {
            isOpen = false;
            chatWindow.classList.remove('active');
            toggleBtn.classList.remove('active');
        },
        
        sendMessage: (text) => {
            if (text) {
                chatInput.value = text;
                sendMessage();
            }
        },
        
        setTheme: (theme) => {
            const isDark = theme === 'dark';
            chatWindow.style.backgroundColor = isDark ? '#2c3e50' : 'white';
            chatWindow.style.color = isDark ? 'white' : '#333';
        },
        
        clearHistory: () => {
            messagesContainer.innerHTML = '';
            messages = [];
            addMessage('bot', 'سلام! 👋 به پشتیبانی آنلاین خوش آمدید. چطور می‌توانم کمکتان کنم؟');
        },
        
        updateFAQ: async (newFAQ) => {
            try {
                const response = await fetch('/api/update-faq', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(newFAQ)
                });
                
                const result = await response.json();
                if (result.status === 'success') {
                    faqData = newFAQ;
                    console.log('FAQ updated successfully');
                }
            } catch (error) {
                console.error('Error updating FAQ:', error);
            }
        }
    };
    
    console.log('Chat Widget loaded successfully!');
    console.log('Control with: window.ChatWidget');
})();
