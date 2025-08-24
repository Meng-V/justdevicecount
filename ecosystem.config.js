module.exports = {
  apps: [{
    name: 'justdevicecount',
    script: './bin/www',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: true,
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
      TZ: 'America/New_York'
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3012,
      watch: false,
      TZ: 'America/New_York'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    time: true,
    merge_logs: true,
    kill_timeout: 5000,
    listen_timeout: 3000,
    // Health monitoring
    health_check_grace_period: 3000,
    // Advanced PM2+ features (optional)
    pmx: false,
    // Instance variables
    instance_var: 'INSTANCE_ID'
  }]
};
