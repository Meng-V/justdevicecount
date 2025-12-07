/**
 * Prisma Client wrapper for CommonJS projects using Prisma v7
 * Prisma v7 generates TypeScript, so we use tsx to load it
 */

// Load tsx to handle TypeScript imports
require('tsx/cjs');

// Now we can require the TypeScript file
const { PrismaClient } = require('../generated/prisma/client.ts');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

// Parse and modify the DATABASE_URL to handle self-signed certificates
// Remove sslmode from URL and set it explicitly in config
const databaseUrl = process.env.DATABASE_URL.replace(/[?&]sslmode=\w+/, '');

// Create pg Pool with SSL configuration for self-signed certificates
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: {
    rejectUnauthorized: false // Accept self-signed certificates
  }
});

// Create PostgreSQL adapter using the configured pool
const adapter = new PrismaPg(pool);

// Create and export Prisma Client instance with adapter
const prisma = new PrismaClient({ adapter });

module.exports = prisma;
