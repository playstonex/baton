import { useMemo } from 'react';

interface DiffViewerProps {
  oldContent: string;
  newContent: string;
  language?: string;
}

interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  lineNumber?: number;
}

export function DiffViewer({ oldContent, newContent, language = 'typescript' }: DiffViewerProps) {
  const diffLines = useMemo(() => {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const result: DiffLine[] = [];

    const maxLines = Math.max(oldLines.length, newLines.length);
    let i = 0;
    let j = 0;

    while (i < oldLines.length || j < newLines.length) {
      const oldLine = oldLines[i];
      const newLine = newLines[j];

      if (oldLine === newLine) {
        result.push({ type: 'context', content: oldLine ?? '', lineNumber: i + 1 });
        i++;
        j++;
      } else if (oldLine !== undefined && newLine !== undefined) {
        result.push({ type: 'remove', content: oldLine, lineNumber: i + 1 });
        result.push({ type: 'add', content: newLine, lineNumber: j + 1 });
        i++;
        j++;
      } else if (oldLine === undefined) {
        result.push({ type: 'add', content: newLine ?? '', lineNumber: j + 1 });
        j++;
      } else {
        result.push({ type: 'remove', content: oldLine ?? '', lineNumber: i + 1 });
        i++;
      }
    }

    return result;
  }, [oldContent, newContent]);

  return (
    <div
      style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: 12,
        lineHeight: 1.5,
        background: '#1e1e1e',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div style={{ overflowX: 'auto' }}>
        {diffLines.map((line, idx) => (
          <div
            key={idx}
            style={{
              display: 'flex',
              background:
                line.type === 'add'
                  ? 'rgba(34, 197, 94, 0.15)'
                  : line.type === 'remove'
                    ? 'rgba(239, 68, 68, 0.15)'
                    : 'transparent',
            }}
          >
            <div
              style={{
                width: 40,
                padding: '2px 8px',
                textAlign: 'right',
                color: '#6b7280',
                background: 'rgba(0,0,0,0.2)',
                userSelect: 'none',
              }}
            >
              {line.lineNumber}
            </div>
            <div
              style={{
                width: 20,
                padding: '2px 4px',
                textAlign: 'center',
                color: line.type === 'add' ? '#22c55e' : line.type === 'remove' ? '#ef4444' : '#6b7280',
                background: 'rgba(0,0,0,0.2)',
                userSelect: 'none',
              }}
            >
              {line.type === '+' ? '+' : line.type === '-' ? '-' : ' '}
            </div>
            <pre
              style={{
                margin: 0,
                padding: '2px 8px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                color: line.type === 'add' ? '#4ade80' : line.type === 'remove' ? '#f87171' : '#d1d5db',
              }}
            >
              {line.content}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}

export function computeSimpleDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  if (oldLines.length === newLines.length && oldText === newText) {
    return 'No changes';
  }

  const added = newLines.filter((l) => !oldLines.includes(l)).length;
  const removed = oldLines.filter((l) => !newLines.includes(l)).length;

  const parts: string[] = [];
  if (added > 0) parts.push(`+${added}`);
  if (removed > 0) parts.push(`-${removed}`);

  return parts.join(', ') + ' line(s)';
}