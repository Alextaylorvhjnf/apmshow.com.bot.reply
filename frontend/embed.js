<!-- در فوتر سایت قرار دهید -->
<script>
    // تنظیمات چت بات
    window.CHATBOT_SERVER_URL = 'https://web-production-4063.up.railway.app';
    window.CHATBOT_WIDGET_URL = 'https://web-production-4063.up.railway.app/widget';
    window.CHATBOT_POSITION = 'bottom-left';
    window.CHATBOT_THEME = 'default';
    window.CHATBOT_AUTO_INIT = true;
    window.CHATBOT_LANGUAGE = 'fa';
</script>
<script src="https://web-production-4063.up.railway.app/widget/embed.js" async></script>

<!-- برای دیباگ -->
<script>
    // رویدادهای دیباگ
    document.addEventListener('DOMContentLoaded', function() {
        console.log('🔧 شروع لود چت بات...');
    });
    
    document.addEventListener('chatbot:loaded', function(event) {
        console.log('✅ چت بات با موفقیت لود شد!', event.detail);
        // می‌توانید چت را باز کنید
        if (window.ChatbotWidget) {
            window.ChatbotWidget.open();
        }
    });
    
    // هندل خطاها
    window.addEventListener('error', function(event) {
        if (event.message && event.message.includes('chatbot')) {
            console.error('❌ خطای چت بات:', event.error);
        }
    });
    
    // هندل خطاهای لود resource
    window.addEventListener('unhandledrejection', function(event) {
        console.error('❌ خطای Promise:', event.reason);
    });
</script>
