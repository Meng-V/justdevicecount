// PM2 Ecosystem Configuration for JustDeviceCount (Dist Build)
// Production deployment from webpack-bundled dist folder
// Uses server-side PostgreSQL database

module.exports = {
  apps: [{
    name: 'justdevicecount-dist',
    script: './dist/server.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false, // Don't watch in production
    max_memory_restart: '500M',
    min_uptime: '10s',
    max_restarts: 5,
    restart_delay: 4000,
    env_production: {
      NODE_ENV: 'production',
      PORT: 3012,
      TZ: 'America/New_York',
      NODE_TLS_REJECT_UNAUTHORIZED: '1'
    },
    error_file: './logs/dist-err.log',
    out_file: './logs/dist-out.log',
    log_file: './logs/dist-combined.log',
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
