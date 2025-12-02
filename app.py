from flask import Flask, render_template, send_from_directory, jsonify, request
from flask_cors import CORS
import json
import os
import re
from chatbot_ai import ChatbotAI

app = Flask(__name__, static_folder='static', template_folder='templates')
CORS(app)  # اضافه کردن CORS برای اجازه دسترسی از همه دامنه‌ها

chatbot_ai = ChatbotAI()

# لود آموزش‌ها
try:
    with open('static/faq.json', 'r', encoding='utf-8') as f:
        chatbot_ai.load_faq(json.load(f))
    print("✅ FAQ loaded successfully")
except Exception as e:
    print(f"❌ Error loading FAQ: {e}")

# لود متن آموزشی
training_text = """
فروشگاه لباس، کفش، کیف و اکسسوری
سوالات کاربران: پیگیری سفارش، تأخیر، وضعیت بسته‌ها، سایز و اندازه، جنس و کیفیت محصول، بازگشت وجه، قیمت، زمان ارسال
تأخیر در ارسال: به دلیل حجم بالای سفارشات و تولیدی بودن مجموعه، برخی سفارشات زمان‌بر می‌شوند. تمام سفارشات ۱۰۰٪ به دست مشتری می‌رسند
انتخاب سایز: برای انتخاب سایز مناسب از جدول سایز در صفحه محصول استفاده کنید. در صورت نیاز به راهنمایی با پشتیبانی تماس بگیرید
بازگشت وجه: به دلیل تولید اختصاصی و برنامه‌ریزی سفارشات، بازگشت وجه پس از شروع تولید امکان‌پذیر نیست
کیفیت محصولات: تمام محصولات تولید داخلی با مواد با کیفیت هستند. جزئیات در صفحه محصول موجود است
زمان ارسال: معمولاً ۲ تا ۵ روز کاری. در زمان‌های شلوغ ممکن است کمی بیشتر طول بکشد
"""

chatbot_ai.train_from_text(training_text)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/chat', methods=['POST'])
def chat():
    try:
        data = request.get_json()
        if not data:
            return jsonify({
                "reply": "لطفاً پیام خود را وارد کنید.",
                "confidence": 0,
                "source": "empty"
            })
        
        user_message = data.get('message', '').strip()
        
        if not user_message:
            return jsonify({
                "reply": "لطفاً پیام خود را وارد کنید.",
                "confidence": 0,
                "source": "empty"
            })
        
        # پردازش با AI
        response = chatbot_ai.process_message(user_message)
        
        # بررسی درخواست اپراتور انسانی
        if chatbot_ai.check_human_request(user_message):
            response["reply"] = "برای ارتباط با اپراتور انسانی، لطفاً به آی‌دی اینستاگرام ما پیام دهید: @apmshow_"
            response["confidence"] = 1.0
            response["source"] = "instagram"
        
        print(f"🤖 User: {user_message} -> Bot: {response['reply'][:50]}...")
        
        return jsonify(response)
        
    except Exception as e:
        print(f"❌ Error in chat API: {str(e)}")
        return jsonify({
            "reply": "متأسفانه در پردازش سوال شما مشکلی پیش آمد. لطفاً دوباره تلاش کنید.",
            "confidence": 0,
            "source": "error"
        })

@app.route('/api/faq')
def get_faq():
    try:
        with open('static/faq.json', 'r', encoding='utf-8') as f:
            faq_data = json.load(f)
        return jsonify(faq_data)
    except Exception as e:
        print(f"Error loading FAQ: {e}")
        return jsonify([])

@app.route('/api/update-faq', methods=['POST'])
def update_faq():
    try:
        data = request.get_json()
        with open('static/faq.json', 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return jsonify({"status": "success", "message": "FAQ updated successfully"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/health')
def health_check():
    return jsonify({"status": "healthy", "service": "APM Chatbot API"})

@app.route('/<path:filename>')
def static_files(filename):
    return send_from_directory('static', filename)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))  # Railway از پورت 8080 استفاده می‌کنه
    app.run(host='0.0.0.0', port=port, debug=False)
