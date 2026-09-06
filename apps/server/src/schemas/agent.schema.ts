import { z } from 'zod';
import { AgentStatus } from '@prisma/client';

export const createAgentSchema = z.object({
  ownerId: z.string().trim().min(1, 'Owner ID is required'),
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name is too long'),
  provider: z.string().trim().min(1, 'Provider is required').max(50, 'Provider is too long'),
});

export const updateAgentSchema = z
  .object({
    name: z.string().trim().min(1, 'Name cannot be empty').max(100, 'Name is too long').optional(),
    provider: z
      .string()
      .trim()
      .min(1, 'Provider cannot be empty')
      .max(50, 'Provider is too long')
      .optional(),
    status: z
      .nativeEnum(AgentStatus, {
        errorMap: () => ({ message: 'Status must be OFFLINE, ONLINE, or BUSY' }),
      })
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
