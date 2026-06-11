// Shared Prisma client singleton.
// Import this module everywhere instead of creating new PrismaClient() instances.
// This ensures a single connection pool is shared across the whole application.

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

module.exports = prisma;
