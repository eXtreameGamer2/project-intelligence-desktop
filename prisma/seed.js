import { PrismaClient } from '@prisma/client';
import { resolveDatabaseConfig } from '../src/db/config.js';

async function main() {
  const config = resolveDatabaseConfig();
  process.env.DATABASE_URL = config.url;

  const prisma = new PrismaClient();

  const demoUser = await prisma.user.upsert({
    where: { email: 'desktop@local' },
    update: { tier: 'paid' },
    create: {
      email: 'desktop@local',
      tier: 'paid',
    },
  });

  const existingProject = await prisma.project.findFirst({
    where: { userId: demoUser.id, name: 'Sample Feedback Intake' },
  });

  if (!existingProject) {
    await prisma.project.create({
      data: {
        name: 'Sample Feedback Intake',
        userId: demoUser.id,
      },
    });
  }

  console.log('Seed complete.');
  console.log(`Demo user id: ${demoUser.id}`);
  console.log(`Database: ${config.provider} (${config.mode})`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
