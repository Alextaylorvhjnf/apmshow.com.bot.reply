from flask import Flask, render_template, send_from_directory, jsonify, request
import json
import os
import re
from chatbot_ai import ChatbotAI

app = Flask(__name__, static_folder='static', template_folder='templates')
chatbot_ai = ChatbotAI()

# لود آموزش‌ها
with open('static/faq.json', 'r', encoding='utf-8') as f:
    chatbot_ai.load_faq(json.load(f))

# لود متن آموزشی
training_text = """
سوال کاربران می‌تواند شامل پیگیری سفارش، تأخیر، وضعیت بسته‌ها، سایز و اندازه، جنس و کیفیت محصول، بازگشت و مرجوعی، قیمت، زمان ارسال، نحوه انتخاب محصول و همچنین رفتار انسانی و محترمانه باشد.

پیگیری سفارش و زمان ارسال:
کاربران ممکن است بپرسند سفارش خود را یک هفته یا یک ماه پیش ثبت کرده‌اند و هنوز دریافت نکرده‌اند. پاسخ مناسب این است که به کاربر اطمینان داده شود که سفارش‌ها با توجه به برنامه تولید و حجم درخواست‌ها در صف ارسال هستند و تمام بسته‌ها 100 درصد به دست مشتری خواهند رسید. همچنین باید توضیح داده شود که بسته‌ها به محض تحویل به پست یا پیک، کد رهگیری برای مشتری فعال خواهد شد و کاربر می‌تواند وضعیت سفارش خود را بررسی کند.

سوالات درباره محصول و سایز:
کاربران ممکن است درباره سایز مناسب لباس یا کفش سوال کنند. هوش مصنوعی باید پاسخ دهد که جدول سایز هر محصول در صفحه محصول موجود است و بر اساس اندازه‌های خود انتخاب کنند. همچنین باید توضیح داده شود که در صورت نیاز به راهنمایی بیشتر، بخش پشتیبانی آماده پاسخگویی است.

بازگشت و مرجوعی:
کاربران ممکن است درخواست بازگشت وجه یا مرجوعی محصول داشته باشند. هوش مصنوعی باید توضیح دهد که به علت تولید اختصاصی و برنامه‌ریزی سفارش‌ها، بازگشت وجه ممکن نیست و این یک رویه منطقی و اقتصادی برای حفظ کیفیت و برنامه ارسال است.

اگر کاربر پیام توهین‌آمیز یا فحاشی ارسال کند، هوش مصنوعی باید پاسخ دهد به شکل مودبانه اما قاطع. نمونه پاسخ: "لطفاً از استفاده از الفاظ توهین‌آمیز خودداری کنید. این نوع رفتار مناسب نیست و ما برای ارائه خدمات حرفه‌ای و محترمانه اینجا هستیم."

سوالات متداول:
آیا امکان تست نمونه قبل از خرید وجود دارد؟ پاسخ: خیر، اما جدول سایز، عکس‌ها و توضیحات کامل محصول در صفحه موجود است تا انتخاب درست انجام شود.

محصولات از کجا تولید می‌شوند؟ پاسخ: همه محصولات تولید داخلی هستند و با مواد اولیه با کیفیت تهیه شده‌اند.

زمان تحویل چقدر است؟ پاسخ: زمان ارسال طبق برنامه تولید و تعداد سفارش‌ها است و بسته‌ها به ترتیب آماده‌سازی و ارسال می‌شوند.
"""

chatbot_ai.train_from_text(training_text)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/chat', methods=['POST'])
def chat():
    try:
        data = request.json
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
        
        return jsonify(response)
        
    except Exception as e:
        print(f"Error in chat API: {str(e)}")
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
    except:
        return jsonify([])

@app.route('/api/update-faq', methods=['POST'])
def update_faq():
    try:
        data = request.json
        with open('static/faq.json', 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/<path:filename>')
def static_files(filename):
    return send_from_directory('static', filename)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
