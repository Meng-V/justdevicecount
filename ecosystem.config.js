// PM2 Ecosystem Configuration for JustDeviceCount
// ⚠️  LOCAL DEVELOPMENT ONLY - NOT FOR SERVER DEPLOYMENT
// 
// For production server deployment, see SERVER_DEPLOYMENT.md
// Server uses systemd service (crowd-index), NOT PM2

module.exports = {
  apps: [{
    name: 'justdevicecount',
    script: './bin/www',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: true,  // Auto-reload on file changes (dev only)
    ignore_watch: [
      'node_modules',
      'logs',
      'test*',
      '*.log',
      '.git',
      '.env'
    ],
    max_memory_restart: '500M',
    min_uptime: '10s',
    max_restarts: 5,
    restart_delay: 4000,
    env: {
      NODE_ENV: 'development',
      PORT: 3012,
      TZ: 'America/New_York',
      NODE_TLS_REJECT_UNAUTHORIZED: '0'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    time: true,
    merge_logs: true,
    kill_timeout: 5000,
    listen_timeout: 3000
  }]
};

// Note: This PM2 config is ONLY for local development
// Production server uses systemd service management
// See SERVER_DEPLOYMENT.md for production deployment instructions
