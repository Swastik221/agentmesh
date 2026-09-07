import { z } from 'zod';
import { ExecutionStatus } from '@prisma/client';

export const executionStatusEnum = z.nativeEnum(ExecutionStatus);

export const createTaskExecutionSchema = z.object({
  agentId: z.string().min(1, 'agentId is required'),
  input: z.record(z.unknown()).optional().nullable(),
});

export const listExecutionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateTaskExecutionInput = z.infer<typeof createTaskExecutionSchema>;
export type ListExecutionsQuery = z.infer<typeof listExecutionsQuerySchema>;
