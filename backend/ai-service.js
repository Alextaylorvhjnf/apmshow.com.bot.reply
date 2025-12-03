const axios = require('axios');
const winston = require('winston');

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/ai-service-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/ai-service-combined.log' })
  ]
});

class AIService {
  constructor() {
    this.apiKey = process.env.GROQ_API_KEY;
    this.model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    this.baseURL = 'https://api.groq.com/openai/v1';
    
    this.axiosInstance = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000 // 30 seconds timeout
    });
    
    // System prompt for AI
    this.systemPrompt = `شما یک دستیار هوشمند فارسی هستید که به سوالات کاربران پاسخ می‌دهید.
قوانین:
1. فقط به زبان فارسی پاسخ دهید
2. پاسخ‌ها باید مفید، دقیق و دوستانه باشند
3. اگر اطلاعات کافی برای پاسخ ندارید، صادقانه بگویید
4. در زمینه‌های زیر تخصص دارید:
   - پشتیبانی محصولات
   - پاسخ به سوالات عمومی
   - راهنمایی کاربران
   - حل مشکلات اولیه

اگر سوال خارج از حوزه دانش شماست یا اطلاعات کافی ندارید، بگویید: "برای پاسخ به این سوال نیاز به اتصال به اپراتور انسانی دارم"`;
  }

  async getAIResponse(userMessage, context = []) {
    try {
      const messages = [
        { role: 'system', content: this.systemPrompt },
        ...context.slice(-10), // Last 10 messages for context
        { role: 'user', content: userMessage }
      ];

      const response = await this.axiosInstance.post('/chat/completions', {
        model: this.model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 1000,
        stream: false
      });

      if (response.data && response.data.choices && response.data.choices.length > 0) {
        const aiMessage = response.data.choices[0].message.content;
        
        // Check if AI couldn't answer properly
        if (this.shouldConnectToHuman(aiMessage)) {
          return {
            success: false,
            message: aiMessage,
            requiresHuman: true
          };
        }

        logger.info('AI response generated successfully');
        return {
          success: true,
          message: aiMessage,
          requiresHuman: false
        };
      }

      throw new Error('Invalid response from AI API');

    } catch (error) {
      logger.error('AI Service Error:', {
        error: error.message,
        userMessage: userMessage.substring(0, 100)
      });

      // If AI fails, connect to human
      return {
        success: false,
        message: 'خطا در پردازش درخواست. لطفاً با اپراتور انسانی صحبت کنید.',
        requiresHuman: true
      };
    }
  }

  shouldConnectToHuman(aiMessage) {
    const indicators = [
      'اطلاعات کافی',
      'نمیتوانم پاسخ دهم',
      'اپراتور انسانی',
      'متخصص انسانی',
      'نمیدانم',
      'مطمئن نیستم',
      'دانش کافی'
    ];
    
    const lowerMessage = aiMessage.toLowerCase();
    return indicators.some(indicator => lowerMessage.includes(indicator.toLowerCase()));
  }

  // Test API connection
  async testConnection() {
    try {
      const response = await this.axiosInstance.get('/models');
      return {
        success: true,
        models: response.data.data
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = AIService;
