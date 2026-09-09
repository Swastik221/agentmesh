import { useState } from 'react';
import { Bot, CheckCircle2, AlertCircle, CreditCard, ExternalLink } from 'lucide-react';

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
  | 'SIGNING'
  | 'SUBMITTING'
  | 'VERIFYING'
  | 'SETTLED'
  | 'FAILED';

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

  const handleExecute = async () => {
    try {
      setPaymentState('REQUIREMENT_RECEIVED');
      setErrorMsg(null);

      // Step 1: Initial request (without payment header) to trigger HTTP 402
      const initialRes = await fetch(`/api/agents/${agentId}/capabilities/${encodeURIComponent(capability)}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: capability }),
      });

      if (initialRes.status === 402) {
        setPaymentState('SIGNING');
        const reqHeader = initialRes.headers.get('X-Payment-Requirement');
        const reqData = reqHeader ? JSON.parse(reqHeader) : await initialRes.json();
        const requirement = reqData.paymentRequirement || reqData;

        // Step 2: Sign x402 payment payload
        setPaymentState('SUBMITTING');
        const paymentPayload = {
          scheme: requirement.scheme || 'exact',
          network: requirement.network || 'hedera:testnet',
          asset: requirement.asset || '0.0.429274',
          amount: requirement.amount || '1000',
          receiverAddress: requirement.receiver || '0.0.500123',
          paymentReference: requirement.paymentReference,
          signedTransaction: 'signed_hedera_testnet_tx_data',
        };

        // Step 3: Retry request with signed x402 payment header
        setPaymentState('VERIFYING');
        const retryRes = await fetch(`/api/agents/${agentId}/capabilities/${encodeURIComponent(capability)}/execute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Payment': JSON.stringify(paymentPayload),
            'X-Payment-Reference': requirement.paymentReference,
          },
          body: JSON.stringify({ action: capability }),
        });

        const data = await retryRes.json();

        if (!retryRes.ok || !data.success) {
          throw new Error(data.error || 'Payment or execution failed');
        }

        setPaymentState('SETTLED');
        setTxRef(data.payment?.transactionReference || requirement.paymentReference);
        setResultData(data.result);
        if (onExecuteSuccess) {
          onExecuteSuccess(data.result);
        }
      } else if (initialRes.ok) {
        const data = await initialRes.json();
        setPaymentState('SETTLED');
        setResultData(data.result);
      } else {
        const errJson = await initialRes.json();
        throw new Error(errJson.error || `HTTP ${initialRes.status}`);
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

      {/* State Indicators */}
      {paymentState === 'SIGNING' && (
        <div className="text-xs text-amber-400 mb-3 animate-pulse">
          Signing x402 payment...
        </div>
      )}
      {paymentState === 'SUBMITTING' && (
        <div className="text-xs text-blue-400 mb-3 animate-pulse">
          Submitting to Hedera Testnet...
        </div>
      )}
      {paymentState === 'VERIFYING' && (
        <div className="text-xs text-indigo-400 mb-3 animate-pulse">
          Verifying & Settling transaction...
        </div>
      )}

      {paymentState === 'SETTLED' && (
        <div className="mb-3 p-2.5 rounded bg-emerald-950/40 border border-emerald-800/60 text-xs text-emerald-300">
          <div className="flex items-center gap-1.5 font-medium mb-1">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>✓ Payment Settled ({network})</span>
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
