#!/bin/bash

# Modern PM2 deployment script for justdevicecount
# Uses ecosystem.config.js for advanced configuration

APP_NAME="justdevicecount"
ECOSYSTEM_FILE="ecosystem.config.js"

function check_pm2() {
  if ! command -v pm2 &> /dev/null; then
    echo "PM2 is not installed. Installing PM2..."
    npm install -g pm2
  fi
}

function start() {
  echo "Starting $APP_NAME with PM2 ecosystem file..."
  check_pm2
  
  # Stop any existing instances
  pm2 stop $APP_NAME 2>/dev/null || true
  pm2 delete $APP_NAME 2>/dev/null || true
  
  # Start using ecosystem file
  pm2 start $ECOSYSTEM_FILE
  
  # Save PM2 configuration
  pm2 save
  
  echo "$APP_NAME started successfully on port 3012"
  echo "Use 'pm2 logs $APP_NAME' to view logs"
  echo "Use 'pm2 monit' to monitor the application"
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
    echo "Usage: $0 {start|stop|restart|status|logs|delete}"
    echo ""
    echo "Commands:"
    echo "  start   - Start the application with PM2"
    echo "  stop    - Stop the application"
    echo "  restart - Restart the application"
    echo "  status  - Show application status"
    echo "  logs    - Show application logs"
    echo "  delete  - Remove application from PM2"
    echo ""
    echo "Default action: start"
    start
    ;;
esac
