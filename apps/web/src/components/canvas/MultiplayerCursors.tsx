import { useEffect, useRef, useState } from 'react';
import type { Cursor } from '../../adapters/types';
import { adapters } from '../../adapters';
import { getAppMode } from '../../config/env';

interface MultiplayerCursorsProps {
  currentUserId?: string;
  isReplayActive?: boolean;
}

/**
 * Renders collaborator cursors on the canvas.
 *
 * Demo Mode only: this is a scripted flourish (a hardcoded 'checkout-demo'
 * workspace id and a fully fabricated "Swastik" cursor animated in a
 * sine/cosine orbit, not driven by any real connection). In Live Mode this
 * used to run unchanged and show that same fake cursor to real users.
 *
 * It cannot be made real by swapping a data source: the realtime protocol
 * (`@agentmesh/agent-protocol`) has no cursor position field anywhere in its
 * schemas, only entity-level ONLINE/OFFLINE/BUSY presence
 * (`workspace.presence.changed`, `workspace.delta` with `entity: 'presence'`).
 * There is no real (x, y) to render. Rather than fabricate one, this renders
 * nothing in Live Mode until the protocol actually carries real coordinates.
 */
export function MultiplayerCursors({ currentUserId = 'anand', isReplayActive = false }: MultiplayerCursorsProps) {
  const [remoteCursors, setRemoteCursors] = useState<Cursor[]>([]);
  const targetPositions = useRef<Map<string, { x: number; y: number }>>(new Map());
  const currentPositions = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [movingNodeBadge, setMovingNodeBadge] = useState<{ actor: string; nodeId: string } | null>(null);

  useEffect(() => {
    // No real cursor coordinates exist in Live Mode (see the module docstring);
    // this whole simulated overlay is Demo Mode only.
    if (getAppMode() !== 'demo') return;

    // Subscribe to cross-tab cursor sync
    const unsubscribe = adapters.workspaceRealtime.subscribeCursors('checkout-demo', (cursors) => {
      const filtered = cursors.filter((c) => c.id !== currentUserId);
      setRemoteCursors(filtered);
      for (const c of filtered) {
        targetPositions.current.set(c.id, { x: c.x, y: c.y });
        if (!currentPositions.current.has(c.id)) {
          currentPositions.current.set(c.id, { x: c.x, y: c.y });
        }
      }
    });

    // Listen to node movement presence
    const handleNodeMove = (e: Event) => {
      const detail = (e as CustomEvent<{ actor?: string; nodeId: string }>).detail;
      if (detail && detail.actor) {
        setMovingNodeBadge({ actor: detail.actor, nodeId: detail.nodeId });
        setTimeout(() => setMovingNodeBadge(null), 1800);
      }
    };
    window.addEventListener('agentmesh:node-move', handleNodeMove);

    // Ambient collaborator (Swastik) when replay is inactive
    let ambientTimer: number;
    if (!isReplayActive) {
      const swastikId = 'swastik';
      if (!currentPositions.current.has(swastikId)) {
        currentPositions.current.set(swastikId, { x: 780, y: 220 });
        targetPositions.current.set(swastikId, { x: 780, y: 220 });
      }

      let angle = 0;
      ambientTimer = window.setInterval(() => {
        angle += 0.08;
        const targetX = 780 + Math.sin(angle) * 70;
        const targetY = 220 + Math.cos(angle * 0.7) * 45;
        targetPositions.current.set(swastikId, { x: targetX, y: targetY });

        setRemoteCursors((prev) => {
          const existing = prev.find((c) => c.id === swastikId);
          if (existing) {
            return prev.map((c) => (c.id === swastikId ? { ...c, updatedAt: Date.now() } : c));
          }
          return [
            ...prev,
            {
              id: swastikId,
              name: 'Swastik',
              ens: 'dev2.eth',
              color: 'green',
              x: targetX,
              y: targetY,
              updatedAt: Date.now(),
            },
          ];
        });
      }, 2000);
    }

    // Smooth Spring / LERP Animation Frame
    let rafId: number;
    const animate = () => {
      for (const [id, target] of targetPositions.current.entries()) {
        const current = currentPositions.current.get(id) || { ...target };
        const nextX = current.x + (target.x - current.x) * 0.18;
        const nextY = current.y + (target.y - current.y) * 0.18;
        currentPositions.current.set(id, { x: nextX, y: nextY });

        const el = document.getElementById(`cursor-${id}`);
        if (el) {
          el.style.transform = `translate3d(${nextX}px, ${nextY}px, 0)`;
        }
      }
      rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);

    return () => {
      unsubscribe();
      window.removeEventListener('agentmesh:node-move', handleNodeMove);
      clearInterval(ambientTimer);
      cancelAnimationFrame(rafId);
    };
  }, [currentUserId, isReplayActive]);

  return (
    <>
      {remoteCursors.map((cursor) => {
        const isPurple = cursor.color === 'purple';
        const colorClass = isPurple ? 'live-cursor--purple' : 'live-cursor--green';
        const initialPos = currentPositions.current.get(cursor.id) || { x: cursor.x, y: cursor.y };

        return (
          <div
            key={cursor.id}
            id={`cursor-${cursor.id}`}
            className={`live-cursor ${colorClass}`}
            style={{ transform: `translate3d(${initialPos.x}px, ${initialPos.y}px, 0)` }}
          >
            <svg viewBox="0 0 20 24" fill="currentColor">
              <path d="M2 2L18 14L10 16L6 22Z" />
            </svg>
            <div className="live-cursor__badge">
              <span>{cursor.name}</span>
              <span style={{ opacity: 0.75, fontSize: 9 }}>· {cursor.ens}</span>
            </div>
          </div>
        );
      })}

      {movingNodeBadge && (
        <div
          style={{
            position: 'absolute',
            top: 20,
            left: 20,
            zIndex: 90,
            backgroundColor: 'var(--mesh-bg-card)',
            border: '1px solid var(--mesh-primary-green)',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 11,
            color: 'var(--mesh-primary-green)',
            boxShadow: 'var(--mesh-shadow-node)',
          }}
        >
          {movingNodeBadge.actor} is arranging {movingNodeBadge.nodeId}
        </div>
      )}
    </>
  );
}
