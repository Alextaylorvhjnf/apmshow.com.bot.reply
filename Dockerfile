FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000
EXPOSE 3001

# Start both servers
CMD ["sh", "-c", "node server.js & node telegram-bot.js && wait"]
