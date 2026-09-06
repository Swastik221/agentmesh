import { z } from 'zod';
import { ProjectBrainEntryType } from '@prisma/client';

export const projectBrainEntryTypeEnum = z.nativeEnum(ProjectBrainEntryType);

export const createProjectBrainEntrySchema = z.object({
  type: projectBrainEntryTypeEnum,
  title: z
    .string()
    .transform((val) => val.trim())
    .refine((val) => val.length >= 1 && val.length <= 200, {
      message: 'Title must be between 1 and 200 characters',
    }),
  content: z
    .string()
    .transform((val) => val.trim())
    .refine((val) => val.length >= 1 && val.length <= 10000, {
      message: 'Content must be between 1 and 10000 characters',
    }),
  tags: z
    .array(
      z
        .string()
        .transform((val) => val.trim())
        .refine((val) => val.length >= 1, {
          message: 'Tag cannot be empty',
        }),
    )
    .optional()
    .default([]),
});

export const updateProjectBrainEntrySchema = z
  .object({
    type: projectBrainEntryTypeEnum.optional(),
    title: z
      .string()
      .transform((val) => val.trim())
      .refine((val) => val.length >= 1 && val.length <= 200, {
        message: 'Title must be between 1 and 200 characters',
      })
      .optional(),
    content: z
      .string()
      .transform((val) => val.trim())
      .refine((val) => val.length >= 1 && val.length <= 10000, {
        message: 'Content must be between 1 and 10000 characters',
      })
      .optional(),
    tags: z
      .array(
        z
          .string()
          .transform((val) => val.trim())
          .refine((val) => val.length >= 1, {
            message: 'Tag cannot be empty',
          }),
      )
      .optional(),
  })
  .refine(
    (data) =>
      data.type !== undefined ||
      data.title !== undefined ||
      data.content !== undefined ||
      data.tags !== undefined,
    {
      message: 'At least one field must be provided for update',
    },
  );

export const listProjectBrainEntriesQuerySchema = z.object({
  type: projectBrainEntryTypeEnum.optional(),
  tag: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateProjectBrainEntryInput = z.infer<typeof createProjectBrainEntrySchema>;
export type UpdateProjectBrainEntryInput = z.infer<typeof updateProjectBrainEntrySchema>;
export type ListProjectBrainEntriesQuery = z.infer<typeof listProjectBrainEntriesQuerySchema>;
