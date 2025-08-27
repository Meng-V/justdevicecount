# Developer Guide

Complete setup, build, and deployment instructions for JustDeviceCount at your institution.

## 🏗️ Architecture Overview

JustDeviceCount operates across **two buildings** with different data strategies:

### 🏛️ King Library (Primary Building)
- **4 floors**: Ground, First, Second, Third
- **Database storage**: All data persisted in PostgreSQL
- **Cache layer**: 15-minute refresh cycle for performance
- **Historical data**: Full analytics and reporting capabilities

### 🏃‍♂️ Recreation Center (Secondary Building)  
- **2 floors**: Ground, First
- **Memory-only storage**: No database persistence
- **Real-time only**: Current counts without historical data
- **Lightweight**: Minimal resource usage

## ⚡ Prerequisites

- Node.js >= 18.x: `node --version`
- npm >= 8.x: `npm --version` 
- PostgreSQL database server
- Cisco CMX server credentials (username/password)
- CMX Floor IDs for your buildings

## 📥 Step 1: Clone and Install

```bash
git clone https://github.com/Meng-V/justdevicecount.git
cd justdevicecount
npm install
```

## ⚙️ Step 2: Environment Configuration

```bash
# Copy environment template
cp .env.example .env
nano .env  # Edit with your values
```

**Required variables:**
```bash
DATABASE_URL="postgresql://username:password@localhost:5432/justdevicecount"
NODE_ENV="development"
PORT=3012
TZ="America/New_York"
PRODUCTION_HOSTNAME="your-production-server.edu"
TEST_USER_ID="testuser"
TEST_USER_NAME="Test Developer"
```

## 🏢 Step 3: CMX Integration

Edit `config/default.json` with your CMX server details:

```bash
nano config/default.json
```

**Update these values:**
1. `"host"`: Your CMX server URL
2. Floor IDs for each floor (get from your CMX admin)
3. `"auth"`: Your Base64 encoded credentials

**Generate Base64 credentials:**
```bash
echo -n "your_username:your_password" | base64
```

## 🔒 Step 4: SSL Certificates

**⚠️ SECURITY: All files in security/ are gitignored. Create certificates locally.**

```bash
mkdir -p security

# Option A: Self-signed (Development)
openssl req -x509 -newkey rsa:4096 -keyout security/cert.key -out security/cert.pem -days 365 -nodes

# Option B: Use template (customize security/req.cnf first)
openssl req -x509 -newkey rsa:4096 -keyout security/cert.key -out security/cert.pem -days 365 -nodes -config security/req.cnf

# Option C: Institution certificates (Production)
# Copy your cert.pem and cert.key to security/
```

## 🗄️ Step 5: Database Setup

```bash
# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev --name init

# Optional: View database
npx prisma studio
```

## 🧪 Step 6: Test Setup

```bash
# Start application
npm start

# Test endpoints (in another terminal)
curl -k https://localhost:3012/
curl -k https://localhost:3012/patronapi
curl -k https://localhost:3012/recapi
curl -k https://localhost:3012/count_by_floor

# Run tests
npm test
```

## 🔍 Step 7: Security Verification

**Critical security checks before deployment:**

```bash
# Verify no sensitive files tracked by git
git status
git check-ignore .env .env.production security/*
git ls-files security/  # Should return empty

# Check for accidentally committed secrets
git log --name-only | grep -E '\.(key|pem|env|pub)$'
```

**Expected results:**
- [ ] Server starts without errors
- [ ] Dashboard loads at `https://localhost:3012`
- [ ] All API endpoints return JSON
- [ ] Database connection successful
- [ ] CMX API authentication working
- [ ] Tests pass
- [ ] **No sensitive files tracked by git**

---

# Build System Guide

Your JustDeviceCount application supports generating a production-ready `dist` folder using webpack. This section explains how to use the build system.

## Build System Overview

The build system bundles your Node.js application and all its dependencies into a single `dist` folder that can be deployed to production servers. This approach provides:

- **Single artifact deployment**: Everything needed to run the app is in one folder
- **Optimized bundle**: Webpack optimizes the code for production
- **Dependency isolation**: Production dependencies are separate from development tools
- **Easy deployment**: Just copy the `dist` folder to your production server

