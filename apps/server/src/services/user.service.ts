import { User } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { CreateUserInput, UpdateUserInput } from '../schemas/user.schema.js';
import { NotFoundError } from '../errors/app-error.js';

export class UserService {
  async createUser(data: CreateUserInput): Promise<User> {
    if (data.walletAddress) {
      const existing = await prisma.user.findUnique({
        where: { walletAddress: data.walletAddress },
      });
      if (existing) {
        if (data.displayName && data.displayName !== existing.displayName) {
          return await prisma.user.update({
            where: { id: existing.id },
            data: { displayName: data.displayName },
          });
        }
        return existing;
      }
    }

    return await prisma.user.create({
      data: {
        walletAddress: data.walletAddress || null,
        displayName: data.displayName || null,
      },
    });
  }

  async areUsersInSameProject(userAId: string, userBId: string): Promise<boolean> {
    if (userAId === userBId) return true;
    const sharedMembership = await prisma.projectMember.findFirst({
      where: {
        userId: userAId,
        project: {
          members: {
            some: {
              userId: userBId,
            },
          },
        },
      },
    });
    return Boolean(sharedMembership);
  }

  async getUserById(id: string): Promise<User> {
    const user = await prisma.user.findUnique({
      where: { id },
    });
    if (!user) {
      throw new NotFoundError(`User with ID '${id}' not found`);
    }
    return user;
  }

  async getUserByWallet(walletAddress: string): Promise<User> {
    const user = await prisma.user.findUnique({
      where: { walletAddress },
    });
    if (!user) {
      throw new NotFoundError(`User with wallet address '${walletAddress}' not found`);
    }
    return user;
  }

  async updateUser(id: string, data: UpdateUserInput): Promise<User> {
    await this.getUserById(id);

    return await prisma.user.update({
      where: { id },
      data: {
        displayName: data.displayName,
      },
    });
  }
}

export const userService = new UserService();
