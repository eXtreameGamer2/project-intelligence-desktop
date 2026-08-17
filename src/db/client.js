import { PrismaClient } from '@prisma/client';
import { resolveDatabaseConfig } from './config.js';

const dbConfig = resolveDatabaseConfig();

// Prisma reads DATABASE_URL at client construction time.
process.env.DATABASE_URL = dbConfig.url;

const globalForPrisma = globalThis;

/** @type {PrismaClient | undefined} */
const existingClient = globalForPrisma.__prisma;

export const prisma =
  existingClient ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = prisma;
}

export const databaseMode = dbConfig.mode;
export const databaseProvider = dbConfig.provider;

export async function disconnectDatabase() {
  await prisma.$disconnect();
}

export default prisma;
