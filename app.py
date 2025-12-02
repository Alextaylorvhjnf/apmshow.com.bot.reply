from flask import Flask, render_template, send_from_directory, jsonify, request
import json
import os

app = Flask(__name__, static_folder='static', template_folder='templates')

# روت اصلی
@app.route('/')
def index():
    return render_template('index.html')

# API برای دریافت FAQ
@app.route('/api/faq')
def get_faq():
    try:
        with open('static/faq.json', 'r', encoding='utf-8') as f:
            faq_data = json.load(f)
        return jsonify(faq_data)
    except:
        # FAQ پیش‌فرض
        default_faq = [
            {
                "question": "چطور سایز مناسب را انتخاب کنم؟",
                "answer": "برای تمام محصولات، جدول سایز دقیق درج شده است. اگر بین دو سایز مردد هستید، با پشتیبانی قد، وزن و فرم بدن خود را بفرستید تا بهترین سایز را اصولی پیشنهاد کنیم."
            }
        ]
        return jsonify(default_faq)

# API برای به‌روزرسانی FAQ
@app.route('/api/update-faq', methods=['POST'])
def update_faq():
    try:
        data = request.json
        with open('static/faq.json', 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return jsonify({"status": "success", "message": "FAQ updated successfully"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# سرو فایل‌های استاتیک
@app.route('/<path:filename>')
def static_files(filename):
    return send_from_directory('static', filename)

# API برای چت (در صورت نیاز به backend)
@app.route('/api/chat', methods=['POST'])
def chat():
    data = request.json
    user_message = data.get('message', '')
    
    # در اینجا می‌توانید منطق چت را اضافه کنید
    # فعلاً یک پاسخ ساده برمی‌گرداند
    response = {
        "reply": f"پیام شما دریافت شد: '{user_message}'. من یک چت‌بات هستم که به زودی هوشمندتر می‌شوم!",
        "timestamp": "اکنون"
    }
    
    return jsonify(response)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
