# JustDeviceCount - Testing Guide

## Overview
This guide provides comprehensive instructions for testing the JustDeviceCount application, including setup, execution, and troubleshooting.

## Prerequisites

### 1. System Requirements
- Node.js (v14 or higher)
- npm or yarn package manager
- PM2 process manager
- PostgreSQL database (or compatible Prisma setup)
- SSL certificates for HTTPS

### 2. Environment Setup
```bash
# Install dependencies
npm install

# Install PM2 globally (if not already installed)
npm install -g pm2

# Ensure database is running and accessible
# Update .env file with correct database connection string
```

### 3. SSL Certificates
Ensure SSL certificates exist in the `security/` directory:
- `security/cert.pem`
- `security/cert.key`

For development, you can generate self-signed certificates:
```bash
mkdir -p security
openssl req -x509 -newkey rsa:4096 -keyout security/cert.key -out security/cert.pem -days 365 -nodes
```

## Starting the Application

### Method 1: Using start.sh (Recommended)
```bash
# Make script executable
chmod +x start.sh

# Start the application
bash start.sh start

# Check status
bash start.sh status

# View logs
bash start.sh logs

# Stop the application
bash start.sh stop

# Restart the application
bash start.sh restart
```

### Method 2: Direct PM2 Commands
```bash
# Start with PM2
pm2 start bin/www --name justdevicecount --watch

# Check status
pm2 status justdevicecount

# View logs
pm2 logs justdevicecount

# Stop
pm2 stop justdevicecount
```

### Method 3: Development Mode
```bash
# Direct node execution (not recommended for production)
node bin/www
```

## Running Tests

### Comprehensive Test Suite
```bash
# Run the full test suite
node test_comprehensive.js

# Run with verbose output
DEBUG=* node test_comprehensive.js
```

### Individual Test Categories

#### 1. Unit Tests
```bash
# Test utility functions
node -e "
const { dateTime, validRssi, validTime, isValidDevice, isWithinBounds } = require('./modules/deviceUtils');
console.log('dateTime():', dateTime());
console.log('validRssi(-50):', validRssi(-50));
console.log('validRssi(-80):', validRssi(-80));
"
```

#### 2. API Endpoint Tests
```bash
# Test Patron API
curl -k https://localhost:3012/patronapi

# Test Recreation API
curl -k https://localhost:3012/recapi

# Test Count by Floor API
curl -k https://localhost:3012/count_by_floor

# Test main index
curl -k https://localhost:3012/
```

#### 3. Database Tests
```bash
# Test database connectivity
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.\$connect()
  .then(() => console.log('Database connected successfully'))
  .catch(err => console.error('Database connection failed:', err))
  .finally(() => prisma.\$disconnect());
"
```

#### 4. Configuration Tests
```bash
# Verify configuration
node -e "
const config = require('config');
console.log('App config:', config.get('app'));
console.log('CMX host:', config.get('address.host'));
"
```

## Test Scenarios

### 1. Basic Functionality Test
1. Start the application: `bash start.sh start`
2. Wait 30 seconds for initialization
3. Access APIs:
   - https://localhost:3012/patronapi
   - https://localhost:3012/recapi
   - https://localhost:3012/count_by_floor
4. Verify JSON responses contain expected data structure

### 2. Data Collection Test
1. Monitor logs: `bash start.sh logs`
2. Wait for 15-minute data collection cycle
3. Verify King data is saved to database
4. Verify Recreation data is cached in memory only
5. Check API responses reflect new data

### 3. Error Handling Test
1. Stop database temporarily
2. Verify application handles database errors gracefully
3. Restart database
4. Verify application recovers automatically

### 4. Performance Test
1. Run multiple concurrent API requests:
```bash
# Test concurrent requests
for i in {1..10}; do
  curl -k https://localhost:3012/patronapi &
done
wait
```

### 5. PM2 Integration Test
1. Start with PM2: `bash start.sh start`
2. Kill the process: `pm2 stop justdevicecount`
3. Verify PM2 restarts the application
4. Check logs for restart events

## Expected API Responses

### Patron API (/patronapi)
```json
{
  "success": true,
  "data": {
    "patrons": 42,
    "timeMap": [...],
    "findMax": [...],
    "lastTen": [...]
  },
  "metadata": {
    "cached": true,
    "cacheAgeMinutes": 5,
    "source": "King Library Database",
    "refreshInterval": "15 minutes"
  }
}
```

