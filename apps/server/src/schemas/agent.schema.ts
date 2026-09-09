import { z } from 'zod';
import { AgentStatus } from '@prisma/client';

export const createAgentSchema = z
  .object({
    /**
     * SECURITY: ownerId is ALWAYS overwritten by the server with req.auth.userId.
     * It is present in the schema so CreateAgentInput carries the field, but the
     * controller MUST pass it last in the parse object so req.body cannot override it.
     */
    ownerId: z.string().trim().min(1, 'Owner ID is required'),
    name: z.string().trim().min(1, 'Name is required').max(100, 'Name is too long'),
    provider: z.string().trim().min(1, 'Provider is required').max(50, 'Provider is too long'),
    // Optional ENS name from client — server independently resolves & verifies.
    // ensAddress and ensVerifiedAt are NEVER accepted from the client; Zod strips them.
    ensName: z
      .string()
      .trim()
      .min(1, 'ENS name cannot be empty')
      .max(255, 'ENS name is too long')
      .optional()
      .nullable(),
  })
  .strip(); // silently drop any client-supplied fields not in this schema (e.g. ensAddress, ensVerifiedAt)


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
    // null = explicit removal; string = attach/change; absent = no change
    ensName: z
      .string()
      .trim()
      .min(1, 'ENS name cannot be empty')
      .max(255, 'ENS name is too long')
      .optional()
      .nullable(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
