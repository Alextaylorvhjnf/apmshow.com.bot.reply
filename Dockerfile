FROM node:18-alpine

WORKDIR /app

# نصب وابستگی‌های سیستم
RUN apk add --no-cache bash

# کپی package.json اول برای نصب وابستگی‌ها
COPY backend/package*.json ./backend/
COPY telegram/package*.json ./telegram/

# نصب وابستگی‌ها در ریشه
RUN npm init -y && \
    cd backend && npm install && \
    cd ../telegram && npm install

# کپی تمام فایل‌ها
COPY . .

# ساخت پوشه برای لاگ
RUN mkdir -p logs

# پورت اکسپوز
EXPOSE 3000

# دستور اجرا
CMD ["sh", "-c", "cd backend && node server.js & cd ../telegram && node bot.js && wait"]
