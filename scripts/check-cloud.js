import 'dotenv/config';
import { resolveDatabaseConfig } from '../src/db/config.js';

const db = resolveDatabaseConfig();
const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY?.trim();
const hasServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
const hasMasterAiKey = Boolean(process.env.OPENAI_API_KEY?.trim());
const supabaseEnabled = Boolean(supabaseUrl && supabaseAnonKey);

console.log('Database:', `${db.provider} (${db.mode})`);
console.log('Supabase Auth:', supabaseEnabled ? 'configured' : 'not configured');
console.log('Supabase URL:', supabaseUrl || '(unset)');
console.log('Service role key:', hasServiceRole ? 'set' : '(unset)');
console.log('Master AI key:', hasMasterAiKey ? 'set' : '(unset)');

if (db.mode === 'cloud' && supabaseEnabled) {
  console.log('\nCloud SaaS wiring looks complete. Restart the API after changing .env.');
  process.exit(0);
}

console.log(`
Local demo mode is active. To wire Supabase cloud:

1. Create a project at https://supabase.com/dashboard
2. Enable Email auth (Authentication → Providers → Email)
3. Copy these values into .env:

   DATABASE_URL=postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true
   SUPABASE_URL=https://[PROJECT_REF].supabase.co
   SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   OPENAI_API_KEY=sk-...   # optional, paid-cloud AI provider

4. Then run:

   npm run db:generate
   npm run db:push
   npm run db:seed
   npm run dev
`);
