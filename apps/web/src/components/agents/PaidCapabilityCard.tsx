import { useState } from 'react';
import { Bot, CheckCircle2, AlertCircle, CreditCard, ExternalLink, Key } from 'lucide-react';
import { envConfig } from '../../config/env';

export interface PaidCapabilityCardProps {
  agentId: string;
  agentName: string;
  ensName?: string | null;
  capability: string;
  priceUsdc?: string;
  network?: string;
  onExecuteSuccess?: (result: unknown) => void;
}

export type PaymentState =
  | 'IDLE'
  | 'REQUIREMENT_RECEIVED'
  | 'WALLET_SIGNING_REQUIRED'
  | 'SUBMITTING'
  | 'VERIFYING'
  | 'SETTLED'
  | 'COMPLETED_WITHOUT_PAYMENT'
  | 'FAILED';

interface WireRequirement {
  scheme?: string;
  network?: string;
  asset?: string;
  amount?: string;
  payTo?: string;
  maxTimeoutSeconds?: number;
  extra?: { feePayer?: string; paymentReference?: string };
}

/** Decodes an x402 base64 JSON header. Returns null if it is not one. */
export function decodePaymentRequired(header: string): { accepts?: WireRequirement[] } | null {
  try {
    const bytes = Uint8Array.from(atob(header), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as { accepts?: WireRequirement[] };
  } catch {
    return null;
  }
}

/** USDC has 6 decimals on Hedera. */
const formatUsdc = (atomic?: string) => (atomic && /^\d+$/.test(atomic) ? `${(Number(atomic) / 1e6).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')} USDC` : atomic ?? '—');

export function PaidCapabilityCard({
  agentId,
  agentName,
  ensName,
  capability,
  priceUsdc = '$0.001 USDC',
  network = 'Hedera Testnet',
  onExecuteSuccess,
}: PaidCapabilityCardProps) {
  const [paymentState, setPaymentState] = useState<PaymentState>('IDLE');
  const [txRef, setTxRef] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultData, setResultData] = useState<unknown | null>(null);
  const [requirementObj, setRequirementObj] = useState<WireRequirement | null>(null);
  const [paymentReference, setPaymentReference] = useState<string | null>(null);

  const handleExecute = async () => {
    try {
      setPaymentState('REQUIREMENT_RECEIVED');
      setErrorMsg(null);

      // Step 1: Initial request without payment header to trigger HTTP 402.
      // Real path, confirmed directly against app.ts: agentCapabilityRouter
      // is mounted at root, not under /api or /projects/:id, and requires
      // the real SIWE session cookie (requireAuth), not just the right URL.
      const base = envConfig.apiUrl.replace(/\/$/, '');
      const initialRes = await fetch(
        `${base}/agents/${encodeURIComponent(agentId)}/capabilities/${encodeURIComponent(capability)}/execute`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action: 'capability.execute' }),
        },
      );

      if (initialRes.status === 402) {
        // The x402 header is base64-encoded JSON (PAYMENT-REQUIRED in x402 v2;
        // X-Payment-Requirement is the legacy name). The JSON body carries the
        // same requirement as a fallback.
        const body = await initialRes.json().catch(() => ({}));
        const header = initialRes.headers.get('PAYMENT-REQUIRED') ?? initialRes.headers.get('X-Payment-Requirement');
        const decoded = header ? decodePaymentRequired(header) : null;
        setRequirementObj(decoded?.accepts?.[0] ?? body.paymentRequirement ?? null);
        setPaymentReference(body.paymentRequirement?.paymentReference ?? decoded?.accepts?.[0]?.extra?.paymentReference ?? null);
        setPaymentState('WALLET_SIGNING_REQUIRED');
      } else if (initialRes.ok) {
        const data = await initialRes.json();
        // Only a payment the server reports as SETTLED counts as paid.
        setPaymentState(data.payment?.status === 'SETTLED' ? 'SETTLED' : 'COMPLETED_WITHOUT_PAYMENT');
        setResultData(data.result);
        if (data.payment?.transactionReference) {
          setTxRef(data.payment.transactionReference);
        }
        if (onExecuteSuccess) {
          onExecuteSuccess(data.result);
        }
      } else {
        const errJson = await initialRes.json();
        throw new Error(errJson.message || errJson.error || `HTTP ${initialRes.status}`);
      }
    } catch (err: unknown) {
      setPaymentState('FAILED');
      setErrorMsg(err instanceof Error ? err.message : 'Execution failed');
    }
  };

  return (
    <article className="paid-capability-card p-4 rounded-xl border border-gray-800 bg-gray-900/60 shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-indigo-400" />
          <span className="font-semibold text-gray-100">{ensName || agentName}</span>
        </div>
        <span className="text-xs font-mono px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
          {network}
        </span>
      </div>

      <div className="mb-4">
        <h4 className="text-sm font-medium text-gray-200">{capability}</h4>
        <div className="flex items-center gap-1.5 mt-1 text-xs text-emerald-400 font-mono">
          <CreditCard className="w-3.5 h-3.5" />
          <span>{priceUsdc}</span>
        </div>
      </div>

      {/* Requirement State */}
      {paymentState === 'WALLET_SIGNING_REQUIRED' && (
        <div className="mb-3 p-3 rounded bg-amber-950/40 border border-amber-800/60 text-xs text-amber-300">
          <div className="flex items-center gap-1.5 font-medium mb-1">
            <Key className="w-4 h-4 text-amber-400" />
            <span>Payment required (HTTP 402). Nothing has been charged.</span>
          </div>
          {requirementObj ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono text-[10px] mb-2">
              <dt>Amount</dt><dd>{formatUsdc(requirementObj.amount)}</dd>
              <dt>Network</dt><dd>{requirementObj.network}</dd>
              <dt>Pay to</dt><dd>{requirementObj.payTo}</dd>
              <dt>Fee payer</dt><dd>{requirementObj.extra?.feePayer ?? '—'}</dd>
              <dt>Valid for</dt><dd>{requirementObj.maxTimeoutSeconds ?? '—'}s</dd>
              {paymentReference && (<><dt>Reference</dt><dd className="break-all">{paymentReference}</dd></>)}
            </dl>
          ) : (
            <p className="text-[11px] mb-2">The server asked for payment but its requirement could not be read.</p>
          )}
          <p className="text-[11px] text-amber-400/80">
            Paying needs a Hedera wallet that signs an x402 payment for exactly these terms, sent back with this reference.
            Signing inside this page is not available yet; use an x402-capable Hedera client.
          </p>
        </div>
      )}

      {paymentState === 'COMPLETED_WITHOUT_PAYMENT' && (
        <div className="mb-3 p-2.5 rounded bg-emerald-950/40 border border-emerald-800/60 text-xs text-emerald-300">
          <CheckCircle2 className="w-4 h-4 inline mr-1" /> Completed. No payment was taken.
        </div>
      )}

      {/* Settlement State */}
      {paymentState === 'SETTLED' && (
        <div className="mb-3 p-2.5 rounded bg-emerald-950/40 border border-emerald-800/60 text-xs text-emerald-300">
          <div className="flex items-center gap-1.5 font-medium mb-1">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>✓ Payment Settled on Hedera Testnet</span>
          </div>
          {txRef && (
            <div className="flex items-center gap-1 font-mono text-[11px] text-emerald-400/80">
              <span>Tx: {txRef}</span>
              <a
                href={`https://hashscan.io/testnet/transaction/${txRef}`}
                target="_blank"
                rel="noreferrer"
                className="hover:underline inline-flex items-center"
              >
                <ExternalLink className="w-3 h-3 ml-0.5" />
              </a>
            </div>
          )}
        </div>
      )}

      {paymentState === 'FAILED' && (
        <div className="mb-3 p-2.5 rounded bg-red-950/40 border border-red-800/60 text-xs text-red-300 flex items-center gap-1.5">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span>✕ {errorMsg || 'Payment Failed'}</span>
        </div>
      )}

      {/* Execution Button */}
      <button
        onClick={handleExecute}
        disabled={paymentState !== 'IDLE' && paymentState !== 'FAILED'}
        className="w-full py-2 px-4 rounded-lg font-medium text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition-colors flex items-center justify-center gap-2 shadow"
      >
        {paymentState === 'IDLE' || paymentState === 'FAILED'
          ? 'Pay & Execute'
          : paymentState === 'SETTLED'
          ? 'Execution Complete'
          : 'Processing...'}
      </button>

      {/* Result Display */}
      {resultData !== null && typeof resultData === 'object' && (
        <div className="mt-3 p-3 rounded bg-gray-950 border border-gray-800 text-xs text-gray-300 font-mono overflow-auto max-h-40">
          <pre>{JSON.stringify(resultData, null, 2)}</pre>
        </div>
      )}
    </article>
  );
}