## Build Commands

### Development Build
```bash
npm run build:dev
```
Creates a development build with source maps and debugging information.

### Production Build
```bash
npm run build
```
Creates an optimized production build.

### Start from Dist
```bash
npm run start:dist
```
Runs the application directly from the `dist` folder (requires build first).

### Start Dist in Development Mode
```bash
npm run start:dist:dev
```
Runs the dist application in development mode for testing.

### Complete Build and Deploy Script
```bash
./start-dist.sh
```
Automated script that builds, installs dependencies, and starts with PM2.

## Build Process

The webpack configuration (`webpack.config.js`) performs these steps:

1. **Bundle JavaScript**: Combines all your Node.js modules into `dist/server.js`
2. **Copy Assets**: Copies necessary files and directories:
   - `views/` - EJS templates
   - `config/` - Configuration files
   - `prisma/` - Database schema
   - `security/` - SSL certificates (if present)
   - `package.json` - For production dependencies
   - `.env.example` - Environment template

3. **External Dependencies**: Node modules remain external and are installed separately in the dist folder

## Dist Folder Structure

After building, your `dist` folder will contain:
```
dist/
├── server.js           # Bundled application
├── package.json        # Production dependencies
├── .env.example        # Environment template
├── config/            # Configuration files
├── views/             # EJS templates
├── prisma/            # Database schema
├── security/          # SSL certificates
└── node_modules/      # Production dependencies (after npm install)
```

---

# Production Deployment

## Method 1: Using the automated script
```bash
./start-dist.sh
```

## Method 2: Manual deployment
```bash
# Build the application
npm run build

# Navigate to dist folder
cd dist

# Install production dependencies
npm install --production

# Copy environment file
cp ../.env .env  # Copy your actual .env file

# Start the application
node server.js
# OR with PM2
pm2 start ../ecosystem.dist.config.js --env production
```

## Method 3: Traditional PM2 deployment
```bash
# Install PM2 globally
npm install -g pm2

# Create production config
cp config/default.json config/production.json
nano config/production.json  # Add real CMX values

# Create production environment
cp .env .env.production
nano .env.production  # Add production values

# Start with PM2
npm run pm2:start:prod

# Monitor
pm2 status
pm2 logs justdevicecount
pm2 monit
```

## PM2 Configuration

The build system includes `ecosystem.dist.config.js` for PM2 process management:

- **Process name**: `justdevicecount-dist`
- **Script**: `./dist/server.js`
- **Logs**: Separate log files with `dist-` prefix
- **Environment**: Production-optimized settings

### PM2 Commands for Dist
```bash
npm run pm2:start:dist    # Start from dist folder
pm2 logs justdevicecount-dist  # View logs
pm2 restart justdevicecount-dist  # Restart
pm2 stop justdevicecount-dist     # Stop
```

## Environment Configuration

### SSL Certificates
The application expects SSL certificates for HTTPS. Configure paths using environment variables:

```bash
# For development (default paths)
HTTPS_CERT_PATH=./security/cert.pem
HTTPS_KEY_PATH=./security/cert.key

# For production (override defaults)
PROD_CERT_PATH=/path/to/production/cert.pem
PROD_KEY_PATH=/path/to/production/key.pem
```

### Environment Detection
The application detects the environment based on:
- `NODE_ENV=production` - Forces production mode
- `PRODUCTION_HOSTNAME` - Your production server hostname
- `HOSTNAME` environment variable

---

# API Endpoints

## King Library Data (`/patronapi`)
```json
{
  "success": true,
  "data": {
    "timeStamp": "2024-01-15T14:30:00.000Z",
    "patrons": 245,
    "timeMap": [...],
    "findMax": {...},
    "lastTen": [...]
  },
  "metadata": {
    "cached": true,
    "source": "King Library Database",
    "refreshInterval": "15 minutes"
  }
}
```

## Recreation Data (`/recapi`)
```json
{
  "success": true,
  "data": {
    "timeStamp": "2024-01-15T14:30:00.000Z",
    "patrons": 89
  },
  "metadata": {
    "cached": true,
    "source": "Recreation Center Memory Cache",
    "refreshInterval": "15 minutes"
  }
}
```

