# JustDeviceCount

A real-time device counting and analytics system for institutional libraries and recreation centers using Cisco CMX API integration.

## 📊 What It Does

JustDeviceCount automatically tracks patron counts across multiple building floors by integrating with your existing Cisco CMX WiFi infrastructure. It provides real-time and historical analytics through RESTful APIs and a web dashboard.

### Key Features
- **Real-time Data Collection**: Automated 15-minute intervals with timezone handling
- **Multi-building Support**: Configurable for multiple buildings and floors
- **Dual Storage Strategy**: Database persistence + memory caching for optimal performance
- **RESTful APIs**: JSON endpoints for dashboards and integrations
- **Production Ready**: PM2 process management with comprehensive monitoring
- **Secure HTTPS**: SSL/TLS encryption with certificate management

## 🏗️ Architecture

**Two-Building Implementation:**

- **King Library** (4 floors): Full database storage + 15-minute cache layer
- **Recreation Center** (2 floors): Memory-only storage for lightweight operation

## 🚀 Technology Stack

- **Backend**: Node.js, Express.js
- **Database**: PostgreSQL with Prisma ORM
- **Process Management**: PM2
- **Security**: HTTPS/SSL, environment-based configuration
- **Integration**: Cisco CMX API

## 🚀 Getting Started

### Prerequisites
- Node.js >= 18.x
- PostgreSQL database
- Cisco CMX server with API access
- SSL certificates

### Quick Start
```bash
# Clone and install
git clone https://github.com/Meng-V/justdevicecount.git
cd justdevicecount
npm install

# Configure (see DEVELOPER_SETUP.md for details)
cp .env.example .env
# Edit .env and config/default.json with your values

# Setup database
npx prisma generate
npx prisma migrate dev --name init

# Start application
npm start
```

**📖 For complete setup instructions, see [DEVELOPER_SETUP.md](DEVELOPER_SETUP.md)**

## 📊 API Endpoints

### King Library Data
`GET /patronapi` - Returns current patron count with historical data and analytics

### Recreation Center Data  
`GET /recapi` - Returns current patron count (memory-only, no historical data)

### Floor Breakdown
`GET /count_by_floor` - Returns patron counts by floor for both buildings

### Dashboard
`GET /` - Web dashboard showing real-time counts and analytics

## 🔒 Security

The application uses environment-based configuration with gitignored sensitive files:
- Environment variables (`.env*`)
- Production configurations (`config/production.json`)
- SSL certificates and keys (`security/` directory)
- Database credentials and connection strings

**All sensitive files are automatically excluded from version control.**

## 🤝 Contributing

This project is designed to be easily adaptable to different institutional environments. Feel free to submit issues or pull requests for improvements.

## 📁 Project Structure
```
justdevicecount/
├── bin/www                 # HTTPS server entry point
├── app.js                  # Express application setup
├── ecosystem.config.js     # PM2 configuration
├── start.sh               # Deployment convenience script
├── package.json           # Dependencies and scripts
├── .env                   # Environment variables (create this)
├── modules/
│   ├── app_core.js        # Data collection service
│   ├── patronCache.js     # Memory caching system
│   ├── axiosApi.js        # CMX API client
│   └── deviceUtils.js     # Utility functions
├── routes/
│   ├── index.js           # Dashboard route (/)
│   ├── patronapi.js       # King Library API (/patronapi)
│   ├── recapi.js          # Recreation Center API (/recapi)
│   └── count_by_floor.js  # Historical data API (/count_by_floor)
├── config/
│   └── default.json       # CMX API configuration (update this)
├── security/              # SSL certificates (create this)
│   ├── cert.pem          # SSL certificate
│   └── cert.key          # SSL private key
├── prisma/
│   └── schema.prisma     # Database schema
├── logs/                 # PM2 log files (auto-created)
├── views/
│   └── index.ejs         # Dashboard HTML template
└── test_comprehensive.js # Complete test suite
```

## 🔍 Troubleshooting Guide

### Common Issues & Solutions

#### 1. "EADDRINUSE: Port 3012 already in use"
```bash
# Find process using port
lsof -i :3012
# Kill the process
kill -9 <PID>
# Or use different port in .env
PORT=3013
```

#### 2. "SSL Certificate Error"
```bash
# Generate new self-signed certificates
openssl req -x509 -newkey rsa:4096 -keyout security/cert.key -out security/cert.pem -days 365 -nodes
# Or check certificate validity
openssl x509 -in security/cert.pem -text -noout
```

