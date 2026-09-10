import { useState } from 'react';
import { Play, Sparkles, X, CheckCircle2, ShieldCheck, Terminal, AlertTriangle, Loader2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

export interface DemoStageInfo {
  stage: string;
  name: string;
  subsystem: string;
  isMocked?: boolean;
  explanation: string;
}

export const DEMO_STAGES: DemoStageInfo[] = [
  {
    stage: 'IDENTITY_VERIFIED',
    name: '1. User Identity & Session',
    subsystem: 'SIWE & Auth',
    explanation: 'User authenticated via Sign-In with Ethereum (SIWE) and active session validated.',
  },
  {
    stage: 'AGENTS_READY',
    name: '2. Agent Registration & ENS Identity',
    subsystem: 'ENS & Agent Registry',
    explanation: 'Agent A (researcher.eth) & Agent B registered with verified ENS identity.',
  },
  {
    stage: 'TASK_CREATED',
    name: '3. Task Creation',
    subsystem: 'Task Engine',
    explanation: 'Task A (Security Audit) and Task B (Remediation Strategy) initialized.',
  },
  {
    stage: 'POLICY_APPROVAL_REQUIRED',
    name: '4. Policy Evaluation',
    subsystem: 'Policy Engine',
    explanation: 'Project policy evaluated action task.execute as APPROVAL_REQUIRED.',
  },
  {
    stage: 'EXECUTION_BLOCKED',
    name: '5. Pre-Approval Execution Blocking',
    subsystem: 'Policy Enforcement',
    explanation: 'Capability execution strictly blocked prior to human manager approval.',
  },
  {
    stage: 'APPROVAL_CREATED',
    name: '6. Approval Request Created',
    subsystem: 'Approval Engine',
    explanation: 'Human approval request created for capability execution.',
  },
  {
    stage: 'APPROVAL_APPROVED',
    name: '7. Human Approval Resolved',
    subsystem: 'Approval Engine',
    explanation: 'Authorized human project manager approves capability execution.',
  },
  {
    stage: 'PAYMENT_REQUIRED',
    name: '8. HTTP 402 Payment Required',
    subsystem: 'x402 Protocol',
    explanation: 'Agent B capability endpoint returns HTTP 402 with X-Payment-Requirement header.',
  },
  {
    stage: 'PAYMENT_VERIFIED',
    name: '9. x402 Payment Payload Verification',
    subsystem: 'x402 Protocol',
    isMocked: true,
    explanation: 'Payment payload scheme (exact), asset (0.0.429274), and amount (1000 atomic units) verified. (MOCKED in browser demo)',
  },
  {
    stage: 'PAYMENT_SETTLED',
    name: '10. Hedera Testnet USDC Settlement',
    subsystem: 'Hedera Blockchain',
    isMocked: true,
    explanation: 'Settlement confirmed with reference MOCK-HEDERA-SETTLEMENT. (MOCKED in browser demo)',
  },
  {
    stage: 'CAPABILITY_EXECUTED',
    name: '11. Paid Capability Execution',
    subsystem: 'Capability Execution',
    explanation: 'Paid capability artifact-analysis executed after payment status reaches SETTLED.',
  },
  {
    stage: 'ARTIFACT_CREATED',
    name: '12. Artifact A Creation',
    subsystem: 'Artifact Service',
    explanation: 'Agent A produces security-audit-report.json artifact containing 2 vulnerabilities.',
  },
  {
    stage: 'ARTIFACT_EXCHANGED',
    name: '13. Agent-to-Agent Artifact Exchange',
    subsystem: 'Dependency Service',
    explanation: 'Artifact A linked to Task B via task dependency and retrieved across authorization boundary.',
  },
  {
    stage: 'AGENT_B_PROCESSED',
    name: '14. Agent B Processing',
    subsystem: 'Agent B Processing',
    explanation: 'Agent B consumes Artifact A findings and generates remediation plan payload.',
  },
  {
    stage: 'DEMO_COMPLETE',
    name: '15. Artifact B Final Result',
    subsystem: 'Artifact Service',
    explanation: 'Agent B produces final remediation-plan-summary.json artifact ready for deployment.',
  },
];

export function DemoModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [demoResult, setDemoResult] = useState<any | null>(null);

  const { status, loginWithSiwe } = useAuth();

  const runDemo = async () => {
    if (status !== 'authenticated') {
      try {
        const user = await loginWithSiwe();
        if (!user) return;
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'SIWE login required to run demo');
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/demo/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || errJson.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setDemoResult(data.result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to execute demo');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Action Button */}
      <button
        onClick={() => {
          setIsOpen(true);
          if (!demoResult && !loading) {
            void runDemo();
          }
        }}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition-all"
        title="Run AgentMesh E2E Demo"
      >
        <Sparkles size={14} className="text-amber-300 animate-pulse" />
        <span>Run AgentMesh Demo</span>
      </button>

      {/* Modal / Drawer */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-xl bg-slate-900 border border-slate-800 shadow-2xl text-slate-100 overflow-hidden">
            {/* Modal Header */}
            <header className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/80">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-400" />
                <h2 className="text-base font-bold text-slate-100">
                  AgentMesh 15-Stage E2E Workflow Demo
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/60">
                  Browser Demo
                </span>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                <X size={18} />
              </button>
            </header>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Authenticated Check / Prompt */}
              {status !== 'authenticated' && (
                <div className="p-4 rounded-lg bg-amber-950/40 border border-amber-800/60 text-xs text-amber-300 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    <span>SIWE Authentication required to run backend orchestrator demo.</span>
                  </div>
                  <button
                    onClick={loginWithSiwe}
                    className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded transition-colors"
                  >
                    Sign In with Ethereum
                  </button>
                </div>
              )}

              {/* Error Alert */}
              {error && (
                <div className="p-4 rounded-lg bg-red-950/40 border border-red-800/60 text-xs text-red-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Loading State */}
              {loading && (
                <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400">
                  <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                  <p className="text-sm font-medium text-slate-300">
                    Executing 15-Stage E2E Multi-Agent Workflow...
                  </p>
                  <span className="text-xs text-slate-500">
                    Task → Policy → Approval → x402 → Hedera → Capability → Artifact → Agent B
                  </span>
                </div>
              )}

              {/* Demo Results & Stage Visualization */}
              {!loading && (
                <>
                  {/* Real Hedera Proof Terminal Banner */}
                  <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 font-semibold text-emerald-400">
                        <Terminal className="w-4 h-4" />
                        <span>Real Blockchain Verification (Live Hedera Testnet)</span>
                      </div>
                      <span className="text-[10px] text-slate-400">Terminal Command</span>
                    </div>
                    <p className="text-slate-300 mb-2 font-sans">
                      The browser demo uses deterministic mock settlement for instant reproducibility. To verify the live cryptographic payment settlement on Hedera Testnet USDC via the official x402 facilitator, run:
                    </p>
                    <div className="bg-black/60 p-2.5 rounded border border-slate-800 text-indigo-300 flex items-center justify-between font-mono">
                      <code>pnpm demo:e2e:live</code>
                      <span className="text-[10px] text-slate-500">Requires HEDERA_ACCOUNT_ID & HEDERA_PRIVATE_KEY</span>
                    </div>
                  </div>

                  {/* Workflow Stages Grid */}
                  <div>
                    <h3 className="text-sm font-bold text-slate-200 mb-3 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>Workflow Execution Stages ({DEMO_STAGES.length} Stages)</span>
                    </h3>

                    <div className="space-y-2">
                      {DEMO_STAGES.map((s) => {
                        const isCompleted = Boolean(demoResult);
                        return (
                          <div
                            key={s.stage}
                            className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-start justify-between gap-3 text-xs"
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-200">{s.name}</span>
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
                                  {s.subsystem}
                                </span>
                              </div>
                              <p className="text-slate-400 text-[11px]">{s.explanation}</p>
                            </div>

                            <div className="flex flex-col items-end flex-shrink-0">
                              {s.isMocked ? (
                                <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-amber-950 text-amber-300 border border-amber-800/60">
                                  MOCKED — external Hedera settlement
                                </span>
                              ) : isCompleted ? (
                                <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800/60 flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-400" /> SUCCESS
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-slate-800 text-slate-400">
                                  PENDING
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Final Summary Card */}
                  {demoResult && (
                    <div className="p-4 rounded-xl bg-indigo-950/20 border border-indigo-800/40 space-y-3 text-xs">
                      <h4 className="font-bold text-indigo-200 text-sm flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-indigo-400" />
                        <span>Execution Summary</span>
                      </h4>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-slate-300 font-mono text-[11px]">
                        <div className="bg-slate-950/80 p-2 rounded border border-slate-800">
                          <span className="text-slate-500 block text-[10px]">AGENT A</span>
                          <span className="text-indigo-300 font-semibold">Producer (researcher.eth)</span>
                        </div>
                        <div className="bg-slate-950/80 p-2 rounded border border-slate-800">
                          <span className="text-slate-500 block text-[10px]">AGENT B</span>
                          <span className="text-emerald-300 font-semibold">Consumer (Remediation)</span>
                        </div>
                        <div className="bg-slate-950/80 p-2 rounded border border-slate-800">
                          <span className="text-slate-500 block text-[10px]">PAYMENT PROTOCOL</span>
                          <span className="text-amber-300 font-semibold">x402 v2 (1000 atomic USDC)</span>
                        </div>
                        <div className="bg-slate-950/80 p-2 rounded border border-slate-800">
                          <span className="text-slate-500 block text-[10px]">SETTLEMENT REFERENCE</span>
                          <span className="text-amber-300 font-semibold">{demoResult.transactionReference}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Modal Footer */}
            <footer className="flex items-center justify-between px-6 py-3 border-t border-slate-800 bg-slate-950/80 text-xs text-slate-400">
              <span>AgentMesh Hackathon Submission Demonstration</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={runDemo}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium transition-colors"
                >
                  <Play size={14} />
                  <span>Re-run Demo</span>
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                >
                  Close
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
