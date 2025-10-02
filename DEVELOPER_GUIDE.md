# JustDeviceCount - Developer Guide

Complete technical guide for deploying and customizing JustDeviceCount at your institution.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [Database Configuration](#database-configuration)
- [CMX API Configuration](#cmx-api-configuration)
- [SSL/HTTPS Setup](#sslhttps-setup)
- [Environment Variables](#environment-variables)
- [Deployment Options](#deployment-options)
- [Customization](#customization)
- [Troubleshooting](#troubleshooting)
- [Production Best Practices](#production-best-practices)

## Prerequisites

### Required Software
- **Node.js**: v18.x or higher
- **npm**: v9.x or higher
- **PostgreSQL**: v14.x or higher
- **PM2**: v5.x or higher (for production)
- **Git**: For version control

### Required Access
- **Cisco CMX API**: Network credentials with read access
- **PostgreSQL Server**: Database credentials with CREATE/ALTER permissions
- **Server/VM**: Linux server with sudo access (or equivalent)

### System Requirements
- **RAM**: 512MB minimum, 1GB recommended
- **Disk**: 1GB minimum for application and logs
- **Network**: Outbound HTTPS access to CMX API
- **Ports**: 3012 (configurable) for application server

## Initial Setup

### 1. Clone Repository

```bash
git clone https://github.com/Meng-V/justdevicecount.git
cd justdevicecount
```

### 2. Install Dependencies

```bash
npm install
```

This installs all required packages including:
- Express.js (web framework)
- Prisma (database ORM)
- Axios (HTTP client)
- PM2 (process manager)
- Webpack (build system)

### 3. Verify Installation

```bash
npm test
```

This runs the comprehensive test suite to verify dependencies are correctly installed.

## Database Configuration

### 1. Create PostgreSQL Database

Connect to your PostgreSQL server:

```bash
psql -h your-database-host -U your-username
```

Create the database:

```sql
CREATE DATABASE crowd_index;
```

### 2. Configure Database Connection

Create a `.env` file in the project root:

```bash
# .env file
DATABASE_URL="postgresql://username:password@hostname:5432/crowd_index?schema=public"

# Example:
# DATABASE_URL="postgresql://dbuser:securepass@db.example.edu:5432/crowd_index?schema=public"
```

**Format Breakdown**:
- `username`: Your PostgreSQL username
- `password`: Your PostgreSQL password
- `hostname`: Database server hostname or IP
- `5432`: PostgreSQL port (default)
- `crowd_index`: Database name
- `schema=public`: PostgreSQL schema (usually public)

### 3. Initialize Database Schema

Run Prisma migrations to create tables:

```bash
# Push schema to database
npx prisma db push

# Generate Prisma Client
npx prisma generate
```

This creates the `device_data` table with the following structure:

```
device_data
├── id (String, Primary Key)
├── timeStamp (DateTime, indexed)
├── uniqUserTotal (String[])
├── uniqUserGround (JSON)
├── uniqUserFirst (JSON)
├── uniqUserSecond (JSON)
├── uniqUserThird (JSON)
├── patrons (Int, indexed)
└── countByFloor (Int[])
```

### 4. Verify Database Connection

```bash
node test_comprehensive.js
```

Look for "✅ Successfully connected to database!"

## CMX API Configuration

### 1. Obtain CMX Credentials

Contact your network team to get:
- CMX API base URL
- Username with API access
- Password or API token
- Building/floor map IDs

### 2. Configure CMX Settings

Edit `config/default.json`:

```json
{
  "server": {
    "cmx_url": "https://your-cmx-server.example.edu",
    "username": "cmx_api_user",
    "password": "cmx_api_password"
  },
  "buildings": {
    "king_library": {
      "floors": {
        "ground": "map-id-ground-floor",
        "first": "map-id-first-floor",
        "second": "map-id-second-floor",
        "third": "map-id-third-floor"
      }
    },
    "recreation_center": {
      "floors": {
        "ground": "map-id-rec-ground",
        "first": "map-id-rec-first"
      }
    }
  }
}
```

**Getting Map IDs**:

```bash
# Test CMX connection and list available maps
curl -u username:password https://your-cmx-server.example.edu/api/location/v2/clients
```

### 3. Test CMX Connection

Run the comprehensive test:

```bash
npm test
```

This verifies:
- CMX API connectivity
- Authentication
- Data retrieval
- Response parsing

## SSL/HTTPS Setup

### Option 1: Self-Signed Certificate (Development)

```bash
mkdir -p security
cd security

# Generate self-signed certificate
openssl req -x509 -newkey rsa:4096 -keyout cert.key -out cert.pem -days 365 -nodes

cd ..
```

### Option 2: Let's Encrypt (Production)

```bash
# Install certbot
sudo apt-get install certbot

# Obtain certificate
sudo certbot certonly --standalone -d your-domain.example.edu

# Copy certificates to project
mkdir -p security
sudo cp /etc/letsencrypt/live/your-domain.example.edu/fullchain.pem security/cert.pem
sudo cp /etc/letsencrypt/live/your-domain.example.edu/privkey.pem security/cert.key
sudo chmod 644 security/cert.pem
sudo chmod 600 security/cert.key
```

### Option 3: Institutional Certificate

Place your institution's SSL certificates in the `security/` directory:

```bash
mkdir -p security
cp /path/to/your/certificate.crt security/cert.pem
cp /path/to/your/private.key security/cert.key
chmod 644 security/cert.pem
chmod 600 security/cert.key
```

### Verify SSL Setup

The application expects:
- `security/cert.pem` - SSL certificate
- `security/cert.key` - Private key

## Environment Variables

Complete `.env` file example:

```bash
# Database Connection
DATABASE_URL="postgresql://username:password@hostname:5432/crowd_index?schema=public"

# Application Settings
NODE_ENV=production
PORT=3012

# Timezone (for consistent logging)
TZ=America/New_York

# Optional: SSL/TLS settings
NODE_TLS_REJECT_UNAUTHORIZED=1
```

**Environment Variables Explained**:

| Variable | Purpose | Example |
|----------|---------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/dbname` |
| `NODE_ENV` | Environment mode | `production` or `development` |
| `PORT` | Application port | `3012` |
| `TZ` | Timezone for logging | `America/New_York` |

## Deployment Options

### Local Development

For testing and development on your local machine:

```bash
# Direct node execution
npm start

# Or with PM2 for auto-restart during development
./start.sh start
```

**PM2 Configuration** (`ecosystem.config.js`):

```javascript
module.exports = {
  apps: [{
    name: 'justdevicecount',
    script: './bin/www',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: true,  // Auto-reload on file changes
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'development',
      PORT: 3012
    }
  }]
};
```

### Server Production Deployment

**For production server deployment, see [SERVER_DEPLOYMENT.md](SERVER_DEPLOYMENT.md)**

The production server uses systemd service management (not PM2):
- Service name: `crowd-index`
- Restart: `sudo service crowd-index restart`
- Logs: `sudo journalctl -u crowd-index -f`
- Runs: `bin/www` directly

The SERVER_DEPLOYMENT.md guide covers:
- Complete deployment workflow
- Service management commands
- Troubleshooting production issues
- Differences from local development

### Local PM2 Management Commands

These commands are for **local development only**:

```bash
# Start application
./start.sh start

# Stop application
./start.sh stop

# Restart application
./start.sh restart

# View logs
./start.sh logs

# Check status
./start.sh status

# Monitor in real-time
npm run pm2:monit

# Remove from PM2
./start.sh delete
```

**Note**: For production server deployment, use systemd commands instead. See [SERVER_DEPLOYMENT.md](SERVER_DEPLOYMENT.md).

## Customization

### Modify Building Configuration

Edit `modules/deviceUtils.js` to change:

**Floor Boundaries** (X/Y coordinates):

```javascript
const FLOOR_BOUNDARIES = {
  ground: { minX: 0, maxX: 100, minY: 0, maxY: 50 },
  first: { minX: 0, maxX: 100, minY: 50, maxY: 100 },
  // Add/modify as needed
};
```

**Building Names**:

Update route files in `routes/`:
- `routes/patronapi.js` - King Library endpoint
- `routes/recapi.js` - Recreation Center endpoint
- `routes/count_by_floor.js` - Multi-building endpoint

### Change Base Path

Edit `app.js`:

```javascript
const basePath = "/crowdindex"; // Change to your preferred path
```

### Adjust Update Interval

Edit `modules/app_core.js`:

```javascript
const UPDATE_INTERVAL = 15 * 60 * 1000; // 15 minutes in milliseconds
// Change to desired interval (e.g., 5 * 60 * 1000 for 5 minutes)
```

### Customize Dashboard

Edit `views/index.ejs` to modify the web dashboard:
- Update building names
- Change styling/colors
- Add institutional branding
- Modify visualization

## Troubleshooting

### Common Issues

#### 1. Database Connection Failed

**Error**: `P2021: The table 'device_data' does not exist`

**Solution**:
```bash
npx prisma db push
npx prisma generate
```

#### 2. CMX API Connection Failed

**Error**: `ECONNREFUSED` or `401 Unauthorized`

**Checks**:
- Verify CMX URL in `config/default.json`
- Check username/password
- Ensure network connectivity to CMX server
- Verify firewall rules allow outbound HTTPS

#### 3. SSL Certificate Error

**Error**: `ENOENT: no such file or directory, open 'security/cert.pem'`

**Solution**:
```bash
mkdir -p security
# Place your SSL certificates in security/ directory
```

#### 4. Port Already in Use

**Error**: `EADDRINUSE: address already in use :::3012`

**Solution**:
```bash
# Find process using port 3012
lsof -i :3012

# Kill the process
kill -9 <PID>

# Or change port in .env file
echo "PORT=3013" >> .env
```

#### 5. PM2 Won't Start

**Checks**:
```bash
# Check PM2 status
pm2 status

# Check logs for errors
pm2 logs justdevicecount --lines 100

# Delete and restart
pm2 delete justdevicecount
pm2 start ecosystem.config.js
```

### Debugging Tools

#### Enable Verbose Logging

```bash
NODE_ENV=development npm start
```

#### Test Database Connection

```bash
node test_comprehensive.js
```

#### Check CMX API Response

```bash
curl -u username:password https://your-cmx-server.example.edu/api/location/v2/clients | jq
```

#### Monitor Process

```bash
pm2 monit
```

## Production Best Practices

### Security

1. **Never Commit Secrets**
   - Keep `.env` out of version control
   - Use `.gitignore` for sensitive files
   - Rotate credentials regularly

2. **Use Strong Passwords**
   - Complex database passwords
   - Secure CMX credentials
   - Restrict database user permissions

3. **Enable SSL/TLS**
   - Use valid certificates
   - Keep certificates updated
   - Configure proper certificate paths

4. **Firewall Configuration**
   - Restrict database access to application server only
   - Limit inbound connections to necessary ports
   - Use VPN/SSH for administrative access

### Performance

1. **Database Optimization**
   ```sql
   -- Add indexes for common queries
   CREATE INDEX idx_timestamp ON device_data(timeStamp);
   CREATE INDEX idx_patrons ON device_data(patrons);
   ```

2. **Memory Management**
   - Monitor PM2 memory usage: `pm2 monit`
   - Set `max_memory_restart` in `ecosystem.config.js`
   - Clear old logs regularly: `pm2 flush`

3. **Log Rotation**
   ```bash
   pm2 install pm2-logrotate
   pm2 set pm2-logrotate:max_size 10M
   pm2 set pm2-logrotate:retain 7
   ```

### Monitoring

1. **Health Checks**
   ```bash
   # Add to cron for daily checks
   0 9 * * * cd /path/to/justdevicecount && node test_comprehensive.js >> /var/log/healthcheck.log 2>&1
   ```

2. **PM2 Monitoring**
   ```bash
   # View real-time metrics
   pm2 monit

   # Check status
   pm2 status

   # View logs
   pm2 logs justdevicecount --lines 50
   ```

3. **Database Maintenance**
   ```sql
   -- Vacuum database monthly
   VACUUM ANALYZE device_data;

   -- Check database size
   SELECT pg_size_pretty(pg_database_size('crowd_index'));
   ```

### Backup Strategy

1. **Database Backups**
   ```bash
   # Daily backup script
   #!/bin/bash
   DATE=$(date +%Y%m%d)
   pg_dump -h hostname -U username crowd_index > /backups/crowd_index_$DATE.sql
   
   # Keep last 30 days
   find /backups -name "crowd_index_*.sql" -mtime +30 -delete
   ```

2. **Configuration Backups**
   ```bash
   # Backup config files (without secrets)
   tar -czf config-backup.tar.gz \
     ecosystem.config.js \
     webpack.config.js \
     prisma/schema.prisma \
     config/default.json.example
   ```

### Updating

1. **Application Updates**
   ```bash
   # Pull latest changes
   git pull origin main

   # Install new dependencies
   npm install

   # Update database schema if changed
   npx prisma db push
   npx prisma generate

   # Restart application (local dev)
   pm2 restart justdevicecount
   
   # Or restart server (production)
   # See SERVER_DEPLOYMENT.md
   ```

2. **Dependency Updates**
   ```bash
   # Check for outdated packages
   npm outdated

   # Update packages
   npm update

   # Test after updates
   npm test
   ```

## Architecture Overview

### File Structure

```
justdevicecount/
├── bin/
│   └── www                      # HTTPS server entry point
├── modules/
│   ├── app_core.js             # Data collection service
│   ├── patronCache.js          # 15-minute caching layer
│   ├── axiosApi.js             # CMX API client
│   └── deviceUtils.js          # Floor mapping utilities
├── routes/
│   ├── index.js                # Dashboard route
│   ├── patronapi.js            # King Library API
│   ├── recapi.js               # Recreation Center API
│   └── count_by_floor.js       # Historical data API
├── prisma/
│   └── schema.prisma           # Database schema
├── views/
│   └── index.ejs               # Web dashboard template
├── config/
│   └── default.json            # CMX configuration
├── security/                   # SSL certificates (gitignored)
│   ├── cert.pem
│   └── cert.key
├── .env                        # Environment variables (gitignored)
├── app.js                      # Express application
├── ecosystem.config.js         # PM2 configuration (local dev)
├── start.sh                    # Local development script
└── test_comprehensive.js      # Test suite
```

### Data Flow

```
CMX API → axiosApi.js → deviceUtils.js → app_core.js → Database (PostgreSQL)
                                              ↓
                                       patronCache.js
                                              ↓
                                    routes/*.js → Client
```

### Process Architecture

- **Main Process**: Express server (bin/www)
- **Background Job 1**: Database updater (15-minute interval)
- **Background Job 2**: Cache updater (15-minute interval)
- **Memory Store**: Recreation Center data (no database)

## Support

### Getting Help

1. **Check logs first**
   ```bash
   # Local development
   pm2 logs justdevicecount --lines 100
   
   # Production server
   sudo journalctl -u crowd-index -n 100
   ```

2. **Run diagnostics**
   ```bash
   npm test
   ```

3. **Check GitHub Issues**
   - Search existing issues
   - Create new issue with logs

4. **Review this guide**
   - Troubleshooting section
   - Common issues

### Reporting Issues

Include in bug reports:
- Node.js version (`node --version`)
- npm version (`npm --version`)
- OS and version
- Error messages and logs
- Steps to reproduce
- Configuration (redact secrets)

---

**Last Updated**: 2025-10-02  
**Version**: 1.0.0  
**Maintainer**: Meng-V
