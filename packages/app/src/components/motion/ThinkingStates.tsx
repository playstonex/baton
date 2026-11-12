import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const DEFAULT_STATES = [
  'Thinking…',
  'Analyzing context',
  'Evaluating tool execution',
  'Checking workspace files',
];

const ms = (name: string, fallback: number): number => {
  if (typeof window === 'undefined') return fallback;
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
};

export interface ThinkingStatesProps {
  states?: string[];
  text?: string;
  className?: string;
}

export function ThinkingStates({
  states = DEFAULT_STATES,
  text,
  className = '',
}: ThinkingStatesProps) {
  const isControlled = typeof text === 'string';
  const effectiveStates = isControlled ? [text] : states;

  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentText, setCurrentText] = useState(isControlled ? text : (states[0] ?? ''));
  const [leavingText, setLeavingText] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);
  const liveRef = useRef<HTMLSpanElement>(null);
  const prevControlledText = useRef(text);

  // Controlled mode: trigger transition when prop `text` changes
  useEffect(() => {
    if (!isControlled) return;
    if (text !== prevControlledText.current) {
      setLeavingText(prevControlledText.current ?? '');
      setCurrentText(text);
      setEntering(true);
      prevControlledText.current = text;
    }
  }, [isControlled, text]);

  // Uncontrolled mode: cycle through `states` list
  useEffect(() => {
    if (isControlled || effectiveStates.length <= 1) return;

    const hold = setTimeout(
      () => {
        const nextIdx = (currentIndex + 1) % effectiveStates.length;
        setLeavingText(effectiveStates[currentIndex] ?? '');
        setCurrentIndex(nextIdx);
        setCurrentText(effectiveStates[nextIdx] ?? '');
        setEntering(true);
      },
      ms('--think-hold', 2400),
    );

    return () => clearTimeout(hold);
  }, [isControlled, currentIndex, effectiveStates]);

  // Handle entry animation flush and exit dismissal
  useLayoutEffect(() => {
    if (!entering) return;
    if (liveRef.current) void liveRef.current.offsetWidth;
    const gap = ms('--think-gap', 50);
    const swap = ms('--think-swap', 180);
    const release = setTimeout(() => setEntering(false), gap);
    const done = setTimeout(() => setLeavingText(null), swap + gap);
    return () => {
      clearTimeout(release);
      clearTimeout(done);
    };
  }, [entering]);

  const longest = effectiveStates.reduce((a, b) => (b.length > a.length ? b : a), currentText);

  return (
    <span className={`t-think ${className}`} role="status">
      <span className="t-think-sizer" aria-hidden="true">
        {longest}
      </span>
      {leavingText !== null && (
        <span className="t-think-text is-exit" data-text={leavingText} aria-hidden="true">
          {leavingText}
        </span>
      )}
      <span
        ref={liveRef}
        className={`t-think-text${entering ? ' is-enter-start' : ''}`}
        data-text={currentText}
      >
        {currentText}
      </span>
    </span>
  );
}
