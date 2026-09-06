import { z } from 'zod';

export const createUserSchema = z.object({
  walletAddress: z.string().trim().min(1).optional().nullable(),
  displayName: z.string().trim().min(1).optional().nullable(),
});

export const updateUserSchema = z.object({
  displayName: z.string().trim().min(1, 'Display name cannot be empty'),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
