import { z } from 'zod';

export const createPaymentRequirementSchema = z.object({
  agentId: z.string().cuid().optional(),
  action: z.string().trim().min(1).default('capability.execute'),
  amount: z.string().optional(),
  asset: z.string().optional(),
  network: z.string().optional(),
});

export type CreatePaymentRequirementInput = z.infer<typeof createPaymentRequirementSchema>;