#### 3. "Database Connection Failed"
```bash
# Test database connection
node -e "require('@prisma/client').PrismaClient().\$connect().then(() => console.log('OK')).catch(console.error)"
# Check DATABASE_URL in .env
# Ensure PostgreSQL is running
```

#### 4. "CMX API Authentication Failed"
```bash
# Test CMX credentials
curl -H "Authorization: Basic YOUR_BASE64_CREDENTIALS" "https://your-cmx-server.edu/api/location/v3/clients"
# Regenerate base64 credentials
echo -n "username:password" | base64
```

#### 5. "PM2 Process Not Starting"
```bash
# Reset PM2
pm2 kill
pm2 start ecosystem.config.js
# Check PM2 logs
pm2 logs justdevicecount --lines 50
```

### Debug Commands
```bash
# Enable debug logging
DEBUG=* npm start

# Check configuration
node -e "console.log(require('config'))"

# Test individual modules
node -e "require('./modules/deviceUtils').dateTime()"

# Monitor system resources
top -p $(pgrep -f justdevicecount)
```

## 🤝 Contributing & Customization

### For Peer Institutions
1. **Fork the repository** for your institution
2. **Update configuration** files with your CMX details
3. **Modify floor boundaries** in `deviceUtils.js`
4. **Customize API endpoints** as needed
5. **Add your institution's branding** to dashboard

### Development Workflow
```bash
# 1. Create feature branch
git checkout -b feature/your-enhancement

# 2. Make changes and test
npm test

# 3. Update documentation
# Edit README.md if adding new features

# 4. Commit and push
git commit -m "Add: your enhancement description"
git push origin feature/your-enhancement
```

### Code Style Guidelines
- Follow existing ESLint configuration
- Use NY timezone for all timestamps
- Add comprehensive error handling
- Include JSDoc comments for new functions
- Update tests for new features

### Adding New Features
```bash
# Add new API endpoint:
# 1. Create route file in routes/
# 2. Add route to app.js
# 3. Add tests to test_comprehensive.js
# 4. Update this README

# Modify data collection:
# 1. Update modules/app_core.js
# 2. Test with shorter intervals first
# 3. Update database schema if needed
```

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


## 📞 Support & Resources

### Getting Help
1. **Check the logs first**: `pm2 logs justdevicecount`
2. **Run the test suite**: `npm test`
3. **Review this README** for configuration steps
4. **Check GitHub Issues** for similar problems

### Useful Resources
- **Cisco CMX Documentation**: [CMX API Guide](https://developer.cisco.com/docs/cmx/)
- **Prisma Documentation**: [Prisma.io](https://www.prisma.io/docs/)
- **PM2 Documentation**: [PM2.io](https://pm2.keymetrics.io/docs/)
- **Node.js Best Practices**: [Node.js Guide](https://nodejs.org/en/docs/)

### Performance Monitoring
```bash
# Real-time process monitoring
pm2 monit

# System resource usage
htop

# Database performance
npx prisma studio

# API response times
time curl -k https://localhost:3012/patronapi
```

### Maintenance Tasks
- **Weekly**: Check logs for errors, verify data collection
- **Monthly**: Update dependencies, rotate SSL certificates
- **Quarterly**: Review CMX credentials, optimize database
- **Annually**: Update Node.js version, security audit

---

## 📋 Quick Reference

### Essential Commands
```bash
# Start application
npm start                    # Development
npm run pm2:start:prod      # Production

# Monitor & Debug
pm2 logs justdevicecount    # View logs
pm2 monit                   # Real-time monitoring
npm test                     # Run tests

# Database
npx prisma studio           # Database browser
npx prisma migrate dev      # Apply migrations

# SSL Certificates
openssl req -x509 -newkey rsa:4096 -keyout security/cert.key -out security/cert.pem -days 365 -nodes
```

### Key Files to Configure
1. `.env` or `.env.production` - Database URL and environment variables
2. `config/default.json` - CMX server template (for sharing)
3. `config/production.json` - Actual CMX server and Floor IDs (gitignored)
4. `security/cert.pem` & `security/cert.key` - SSL certificates
5. Environment variables for production hostname and certificate paths

### API Endpoints
- `https://localhost:3012/` - Dashboard
- `https://localhost:3012/patronapi` - Library patron counts
- `https://localhost:3012/recapi` - Recreation center counts
- `https://localhost:3012/count_by_floor` - Historical floor data

---

**Author**: Meng-V  
**License**: ISC  
**Repository**: [GitHub](https://github.com/Meng-V/justdevicecount)  
**For Support**: Check GitHub Issues or run `npm test` for diagnostics
