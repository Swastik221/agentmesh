import { z } from 'zod';

export const verifySiweSchema = z.object({
  message: z.string().trim().min(1, 'SIWE message is required'),
  signature: z.string().trim().min(1, 'Signature is required'),
});

export type VerifySiweInput = z.infer<typeof verifySiweSchema>;
