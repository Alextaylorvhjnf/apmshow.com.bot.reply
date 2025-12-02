import re
import json
from typing import List, Dict, Tuple
import math

class ChatbotAI:
    def __init__(self):
        self.faq_data = []
        self.training_data = []
        self.keyword_patterns = {
            # سایز و اندازه
            'size': ['سایز', 'اندازه', 'بزرگ', 'کوچک', 'م', 'ال', 'ایکس ال', 'xs', 's', 'm', 'l', 'xl', 'xxl'],
            'delivery': ['زمان ارسال', 'زمان تحویل', 'کی میرسه', 'چند روزه', 'ارسال', 'تحویل', 'پست', 'پیک'],
            'tracking': ['پیگیری', 'رهگیری', 'کد رهگیری', 'وضعیت سفارش', 'سفارشم کجاست'],
            'quality': ['کیفیت', 'جنس', 'مرغوب', 'متریال', 'پارچه', 'چرم', 'نخ', 'دوخت'],
            'return': ['مرجوع', 'بازگشت', 'عودت', 'برگشت وجه', 'پول', 'تضمین'],
            'price': ['قیمت', 'هزینه', 'ارزان', 'گران', 'تخفیف', 'حراج'],
            'human': ['انسان', 'اپراتور', 'واقعی', 'زنده', 'پشتیبان', 'مشاور', 'صحبت با انسان'],
            'insult': ['احمق', 'خر', 'بی شعور', 'کثافت', 'نادان', 'بی ادب', 'فحش', 'توهین'],
        }
        
        # پاسخ‌های پیش‌فرض
        self.default_responses = [
            "ممنون از سوال شما. لطفاً کمی بیشتر توضیح دهید تا بهتر بتوانم کمک کنم.",
            "سوال خوبی پرسیدید! برای پاسخ دقیق‌تر، می‌توانید با پشتیبانی تماس بگیرید.",
            "متوجه سوال شما شدم. در حال حاضر اطلاعات کامل برای پاسخ ندارم.",
            "سوال شما ثبت شد. تیم پشتیبانی به زودی با شما تماس خواهند گرفت."
        ]
    
    def load_faq(self, faq_data: List[Dict]):
        """بارگذاری FAQ"""
        self.faq_data = faq_data
        print(f"✅ {len(faq_data)} سوال FAQ بارگذاری شد")
    
    def train_from_text(self, text: str):
        """آموزش از متن آموزشی"""
        lines = text.split('\n')
        for line in lines:
            line = line.strip()
            if line and ':' in line:
                parts = line.split(':', 1)
                if len(parts) == 2:
                    keyword = parts[0].strip()
                    response = parts[1].strip()
                    self.training_data.append({
                        'keyword': keyword,
                        'response': response
                    })
        print(f"✅ {len(self.training_data)} خط آموزشی پردازش شد")
    
    def calculate_similarity(self, text1: str, text2: str) -> float:
        """محاسبه شباهت بین دو متن"""
        if not text1 or not text2:
            return 0.0
        
        # نرمال‌سازی متن
        text1 = self.normalize_text(text1)
        text2 = self.normalize_text(text2)
        
        if text1 == text2:
            return 1.0
        
        # تقسیم به کلمات
        words1 = set(text1.split())
        words2 = set(text2.split())
        
        if not words1 or not words2:
            return 0.0
        
        # اشتراک و اجتماع
        intersection = words1.intersection(words2)
        union = words1.union(words2)
        
        similarity = len(intersection) / len(union)
        
        # افزایش امتیاز برای کلمات کلیدی مشترک
        keyword_score = 0
        for word in intersection:
            for category, keywords in self.keyword_patterns.items():
                if word in keywords:
                    keyword_score += 0.1
        
        return min(1.0, similarity + keyword_score * 0.3)
    
    def normalize_text(self, text: str) -> str:
        """نرمال‌سازی متن فارسی"""
        if not text:
            return ""
        
        # حذف علائم نگارشی
        text = re.sub(r'[،؛:.,!?;]', ' ', text)
        
        # حذف فاصله‌های اضافی
        text = re.sub(r'\s+', ' ', text)
        
        # تبدیل به حروف کوچک فارسی
        text = text.lower()
        
        # حذف کاراکترهای غیرضروری
        text = re.sub(r'[^آ-ی۰-9\s]', '', text)
        
        return text.strip()
    
    def find_faq_answer(self, question: str) -> Tuple[str, float]:
        """یافتن پاسخ در FAQ با شباهت معنایی"""
        question_norm = self.normalize_text(question)
        
        best_match = None
        highest_similarity = 0.0
        
        for faq in self.faq_data:
            faq_question = self.normalize_text(faq.get('question', ''))
            similarity = self.calculate_similarity(question_norm, faq_question)
            
            if similarity > highest_similarity:
                highest_similarity = similarity
                best_match = faq
        
        if best_match and highest_similarity >= 0.3:  # آستانه پایین‌تر برای انعطاف بیشتر
            return best_match['answer'], highest_similarity
        
        return None, 0.0
    
    def check_keywords(self, text: str) -> Dict:
        """بررسی کلمات کلیدی در متن"""
        text_norm = self.normalize_text(text)
        words = text_norm.split()
        
        matches = {}
        for category, keywords in self.keyword_patterns.items():
            for keyword in keywords:
                if keyword in text_norm:
                    if category not in matches:
                        matches[category] = []
                    matches[category].append(keyword)
        
        return matches
    
    def check_human_request(self, text: str) -> bool:
        """بررسی درخواست اپراتور انسانی"""
        text_lower = text.lower()
        human_keywords = ['انسان', 'اپراتور', 'واقعی', 'زنده', 'پشتیبان انسانی', 
                         'مشاور انسانی', 'صحبت با انسان', 'آدم واقعی']
        
        for keyword in human_keywords:
            if keyword in text_lower:
                return True
        
        matches = self.check_keywords(text)
        return 'human' in matches
    
    def check_insult(self, text: str) -> bool:
        """بررسی وجود فحش و توهین"""
        matches = self.check_keywords(text)
        return 'insult' in matches
    
    def generate_response_based_on_context(self, text: str, matches: Dict) -> str:
        """تولید پاسخ بر اساس زمینه"""
        text_lower = text.lower()
        
        # فحش و توهین
        if self.check_insult(text):
            return "لطفاً از استفاده از الفاظ توهین‌آمیز خودداری کنید. این نوع رفتار مناسب نیست و ما برای ارائه خدمات حرفه‌ای و محترمانه اینجا هستیم. اگر سوال یا مشکل خاصی دارید، خوشحال می‌شویم به شما کمک کنیم."
        
        # درخواست اپراتور انسانی
        if self.check_human_request(text):
            return "برای ارتباط با اپراتور انسانی، لطفاً به آی‌دی اینستاگرام ما پیام دهید: @apmshow_"
        
        # پاسخ بر اساس کلمات کلیدی
        if 'size' in matches:
            return "برای انتخاب سایز مناسب، می‌توانید از جدول سایز در صفحه محصول استفاده کنید. اگر بین دو سایز مردد هستید، قد، وزن و فرم بدن خود را برای ما بفرستید تا بهترین سایز را پیشنهاد کنیم."
        
        if 'delivery' in matches or 'tracking' in matches:
            return "سفارش‌ها با توجه به برنامه تولید و حجم درخواست‌ها در صف ارسال هستند. تمام بسته‌ها 100% به دست مشتری می‌رسند. پس از ارسال، کد رهگیری برای شما فعال می‌شود."
        
        if 'return' in matches:
            return "به علت تولید اختصاصی و برنامه‌ریزی سفارش‌ها، بازگشت وجه ممکن نیست. این رویه برای حفظ کیفیت و برنامه ارسال ضروری است. لطفاً قبل از خرید، سایز و مشخصات را به دقت بررسی کنید."
        
        if 'quality' in matches:
            return "تمام محصولات تولید داخلی هستند و از مواد با کیفیت تهیه شده‌اند. جزئیات جنس و ویژگی‌های هر محصول در صفحه محصول موجود است."
        
        if 'price' in matches:
            return "قیمت محصولات بر اساس متریال، هزینه تولید و کیفیت نهایی تعیین می‌شود. تمام قیمت‌ها واقعی و منطقی هستند."
        
        # اگر کلمه "چطور" یا "چگونه" وجود دارد
        if 'چطور' in text_lower or 'چگونه' in text_lower:
            return "برای راهنمایی دقیق‌تر، لطفاً سوال خود را به صورت مشخص‌تر مطرح کنید. مثلاً: 'چطور سایز مناسب را انتخاب کنم؟' یا 'چطور می‌توانم سفارشم را پیگیری کنم؟'"
        
        # اگر سوال درباره "آیا" است
        if text_lower.startswith('آیا'):
            return "بله، می‌توانم در این مورد کمک کنم. لطفاً سوال خود را کامل‌تر بیان کنید."
        
        return None
    
    def process_message(self, message: str) -> Dict:
        """پردازش پیام کاربر و تولید پاسخ"""
        # بررسی FAQ
        faq_answer, faq_confidence = self.find_faq_answer(message)
        
        if faq_answer and faq_confidence >= 0.3:
            return {
                "reply": faq_answer,
                "confidence": faq_confidence,
                "source": "faq"
            }
        
        # بررسی کلمات کلیدی
        keyword_matches = self.check_keywords(message)
        
        # تولید پاسخ بر اساس زمینه
        context_response = self.generate_response_based_on_context(message, keyword_matches)
        
        if context_response:
            return {
                "reply": context_response,
                "confidence": 0.7,
                "source": "context"
            }
        
        # اگر متن نامفهوم است
        if len(self.normalize_text(message)) < 3:
            return {
                "reply": "متوجه نشدم پیام شما چه معنایی دارد. لطفاً پیام خود را واضح و خوانا بنویسید تا بتوانم پاسخ درست به شما بدهم.",
                "confidence": 0.3,
                "source": "unclear"
            }
        
        # پاسخ پیش‌فرض هوشمند
        import random
        default_response = random.choice(self.default_responses)
        
        # اضافه کردن پیشنهاد
        suggestions = [
            "\n\nاگر سوال خاصی درباره سایز، ارسال، کیفیت یا قیمت دارید، بپرسید.",
            "\n\nبرای پیگیری سفارش، شماره سفارش خود را بفرستید.",
            "\n\nمی‌توانید سوالات متداول را در بخش FAQ مشاهده کنید."
        ]
        
        response = default_response + random.choice(suggestions)
        
        return {
            "reply": response,
            "confidence": 0.4,
            "source": "default"
        }
