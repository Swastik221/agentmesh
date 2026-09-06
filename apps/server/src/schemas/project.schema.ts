import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, 'Project name is required'),
  description: z.string().trim().optional().nullable(),
  ownerId: z.string().trim().min(1, 'Owner ID is required'),
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1, 'Project name cannot be empty').optional(),
  description: z.string().trim().optional().nullable(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
