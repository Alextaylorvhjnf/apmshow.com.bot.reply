# استفاده از image Node.js
FROM node:18-alpine

# تنظیم دایرکتوری کاری
WORKDIR /app

# کپی package.json از backend
COPY backend/package*.json ./

# نصب dependencies
RUN npm install --production

# کپی تمام فایل‌های backend
COPY backend/ .

# کپی فایل‌های frontend و telegram
COPY frontend/ ./frontend/
COPY telegram/ ./telegram/

# پورت را اکسپوز کن
EXPOSE 3000

# کامند شروع
CMD ["node", "server.js"]
