FROM node:18-alpine

WORKDIR /app

# کپی package.json و نصب dependencies
COPY package*.json ./
RUN npm ci --only=production

# کپی فایل‌های اپلیکیشن
COPY . .

# پورت اکسپوز
EXPOSE 3000

# اجرای اپلیکیشن
CMD ["node", "server.js"]
