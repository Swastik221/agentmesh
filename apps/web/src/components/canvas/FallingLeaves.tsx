import { useEffect, useState, type CSSProperties } from 'react';

interface LeafConfig {
  id: number;
  startX: number; // percentage 0-100
  driftX: number; // px -80 to +120
  duration: number; // seconds 14 - 28
  delay: number; // negative seconds so leaves are already mid-flight
  rotationEnd: number; // degrees 240 - 540
  color: string;
  size: number; // 12 - 20px
  flipDelay: number;
}

const AUTUMN_LEAF_COLORS = [
  '#C94F4F', // deep maple crimson
  '#D97732', // rich orange
  '#E89838', // golden amber
  '#B54832', // rust red
  '#E27447', // warm vermilion
];

// SVG path of a stylized Japanese maple leaf (momiji)
const MAPLE_LEAF_PATH =
  'M12 2 C12 2, 10 5, 8 6 C6 4, 4 4, 3 6 C5 7, 6 9, 5 11 C3 11, 1 12, 1 14 C3 14, 5 13, 7 14 C6 16, 5 18, 6 20 C7 18, 9 16, 11 16 L11 22 L13 22 L13 16 C15 16, 17 18, 18 20 C19 18, 18 16, 17 14 C19 13, 21 14, 23 14 C23 12, 21 11, 19 11 C18 9, 19 7, 21 6 C20 4, 18 4, 16 6 C14 5, 12 2, 12 2 Z';

function generateLeaves(count = 18): LeafConfig[] {
  const leaves: LeafConfig[] = [];
  for (let i = 0; i < count; i++) {
    // Distribute evenly across viewport width with jitter
    const basePercent = (i / count) * 100;
    const jitter = ((i * 37) % 15) - 7;
    const startX = Math.max(2, Math.min(98, basePercent + jitter));

    const color = AUTUMN_LEAF_COLORS[i % AUTUMN_LEAF_COLORS.length];
    const duration = 16 + ((i * 7) % 12); // 16s to 27s
    const delay = -(i * 1.5) % duration; // Staggered pre-fall offset
    const driftX = 40 + ((i * 23) % 90); // 40px to 130px drift
    const rotationEnd = 240 + ((i * 47) % 360);
    const size = 12 + ((i * 3) % 8); // 12px to 19px
    const flipDelay = (i * 0.4) % 3;

    leaves.push({
      id: i,
      startX,
      driftX,
      duration,
      delay,
      rotationEnd,
      color,
      size,
      flipDelay,
    });
  }
  return leaves;
}

export function FallingLeaves() {
  const [leaves] = useState(() => generateLeaves(18));
  const [isTabVisible, setIsTabVisible] = useState(!document.hidden);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsTabVisible(!document.hidden);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  if (!isTabVisible) {
    return null; // Pause animations when user is not viewing tab
  }

  return (
    <div className="falling-leaves-container" aria-hidden="true">
      {leaves.map((leaf) => {
        const style: CSSProperties = {
          left: `${leaf.startX}%`,
          width: `${leaf.size}px`,
          height: `${leaf.size}px`,
          color: leaf.color,
          animationDuration: `${leaf.duration}s`,
          animationDelay: `${leaf.delay}s`,
          ['--leaf-start-x' as string]: '0px',
          ['--leaf-drift-x' as string]: `${leaf.driftX}px`,
          ['--leaf-rot-end' as string]: `${leaf.rotationEnd}deg`,
        };

        return (
          <div key={leaf.id} className="falling-leaf" style={style}>
            <svg
              viewBox="0 0 24 24"
              width="100%"
              height="100%"
              style={{
                fill: 'currentColor',
                filter: 'drop-shadow(0 2px 3px rgba(100, 30, 20, 0.35))',
                opacity: 1,
              }}
            >
              <path d={MAPLE_LEAF_PATH} />
            </svg>
          </div>
        );
      })}
    </div>
  );
}
