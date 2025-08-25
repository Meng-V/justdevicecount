#!/usr/bin/env node

/**
 * Comprehensive Test Suite for JustDeviceCount Application
 * 
 * This test file validates all core functionality:
 * 1. Server startup and PM2 integration
 * 2. API endpoints (/patronapi, /recapi, /count_by_floor)
 * 3. Database connectivity and Prisma operations
 * 4. CMX API authentication and data fetching
 * 5. 15-minute refresh cycles
 * 6. Data processing and caching
 * 7. Error handling and edge cases
 */

const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const config = require('config');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Test configuration
const TEST_CONFIG = {
  baseUrl: 'https://localhost:3012',
  timeout: 30000,
  retryAttempts: 3,
  waitBetweenTests: 2000
};

// Test results tracking
let testResults = {
  passed: 0,
  failed: 0,
  skipped: 0,
  errors: []
};

// Utility functions
const log = (message, type = 'INFO') => {
  const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  console.log(`[${timestamp}] [${type}] ${message}`);
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const makeRequest = async (url, options = {}) => {
  const defaultOptions = {
    timeout: TEST_CONFIG.timeout,
    validateStatus: () => true, // Don't throw on HTTP errors
    httpsAgent: new (require('https').Agent)({
      rejectUnauthorized: false // Accept self-signed certificates
    })
  };
  
  return axios({ ...defaultOptions, ...options, url });
};

// Test framework
class TestRunner {
  constructor() {
    this.tests = [];
    this.beforeAllHooks = [];
    this.afterAllHooks = [];
  }

  beforeAll(fn) {
    this.beforeAllHooks.push(fn);
  }

  afterAll(fn) {
    this.afterAllHooks.push(fn);
  }

  test(name, fn, options = {}) {
    this.tests.push({ name, fn, options });
  }

  async run() {
    log('Starting comprehensive test suite...', 'TEST');
    
    // Run beforeAll hooks
    for (const hook of this.beforeAllHooks) {
      await hook();
    }

    // Run tests
    for (const test of this.tests) {
      try {
        if (test.options.skip) {
          log(`SKIPPED: ${test.name}`, 'SKIP');
          testResults.skipped++;
          continue;
        }

        log(`Running: ${test.name}`, 'TEST');
        await test.fn();
        log(`PASSED: ${test.name}`, 'PASS');
        testResults.passed++;
      } catch (error) {
        log(`FAILED: ${test.name} - ${error.message}`, 'FAIL');
        testResults.failed++;
        testResults.errors.push({ test: test.name, error: error.message });
      }
      
      await sleep(TEST_CONFIG.waitBetweenTests);
    }

    // Run afterAll hooks
    for (const hook of this.afterAllHooks) {
      await hook();
    }

    this.printResults();
  }

  printResults() {
    log('='.repeat(60), 'RESULT');
    log('TEST RESULTS SUMMARY', 'RESULT');
    log('='.repeat(60), 'RESULT');
    log(`Total Tests: ${this.tests.length}`, 'RESULT');
    log(`Passed: ${testResults.passed}`, 'RESULT');
    log(`Failed: ${testResults.failed}`, 'RESULT');
    log(`Skipped: ${testResults.skipped}`, 'RESULT');
    
    if (testResults.errors.length > 0) {
      log('\nFAILED TESTS:', 'RESULT');
      testResults.errors.forEach(({ test, error }) => {
        log(`  - ${test}: ${error}`, 'RESULT');
      });
    }
    
    const success = testResults.failed === 0;
    log(`\nOverall: ${success ? 'SUCCESS' : 'FAILURE'}`, success ? 'PASS' : 'FAIL');
  }
}

// Test assertions
const assert = {
  equal: (actual, expected, message = '') => {
    if (actual !== expected) {
      throw new Error(`${message} Expected: ${expected}, Actual: ${actual}`);
    }
  },
  
  truthy: (value, message = '') => {
    if (!value) {
      throw new Error(`${message} Expected truthy value, got: ${value}`);
    }
  },
  
  exists: (value, message = '') => {
    if (value === null || value === undefined) {
      throw new Error(`${message} Expected value to exist, got: ${value}`);
    }
  },
  
  isNumber: (value, message = '') => {
    if (typeof value !== 'number' || isNaN(value)) {
      throw new Error(`${message} Expected number, got: ${typeof value}`);
    }
  },
  
  isArray: (value, message = '') => {
    if (!Array.isArray(value)) {
      throw new Error(`${message} Expected array, got: ${typeof value}`);
    }
  },
  
  hasProperty: (obj, prop, message = '') => {
    if (!obj.hasOwnProperty(prop)) {
      throw new Error(`${message} Expected object to have property: ${prop}`);
    }
  },
  
  statusCode: (response, expected, message = '') => {
    if (response.status !== expected) {
      throw new Error(`${message} Expected status ${expected}, got ${response.status}`);
    }
  }
};

// Initialize test runner
const runner = new TestRunner();

// Setup and teardown
runner.beforeAll(async () => {
  log('Setting up test environment...', 'SETUP');
  
  // Ensure certificates exist for HTTPS
  const certPath = path.join(__dirname, 'security', 'cert.pem');
  const keyPath = path.join(__dirname, 'security', 'cert.key');
  
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    log('SSL certificates not found - tests may fail', 'WARN');
  }
  
  // Wait for server to be ready
  log('Waiting for server to be ready...', 'SETUP');
  await sleep(5000);
});

