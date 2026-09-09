import { z } from 'zod';
import { PolicyDecision } from '@prisma/client';

export const createPolicySchema = z
  .object({
    name: z.string().trim().min(1, 'Policy name is required').max(100, 'Name is too long'),
    description: z.string().trim().max(500, 'Description is too long').optional().nullable(),
    action: z.string().trim().min(1, 'Action is required').max(100, 'Action is too long'),
    decision: z.nativeEnum(PolicyDecision, {
      errorMap: () => ({ message: 'Decision must be ALLOW, APPROVAL_REQUIRED, or DENY' }),
    }),
    enabled: z.boolean().optional().default(true),
  })
  .strip();

export const updatePolicySchema = z
  .object({
    name: z.string().trim().min(1, 'Policy name cannot be empty').max(100, 'Name is too long').optional(),
    description: z.string().trim().max(500, 'Description is too long').optional().nullable(),
    action: z.string().trim().min(1, 'Action cannot be empty').max(100, 'Action is too long').optional(),
    decision: z
      .nativeEnum(PolicyDecision, {
        errorMap: () => ({ message: 'Decision must be ALLOW, APPROVAL_REQUIRED, or DENY' }),
      })
      .optional(),
    enabled: z.boolean().optional(),
  })
  .strip()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

export type CreatePolicyInput = z.infer<typeof createPolicySchema>;
export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>;