## Floor Breakdown (`/count_by_floor`)
```json
{
  "success": true,
  "data": {
    "king": {
      "ground": 45,
      "first": 67,
      "second": 89,
      "third": 44,
      "total": 245
    },
    "recreation": {
      "ground": 34,
      "first": 55,
      "total": 89
    }
  }
}
```

---

# Troubleshooting

## Common Issues

### CMX Authentication Fails
```bash
# Test credentials manually
curl -H "Authorization: Basic YOUR_CREDENTIALS" "https://your-cmx-server.edu/api/location/v3/clients"
```

### Database Connection Issues
```bash
# Test database connection
npx prisma studio
# Check DATABASE_URL in .env
```

### SSL Certificate Problems
```bash
# Verify certificates exist
ls -la security/
# Check certificate validity
openssl x509 -in security/cert.pem -text -noout
```

### PM2 Process Issues
```bash
# Check PM2 status
pm2 status
pm2 logs justdevicecount
pm2 restart justdevicecount
```

### Build Errors
- Check that all source directories exist
- Verify webpack configuration matches your project structure
- Review build output for specific error messages

### Missing Dependencies in Dist
If modules are missing:
```bash
cd dist
npm install --production
```

### SSL Certificate Errors in Dist
If you get certificate errors when testing the dist build:

1. **For testing**: Set `NODE_ENV=development` to use local certificates
2. **For production**: Ensure certificates exist at the specified paths
3. **Override paths**: Use environment variables to specify custom certificate locations

## Debug Commands
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

---

# Development vs Production

| Aspect | Development | Production (Dist) |
|--------|-------------|-------------------|
| **Files** | Source files | Bundled `server.js` |
| **Dependencies** | All deps | Production only |
| **SSL** | Local certs | Production certs |
| **Environment** | `NODE_ENV=development` | `NODE_ENV=production` |
| **PM2 Config** | `ecosystem.config.js` | `ecosystem.dist.config.js` |

## Integration with Existing Workflow

Your existing development workflow remains unchanged:
- `npm start` - Direct development server
- `npm run dev` - PM2 development mode
- `npm run pm2:start` - PM2 with source files

The build system adds production deployment options without affecting development.

---

# Customization

## Adding New Buildings
1. Add floor IDs to `config/default.json`
2. Update route handlers in `routes/`
3. Modify data collection in `modules/app_core.js`
4. Update API endpoints as needed

## Changing Cache Intervals
Edit `modules/patronCache.js` and `modules/app_core.js` for different refresh rates.

## Database Schema Changes
Use Prisma migrations: `npx prisma migrate dev --name your_change_name`

## Performance Optimization

- **King Library**: Uses database + 15-minute cache for optimal performance
- **Recreation Center**: Memory-only for lightweight operation
- **Database**: Indexed on timestamp for fast queries
- **Monitoring**: PM2 provides CPU, memory, and restart statistics

---

# Quick Reference

## Essential Commands
```bash
# Development
npm start                    # Start development server
npm run dev                  # PM2 development mode
npm test                     # Run tests

# Build System
npm run build               # Production build
npm run build:dev           # Development build
npm run start:dist          # Start from dist folder
./start-dist.sh             # Automated build and deploy

# Production
npm run pm2:start:prod      # PM2 production (source)
npm run pm2:start:dist      # PM2 production (dist)

# Monitoring
pm2 logs justdevicecount    # View logs
pm2 monit                   # Real-time monitoring
pm2 status                  # Process status

# Database
npx prisma studio           # Database browser
npx prisma migrate dev      # Apply migrations

# SSL Certificates
openssl req -x509 -newkey rsa:4096 -keyout security/cert.key -out security/cert.pem -days 365 -nodes
```

## Key Files to Configure
1. `.env` or `.env.production` - Database URL and environment variables
2. `config/default.json` - CMX server template (for sharing)
3. `config/production.json` - Actual CMX server and Floor IDs (gitignored)
4. `security/cert.pem` & `security/cert.key` - SSL certificates
5. Environment variables for production hostname and certificate paths

---

**Setup time: 15-30 minutes**

Your JustDeviceCount installation is ready to collect patron data from your CMX infrastructure!
