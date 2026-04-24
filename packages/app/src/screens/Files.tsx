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

  return (
    <div className="flex h-[calc(100dvh-88px)] gap-4 md:h-[calc(100dvh-96px)]">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-2 flex flex-wrap items-center gap-1">
          <Button variant="ghost" size="sm" onPress={() => fetchDir('/')} className="font-mono text-[13px] px-1">
            /
          </Button>
          {pathParts.map((part, i) => {
            const path = '/' + pathParts.slice(0, i + 1).join('/');
            return (
              <span key={path} className="flex items-center gap-1">
                <span className="text-surface-300 dark:text-surface-600">/</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => fetchDir(path)}
                  className={`font-mono text-[13px] px-1 ${i === pathParts.length - 1 ? 'font-semibold text-primary-600 dark:text-primary-400' : 'text-surface-500'}`}
                >
                  {part}
                </Button>
              </span>
            );
          })}
        </div>

        <Card className="flex-1 overflow-auto">
          {loading ? (
            <CardContent className="py-10 text-center text-sm text-surface-400">Loading...</CardContent>
          ) : items.length === 0 ? (
            <CardContent className="py-10 text-center text-sm text-surface-400">Empty directory</CardContent>
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
          <div className="mt-2 flex flex-wrap gap-1.5">
            {activeAgents.map((a) => (
              <button key={a.id} type="button" onClick={() => fetchDir(a.projectPath)} className="cursor-pointer">
                <Chip
                  variant={currentPath === a.projectPath ? 'primary' : 'tertiary'}
                  color={currentPath === a.projectPath ? 'accent' : 'default'}
                  className="font-mono text-[11px]"
                >
                  {a.projectPath.split('/').pop()}
                </Chip>
              </button>
            ))}
          </div>
        )}
      </div>

      <Card className="hidden w-[55%] sm:flex flex-col overflow-hidden">
        {selectedFile ? (
          <>
            <CardHeader className="shrink-0 flex items-center justify-between px-3 py-2">
              <span className="text-[13px] font-medium text-surface-900 dark:text-white">{selectedFile.name}</span>
              <span className="text-[11px] text-surface-400">{formatSize(selectedFile.size)}</span>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto">
              <pre className="bg-surface-50 p-3 font-mono text-xs leading-relaxed text-surface-700 dark:bg-surface-900 dark:text-surface-300">
                {selectedFile.content}
              </pre>
            </CardContent>
          </>
        ) : (
          <CardContent className="flex flex-1 items-center justify-center text-surface-300 dark:text-surface-600">
            Select a file to view its content
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
      className={`flex w-full items-center gap-2.5 border-b border-surface-100 px-3 py-2 text-left text-[13px] transition-colors last:border-0 dark:border-surface-700 ${
        isSelected
          ? 'bg-primary-50 dark:bg-primary-950/30'
          : 'hover:bg-surface-50 dark:hover:bg-surface-700/50'
      }`}
    >
      <span className={`w-4 text-center ${item.isDir ? 'text-primary-500' : 'text-surface-400'}`}>
        {item.isDir ? (
          <svg className="inline h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 2A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5V5.5A1.5 1.5 0 0 0 14.5 4H7.707l-1.854-1.854A.5.5 0 0 0 5.5 2H1.5Z"/></svg>
        ) : (
          <svg className="inline h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor"><path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.414A2 2 0 0 0 13.414 3L11 .586A2 2 0 0 0 9.586 0H4Z"/></svg>
        )}
      </span>
      <span className={`flex-1 truncate font-mono ${item.isDir ? 'font-medium' : ''} text-surface-700 dark:text-surface-300`}>
        {item.name}
      </span>
      {!item.isDir && <span className="text-[11px] text-surface-300 dark:text-surface-500">{formatSize(item.size)}</span>}
    </button>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
