import { Play, Pause, SkipForward, RotateCcw, X, Sparkles } from 'lucide-react';

export interface ReplayStep {
  id: number;
  title: string;
  detail: string;
  eventType?: string;
  action?: 'init' | 'anand-login' | 'anand-wallet' | 'anand-ens' | 'orion-agent' | 'swastik-join' | 'swastik-wallet' | 'swastik-ens' | 'vega-agent' | 'coordinator' | 'taskboard' | 'proposals' | 'claim-frontend' | 'claim-backend' | 'publish-api' | 'dependency' | 'approval-req' | 'approved' | 'synced';
  cursor?: { id: 'anand' | 'swastik'; x: number; y: number };
}

export const REPLAY_STEPS: ReplayStep[] = [
  { id: 1, title: 'Workspace Init', detail: 'Empty workspace loads', action: 'init' },
  { id: 2, title: 'Developer 1 Login', detail: 'Anand signs into AgentMesh', action: 'anand-login' },
  { id: 3, title: 'Wallet Connect', detail: 'Anand connects demo Web3 wallet', action: 'anand-wallet' },
  { id: 4, title: 'ENS Resolution', detail: '0x1a2b…9f3c resolves to dev1.eth', action: 'anand-ens' },
  { id: 5, title: 'Agent Deployed', detail: 'Orion (Codex) coding agent appears', action: 'orion-agent', cursor: { id: 'anand', x: 200, y: 180 } },
  { id: 6, title: 'Developer 2 Joins', detail: 'Swastik joins the shared workspace', action: 'swastik-join' },
  { id: 7, title: 'Peer Wallet Connect', detail: 'Swastik connects demo wallet', action: 'swastik-wallet' },
  { id: 8, title: 'Peer ENS Resolution', detail: '0x7c81…a6e7 resolves to dev2.eth', action: 'swastik-ens' },
  { id: 9, title: 'Peer Agent Connected', detail: 'Vega (Claude) coding agent appears', action: 'vega-agent', cursor: { id: 'swastik', x: 800, y: 180 } },
  { id: 10, title: 'Coordinator Active', detail: 'Mesh Coordinator receives PRD', action: 'coordinator', cursor: { id: 'anand', x: 500, y: 40 } },
  { id: 11, title: 'Shared Task Board', detail: 'Task board appears on the canvas', action: 'taskboard' },
  { id: 12, title: 'Task Proposals', detail: 'Coordinator emits TASK_PROPOSAL events', eventType: 'TASK_PROPOSAL', action: 'proposals' },
  { id: 13, title: 'Frontend Task Claimed', detail: 'Anand (Orion) claims AM-114 identity task', eventType: 'TASK_CLAIMED', action: 'claim-frontend', cursor: { id: 'anand', x: 420, y: 220 } },
  { id: 14, title: 'Backend Task Claimed', detail: 'Swastik (Vega) claims AM-115 payment API', eventType: 'TASK_CLAIMED', action: 'claim-backend', cursor: { id: 'swastik', x: 520, y: 260 } },
  { id: 15, title: 'Schema Published', detail: 'Vega publishes payment-api.json artifact', eventType: 'ARTIFACT_PUBLISHED', action: 'publish-api', cursor: { id: 'swastik', x: 740, y: 560 } },
  { id: 16, title: 'Dependency Received', detail: 'Orion consumes payment-api.json artifact', eventType: 'DEPENDENCY_REQUEST', action: 'dependency', cursor: { id: 'anand', x: 280, y: 320 } },
  { id: 17, title: 'Human Approval Gate', detail: 'Deploy checkout contract requires human authority ($0.001 USDC)', eventType: 'APPROVAL_REQUESTED', action: 'approval-req', cursor: { id: 'anand', x: 180, y: 560 } },
  { id: 18, title: 'Human Owner Approved', detail: 'APPROVAL_GRANTED: dev1.eth signs simulated deployment', eventType: 'APPROVAL_GRANTED', action: 'approved', cursor: { id: 'anand', x: 220, y: 620 } },
  { id: 19, title: 'Workspace Synced', detail: 'Both agents and human developers fully coordinated', action: 'synced' },
];

interface DemoReplayControllerProps {
  activeStep: number;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onRestart: () => void;
  onClose: () => void;
}

export function DemoReplayController({
  activeStep,
  isPlaying,
  onPlay,
  onPause,
  onNext,
  onRestart,
  onClose,
}: DemoReplayControllerProps) {
  const currentStep = REPLAY_STEPS[Math.min(activeStep, REPLAY_STEPS.length - 1)];

  return (
    <aside className="mesh-replay-bar nodrag nopan" aria-label="Demo Replay Controller">
      <div className="mesh-replay-step-info">
        <Sparkles size={14} color="var(--mesh-primary-green)" />
        <span className="mesh-replay-step-num">
          STEP {currentStep.id} / 19
        </span>
        <div>
          <span className="mesh-replay-step-title">{currentStep.title}</span>
          <span style={{ margin: '0 6px', color: 'var(--mesh-border-strong)' }}>·</span>
          <span style={{ fontSize: 11, color: 'var(--mesh-text-muted)' }}>{currentStep.detail}</span>
        </div>
      </div>

      <div className="mesh-replay-controls">
        {isPlaying ? (
          <button
            type="button"
            className="mesh-replay-btn"
            title="Pause replay"
            onClick={onPause}
          >
            <Pause size={14} />
          </button>
        ) : (
          <button
            type="button"
            className="mesh-replay-btn"
            title="Play replay"
            onClick={onPlay}
          >
            <Play size={14} />
          </button>
        )}

        <button
          type="button"
          className="mesh-replay-btn"
          title="Next step"
          onClick={onNext}
          disabled={activeStep >= REPLAY_STEPS.length - 1}
        >
          <SkipForward size={14} />
        </button>

        <button
          type="button"
          className="mesh-replay-btn"
          title="Restart replay from step 1"
          onClick={onRestart}
        >
          <RotateCcw size={13} />
        </button>

        <button
          type="button"
          className="mesh-replay-btn"
          title="Exit replay mode"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>
    </aside>
  );
}
