import { User } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { CreateUserInput, UpdateUserInput } from '../schemas/user.schema.js';
import { ConflictError, NotFoundError } from '../errors/app-error.js';

export class UserService {
  async createUser(data: CreateUserInput): Promise<User> {
    if (data.walletAddress) {
      const existing = await prisma.user.findUnique({
        where: { walletAddress: data.walletAddress },
      });
      if (existing) {
        throw new ConflictError('A user with this wallet address already exists');
      }
    }

    return await prisma.user.create({
      data: {
        walletAddress: data.walletAddress || null,
        displayName: data.displayName || null,
      },
    });
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
