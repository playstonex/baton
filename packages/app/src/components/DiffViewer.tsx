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

export function DiffViewer({ oldContent, newContent }: DiffViewerProps) {
  const diffLines = useMemo(() => {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const result: DiffLine[] = [];

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
    <div className="overflow-hidden rounded-sm border border-line-soft bg-canvas font-mono text-xs leading-relaxed">
      <div className="overflow-x-auto">
        {diffLines.map((line, idx) => (
          <div
            key={idx}
            className={`flex ${
              line.type === 'add'
                ? 'bg-success-soft'
                : line.type === 'remove'
                  ? 'bg-danger-soft'
                  : ''
            }`}
          >
            <div className="w-10 shrink-0 select-none bg-raised/60 px-2 py-1 text-right text-meta">
              {line.lineNumber}
            </div>
            <div
              className={`w-5 shrink-0 select-none bg-raised/60 px-1 py-1 text-center ${
                line.type === 'add'
                  ? 'text-success'
                  : line.type === 'remove'
                    ? 'text-danger'
                    : 'text-meta'
              }`}
            >
              {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
            </div>
            <pre
              className={`whitespace-pre-wrap break-all px-2.5 py-1 ${
                line.type === 'add'
                  ? 'text-success'
                  : line.type === 'remove'
                    ? 'text-danger'
                    : 'text-fg-2'
              }`}
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
