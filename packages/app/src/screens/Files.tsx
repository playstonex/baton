import { useState, useEffect, useCallback } from 'react';
import { Button, Card, CardContent, CardHeader, Chip } from '@heroui/react';
import { useAgentStore } from '../stores/connection.js';

interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: string;
}

interface FileContent {
  path: string;
  name: string;
  ext: string;
  content: string;
  size: number;
}

const FILE_ICONS: Record<string, string> = {
  ts: '📘',
  tsx: '⚛️',
  js: '📒',
  jsx: '⚛️',
  json: '📋',
  css: '🎨',
  html: '🌐',
  md: '📝',
  py: '🐍',
  rs: '🦀',
  go: '🔵',
  toml: '⚙️',
  yaml: '⚙️',
  yml: '⚙️',
  lock: '🔒',
};

function getFileIcon(name: string, isDir: boolean): string {
  if (isDir) return '📁';
  const ext = name.split('.').pop() ?? '';
  if (name.startsWith('.env')) return '🔐';
  if (name === 'package.json' || name === 'tsconfig.json') return '📦';
  return FILE_ICONS[ext] ?? '📄';
}

export function FilesScreen() {
  const agents = useAgentStore((s) => s.agents);
  const activeAgents = agents.filter((a) => a.status !== 'stopped');

  const [currentPath, setCurrentPath] = useState('/');
  const [items, setItems] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (activeAgents.length > 0 && currentPath === '/') {
      setCurrentPath(activeAgents[0].projectPath);
    }
  }, [activeAgents, currentPath]);

  const fetchDir = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items ?? []);
        setCurrentPath(path);
        setSelectedFile(null);
      }
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentPath !== '/') fetchDir(currentPath);
  }, [currentPath, fetchDir]);

  async function openFile(path: string) {
    try {
      const res = await fetch(`/api/files/content?path=${encodeURIComponent(path)}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedFile(data);
      }
    } catch {
      // offline
    }
  }

  const pathParts = currentPath.split('/').filter(Boolean);
  const lineCount = selectedFile?.content ? selectedFile.content.split('\n').length : 0;

  return (
    <div className="flex h-[calc(100dvh-88px)] gap-4 md:h-[calc(100dvh-96px)]">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-3 flex flex-wrap items-center gap-1 rounded-lg border border-surface-200 bg-white px-3 py-2 dark:border-surface-700 dark:bg-surface-800/50">
          <Button variant="ghost" size="sm" onPress={() => fetchDir('/')} className="font-mono text-[13px] px-1.5 text-surface-400 hover:text-primary-500">
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 8l6-6 6 6M4 6.5V14h3V10h2v4h3V6.5" />
            </svg>
          </Button>
          {pathParts.map((part, i) => {
            const path = '/' + pathParts.slice(0, i + 1).join('/');
            const isLast = i === pathParts.length - 1;
            return (
              <span key={path} className="flex items-center gap-1">
                <svg className="h-3 w-3 text-surface-300 dark:text-surface-600" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 4l4 4-4 4" /></svg>
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => fetchDir(path)}
                  className={`font-mono text-[13px] px-1.5 transition-colors ${
                    isLast
                      ? 'font-semibold text-primary-600 dark:text-primary-400'
                      : 'text-surface-500 hover:text-primary-500'
                  }`}
                >
                  {part}
                </Button>
              </span>
            );
          })}
        </div>

        <Card className="flex-1 overflow-auto border border-surface-200 shadow-sm dark:border-surface-700">
          {loading ? (
            <CardContent className="flex flex-col items-center py-16 text-center">
              <div className="mb-3">
                <svg className="h-5 w-5 animate-spin text-surface-300" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
              <span className="text-sm text-surface-400">Loading...</span>
            </CardContent>
          ) : items.length === 0 ? (
            <CardContent className="flex flex-col items-center py-16 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-surface-100 dark:bg-surface-800">
                <span className="text-xl">📂</span>
              </div>
              <span className="text-sm text-surface-400">Empty directory</span>
            </CardContent>
          ) : (
            items.map((item) => (
              <FileRow
                key={item.path}
                item={item}
                onClick={() => (item.isDir ? fetchDir(item.path) : openFile(item.path))}
                isSelected={selectedFile?.path === item.path}
              />
            ))
          )}
        </Card>

        {activeAgents.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {activeAgents.map((a) => {
              const isActive = currentPath === a.projectPath;
              return (
                <button key={a.id} type="button" onClick={() => fetchDir(a.projectPath)} className="cursor-pointer">
                  <Chip
                    variant={isActive ? 'primary' : 'tertiary'}
                    color={isActive ? 'accent' : 'default'}
                    className={`font-mono text-[11px] transition-all ${isActive ? 'shadow-sm' : ''}`}
                  >
                    {isActive && (
                      <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-primary-400" />
                    )}
                    {a.projectPath.split('/').pop()}
                  </Chip>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Card className="hidden w-[55%] overflow-hidden rounded-lg border border-surface-200 dark:border-surface-700 sm:flex flex-col">
        {selectedFile ? (
          <>
            <CardHeader className="shrink-0 items-center justify-between border-b border-surface-200 px-4 py-3 dark:border-surface-700">
              <div className="flex items-center gap-2.5">
                <span className="text-sm">{getFileIcon(selectedFile.name, false)}</span>
                <span className="text-[13px] font-medium text-surface-900 dark:text-white">{selectedFile.name}</span>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-surface-400">
                {selectedFile.ext && (
                  <span className="rounded bg-surface-100 px-1.5 py-0.5 font-mono uppercase dark:bg-surface-800">
                    {selectedFile.ext}
                  </span>
                )}
                <span>{lineCount} lines</span>
                <span>{formatSize(selectedFile.size)}</span>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto bg-surface-50/50 dark:bg-surface-950/50">
              <pre className="p-4 font-mono text-xs leading-relaxed text-surface-700 dark:text-surface-300">
                {selectedFile.content}
              </pre>
            </CardContent>
          </>
        ) : (
          <CardContent className="flex flex-1 flex-col items-center justify-center text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-xl bg-surface-100 dark:bg-surface-800">
              <svg className="h-6 w-6 text-surface-300 dark:text-surface-600" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h4.172a1 1 0 0 1 .707.293l1.328 1.328a1 1 0 0 0 .707.293H12.5A1.5 1.5 0 0 1 14 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9Z" />
              </svg>
            </div>
            <p className="text-sm text-surface-400">Select a file to view its content</p>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function FileRow({ item, onClick, isSelected }: { item: FileEntry; onClick: () => void; isSelected: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 border-b border-surface-100 px-4 py-2.5 text-left text-[13px] transition-all duration-150 last:border-0 dark:border-surface-700/50 ${
        isSelected
          ? 'bg-primary-50 dark:bg-primary-950/30'
          : 'hover:bg-surface-50 dark:hover:bg-surface-800/50'
      }`}
    >
      <span className="w-5 text-center text-sm">{getFileIcon(item.name, item.isDir)}</span>
      <span className={`flex-1 truncate font-mono ${item.isDir ? 'font-medium text-surface-900 dark:text-white' : 'text-surface-700 dark:text-surface-300'}`}>
        {item.name}
      </span>
      {!item.isDir && (
        <span className="shrink-0 text-[11px] tabular-nums text-surface-300 dark:text-surface-500">
          {formatSize(item.size)}
        </span>
      )}
      {item.isDir && (
        <svg className="h-3 w-3 shrink-0 text-surface-300 dark:text-surface-600" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 4l4 4-4 4" />
        </svg>
      )}
    </button>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
