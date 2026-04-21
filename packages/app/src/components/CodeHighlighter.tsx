import { useMemo } from 'react';
import { DiffViewer as DiffViewerBase } from './DiffViewer.js';

interface CodeHighlighterProps {
  code: string;
  language: 'javascript' | 'typescript' | 'python' | 'html' | 'css' | 'json' | 'text';
}

export function CodeHighlighter({ code, language }: CodeHighlighterProps) {
  const langLabel = language === 'typescript' ? 'ts' : language;

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
      <div
        style={{
          padding: '4px 12px',
          background: '#2d2d2d',
          color: '#9ca3af',
          fontSize: 10,
          textTransform: 'uppercase',
          borderBottom: '1px solid #3d3d3d',
        }}
      >
        {langLabel}
      </div>
      <pre style={{ margin: 0, padding: 12, color: '#d1d5db', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {code}
      </pre>
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