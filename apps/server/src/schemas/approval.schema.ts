import { z } from 'zod';
import { ApprovalStatus } from '@prisma/client';

export const createApprovalRequestSchema = z
  .object({
    projectId: z.string().trim().min(1, 'Project ID is required'),
    action: z.string().trim().min(1, 'Action is required'),
    policyId: z.string().trim().optional().nullable(),
    agentId: z.string().trim().optional().nullable(),
    reason: z.string().trim().max(500, 'Reason is too long').optional().nullable(),
    metadata: z.record(z.unknown()).optional().nullable(),
  })
  .strip();

export const resolveApprovalSchema = z
  .object({
    reason: z.string().trim().max(500, 'Reason is too long').optional().nullable(),
  })
  .strip();

export const listApprovalsQuerySchema = z.object({
  projectId: z.string().trim().optional(),
  status: z.nativeEnum(ApprovalStatus).optional(),
  page: z.coerce.number().min(1).default(1).optional(),
  limit: z.coerce.number().min(1).max(100).default(20).optional(),
});

export type CreateApprovalRequestInput = z.infer<typeof createApprovalRequestSchema>;
export type ResolveApprovalInput = z.infer<typeof resolveApprovalSchema>;
export type ListApprovalsQuery = z.infer<typeof listApprovalsQuerySchema>;
