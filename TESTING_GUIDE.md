# JustDeviceCount - Comprehensive Testing Guide

## 🧪 Testing Overview

This guide provides detailed testing procedures for peer-institution developers to validate their JustDeviceCount installation and ensure reliable operation.

## 🚀 Quick Test Suite

### Automated Testing
```bash
# Run complete test suite
npm test

# Run with verbose debugging
DEBUG=* npm test

# Test specific components
node test_comprehensive.js
```

### Manual Verification Tests
```bash
# 1. Server Health Check
curl -k https://localhost:3012/
# Expected: HTML dashboard response

# 2. API Endpoint Tests
curl -k https://localhost:3012/patronapi
curl -k https://localhost:3012/recapi  
curl -k https://localhost:3012/count_by_floor
# Expected: Valid JSON responses

# 3. Database Connection Test
npx prisma studio
# Expected: Database browser opens successfully
```

## 📋 Detailed Testing Checklist

### Infrastructure Tests
- [ ] **Node.js Version**: `node --version` (>= 18.x)
- [ ] **npm Version**: `npm --version` (>= 8.x)
- [ ] **PostgreSQL**: Database accessible and responsive
- [ ] **SSL Certificates**: Valid and properly configured
- [ ] **Port Availability**: Port 3012 available or configured alternative

### Configuration Tests
- [ ] **Environment Variables**: `.env` file properly configured
- [ ] **CMX Configuration**: `config/default.json` with valid Floor IDs
- [ ] **Database Schema**: Prisma migrations applied successfully
- [ ] **SSL Setup**: Certificates in `security/` directory

### Application Startup Tests
```bash
# Test 1: Standard startup
npm start
# Expected: "HTTPS Server running on port 3012"

# Test 2: PM2 startup
npm run pm2:start
pm2 status
# Expected: Process running with status "online"

# Test 3: Production startup
npm run pm2:start:prod
# Expected: Production environment variables loaded
```

### API Functionality Tests

#### Patron API (`/patronapi`)
```bash
curl -k -H "Accept: application/json" https://localhost:3012/patronapi
```
**Expected Response Structure:**
```json
{
  "success": true,
  "data": {
    "patrons": <number>,
    "timeMap": [array],
    "findMax": {object},
    "lastTen": [array]
  },
  "metadata": {
    "cached": <boolean>,
    "cacheAgeMinutes": <number>,
    "source": "King Library Database",
    "refreshInterval": "15 minutes"
  }
}
```

#### Recreation API (`/recapi`)
```bash
curl -k -H "Accept: application/json" https://localhost:3012/recapi
```
**Expected Response Structure:**
```json
{
  "success": true,
  "data": {
    "timeStamp": "<timestamp>",
    "patrons": <number>
  },
  "metadata": {
    "cached": true,
    "lastUpdated": "<timestamp>",
    "source": "Recreation Center Memory Cache",
    "refreshInterval": "15 minutes"
  }
}
```

#### Count by Floor API (`/count_by_floor`)
```bash
curl -k -H "Accept: application/json" https://localhost:3012/count_by_floor
```
**Expected Response Structure:**
```json
{
  "floorMap": [
    {
      "time": "<timestamp>",
      "countByFloor": [<ground>, <first>, <second>, <third>]
    }
  ]
}
```

### Data Collection Tests

#### CMX API Connectivity
```bash
# Test your CMX server connection
curl -H "Authorization: Basic YOUR_BASE64_CREDENTIALS" \
     "https://your-cmx-server.edu/api/location/v3/clients?floorId=YOUR_FLOOR_ID"
```
**Expected**: JSON response with device data

#### Data Processing Validation
```bash
# Monitor data collection in logs
pm2 logs justdevicecount --lines 50

# Look for these log messages:
# "Starting device data collection cycle"
# "Device data collection completed"
# "Cache updated successfully"
```

### Performance Tests

#### Response Time Test
```bash
# Test API response times
time curl -k https://localhost:3012/patronapi
# Expected: < 100ms for cached responses

# Load test with multiple concurrent requests
for i in {1..10}; do
  curl -k https://localhost:3012/patronapi &
done
wait
```

#### Memory Usage Test
```bash
# Monitor memory usage
pm2 monit
# Expected: ~100MB baseline, < 500MB maximum

# Check for memory leaks over time
watch -n 60 'pm2 show justdevicecount | grep memory'
```

#### Database Performance Test
```bash
# Test database query performance
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
console.time('DB Query');
prisma.deviceData.findMany({ take: 10 })
  .then(() => console.timeEnd('DB Query'))
  .finally(() => prisma.\$disconnect());
"
# Expected: < 50ms for typical queries
```

### Security Tests

#### HTTPS Configuration Test
```bash
# Test SSL certificate
openssl s_client -connect localhost:3012 -servername localhost
# Expected: Certificate chain validation

# Test HTTPS enforcement
curl http://localhost:3012/
# Expected: Connection refused or redirect to HTTPS
```

