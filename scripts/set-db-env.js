import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  projectRoot,
  redactDatabaseUrl,
  resolveDatabaseConfig,
  resolveMigrateDatabaseUrl,
  schemaPathFor,
} from '../src/db/config.js';

const config = resolveDatabaseConfig();
const prismaArgs = process.argv.slice(2);
const schemaArg = schemaPathFor(config.provider);
const databaseUrl = resolveMigrateDatabaseUrl(config.url);

if (prismaArgs.length === 0) {
  console.error('Usage: node scripts/set-db-env.js <prisma-command...>');
  process.exit(1);
}

const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  CI: '1',
};

console.log(`Using ${config.provider} → ${redactDatabaseUrl(databaseUrl)}`);
console.log(`Schema: ${schemaArg}`);

const prismaCli = path.join(projectRoot, 'node_modules', 'prisma', 'build', 'index.js');

const result = spawnSync(process.execPath, [prismaCli, ...prismaArgs, '--schema', schemaArg], {
  stdio: 'inherit',
  env,
  cwd: projectRoot,
});

process.exit(result.status ?? 1);