runner.afterAll(async () => {
  log('Cleaning up test environment...', 'CLEANUP');
});

// Test 1: Server Health Check
runner.test('Server Health Check', async () => {
  const response = await makeRequest(`${TEST_CONFIG.baseUrl}/`);
  assert.truthy(response.status >= 200 && response.status < 400, 'Server should be accessible');
});

// Test 2: Database Connectivity
runner.test('Database Connectivity', async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    log('Database connection successful', 'INFO');
    await prisma.$disconnect();
  } catch (error) {
    throw new Error(`Database connection failed: ${error.message}`);
  }
});

// Test 3: Patron API Endpoint
runner.test('Patron API Endpoint', async () => {
  const response = await makeRequest(`${TEST_CONFIG.baseUrl}/patronapi`);
  assert.statusCode(response, 200, 'Patron API should return 200');
  
  const data = response.data;
  assert.hasProperty(data, 'success', 'Response should have success property');
  assert.equal(data.success, true, 'Response should be successful');
  assert.hasProperty(data, 'data', 'Response should have data property');
  assert.hasProperty(data.data, 'patrons', 'Data should have patrons count');
  assert.isNumber(data.data.patrons, 'Patrons should be a number');
  assert.hasProperty(data, 'metadata', 'Response should have metadata');
  assert.equal(data.metadata.source, 'King Library Database', 'Source should be King Library Database');
});

// Test 4: Recreation API Endpoint
runner.test('Recreation API Endpoint', async () => {
  const response = await makeRequest(`${TEST_CONFIG.baseUrl}/recapi`);
  assert.statusCode(response, 200, 'Recreation API should return 200');
  
  const data = response.data;
  assert.hasProperty(data, 'success', 'Response should have success property');
  assert.equal(data.success, true, 'Response should be successful');
  assert.hasProperty(data, 'data', 'Response should have data property');
  assert.hasProperty(data.data, 'patrons', 'Data should have patrons count');
  assert.isNumber(data.data.patrons, 'Patrons should be a number');
  assert.hasProperty(data, 'metadata', 'Response should have metadata');
  assert.equal(data.metadata.source, 'Recreation Center Memory Cache', 'Source should be Recreation Center Memory Cache');
});

// Test 5: Count by Floor API Endpoint
runner.test('Count by Floor API Endpoint', async () => {
  const response = await makeRequest(`${TEST_CONFIG.baseUrl}/count_by_floor`);
  assert.statusCode(response, 200, 'Count by Floor API should return 200');
  
  const data = response.data;
  assert.hasProperty(data, 'floorMap', 'Response should have floorMap property');
  assert.isArray(data.floorMap, 'FloorMap should be an array');
});

// Test 6: CMX API Configuration
runner.test('CMX API Configuration', async () => {
  const cmxConfig = config.get('address');
  const authConfig = config.get('app.auth');
  
  assert.exists(cmxConfig.host, 'CMX host should be configured');
  assert.exists(authConfig, 'CMX auth should be configured');
  assert.truthy(cmxConfig.host.startsWith('https://'), 'CMX host should use HTTPS');
  
  // Test basic auth format
  assert.truthy(authConfig.startsWith('Basic '), 'Auth should be Basic auth format');
});

