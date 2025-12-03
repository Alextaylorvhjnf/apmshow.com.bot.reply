# Dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package.json files
COPY backend/package.json ./backend/package.json
COPY telegram/package.json ./telegram/package.json

# Install dependencies
RUN cd backend && npm install --production
RUN cd telegram && npm install --production

# Copy source code
COPY . .

# Create a startup script
RUN echo '#!/bin/sh\n\
cd /app/backend\n\
node server.js & \n\
cd /app/telegram\n\
node bot.js \n\
wait' > /app/start.sh && chmod +x /app/start.sh

EXPOSE 3000

CMD ["sh", "/app/start.sh"]
