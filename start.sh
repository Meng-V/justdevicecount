#!/bin/bash

# JustDeviceCount - Production Deployment Script
# Manages PM2 process for the application with PostgreSQL database

APP_NAME="justdevicecount"
ECOSYSTEM_FILE="ecosystem.config.js"

function check_pm2() {
  if ! command -v pm2 &> /dev/null; then
    echo "PM2 is not installed. Installing PM2..."
    npm install -g pm2
  fi
}

function start() {
  echo "Starting $APP_NAME with PM2..."
  check_pm2
  
  # Check if .env file exists
  if [ ! -f ".env" ]; then
    echo "⚠️  Warning: .env file not found!"
    echo "   Create .env file with DATABASE_URL before starting."
    echo "   See DEVELOPER_GUIDE.md for setup instructions."
    exit 1
  fi
  
  # Check if database schema is initialized
  echo "Checking database setup..."
  npx prisma generate > /dev/null 2>&1
  
  # Stop any existing instances
  pm2 stop $APP_NAME 2>/dev/null || true
  pm2 delete $APP_NAME 2>/dev/null || true
  
  # Start using ecosystem file
  pm2 start $ECOSYSTEM_FILE
  
  # Save PM2 configuration
  pm2 save
  
  echo "✅ $APP_NAME started successfully"
  echo "📊 Access dashboard at: https://your-server:3012/crowdindex/"
  echo "📋 View logs: pm2 logs $APP_NAME"
  echo "📈 Monitor: pm2 monit"
}

function stop() {
  echo "Stopping $APP_NAME..."
  pm2 stop $APP_NAME
  echo "$APP_NAME stopped"
}

function restart() {
  echo "Restarting $APP_NAME..."
  pm2 restart $APP_NAME
  echo "$APP_NAME restarted"
}

function status() {
  echo "Status of $APP_NAME:"
  pm2 status $APP_NAME
}

function logs() {
  echo "Showing logs for $APP_NAME:"
  pm2 logs $APP_NAME --lines 50
}

function delete_app() {
  echo "Deleting $APP_NAME from PM2..."
  pm2 stop $APP_NAME 2>/dev/null || true
  pm2 delete $APP_NAME 2>/dev/null || true
  pm2 save
  echo "$APP_NAME deleted from PM2"
}

# Main command handling
case "$1" in
  "start")
    start
    ;;
  "stop")
    stop
    ;;
  "restart")
    restart
    ;;
  "status")
    status
    ;;
  "logs")
    logs
    ;;
  "delete")
    delete_app
    ;;
  *)
    echo "JustDeviceCount Deployment Script"
    echo ""
    echo "Usage: $0 {start|stop|restart|status|logs|delete}"
    echo ""
    echo "Commands:"
    echo "  start   - Start the application with PM2 (checks .env and database)"
    echo "  stop    - Stop the application"
    echo "  restart - Restart the application"
    echo "  status  - Show application status"
    echo "  logs    - Show application logs (last 50 lines)"
    echo "  delete  - Remove application from PM2"
    echo ""
    echo "Prerequisites:"
    echo "  - .env file with DATABASE_URL configured"
    echo "  - PostgreSQL database initialized (run: npm run db:push)"
    echo "  - SSL certificates in security/ directory"
    echo ""
    echo "See DEVELOPER_GUIDE.md for complete setup instructions."
    echo ""
    echo "Default action: start"
    start
    ;;
esac
