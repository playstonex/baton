import { useEffect, useRef, type ReactNode } from 'react';

const num = (name: string, fallback: number): number => {
  if (typeof window === 'undefined') return fallback;
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
};

export interface ReasoningStreamProps {
  children: ReactNode;
  className?: string;
  maxHeight?: number | string;
}

export function ReasoningStream({
  children,
  className = '',
  maxHeight = 84,
}: ReasoningStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroll = scrollRef.current;
    const text = textRef.current;
    if (!scroll || !text) return;
    let offset = 0;
    let timer: ReturnType<typeof setTimeout>;

    const step = () => {
      timer = setTimeout(
        () => {
          const lineH = parseFloat(getComputedStyle(text).lineHeight) || 18;
          const stepPx = lineH * num('--reason-lines', 2);
          const dur = num('--reason-step', 450);
          const ease =
            getComputedStyle(document.documentElement).getPropertyValue('--reason-ease').trim() ||
            'ease-out';
          offset += stepPx;
          scroll.style.transition = 'transform ' + dur + 'ms ' + ease;
          scroll.style.transform = 'translateY(' + -offset + 'px)';
          timer = setTimeout(() => {
            const copyH = text.offsetHeight;
            if (copyH > 0 && offset >= copyH) {
              offset -= copyH;
              scroll.style.transition = 'none';
              scroll.style.transform = 'translateY(' + -offset + 'px)';
              void scroll.offsetWidth;
            }
            step();
          }, dur + 40);
        },
        num('--reason-hold', 900),
      );
    };

    step();
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className={`t-reason ${className}`}
      style={{ height: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight }}
    >
      <div className="t-reason-viewport">
        <div className="t-reason-scroll" ref={scrollRef}>
          <div className="t-reason-text" ref={textRef}>
            {children}
          </div>
          <div className="t-reason-text" aria-hidden="true">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
