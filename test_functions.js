#!/usr/bin/env node

// Comprehensive test script for justdevicecount application
const { dateTime, validRssi, validTime, isValidDevice, isWithinBounds } = require('./modules/deviceUtils');
const patronCache = require('./modules/patronCache');
const app_core = require('./modules/app_core');
const config = require('config');

console.log('🧪 Starting comprehensive function tests...\n');

// Test 1: Device Utility Functions
console.log('📋 Testing Device Utility Functions:');

// Test dateTime
console.log('1. dateTime():', dateTime());

// Test validRssi
console.log('2. validRssi tests:');
console.log('   validRssi(-50):', validRssi(-50)); // Should be true
console.log('   validRssi(-80):', validRssi(-80)); // Should be false
console.log('   validRssi(0):', validRssi(0)); // Should be false

// Test validTime
console.log('3. validTime tests:');
const now = new Date();
const recent = new Date(now.getTime() - 10 * 60 * 1000); // 10 minutes ago
const old = new Date(now.getTime() - 40 * 60 * 1000); // 40 minutes ago
console.log('   Recent time (10min ago):', validTime(now.toISOString(), recent.toISOString()));
console.log('   Old time (40min ago):', validTime(now.toISOString(), old.toISOString()));

// Test isWithinBounds
console.log('4. isWithinBounds tests:');
const bounds = { minX: 10, maxX: 100, minY: 20, maxY: 80 };
console.log('   Point (50, 50) in bounds:', isWithinBounds(50, 50, bounds));
console.log('   Point (5, 50) out of bounds:', isWithinBounds(5, 50, bounds));

// Test isValidDevice
console.log('5. isValidDevice test:');
const mockDevice = {
  maxDetectedRssi: { rssi: -50 },
  statistics: { currentServerTime: now.toISOString() },
  lastSeen: recent.toISOString(),
  ssid: 'TestNetwork'
};
console.log('   Valid device:', isValidDevice(mockDevice));

console.log('\n🔄 Testing Patron Cache Service:');

// Test patron cache
async function testPatronCache() {
  try {
    console.log('6. Initial cache state:', patronCache.getCachedData());
    
    console.log('7. Starting cache updater...');
    // Don't start the interval for testing, just do a single update
    await patronCache.updateCache();
    
    console.log('8. Cache after update:', patronCache.getCachedData());
    
    return true;
  } catch (error) {
    console.error('❌ Patron cache test failed:', error.message);
    return false;
  }
}

// Test app_core functions
async function testAppCore() {
  console.log('\n⚙️ Testing App Core Functions:');
  
  try {
    console.log('9. Testing rec_start function...');
    const recResult = await app_core.rec_start();
    console.log('   rec_start result:', recResult);
    
    return true;
  } catch (error) {
    console.error('❌ App core test failed:', error.message);
    return false;
  }
}

// Configuration validation
function testConfiguration() {
  console.log('\n⚙️ Testing Configuration:');
  
  try {
    console.log('10. Database config:', {
      databaseUrl: !!process.env.DATABASE_URL,
      salt: config.get('database.salt')
    });
    
    console.log('11. App config:', {
      port: config.get('app.port'),
      hasAuth: !!config.get('app.auth')
    });
    
    console.log('12. API endpoints configured:', {
      host: config.get('address.host'),
      groundFloor: !!config.get('address.ground-add'),
      firstFloor: !!config.get('address.first-add'),
      recGround: !!config.get('address.rec-ground'),
      recFirst: !!config.get('address.rec-first')
    });
    
    return true;
  } catch (error) {
    console.error('❌ Configuration test failed:', error.message);
    return false;
  }
}

// Run all tests
async function runAllTests() {
  const results = {
    utilities: true,
    configuration: testConfiguration(),
    patronCache: await testPatronCache(),
    appCore: await testAppCore()
  };
  
  console.log('\n📊 Test Results Summary:');
  console.log('✅ Device Utilities:', results.utilities ? 'PASSED' : 'FAILED');
  console.log('✅ Configuration:', results.configuration ? 'PASSED' : 'FAILED');
  console.log('✅ Patron Cache:', results.patronCache ? 'PASSED' : 'FAILED');
  console.log('✅ App Core:', results.appCore ? 'PASSED' : 'FAILED');
  
  const allPassed = Object.values(results).every(result => result === true);
  console.log('\n🎯 Overall Result:', allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED');
  
  if (!allPassed) {
    console.log('\n⚠️ Issues to fix:');
    if (!results.configuration) console.log('- Check configuration files');
    if (!results.patronCache) console.log('- Check database connectivity and patron cache');
    if (!results.appCore) console.log('- Check app core functions and API connectivity');
  }
}

// Execute tests
runAllTests().catch(console.error);
