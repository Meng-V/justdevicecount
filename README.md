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
- **Build System**: Webpack-based dist folder generation for production deployment

## 🏗️ Architecture

**Two-Building Implementation:**

- **King Library** (4 floors): Full database storage + 15-minute cache layer
- **Recreation Center** (2 floors): Memory-only storage for lightweight operation

## 🚀 Technology Stack

- **Backend**: Node.js, Express.js
- **Database**: PostgreSQL with Prisma ORM
- **Build System**: Webpack, Babel
- **Process Management**: PM2
- **Security**: HTTPS/SSL, environment-based configuration
- **Integration**: Cisco CMX API

## 🚀 Quick Start

```bash
# Clone and install
git clone https://github.com/Meng-V/justdevicecount.git
cd justdevicecount
npm install

# Start development server
npm start
```

**📖 For complete setup, build, and deployment instructions, see [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)**

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

## 🤝 Contributing

This project is designed to be easily adaptable to different institutional environments. Feel free to submit issues or pull requests for improvements.

### For Peer Institutions
1. **Fork the repository** for your institution
2. **Update configuration** files with your CMX details
3. **Modify floor boundaries** in `deviceUtils.js`
4. **Customize API endpoints** as needed
5. **Add your institution's branding** to dashboard

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
3. **Review [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)** for configuration steps
4. **Check GitHub Issues** for similar problems

### Useful Resources
- **Cisco CMX Documentation**: [CMX API Guide](https://developer.cisco.com/docs/cmx/)
- **Prisma Documentation**: [Prisma.io](https://www.prisma.io/docs/)
- **PM2 Documentation**: [PM2.io](https://pm2.keymetrics.io/docs/)
- **Node.js Best Practices**: [Node.js Guide](https://nodejs.org/en/docs/)

---

**Author**: Meng-V  
**License**: ISC  
**Repository**: [GitHub](https://github.com/Meng-V/justdevicecount)  
**For Support**: Check GitHub Issues or run `npm test` for diagnostics
