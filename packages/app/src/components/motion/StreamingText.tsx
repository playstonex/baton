import { useEffect, useRef } from 'react';

export interface StreamingTextProps {
  text: string;
  replayKey?: number | string;
  autoplay?: boolean;
  className?: string;
}

export function StreamingText({
  text,
  replayKey = 0,
  autoplay = true,
  className = '',
}: StreamingTextProps) {
  const words = text.trim().split(/\s+/);
  const spansRef = useRef<(HTMLSpanElement | null)[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!autoplay && replayKey === 0) return;
    const spans = spansRef.current.filter((s): s is HTMLSpanElement => Boolean(s));
    if (!spans.length) return;
    if (timer.current) clearTimeout(timer.current);

    spans.forEach((s) => {
      s.style.transition = 'none';
      s.classList.remove('is-in');
    });
    void spans[0]?.offsetWidth;
    spans.forEach((s) => {
      s.style.transition = '';
    });

    const gap =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--stream-gap')) || 45;
    const next = (n: number) => {
      if (n >= spans.length) return;
      spans[n]?.classList.add('is-in');
      timer.current = setTimeout(() => next(n + 1), gap);
    };
    next(0);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [text, replayKey, autoplay]);

  return (
    <div className={`t-stream ${className}`}>
      {words.map((w, i) => (
        <span
          key={i}
          ref={(el) => {
            spansRef.current[i] = el;
          }}
          className="t-stream-w is-in"
        >
          {w}
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </div>
  );
}
