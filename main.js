/**
 * چت‌بات هوشمند سمت‌کلاینت با WebLLM
 * تمام پردازش‌ها در مرورگر انجام می‌شود
 */

class ChatbotAI {
    constructor() {
        this.chatHistory = [];
        this.faqData = [];
        this.isInitialized = false;
        this.isLoadingModel = false;
        this.currentTheme = 'light';
        this.model = null;
        this.chatContext = null;
        
        this.init();
    }
    
    async init() {
        console.log('🚀 در حال راه‌اندازی چت‌بات هوشمند...');
        
        // بارگذاری تاریخچه چت از LocalStorage
        this.loadChatHistory();
        
        // بارگذاری FAQ
        await this.loadFAQ();
        
        // تنظیم تم اولیه
        this.setupTheme();
        
        // راه‌اندازی WebLLM
        await this.initWebLLM();
        
        this.isInitialized = true;
        console.log('✅ چت‌بات آماده است!');
        
        // نمایش پیام خوشامدگویی
        if (this.chatHistory.length === 0) {
            this.addMessage('bot', 'سلام! من چت‌بات هوشمند شما هستم. چطور می‌توانم کمک‌تان کنم؟');
        }
    }
    
    async loadFAQ() {
        try {
            const response = await fetch('faq.json');
            this.faqData = await response.json();
            console.log(`✅ ${this.faqData.length} سوال FAQ بارگذاری شد`);
        } catch (error) {
            console.error('خطا در بارگذاری FAQ:', error);
            this.faqData = [];
        }
    }
    
    async initWebLLM() {
        // بررسی پشتیبانی مرورگر از WebGPU
        if (!this.checkWebGPUSupport()) {
            console.warn('WebGPU پشتیبانی نمی‌شود. مدل هوش مصنوعی غیرفعال خواهد بود.');
            this.showNotification('مرورگر شما از WebGPU پشتیبانی نمی‌کند. لطفاً از Chrome 113+ یا Edge 113+ استفاده کنید.', 'warning');
            return;
        }
        
        // نمایش وضعیت بارگذاری مدل
        this.showModelLoading();
        
        try {
            // بارگذاری WebLLM از CDN
            await this.loadWebLLMScript();
            
            // مقداردهی اولیه مدل
            await this.initializeModel();
            
            this.hideModelLoading();
            console.log('✅ مدل WebLLM بارگذاری و آماده است');
            this.showNotification('مدل هوش مصنوعی آماده است! می‌توانید سوال خود را بپرسید.', 'success');
        } catch (error) {
            console.error('خطا در بارگذاری WebLLM:', error);
            this.hideModelLoading();
            this.showNotification('خطا در بارگذاری مدل هوش مصنوعی. سیستم از FAQ استفاده خواهد کرد.', 'error');
        }
    }
    
    checkWebGPUSupport() {
        return 'gpu' in navigator;
    }
    
