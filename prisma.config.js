import { defineConfig } from 'prisma/config';
import { resolveDatabaseConfig, schemaPathFor } from './src/db/config.js';

const db = resolveDatabaseConfig();
process.env.DATABASE_URL = db.url;

export default defineConfig({
  schema: schemaPathFor(db.provider),
  migrations: {
    seed: 'node prisma/seed.js',
  },
});
