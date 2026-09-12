import { z } from 'zod';
import { ProjectRole } from '@prisma/client';

export const projectRoleEnum = z.nativeEnum(ProjectRole);

export const createInvitationSchema = z.object({
  target: z
    .string()
    .transform((val) => val.trim())
    .refine((val) => val.length >= 3, {
      message: 'Target wallet address or ENS name must be at least 3 characters',
    }),
  role: projectRoleEnum.optional().default(ProjectRole.MEMBER),
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