    loadWebLLMScript() {
        return new Promise((resolve, reject) => {
            if (window.WebLLM) {
                resolve();
                return;
            }
            
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.34/+esm';
            script.type = 'module';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
    
    async initializeModel() {
        // استفاده از مدل سبک‌تر برای اجرا در مرورگر
        const modelName = 'Llama-2-7b-chat-hf-q4f32_1';
        
        console.log(`🧠 در حال بارگذاری مدل ${modelName}...`);
        
        // ایجاد نمونه WebLLM
        this.model = new window.WebLLM.ChatModule();
        
        // تنظیم پیش‌نمایش مدل
        const initProgressCallback = (report) => {
            console.log(`پیشرفت بارگذاری: ${report.progress}% - ${report.text}`);
            this.updateModelLoading(report.progress, report.text);
        };
        
        // بارگذاری مدل
        await this.model.init({
            model_list: [
                {
                    model_url: `https://huggingface.co/mlc-ai/${modelName}/resolve/main/`,
                    model_id: modelName,
                    model_lib_url: `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/${modelName}/${modelName}-webgpu.wasm`
                }
            ],
            initProgressCallback: initProgressCallback,
            model: modelName
        });
        
        this.chatContext = await this.model.resetChat();
        console.log('🧠 مدل هوش مصنوعی آماده است!');
    }
    
    async processMessage(userMessage) {
        // ذخیره پیام کاربر
        this.addMessage('user', userMessage);
        
        // مرحله 1: جستجو در FAQ
        const faqResult = this.searchFAQ(userMessage);
        
        if (faqResult && faqResult.score > 0.7) {
            // مرحله 2: پاسخ از FAQ
            this.addMessage('bot', faqResult.answer);
            return;
        }
        
        // مرحله 3: پاسخ از مدل هوش مصنوعی
        await this.generateAIResponse(userMessage);
    }
    
    searchFAQ(query) {
        if (this.faqData.length === 0) return null;
        
        let bestMatch = null;
        let highestScore = 0;
        
        for (const faq of this.faqData) {
            const score = calculateSimilarity(query, faq.question);
            
            if (score > highestScore) {
                highestScore = score;
                bestMatch = {
                    question: faq.question,
                    answer: faq.answer,
                    score: score
                };
            }
        }
        
        console.log(`🔍 بهترین تطابق FAQ: ${highestScore.toFixed(2)}`);
        return bestMatch;
    }
    
    async generateAIResponse(userMessage) {
        // نمایش وضعیت "در حال تایپ"
        this.showTypingIndicator();
        
        try {
            // آماده‌سازی تاریخچه گفتگو برای مدل
            const prompt = this.preparePrompt(userMessage);
            
            // تولید پاسخ با مدل
            const response = await this.model.generate(prompt, this.chatContext);
            
            // پاک کردن وضعیت "در حال تایپ"
            this.hideTypingIndicator();
            
            // مرحله 4: بهبود پاسخ با لحن مناسب
            const improvedResponse = this.improveResponseTone(response);
            
            // افزودن پاسخ به چت
            this.addMessage('bot', improvedResponse);
            
            // به‌روزرسانی کانتکست
            this.chatContext = await this.model.resetChat();
            
        } catch (error) {
            console.error('خطا در تولید پاسخ:', error);
            this.hideTypingIndicator();
            
            // پاسخ پیش‌فرض در صورت خطا
            const fallbackResponse = "متأسفانه در پردازش سوال شما مشکلی پیش آمده. لطفاً سوال خود را به شکل دیگری بیان کنید یا از بخش FAQ استفاده نمایید.";
            this.addMessage('bot', fallbackResponse);
        }
    }
    
    preparePrompt(userMessage) {
        // ساخت پرامپت با تاریخچه گفتگو
        let prompt = "شما یک دستیار هوشمند فارسی‌زبان هستید. با لحن مودب، صمیمی و خودمانی پاسخ دهید.\n\n";
        
        // افزودن تاریخچه گفتگو
        if (this.chatHistory.length > 0) {
            prompt += "تاریخچه گفتگو:\n";
            this.chatHistory.slice(-5).forEach(msg => {
                const role = msg.sender === 'user' ? 'کاربر' : 'دستیار';
                prompt += `${role}: ${msg.text}\n`;
            });
        }
        
        prompt += `\nکاربر: ${userMessage}\nدستیار:`;
        return prompt;
    }
    
    improveResponseTone(response) {
        // بهبود لحن پاسخ برای طبیعی‌تر شدن
        let improved = response
            .replace(/\[.*?\]/g, '') // حذف براکت‌ها
            .trim();
        
        // اطمینان از پایان مناسب جمله
        if (!improved.endsWith('.') && !improved.endsWith('!') && !improved.endsWith('؟')) {
            improved += '.';
        }
        
        // افزودن عبارت‌های صمیمی در صورت لزوم
        const friendlyPrefixes = [
            "خب، ",
            "در واقع، ",
            "ببینید، ",
            "جالب است بدانید که "
        ];
        
        if (Math.random() > 0.7) {
            const prefix = friendlyPrefixes[Math.floor(Math.random() * friendlyPrefixes.length)];
            improved = prefix + improved;
        }
        
        return improved;
    }
    
    addMessage(sender, text) {
        const message = {
            id: Date.now(),
            sender: sender,
            text: text,
            timestamp: new Date().toLocaleTimeString('fa-IR')
        };
        
        this.chatHistory.push(message);
        this.saveChatHistory();
        this.renderMessage(message);
    }
    
    renderMessage(message) {
        const messagesContainer = document.getElementById('chat-messages');
        if (!messagesContainer) return;
        
        const messageElement = document.createElement('div');
        messageElement.className = `message ${message.sender}`;
        messageElement.innerHTML = `
            <div class="avatar">
                <i class="fas fa-${message.sender === 'user' ? 'user' : 'robot'}"></i>
            </div>
            <div class="content">
                <div class="text">${message.text}</div>
                <div class="timestamp">${message.timestamp}</div>
            </div>
        `;
        
        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    loadChatHistory() {
        try {
            const saved = localStorage.getItem('chatbot-history');
            if (saved) {
                this.chatHistory = JSON.parse(saved);
                console.log(`📜 ${this.chatHistory.length} پیام از تاریخچه بارگذاری شد`);
            }
        } catch (error) {
            console.error('خطا در بارگذاری تاریخچه:', error);
            this.chatHistory = [];
        }
    }
    
    saveChatHistory() {
        try {
            // ذخیره فقط 50 پیام آخر
            const toSave = this.chatHistory.slice(-50);
            localStorage.setItem('chatbot-history', JSON.stringify(toSave));
        } catch (error) {
            console.error('خطا در ذخیره تاریخچه:', error);
        }
    }
    
    clearChatHistory() {
        this.chatHistory = [];
        localStorage.removeItem('chatbot-history');
        
        const messagesContainer = document.getElementById('chat-messages');
        if (messagesContainer) {
            messagesContainer.innerHTML = '';
        }
        
        this.addMessage('bot', 'سلام! گفتگو جدیدی شروع شد. چطور می‌توانم کمک‌تان کنم؟');
    }
    
    setupTheme() {
        const savedTheme = localStorage.getItem('chatbot-theme') || 'light';
        this.currentTheme = savedTheme;
        this.applyTheme(savedTheme);
    }
    
    applyTheme(theme) {
        document.body.setAttribute('data-theme', theme);
        localStorage.setItem('chatbot-theme', theme);
        this.currentTheme = theme;
    }
    
    toggleTheme() {
        const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
        this.applyTheme(newTheme);
    }
    
    showTypingIndicator() {
        const messagesContainer = document.getElementById('chat-messages');
        if (!messagesContainer) return;
        
        const typingElement = document.createElement('div');
        typingElement.className = 'message bot typing';
        typingElement.id = 'typing-indicator';
        typingElement.innerHTML = `
            <div class="avatar">
                <i class="fas fa-robot"></i>
            </div>
            <div class="content">
                <div class="typing-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        `;
        
        messagesContainer.appendChild(typingElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    hideTypingIndicator() {
        const typingElement = document.getElementById('typing-indicator');
        if (typingElement) {
            typingElement.remove();
        }
    }
    
    showModelLoading() {
        // ایجاد overlay برای نمایش وضعیت بارگذاری مدل
        const overlay = document.createElement('div');
        overlay.id = 'model-loading-overlay';
        overlay.innerHTML = `
            <div class="model-loading">
                <div class="spinner"></div>
                <h3>در حال بارگذاری مدل هوش مصنوعی...</h3>
                <p id="model-progress-text">آماده‌سازی محیط اجرا</p>
                <div class="progress-bar">
                    <div class="progress" id="model-progress-bar"></div>
                </div>
                <p class="note">این عملیات فقط بار اول انجام می‌شود و ممکن است چند دقیقه طول بکشد.</p>
            </div>
        `;
        document.body.appendChild(overlay);
    }
    
    updateModelLoading(progress, text) {
        const progressBar = document.getElementById('model-progress-bar');
        const progressText = document.getElementById('model-progress-text');
        
        if (progressBar) {
            progressBar.style.width = `${progress}%`;
        }
        
        if (progressText && text) {
            progressText.textContent = text;
        }
    }
    
    hideModelLoading() {
        const overlay = document.getElementById('model-loading-overlay');
        if (overlay) {
            overlay.remove();
        }
    }
    
    showNotification(message, type = 'info') {
        // ایجاد نا��یفیکیشن موقت
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle'}"></i>
            <span>${message}</span>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 5000);
    }
}

// تابع‌های کمکی
function setupEventListeners(chatbot) {
    // دکمه ارسال پیام
    const sendBtn = document.getElementById('send-btn');
    const chatInput = document.getElementById('chat-input');
    
    if (sendBtn && chatInput) {
        sendBtn.addEventListener('click', () => {
            const message = chatInput.value.trim();
            if (message) {
                chatbot.processMessage(message);
                chatInput.value = '';
                chatInput.focus();
            }
        });
        
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendBtn.click();
            }
        });
    }
    
    // دکمه تغییر تم
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => chatbot.toggleTheme());
    }
    
