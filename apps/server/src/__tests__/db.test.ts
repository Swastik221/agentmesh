import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ProjectRole, AgentStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

describe('Prisma Core Models Integration Tests', () => {
  const testWallet = '0x9999999999999999999999999999999999999999';
  let userId: string;
  let projectId: string;

  beforeAll(async () => {
    // Clean up any test artifacts before running tests
    const existingUser = await prisma.user.findUnique({ where: { walletAddress: testWallet } });
    if (existingUser) {
      await prisma.user.delete({ where: { id: existingUser.id } });
    }
  });

  afterAll(async () => {
    // Clean up test user (will cascade delete projects, members, agents as configured)
    if (userId) {
      const userProjects = await prisma.project.findMany({ where: { ownerId: userId } });
      for (const proj of userProjects) {
        await prisma.project.delete({ where: { id: proj.id } });
      }
      await prisma.user.delete({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  describe('User Model', () => {
    it('should create and retrieve a user', async () => {
      const user = await prisma.user.create({
        data: {
          walletAddress: testWallet,
          displayName: 'Test Integration User',
        },
      });

      expect(user.id).toBeDefined();
      expect(user.walletAddress).toBe(testWallet);
      expect(user.displayName).toBe('Test Integration User');
      expect(user.createdAt).toBeInstanceOf(Date);

      userId = user.id;

      const retrieved = await prisma.user.findUnique({
        where: { id: userId },
      });
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(userId);
    });

    it('should enforce unique walletAddress constraint', async () => {
      await expect(
        prisma.user.create({
          data: {
            walletAddress: testWallet,
            displayName: 'Duplicate User',
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('Project Model', () => {
    it('should create a project owned by a user and retrieve with owner relation', async () => {
      const project = await prisma.project.create({
        data: {
          name: 'Integration Test Project',
          description: 'Testing project persistence',
          ownerId: userId,
        },
        include: {
          owner: true,
        },
      });

      expect(project.id).toBeDefined();
      expect(project.name).toBe('Integration Test Project');
      expect(project.ownerId).toBe(userId);
      expect(project.owner.walletAddress).toBe(testWallet);

      projectId = project.id;
    });
  });

  describe('ProjectMember Model', () => {
    it('should add a user to project as member and retrieve membership', async () => {
      const member = await prisma.projectMember.create({
        data: {
          projectId,
          userId,
          role: ProjectRole.OWNER,
        },
        include: {
          project: true,
          user: true,
        },
      });

      expect(member.id).toBeDefined();
      expect(member.projectId).toBe(projectId);
      expect(member.userId).toBe(userId);
      expect(member.role).toBe(ProjectRole.OWNER);
      expect(member.project.name).toBe('Integration Test Project');
      expect(member.user.displayName).toBe('Test Integration User');
    });

    it('should enforce (projectId, userId) composite unique constraint', async () => {
      await expect(
        prisma.projectMember.create({
          data: {
            projectId,
            userId,
            role: ProjectRole.MEMBER,
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('Agent Model', () => {
    it('should create agent with default OFFLINE status and verify relationships', async () => {
      const agent = await prisma.agent.create({
        data: {
          name: 'Test Agent 1',
          provider: 'test-provider',
          projectId,
          ownerId: userId,
        },
        include: {
          project: true,
          owner: true,
        },
      });

      expect(agent.id).toBeDefined();
      expect(agent.name).toBe('Test Agent 1');
      expect(agent.status).toBe(AgentStatus.OFFLINE);
      expect(agent.projectId).toBe(projectId);
      expect(agent.ownerId).toBe(userId);
      expect(agent.project.id).toBe(projectId);
      expect(agent.owner.id).toBe(userId);
    });
  });
});
