FROM node:18-alpine

WORKDIR /app

# کپی package.json
COPY package*.json ./

# نصب وابستگی‌ها
RUN npm install

# کپی تمام فایل‌ها
COPY . .

# ساخت پوشه‌های لازم
RUN mkdir -p public logs

# پورت اکسپوز
EXPOSE 3000

# دستور اجرا
CMD ["node", "server.js"]