### Recreation API (/recapi)
```json
{
  "success": true,
  "data": {
    "timeStamp": "8/24/2025, 3:45:00 PM",
    "patrons": 15
  },
  "metadata": {
    "cached": true,
    "lastUpdated": "8/24/2025, 3:45:00 PM",
    "source": "Recreation Center Memory Cache",
    "refreshInterval": "15 minutes",
    "note": "This data is not stored in database"
  }
}
```

### Count by Floor API (/count_by_floor)
```json
{
  "floorMap": [
    {
      "time": "8/24/2025, 3:45:00 PM",
      "countByFloor": [10, 15, 8, 9]
    }
  ]
}
```

## Troubleshooting

### Common Issues

#### 1. SSL Certificate Errors
```bash
# Generate new self-signed certificates
openssl req -x509 -newkey rsa:4096 -keyout security/cert.key -out security/cert.pem -days 365 -nodes
```

#### 2. Database Connection Issues
- Check `.env` file for correct DATABASE_URL
- Verify PostgreSQL is running
- Run Prisma migrations: `npx prisma migrate dev`

#### 3. Port Already in Use
```bash
# Find process using port 3012
lsof -i :3012

# Kill the process
kill -9 <PID>
```

#### 4. PM2 Issues
```bash
# Reset PM2
pm2 kill
pm2 start bin/www --name justdevicecount

# Clear PM2 logs
pm2 flush
```

#### 5. CMX API Authentication
- Verify `config/default.json` has correct auth credentials
- Test CMX connectivity manually:
```bash
curl -H "Authorization: Basic <auth_string>" https://mualcmxp11.itapps.miamioh.edu/api/location/v3/clients
```

### Log Analysis

#### Application Logs
```bash
# View real-time logs
bash start.sh logs

# View PM2 logs
pm2 logs justdevicecount --lines 100

# View error logs only
pm2 logs justdevicecount --err
```

#### Key Log Messages to Look For
- "HTTPS Server running on port 3012" - Server started
- "Device data collection completed" - Data collection working
- "Cache updated successfully" - Patron cache working
- "Database connected" - Database connectivity OK

## Performance Monitoring

### Memory Usage
```bash
# Check application memory usage
pm2 monit

# Check system memory
free -h
```

### Response Times
```bash
# Test API response times
time curl -k https://localhost:3012/patronapi
```

### Database Performance
```bash
# Check database connections
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
console.time('DB Query');
prisma.deviceData.findFirst()
  .then(() => console.timeEnd('DB Query'))
  .finally(() => prisma.\$disconnect());
"
```

## Continuous Testing

### Automated Testing Schedule
1. Run comprehensive tests after each deployment
2. Monitor API endpoints every 5 minutes
3. Check data collection every 15 minutes
4. Verify database integrity daily

### Health Check Script
```bash
#!/bin/bash
# health_check.sh
curl -k -f https://localhost:3012/patronapi > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "$(date): Health check PASSED"
else
    echo "$(date): Health check FAILED"
    bash start.sh restart
fi
```

## Test Data Validation

### Data Integrity Checks
1. Verify patron counts are reasonable (0-1000)
2. Check timestamps are in NY timezone
3. Ensure floor counts sum to total patrons
4. Validate RSSI values are within expected range (-70 to -1)

### API Contract Testing
1. Verify all required fields are present
2. Check data types match specifications
3. Ensure error responses follow standard format
4. Validate HTTP status codes

## Deployment Testing

### Pre-deployment Checklist
- [ ] All tests pass
- [ ] Configuration files updated
- [ ] SSL certificates valid
- [ ] Database migrations applied
- [ ] PM2 configuration tested

### Post-deployment Verification
- [ ] Server accessible on port 3012
- [ ] All API endpoints responding
- [ ] Data collection working
- [ ] Logs show no errors
- [ ] PM2 monitoring active

## Support and Debugging

### Debug Mode
```bash
# Enable debug logging
DEBUG=* node bin/www

# Enable specific debug categories
DEBUG=express:* node bin/www
```

### Remote Debugging
```bash
# Start with inspect mode
node --inspect bin/www

# Connect with Chrome DevTools or VS Code
```

For additional support, check the application logs and ensure all prerequisites are met.
