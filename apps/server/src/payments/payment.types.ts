import { PaymentStatus } from '@prisma/client';

export interface X402PaymentRequirement {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  receiver: string;
  paymentReference: string;
}

export interface X402PaymentPayload {
  scheme?: string;
  network?: string;
  asset?: string;
  amount?: string;
  payerAddress?: string;
  receiverAddress?: string;
  paymentReference?: string;
  signedTransaction?: string;
  proof?: string;
  [key: string]: unknown;
}

export interface X402VerificationResult {
  valid: boolean;
  paymentReference?: string;
  transactionReference?: string;
  payerAddress?: string;
  receiverAddress?: string;
  amount?: string;
  asset?: string;
  network?: string;
  error?: string;
}

export interface CreatePaymentRequirementParams {
  projectId: string;
  requesterUserId: string;
  agentId?: string;
  action: string;
  amount?: string;
  asset?: string;
  network?: string;
}

export interface PaymentRecordDTO {
  id: string;
  projectId: string;
  requesterUserId: string;
  agentId: string | null;
  action: string;
  amount: string;
  asset: string;
  network: string;
  payerAddress: string | null;
  receiverAddress: string;
  status: PaymentStatus;
  x402PaymentReference: string | null;
  transactionReference: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  settledAt: Date | null;
}
