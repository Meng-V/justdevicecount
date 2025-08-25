# Developer Setup Guide

Complete setup instructions for deploying JustDeviceCount at your institution.

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

## 🚀 Step 8: Production Deployment

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

## 📊 API Endpoints

### King Library Data (`/patronapi`)
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

### Recreation Data (`/recapi`)
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

### Floor Breakdown (`/count_by_floor`)
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

## 🛠️ Troubleshooting

### Common Issues

**CMX Authentication Fails:**
```bash
# Test credentials manually
curl -H "Authorization: Basic YOUR_CREDENTIALS" "https://your-cmx-server.edu/api/location/v3/clients"
```

**Database Connection Issues:**
```bash
# Test database connection
npx prisma studio
# Check DATABASE_URL in .env
```

**SSL Certificate Problems:**
```bash
# Verify certificates exist
ls -la security/
# Check certificate validity
openssl x509 -in security/cert.pem -text -noout
```

**PM2 Process Issues:**
```bash
# Check PM2 status
pm2 status
pm2 logs justdevicecount
pm2 restart justdevicecount
```

### Performance Optimization

- **King Library**: Uses database + 15-minute cache for optimal performance
- **Recreation Center**: Memory-only for lightweight operation
- **Database**: Indexed on timestamp for fast queries
- **Monitoring**: PM2 provides CPU, memory, and restart statistics

## 🔧 Customization

### Adding New Buildings
1. Add floor IDs to `config/default.json`
2. Update route handlers in `routes/`
3. Modify data collection in `modules/app_core.js`
4. Update API endpoints as needed

### Changing Cache Intervals
Edit `modules/patronCache.js` and `modules/app_core.js` for different refresh rates.

### Database Schema Changes
Use Prisma migrations: `npx prisma migrate dev --name your_change_name`

---

**Setup time: 15-30 minutes**

Your JustDeviceCount installation is ready to collect patron data from your CMX infrastructure!