#### Authentication Test
```bash
# Test CMX API authentication
curl -H "Authorization: Basic INVALID_CREDENTIALS" \
     "https://your-cmx-server.edu/api/location/v3/clients"
# Expected: 401 Unauthorized
```

### Error Handling Tests

#### Database Disconnection Test
```bash
# Temporarily stop database
sudo systemctl stop postgresql
# Monitor application logs for graceful error handling
pm2 logs justdevicecount

# Restart database
sudo systemctl start postgresql
# Verify application recovers automatically
```

#### Invalid Configuration Test
```bash
# Test with invalid CMX credentials
# Temporarily modify config/default.json with wrong auth
# Expected: Graceful error handling, no crashes
```

## 🔍 Troubleshooting Test Failures

### Common Test Failures

#### "Connection Refused" Errors
```bash
# Check if application is running
pm2 status justdevicecount

# Check port availability
lsof -i :3012

# Verify SSL certificates
ls -la security/cert.*
```

#### "Database Connection Failed"
```bash
# Test database connectivity
psql $DATABASE_URL -c "SELECT 1;"

# Check Prisma client
npx prisma db pull

# Verify migrations
npx prisma migrate status
```

#### "CMX API Timeout"
```bash
# Test CMX server accessibility
ping your-cmx-server.edu

# Test API endpoint manually
curl -v -H "Authorization: Basic YOUR_CREDENTIALS" \
     "https://your-cmx-server.edu/api/location/v3/clients"
```

#### "SSL Certificate Invalid"
```bash
# Check certificate validity
openssl x509 -in security/cert.pem -text -noout

# Regenerate if needed
openssl req -x509 -newkey rsa:4096 -keyout security/cert.key -out security/cert.pem -days 365 -nodes
```

### Performance Issues

#### Slow API Responses
- Check database query performance
- Verify cache is working properly
- Monitor system resources (CPU, memory)
- Check network latency to CMX server

#### High Memory Usage
- Monitor for memory leaks with `pm2 monit`
- Check cache size and cleanup
- Verify PM2 memory restart threshold (500MB)

## 📊 Test Results Documentation

### Test Report Template
```
JustDeviceCount Test Results
Date: ___________
Tester: ___________

Infrastructure Tests:
[ ] Node.js version compatible
[ ] Database accessible
[ ] SSL certificates valid
[ ] Port configuration correct

Application Tests:
[ ] Server starts successfully
[ ] All API endpoints respond
[ ] Data collection working
[ ] PM2 management functional

Performance Tests:
[ ] Response times acceptable (< 100ms)
[ ] Memory usage normal (< 500MB)
[ ] No memory leaks detected
[ ] Database queries optimized

Security Tests:
[ ] HTTPS enforced
[ ] Authentication working
[ ] Error handling secure
[ ] No sensitive data exposed

Issues Found:
_________________________________
_________________________________

Resolution Steps:
_________________________________
_________________________________
```

## 🎯 Continuous Testing

### Automated Health Checks
```bash
# Create health check script
cat > health_check.sh << 'EOF'
#!/bin/bash
echo "$(date): Starting health check"

# Test API endpoints
if curl -k -f https://localhost:3012/patronapi > /dev/null 2>&1; then
    echo "$(date): Patron API - OK"
else
    echo "$(date): Patron API - FAILED"
fi

if curl -k -f https://localhost:3012/recapi > /dev/null 2>&1; then
    echo "$(date): Recreation API - OK"  
else
    echo "$(date): Recreation API - FAILED"
fi

# Check PM2 status
if pm2 describe justdevicecount | grep -q "online"; then
    echo "$(date): PM2 Process - OK"
else
    echo "$(date): PM2 Process - FAILED"
fi

echo "$(date): Health check completed"
EOF

chmod +x health_check.sh
```

### Scheduled Testing
```bash
# Add to crontab for regular testing
# Run health check every 5 minutes
*/5 * * * * /path/to/justdevicecount/health_check.sh >> /var/log/justdevicecount_health.log

# Run full test suite daily
0 2 * * * cd /path/to/justdevicecount && npm test >> /var/log/justdevicecount_tests.log
```

## 📞 Support & Next Steps

### When Tests Pass
- Document your configuration for future reference
- Set up monitoring and alerting
- Schedule regular maintenance windows
- Plan for scaling if needed

### When Tests Fail
1. Review error messages carefully
2. Check the troubleshooting section
3. Verify all configuration files
4. Test individual components in isolation
5. Check GitHub Issues for similar problems

### Performance Optimization
- Monitor API response times over time
- Optimize database queries if needed
- Adjust cache settings for your usage patterns
- Consider load balancing for high traffic

**Testing Complete! 🎉**

A properly tested JustDeviceCount installation should provide reliable, real-time patron counting data for your institution.
