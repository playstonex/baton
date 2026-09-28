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
    <div className="overflow-hidden rounded-[var(--radius-sm)] bg-geist-gray-100 font-mono text-xs leading-relaxed">
      <div className="overflow-x-auto">
        {diffLines.map((line, idx) => (
          <div
            key={idx}
            className={`flex ${
              line.type === 'add'
                ? 'bg-geist-green-700/15'
                : line.type === 'remove'
                  ? 'bg-geist-red-700/15'
                  : ''
            }`}
          >
            <div className="w-10 shrink-0 select-none bg-geist-gray-alpha-1000/20 px-2 py-1 text-right text-geist-gray-600">
              {line.lineNumber}
            </div>
            <div
              className={`w-5 shrink-0 select-none bg-geist-gray-alpha-1000/20 px-1 py-1 text-center ${
                line.type === 'add'
                  ? 'text-geist-green-900'
                  : line.type === 'remove'
                    ? 'text-geist-red-900'
                    : 'text-geist-gray-600'
              }`}
            >
              {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
            </div>
            <pre
              className={`whitespace-pre-wrap break-all px-2.5 py-1 ${
                line.type === 'add'
                  ? 'text-geist-green-900'
                  : line.type === 'remove'
                    ? 'text-geist-red-900'
                    : 'text-geist-gray-900'
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