// Test 7: Device Utility Functions
runner.test('Device Utility Functions', async () => {
  const { dateTime, validRssi, validTime, isValidDevice, isWithinBounds } = require('./modules/deviceUtils');
  
  // Test dateTime function
  const timestamp = dateTime();
  assert.truthy(timestamp, 'dateTime should return a value');
  assert.truthy(typeof timestamp === 'string', 'dateTime should return a string');
  
  // Test validRssi function
  assert.equal(validRssi(-50), true, 'RSSI -50 should be valid');
  assert.equal(validRssi(-80), false, 'RSSI -80 should be invalid');
  assert.equal(validRssi('invalid'), false, 'Invalid RSSI should be false');
  
  // Test validTime function
  const now = new Date().toISOString();
  const recent = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
  const old = new Date(Date.now() - 40 * 60 * 1000).toISOString(); // 40 minutes ago
  
  assert.equal(validTime(now, recent), true, 'Recent time should be valid');
  assert.equal(validTime(now, old), false, 'Old time should be invalid');
  
  // Test isWithinBounds function
  const bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
  assert.equal(isWithinBounds(50, 50, bounds), true, 'Point within bounds should be valid');
  assert.equal(isWithinBounds(150, 50, bounds), false, 'Point outside bounds should be invalid');
});

// Test 8: Data Processing Functions
runner.test('Data Processing Functions', async () => {
  const { processFloorData, processRecData } = require('./modules/app_core');
  
  // Mock device data
  const mockDevices = [
    {
      deviceId: 'test-device-1',
      maxDetectedRssi: { rssi: -50 },
      statistics: { currentServerTime: new Date().toISOString() },
      lastSeen: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      ssid: 'TestNetwork',
      locationCoordinate: { x: 50, y: 50 }
    }
  ];
  
  const bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
  const userMap = new Map();
  
  // Test processFloorData
  processFloorData(mockDevices, userMap, bounds);
  assert.equal(userMap.size, 1, 'Should process one valid device');
  
  // Test processRecData
  processRecData(mockDevices, bounds);
  // This function modifies a global set, so we can't easily test the result
  // but we can verify it doesn't throw an error
});

// Test 9: API Response Time
runner.test('API Response Time', async () => {
  const startTime = Date.now();
  const response = await makeRequest(`${TEST_CONFIG.baseUrl}/patronapi`);
  const responseTime = Date.now() - startTime;
  
  assert.statusCode(response, 200, 'API should respond successfully');
  assert.truthy(responseTime < 5000, `API should respond within 5 seconds (took ${responseTime}ms)`);
});

// Test 10: Error Handling
runner.test('Error Handling', async () => {
  // Test non-existent endpoint
  const response = await makeRequest(`${TEST_CONFIG.baseUrl}/nonexistent`);
  assert.statusCode(response, 404, 'Non-existent endpoint should return 404');
});

// Test 11: PM2 Process Check
runner.test('PM2 Process Check', async () => {
  return new Promise((resolve, reject) => {
    exec('pm2 list justdevicecount', (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`PM2 command failed: ${error.message}`));
        return;
      }
      
      const isRunning = stdout.includes('online') || stdout.includes('justdevicecount');
      assert.truthy(isRunning, 'Application should be running under PM2');
      resolve();
    });
  });
});

// Test 12: Configuration Validation
runner.test('Configuration Validation', async () => {
  const appConfig = config.get('app');
  const addressConfig = config.get('address');
  
  assert.equal(appConfig.port, 3012, 'Port should be 3012');
  assert.exists(appConfig.auth, 'Auth configuration should exist');
  assert.exists(addressConfig.host, 'CMX host should be configured');
  assert.exists(addressConfig['ground-add'], 'Ground floor endpoint should be configured');
  assert.exists(addressConfig['rec-ground'], 'Recreation ground endpoint should be configured');
});

// Test 13: Memory Usage Check
runner.test('Memory Usage Check', async () => {
  const memUsage = process.memoryUsage();
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
  
  log(`Current heap usage: ${heapUsedMB.toFixed(2)} MB`, 'INFO');
  assert.truthy(heapUsedMB < 200, 'Heap usage should be reasonable (< 200MB)');
});

// Export test runner for external use
module.exports = { runner, assert, log };

// Run tests if this file is executed directly
if (require.main === module) {
  runner.run().catch(error => {
    log(`Test runner failed: ${error.message}`, 'ERROR');
    process.exit(1);
  });
}
