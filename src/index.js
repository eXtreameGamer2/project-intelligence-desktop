import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { prisma, databaseMode, databaseProvider, disconnectDatabase } from './db/client.js';
import { attachAuthUser } from './middleware/auth.js';
import projectRoutes from './routes/projectRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import authRoutes from './routes/authRoutes.js';
import roadmapRoutes from './routes/roadmapRoutes.js';
import overviewRoutes from './routes/overviewRoutes.js';
import { installFrontendStatic } from './static/frontend.js';
import { redactDeep, redactSecrets } from './utils/secrets.js';
import { ensureTrainingSchema } from './utils/aiTraining.js';
import { ensureModelCatalogSchema } from './utils/aiModelCatalog.js';
import { ensureCalendarSchema } from './utils/calendar.js';
import { getAppVersion } from './utils/appVersion.js';

const app = express();

app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));
app.use(attachAuthUser);

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    databaseMode,
    databaseProvider,
    desktop: process.env.CPID_DESKTOP === '1',
    appVersion: getAppVersion(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/overview', overviewRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/roadmap', roadmapRoutes);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found.' });
});

installFrontendStatic(app);

app.use((err, _req, res, _next) => {
  console.error('[server]', redactDeep(err));
  res.status(500).json({ error: redactSecrets(err.message || 'Internal server error.') });
});

async function ensureLocalUser() {
  const existing = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (existing) {
    if (existing.tier !== 'paid') {
      return prisma.user.update({
        where: { id: existing.id },
        data: { tier: 'paid' },
      });
    }
    return existing;
  }

  const user = await prisma.user.create({
    data: {
      email: 'desktop@local',
      tier: 'paid',
    },
  });

  await prisma.project.create({
    data: {
      name: 'Sample Feedback Intake',
      userId: user.id,
    },
  });

  return user;
}

function listenOnLocalhost() {
  const host = process.env.HOST || '127.0.0.1';
  let port = Number(process.env.PORT || 4310);
  const lastPort = port + 10;

  const tryListen = () =>
    new Promise((resolve, reject) => {
      const server = app.listen(port, host, () => {
        process.env.PORT = String(port);
        console.log(`Desktop server listening on http://${host}:${port}`);
        console.log(`Database mode: ${databaseMode} (${databaseProvider})`);
        resolve(server);
      });
      server.on('error', (error) => {
        if (error.code === 'EADDRINUSE' && port < lastPort) {
          port += 1;
          tryListen().then(resolve, reject);
          return;
        }
        reject(error);
      });
    });

  return tryListen();
}

export async function startServer() {
  await ensureLocalUser();
  await ensureTrainingSchema(prisma);
  await ensureModelCatalogSchema(prisma);
  await ensureCalendarSchema(prisma);
  return listenOnLocalhost();
}

if (process.env.CPID_ELECTRON !== '1') {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

process.on('SIGINT', async () => {
  await disconnectDatabase();
  process.exit(0);
});

export default app;
