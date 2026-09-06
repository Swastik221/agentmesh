import { z } from 'zod';
import { ProjectRole } from '@prisma/client';

export const addMemberSchema = z.object({
  userId: z.string().trim().min(1, 'User ID is required'),
  role: z.nativeEnum(ProjectRole).optional().default(ProjectRole.MEMBER),
});

export const updateMemberRoleSchema = z.object({
  role: z.nativeEnum(ProjectRole, {
    errorMap: () => ({ message: 'Role must be either OWNER or MEMBER' }),
  }),
});

export type AddMemberInput = z.infer<typeof addMemberSchema>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
