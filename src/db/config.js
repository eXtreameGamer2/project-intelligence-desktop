import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

process.env.CPID_DESKTOP = '1';
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const projectRoot = path.resolve(__dirname, '../..');

function sqliteFileUrl(filePath) {
  return `file:${filePath.replace(/\\/g, '/')}`;
}

/**
 * This desktop repo always uses local SQLite. Cloud DATABASE_URL is ignored.
 */
export function resolveDatabaseConfig() {
  const dataDir = process.env.CPID_DATA_DIR
    ? path.resolve(process.env.CPID_DATA_DIR)
    : path.join(projectRoot, 'prisma');
  fs.mkdirSync(dataDir, { recursive: true });
  const sqlitePath = path.join(dataDir, 'desktop.db');

  return {
    provider: 'sqlite',
    url: sqliteFileUrl(sqlitePath),
    mode: 'local',
  };
}

export function schemaPathFor() {
  return 'prisma/schema.prisma';
}

export function resolveMigrateDatabaseUrl(url) {
  return url;
}

export function redactDatabaseUrl(url) {
  return String(url).replace(/:(?:[^:@/]+)@/, ':****@');
}
