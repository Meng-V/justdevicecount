# JustDeviceCount

A real-time device counting and analytics system for King Library and Recreation Center using CMX API integration. Built with Node.js, Express, and PM2 for production deployment.

## 🏗️ Architecture Overview

**JustDeviceCount** is a backend service that collects, processes, and serves device count data from Cisco CMX APIs. The system provides real-time patron counting with floor-level granularity and historical analytics.

### Key Features
- **Real-time Data Collection**: Automated 15-minute intervals aligned to NY timezone
- **Multi-location Support**: King Library (4 floors) + Recreation Center (2 floors)
- **Intelligent Caching**: Memory-based caching to minimize database load
- **RESTful APIs**: JSON endpoints for external integrations
- **Production Ready**: PM2 process management with monitoring
- **Comprehensive Testing**: Automated test suite for all components

## 🚀 Quick Start (Local Development)

### Prerequisites
```bash
# Required
Node.js >= 18.x
npm >= 8.x
PM2 (auto-installed)

# Database
PostgreSQL or compatible (via Prisma)
```

### Installation & Setup
```bash
# Clone repository
git clone https://github.com/Meng-V/justdevicecount.git
cd justdevicecount

# Install dependencies
npm install

# Environment setup
cp .env.example .env
# Configure DATABASE_URL and other environment variables

# Database setup
npx prisma generate
npx prisma migrate dev

# SSL certificates (for HTTPS)
# Place cert.pem and cert.key in security/ directory
```

### Local Development Server

#### Option 1: Standard Node.js (Recommended for debugging)
```bash
npm start
# Server runs on https://localhost:3012
```

#### Option 2: PM2 Development Mode (Recommended for testing)
```bash
npm run dev
# Runs with file watching and auto-restart
```

#### Option 3: Full PM2 Production Mode
```bash
npm run pm2:start
# or
bash start.sh start
```

### Verify Installation
```bash
# Run comprehensive tests
npm test

# Check server health
curl -k https://localhost:3012/

# Test API endpoints
curl -k https://localhost:3012/patronapi
curl -k https://localhost:3012/recapi
curl -k https://localhost:3012/count_by_floor
```

## 📊 API Endpoints

### Core APIs
| Endpoint | Method | Description | Cache |
|----------|--------|-------------|-------|
| `/` | GET | Dashboard with real-time data | Live |
| `/patronapi` | GET | King Library patron counts | 15min |
| `/recapi` | GET | Recreation Center counts | Memory |
| `/count_by_floor` | GET | Historical floor-wise data | Live |

### API Response Format
```json
{
  "success": true,
  "data": {
    "patrons": 45,
    "timeMap": {...},
    "findMax": {...},
    "lastTen": [...]
  },
  "metadata": {
    "cached": true,
    "cacheAgeMinutes": 3,
    "source": "King Library Database",
    "refreshInterval": "15 minutes"
  }
}
```

## 🏛️ System Architecture

### Data Flow
```
CMX APIs → Device Processing → Database Storage → Cache Layer → API Endpoints
    ↓              ↓               ↓              ↓           ↓
Floor APIs    Validation     Prisma ORM    PatronCache   Express Routes
```

### Core Components

#### **Data Collection (`modules/app_core.js`)**
- **DeviceDataService**: Manages 15-minute collection cycles
- **Floor Processing**: Validates and processes device data per floor
- **Database Integration**: Prisma ORM for PostgreSQL operations

#### **Caching System (`modules/patronCache.js`)**
- **PatronCache**: Singleton cache service
- **Background Updates**: Automatic 15-minute refresh cycles
- **Memory Optimization**: Reduces database load by 95%

#### **API Layer (`routes/`)**
- **Express Routes**: RESTful endpoint implementations
- **Error Handling**: Comprehensive error responses
- **CORS Support**: Cross-origin request handling

#### **Utilities (`modules/deviceUtils.js`)**
- **Timezone Handling**: Consistent NY timezone operations
- **Device Validation**: RSSI, time, and SSID filtering
- **Coordinate Bounds**: Floor-level device positioning

## 🔧 Configuration

### Environment Variables
```bash
# Database
DATABASE_URL="postgresql://user:pass@host:port/db"

# Application
NODE_ENV="development"
PORT=3012
TZ="America/New_York"

# SSL (Production)
HTTPS_CERT_PATH="./security/cert.pem"
HTTPS_KEY_PATH="./security/cert.key"
```

