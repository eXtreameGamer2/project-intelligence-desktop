import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const samplePath = path.join(projectRoot, 'samples', 'sample-feedback.csv');
const baseUrl = process.env.API_BASE || 'http://localhost:3001';

async function readJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || payload.message || `Request failed (${response.status})`);
  }
  return payload;
}

const sample = fs.readFileSync(samplePath);

const bootstrap = await readJson(await fetch(`${baseUrl}/api/auth/bootstrap`));
const userHeaders = {
  'x-user-id': bootstrap.user.id,
  'x-user-tier': bootstrap.user.tier,
  'x-ai-provider': 'localhost',
  'x-ai-base-url': 'http://127.0.0.1:1234/v1',
  'x-ai-model-name': 'llama3',
};

const { projects } = await readJson(
  await fetch(`${baseUrl}/api/projects`, { headers: userHeaders })
);

if (!projects?.length) {
  throw new Error('No projects found. Run npm run db:seed first.');
}

const projectId = projects[0].id;
const form = new FormData();
form.append(
  'file',
  new Blob([sample], { type: 'text/csv' }),
  'sample-feedback.csv'
);

const result = await readJson(
  await fetch(`${baseUrl}/api/projects/${projectId}/reports/upload`, {
    method: 'POST',
    headers: userHeaders,
    body: form,
  })
);

console.log(`Uploaded to project: ${projects[0].name}`);
console.log(`Analysis source: ${result.analysisSource}`);
console.log(`Action items: ${result.stats?.actionItemCount ?? result.actionItems.length}`);
for (const item of result.actionItems) {
  console.log(`  P${item.priority} ${item.title}`);
}
