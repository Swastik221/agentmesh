import { PrismaClient, ProjectRole, AgentStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding development database...');

  // Create or update demo user
  const user = await prisma.user.upsert({
    where: { walletAddress: '0x1111111111111111111111111111111111111111' },
    update: {},
    create: {
      walletAddress: '0x1111111111111111111111111111111111111111',
      displayName: 'Demo Developer',
    },
  });

  // Find or create demo project owned by demo user
  let project = await prisma.project.findFirst({
    where: { ownerId: user.id, name: 'AgentMesh Core' },
  });

  if (!project) {
    project = await prisma.project.create({
      data: {
        name: 'AgentMesh Core',
        description: 'Default development workspace for human and AI collaboration',
        ownerId: user.id,
      },
    });
  }

  // Ensure project member relationship exists
  await prisma.projectMember.upsert({
    where: {
      projectId_userId: {
        projectId: project.id,
        userId: user.id,
      },
    },
    update: {},
    create: {
      projectId: project.id,
      userId: user.id,
      role: ProjectRole.OWNER,
    },
  });

  // Find or create demo agent in demo project
  const agent = await prisma.agent.findFirst({
    where: { projectId: project.id, name: 'Core Assistant' },
  });

  if (!agent) {
    await prisma.agent.create({
      data: {
        name: 'Core Assistant',
        provider: 'mock-provider',
        status: AgentStatus.OFFLINE,
        projectId: project.id,
        ownerId: user.id,
      },
    });
  }

  console.log('Database seeding completed successfully.');
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