### CMX API Configuration (`config/default.json`)
```json
{
  "address": {
    "host": "https://your-cmx-server/",
    "ground-add": "api/location/v3/clients?floorId=...",
    "first-add": "api/location/v3/clients?floorId=..."
  },
  "app": {
    "port": 3012,
    "auth": "Basic <base64-encoded-credentials>"
  }
}
```

## 🚀 Production Deployment

### PM2 Process Management
```bash
# Production start
npm run pm2:start:prod

# Monitor processes
npm run pm2:monit

# View logs
npm run pm2:logs

# Graceful reload
npm run pm2:reload

# Stop services
npm run pm2:stop
```

### PM2 Ecosystem Features
- **Memory Limits**: 500MB restart threshold
- **File Watching**: Development mode only
- **Log Management**: Timestamped logs with rotation
- **Health Monitoring**: Automatic restart on failures
- **Environment Separation**: Dev/prod configurations

## 🧪 Testing & Quality Assurance

### Test Suite (`test_comprehensive.js`)
```bash
npm test
```

**Test Coverage:**
- ✅ Server connectivity and HTTPS
- ✅ Database operations and Prisma
- ✅ API endpoint responses
- ✅ CMX API authentication
- ✅ Device validation logic
- ✅ Cache performance
- ✅ PM2 process health
- ✅ Memory usage monitoring

### Code Quality
- **ESLint**: Code style and error checking
- **Security**: No vulnerabilities (npm audit clean)
- **Performance**: Optimized database queries
- **Logging**: Comprehensive NY timezone logging

## 📈 Performance & Monitoring

### Metrics
- **Database Queries**: Reduced from per-request to 4x/hour
- **Response Time**: <50ms for cached endpoints
- **Memory Usage**: ~100MB baseline, 500MB restart limit
- **Uptime**: PM2 automatic restart on failures

### Monitoring Commands
```bash
# Real-time monitoring
pm2 monit

# Process status
pm2 status

# Log analysis
pm2 logs --lines 100

# Memory usage
pm2 show justdevicecount
```

## 🔒 Security Considerations

- **HTTPS Only**: SSL/TLS encryption required
- **API Authentication**: Basic auth for CMX APIs
- **Input Validation**: Device data sanitization
- **Error Handling**: No sensitive data in error responses
- **Environment Isolation**: Separate dev/prod configurations

## 📁 Project Structure
```
justdevicecount/
├── bin/www                 # Server entry point
├── app.js                  # Express application setup
├── ecosystem.config.js     # PM2 configuration
├── start.sh               # Deployment script
├── modules/
│   ├── app_core.js        # Data collection service
│   ├── patronCache.js     # Caching system
│   ├── axiosApi.js        # CMX API client
│   └── deviceUtils.js     # Utility functions
├── routes/
│   ├── index.js           # Dashboard route
│   ├── patronapi.js       # King Library API
│   ├── recapi.js          # Recreation Center API
│   └── count_by_floor.js  # Historical data API
├── config/
│   └── default.json       # Application configuration
├── security/              # SSL certificates
├── logs/                  # PM2 log files
└── test_comprehensive.js  # Test suite
```

## 🤝 Contributing

### Development Workflow
1. **Setup**: Follow local development setup
2. **Testing**: Run `npm test` before commits
3. **Code Style**: Follow ESLint configuration
4. **Logging**: Use NY timezone for all timestamps
5. **Documentation**: Update README for new features

### Common Tasks
```bash
# Add new API endpoint
# 1. Create route in routes/
# 2. Add to app.js
# 3. Add tests to test_comprehensive.js
# 4. Update README

# Modify data collection
# 1. Update modules/app_core.js
# 2. Test with 30-second intervals first
# 3. Revert to 15-minute for production
```

## 📞 Support & Troubleshooting

### Common Issues
- **SSL Certificate**: Ensure cert.pem and cert.key are valid
- **Database Connection**: Verify DATABASE_URL and network access
- **PM2 Processes**: Use `pm2 delete all` to clean duplicate processes
- **Port Conflicts**: Check if port 3012 is available

### Debug Commands
```bash
# Check server logs
tail -f logs/combined.log

# Test database connection
npx prisma studio

# Validate configuration
node -e "console.log(require('config'))"

# Check PM2 status
pm2 list
```

---

**Author**: Meng-V  
**License**: ISC  
**Repository**: [GitHub](https://github.com/Meng-V/justdevicecount)