    // دکمه پاک کردن چت
    const clearChatBtn = document.getElementById('clear-chat');
    if (clearChatBtn) {
        clearChatBtn.addEventListener('click', () => {
            if (confirm('آیا مطمئن هستید که می‌خواهید تمام تاریخچه گفتگو پاک شود؟')) {
                chatbot.clearChatHistory();
            }
        });
    }
    
    // دکمه باز/بسته کردن چت
    const toggleBtn = document.querySelector('.chatbot-toggle-btn');
    const chatWindow = document.querySelector('.chatbot-window');
    
    if (toggleBtn && chatWindow) {
        toggleBtn.addEventListener('click', () => {
            chatWindow.classList.toggle('hidden');
            toggleBtn.classList.toggle('active');
        });
    }
    
    // دکمه FAQ
    const faqToggle = document.getElementById('faq-toggle');
    if (faqToggle) {
        faqToggle.addEventListener('click', () => {
            chatbot.showFAQList();
        });
    }
}

// بارگذاری و اجرای چت‌بات
document.addEventListener('DOMContentLoaded', async () => {
    // ایجاد نمونه چت‌بات
    window.chatbot = new ChatbotAI();
    
    // تنظیم event listeners
    setupEventListeners(window.chatbot);
    
    // نمایش وضعیت بارگذاری
    const loadingStatus = document.createElement('div');
    loadingStatus.id = 'loading-status';
    loadingStatus.innerHTML = '<p>در حال آماده‌سازی چت‌بات...</p>';
    document.body.appendChild(loadingStatus);
    
    // بررسی پیشرفت بارگذاری
    const checkInitialization = setInterval(() => {
        if (window.chatbot.isInitialized) {
            clearInterval(checkInitialization);
            loadingStatus.innerHTML = '<p class="success">✅ چت‌بات آماده است!</p>';
            setTimeout(() => loadingStatus.remove(), 2000);
        }
    }, 100);
});
