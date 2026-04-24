import { DiffViewer as DiffViewerBase } from './DiffViewer.js';

interface CodeHighlighterProps {
  code: string;
  language: 'javascript' | 'typescript' | 'python' | 'html' | 'css' | 'json' | 'text';
}

export function CodeHighlighter({ code, language }: CodeHighlighterProps) {
  const langLabel = language === 'typescript' ? 'ts' : language;

  return (
    <div className="overflow-hidden rounded-xl bg-[#1e1e1e] font-mono text-xs leading-relaxed">
      <div className="border-b border-white/10 bg-[#2d2d2d] px-3 py-1 text-[10px] uppercase text-surface-400">
        {langLabel}
      </div>
      <pre className="whitespace-pre-wrap break-all p-3 text-surface-300">{code}</pre>
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
