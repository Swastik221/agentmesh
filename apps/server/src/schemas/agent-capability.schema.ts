import { z } from 'zod';

export const CAPABILITY_REGEX = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

export function normalizeCapability(capability: string): string {
  return capability.trim().toLowerCase();
}

export const addCapabilitySchema = z.object({
  capability: z
    .string()
    .transform((val) => normalizeCapability(val))
    .pipe(
      z
        .string()
        .min(2, 'Capability must be at least 2 characters long')
        .max(50, 'Capability cannot exceed 50 characters')
        .regex(
          CAPABILITY_REGEX,
          'Capability must contain only lowercase alphanumeric characters, hyphens, or underscores',
        ),
    ),
});

export type AddCapabilityInput = z.infer<typeof addCapabilitySchema>;
