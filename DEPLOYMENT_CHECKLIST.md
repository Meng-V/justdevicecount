# Deployment Checklist

## ✅ Server Deployment Verification

### Core Application Files (No PM2 Required)

#### Entry Point
- ✅ **`bin/www`** - Runs directly with Node.js, no PM2 dependency
  - Command: `node bin/www`
  - Used by systemd service

#### Main Application  
- ✅ **`app.js`** - Standard Express app, no PM2 dependency

#### Package Scripts
- ✅ **`npm start`** → `node ./bin/www` (server uses this)
- ⚠️ **`pm2:*` scripts** → Optional, local development only

#### Routes & Modules
- ✅ **`routes/*`** - No PM2 references
- ✅ **`modules/*`** - No PM2 references

---

## 🚀 Server Deployment Process

### 1. On Server (as devicecount user)
```bash
cd /opt/justdevicecount
git pull
npm install --production
npx prisma generate
```

### 2. Restart Service (as yourself or root)
```bash
sudo service crowd-index restart
```

### 3. Verify Service
```bash
sudo service crowd-index status
sudo journalctl -u crowd-index -f
```

---

## 🔧 What the Server Does

The systemd service (`crowd-index`) runs:
```bash
node bin/www
```

**No PM2 involved on the server!**

---

## 💻 Local Development (Optional PM2)

For local development, you CAN use PM2 for convenience:
```bash
./start.sh start     # Uses PM2 for auto-restart
```

But you can also run directly:
```bash
npm start           # Direct Node.js execution
```

---

## 📋 Required Files on Server

### Environment Configuration
- `.env` - Database connection & environment variables
  ```bash
  DATABASE_URL="postgresql://user:pass@host:5432/crowd_index"
  NODE_ENV=production
  PROD_CERT_PATH="security/cert.pem"
  PROD_KEY_PATH="security/cert.key"
  ```

### SSL Certificates
- `security/cert.pem` - SSL certificate
- `security/cert.key` - SSL private key

### CMX Configuration
- `config/default.json` - CMX API settings (building/floor maps)

---

## ⚠️ Files NOT Needed on Server

These files are for local development only:
- ❌ `start.sh` - Local PM2 script
- ❌ `ecosystem.config.js` - Local PM2 config
- ❌ `start-dist.sh` - Old dist build script
- ❌ `ecosystem.dist.config.js` - Old dist config
- ❌ `webpack.config.js` - Old build config
- ❌ `dist/` folder - No longer used

---

## 🔍 Verification Commands

### Check Application is Running
```bash
# Check service status
sudo service crowd-index status

# Check process
ps aux | grep "node bin/www"

# Check port
sudo lsof -i :3012

# View logs
sudo journalctl -u crowd-index -n 50
```

### Test Application
```bash
# Test API (replace with your server hostname)
curl -k https://your-server:3012/crowdindex/patronapi

# Or visit in browser
https://your-server:3012/crowdindex/
```

---

## 🚨 Common Issues

### Issue: Service won't start
**Check:**
```bash
# View detailed error logs
sudo journalctl -u crowd-index -xe

# Common problems:
# 1. Missing .env file
# 2. Wrong database credentials
# 3. Missing SSL certificates
# 4. Port 3012 already in use
```

### Issue: Database connection error
**Fix:**
```bash
# Verify database connection in .env
cat .env | grep DATABASE_URL

# Test database connection
npx prisma db pull
```

### Issue: SSL certificate error
**Fix:**
```bash
# Check certificates exist
ls -la security/

# Verify .env has correct paths
cat .env | grep CERT
```

---

## ✅ Final Checklist Before Deployment

- [ ] `.env` file configured with correct DATABASE_URL
- [ ] SSL certificates in `security/` folder
- [ ] `config/default.json` configured with CMX settings
- [ ] Database initialized: `npx prisma db push`
- [ ] Prisma client generated: `npx prisma generate`
- [ ] Production dependencies installed: `npm install --production`
- [ ] Service restarted: `sudo service crowd-index restart`
- [ ] Service running: `sudo service crowd-index status`
- [ ] Application accessible: `https://your-server:3012/crowdindex/`

---

**Server Deployment Documentation**: See [SERVER_DEPLOYMENT.md](SERVER_DEPLOYMENT.md)  
**Local Development Guide**: See [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)
