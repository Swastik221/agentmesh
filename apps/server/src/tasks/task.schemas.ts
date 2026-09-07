import { z } from 'zod';
import { TaskStatus, TaskPriority } from '@prisma/client';

export const taskStatusEnum = z.nativeEnum(TaskStatus);
export const taskPriorityEnum = z.nativeEnum(TaskPriority);

export const createTaskSchema = z.object({
  title: z
    .string()
    .transform((val) => val.trim())
    .refine((val) => val.length >= 1 && val.length <= 200, {
      message: 'Title must be between 1 and 200 characters',
    }),
  description: z
    .string()
    .transform((val) => val.trim())
    .refine((val) => val.length >= 1 && val.length <= 10000, {
      message: 'Description must be between 1 and 10000 characters',
    }),
  priority: taskPriorityEnum.optional().default(TaskPriority.MEDIUM),
  filePaths: z.array(z.string()).optional(),
});

export const updateTaskSchema = z
  .object({
    title: z
      .string()
      .transform((val) => val.trim())
      .refine((val) => val.length >= 1 && val.length <= 200, {
        message: 'Title must be between 1 and 200 characters',
      })
      .optional(),
    description: z
      .string()
      .transform((val) => val.trim())
      .refine((val) => val.length >= 1 && val.length <= 10000, {
        message: 'Description must be between 1 and 10000 characters',
      })
      .optional(),
    status: taskStatusEnum.optional(),
    priority: taskPriorityEnum.optional(),
    filePaths: z.array(z.string()).optional(),
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.description !== undefined ||
      data.status !== undefined ||
      data.priority !== undefined ||
      data.filePaths !== undefined,
    {
      message: 'At least one field must be provided for update',
    },
  );

export const listTasksQuerySchema = z.object({
  status: taskStatusEnum.optional(),
  priority: taskPriorityEnum.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const assignResponsibilitySchema = z.object({
  agentId: z.string().min(1, 'agentId is required'),
  role: z
    .string()
    .transform((val) => val.trim())
    .optional(),
});

export const createDependencySchema = z.object({
  dependsOnTaskId: z.string().min(1, 'dependsOnTaskId is required'),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
export type AssignResponsibilityInput = z.infer<typeof assignResponsibilitySchema>;
export type CreateDependencyInput = z.infer<typeof createDependencySchema>;
