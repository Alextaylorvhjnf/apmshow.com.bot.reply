#!/bin/bash

# Chatbot Deployment Script
# Usage: ./deploy.sh [production|staging]

set -e

ENVIRONMENT=${1:-production}
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="backups/$TIMESTAMP"

echo "🚀 Starting deployment for $ENVIRONMENT environment..."

# Check required tools
command -v docker >/dev/null 2>&1 || { echo "Docker is required but not installed."; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js is required but not installed."; exit 1; }

# Load environment variables
if [ -f ".env.$ENVIRONMENT" ]; then
    echo "📝 Loading $ENVIRONMENT environment variables..."
    source ".env.$ENVIRONMENT"
elif [ -f ".env" ]; then
    echo "📝 Loading default environment variables..."
    source ".env"
else
    echo "❌ No .env file found!"
    exit 1
fi

# Validate required variables
required_vars=("GROQ_API_KEY" "TELEGRAM_BOT_TOKEN" "ADMIN_TELEGRAM_ID")
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        echo "❌ Required variable $var is not set!"
        exit 1
    fi
done

echo "✅ Environment variables validated"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Backup existing data
echo "💾 Creating backup..."
if [ -d "data" ]; then
    cp -r data "$BACKUP_DIR/"
    echo "✅ Backup created in $BACKUP_DIR"
fi

# Install backend dependencies
echo "📦 Installing backend dependencies..."
cd backend
npm ci --only=production
cd ..

# Build Docker image
echo "🐳 Building Docker image..."
docker build -t chatbot:$ENVIRONMENT-$TIMESTAMP .

# Stop and remove existing container
echo "🔄 Stopping existing container..."
docker stop chatbot-$ENVIRONMENT 2>/dev/null || true
docker rm chatbot-$ENVIRONMENT 2>/dev/null || true

# Run new container
echo "🚀 Starting new container..."
docker run -d \
    --name chatbot-$ENVIRONMENT \
    --restart unless-stopped \
    -p 3000:3000 \
    -e NODE_ENV=$ENVIRONMENT \
    -e PORT=3000 \
    -e GROQ_API_KEY="$GROQ_API_KEY" \
    -e TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN" \
    -e ADMIN_TELEGRAM_ID="$ADMIN_TELEGRAM_ID" \
    -e BOT_USERNAME="@costumerreplierbot" \
    -v chatbot-data-$ENVIRONMENT:/app/data \
    chatbot:$ENVIRONMENT-$TIMESTAMP

echo "⏳ Waiting for application to start..."
sleep 10

# Health check
echo "🏥 Performing health check..."
HEALTH_CHECK_MAX_ATTEMPTS=30
HEALTH_CHECK_INTERVAL=5

for i in $(seq 1 $HEALTH_CHECK_MAX_ATTEMPTS); do
    if curl -s http://localhost:3000/health > /dev/null; then
        echo "✅ Application is healthy!"
        break
    fi
    
    if [ $i -eq $HEALTH_CHECK_MAX_ATTEMPTS ]; then
        echo "❌ Health check failed after $HEALTH_CHECK_MAX_ATTEMPTS attempts"
        echo "📋 Container logs:"
        docker logs chatbot-$ENVIRONMENT
        exit 1
    fi
    
    echo "⏳ Health check attempt $i/$HEALTH_CHECK_MAX_ATTEMPTS failed, retrying..."
    sleep $HEALTH_CHECK_INTERVAL
done

# Cleanup old images
echo "🧹 Cleaning up old Docker images..."
docker images | grep chatbot | grep -v "$ENVIRONMENT-$TIMESTAMP" | awk '{print $3}' | xargs docker rmi 2>/dev/null || true

# Show deployment info
echo "📊 Deployment completed successfully!"
echo "====================================="
echo "Environment: $ENVIRONMENT"
echo "Container: chatbot-$ENVIRONMENT"
echo "Image: chatbot:$ENVIRONMENT-$TIMESTAMP"
echo "Port: 3000"
echo "Health check: http://localhost:3000/health"
echo "Backup: $BACKUP_DIR"
echo "====================================="
echo "📝 To view logs: docker logs -f chatbot-$ENVIRONMENT"
echo "🚪 To stop: docker stop chatbot-$ENVIRONMENT"
echo "▶️  To start: docker start chatbot-$ENVIRONMENT"
echo "🗑️  To remove: docker rm -f chatbot-$ENVIRONMENT"

# Send deployment notification
if [ -n "$DEPLOYMENT_WEBHOOK_URL" ]; then
    echo "📨 Sending deployment notification..."
    curl -s -X POST "$DEPLOYMENT_WEBHOOK_URL" \
        -H "Content-Type: application/json" \
        -d "{\"text\": \"✅ Chatbot deployed to $ENVIRONMENT\\nTimestamp: $TIMESTAMP\\nHealth: http://localhost:3000/health\"}" \
        > /dev/null
fi

exit 0
