import { DiffViewer as DiffViewerBase } from './DiffViewer.js';

interface CodeHighlighterProps {
  code: string;
  language: 'javascript' | 'typescript' | 'python' | 'html' | 'css' | 'json' | 'text';
}

export function CodeHighlighter({ code, language }: CodeHighlighterProps) {
  const langLabel = language === 'typescript' ? 'ts' : language;

  return (
    <div className="overflow-hidden rounded-sm border border-line-soft bg-canvas font-mono text-xs leading-relaxed">
      <div className="border-b border-line-soft bg-raised px-4 py-1.5 text-[10px] uppercase tracking-wider text-muted">
        {langLabel}
      </div>
      <pre className="whitespace-pre-wrap break-all p-4 text-fg-2">{code}</pre>
    </div>
  );
}

interface DiffHighlighterProps {
  oldCode: string;
  newCode: string;
  language?: CodeHighlighterProps['language'];
}

export function DiffHighlighter({ oldCode, newCode }: DiffHighlighterProps) {
  return <DiffViewerBase oldContent={oldCode} newContent={newCode} />;
}

export function getLanguageFromPath(filePath: string): CodeHighlighterProps['language'] {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, CodeHighlighterProps['language']> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    mjs: 'javascript',
    py: 'python',
    html: 'html',
    htm: 'html',
    css: 'css',
    json: 'json',
  };
  return map[ext] ?? 'text';
}
