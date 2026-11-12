import type { CSSProperties } from 'react';

const CORNERS = [0, 3, 12, 15];
const RING = [1, 2, 7, 11, 14, 13, 8, 4];
const INNER = [5, 6, 9, 10];
const TWINKLE = [7, 2, 11, 5, 14, 9, 0, 12, 3, 15, 6, 10, 13, 1, 8, 4];

export type MatrixVariant = 'scan' | 'twinkle' | 'orbit' | 'pulse';

function delayFor(variant: MatrixVariant, idx: number, cycle: number): number | null {
  const col = idx % 4;
  if (variant === 'scan') return Math.round(col * (cycle / 10));
  if (variant === 'twinkle') return Math.round((TWINKLE[idx] ?? 0) * (cycle / 16));
  if (variant === 'orbit') {
    const k = RING.indexOf(idx);
    return k === -1 ? null : Math.round(k * (cycle / 8));
  }
  if (variant === 'pulse') return Math.round((INNER.includes(idx) ? 0 : 1) * (cycle * 0.16));
  return 0;
}

export interface MatrixLoaderProps {
  variant?: MatrixVariant;
  rounded?: boolean;
  cycle?: number;
  label?: string;
  className?: string;
}

export function MatrixLoader({
  variant = 'scan',
  rounded = false,
  cycle = 1200,
  label = 'Agent processing',
  className = '',
}: MatrixLoaderProps) {
  return (
    <div
      className={`t-matrix ${className}`}
      data-variant={variant}
      role="status"
      aria-label={label}
    >
      {Array.from({ length: 16 }, (_, idx) => {
        if (rounded && CORNERS.includes(idx)) return <i key={idx} className="is-gap" />;
        const d = delayFor(variant, idx, cycle);
        return (
          <i
            key={idx}
            style={d === null ? { animation: 'none' } : ({ '--d': d } as CSSProperties)}
          />
        );
      })}
    </div>
  );
}
