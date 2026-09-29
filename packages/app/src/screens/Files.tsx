import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useAgentStore } from '../stores/connection.js';
import { Card, EmptyState, LoadingSpinner, BackButton } from '../lib/ui.js';
import { IconChevronRight, IconHome, IconFile, IconFolder } from '../lib/icons.js';

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

const FILE_EXT_STYLES: Record<string, string> = {
  ts: 'bg-accent-soft text-accent-hover',
  tsx: 'bg-accent-soft text-accent-hover',
  js: 'bg-warn-soft text-warn',
  jsx: 'bg-accent-soft text-accent-hover',
  json: 'bg-raised text-muted',
  css: 'bg-danger-soft text-danger',
  html: 'bg-warn-soft text-warn',
  md: 'bg-raised text-muted',
  py: 'bg-success-soft text-success',
  rs: 'bg-warn-soft text-warn',
  go: 'bg-success-soft text-success',
  toml: 'bg-raised text-muted',
  yaml: 'bg-raised text-muted',
  yml: 'bg-raised text-muted',
};

export function FilesScreen() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const agents = useAgentStore((s) => s.agents);
  const agent = sessionId ? agents.find((a) => a.id === sessionId) : null;

  const [currentPath, setCurrentPath] = useState('/');
  const [items, setItems] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (agent && currentPath === '/') {
      setCurrentPath(agent.projectPath);
    }
  }, [agent, currentPath]);

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
    <div className="flex h-[calc(100dvh-88px)] flex-col gap-4 md:h-[calc(100dvh-96px)]">
      <div className="flex items-center gap-3">
        <BackButton onClick={() => navigate(-1)} />
        <span className="text-[13px] font-medium text-fg">
          {agent?.projectPath.split('/').pop() ?? 'Files'}
        </span>
        <span className="font-mono text-xs text-meta">{sessionId?.slice(0, 8)}</span>
      </div>

      <div className="flex flex-1 gap-4 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-md border border-line-soft bg-surface px-4 py-2">
            <button
              type="button"
              onClick={() => fetchDir('/')}
              className="rounded-sm p-1 text-muted transition-colors duration-150 hover:bg-raised hover:text-fg"
            >
              <IconHome className="h-3.5 w-3.5" />
            </button>
            {pathParts.map((part, i) => {
              const path = '/' + pathParts.slice(0, i + 1).join('/');
              const isLast = i === pathParts.length - 1;
              return (
                <span key={path} className="flex items-center gap-1">
                  <IconChevronRight className="h-3 w-3 text-line-strong" />
                  <button
                    type="button"
                    onClick={() => fetchDir(path)}
                    className={`rounded-sm px-1.5 py-0.5 font-mono text-xs transition-colors duration-150 ${
                      isLast
                        ? 'font-semibold text-fg'
                        : 'text-muted hover:bg-raised hover:text-fg'
                    }`}
                  >
                    {part}
                  </button>
                </span>
              );
            })}
          </div>

          <Card className="flex-1 overflow-auto p-0" padding={false}>
            {loading ? (
              <LoadingSpinner text="Loading…" />
            ) : items.length === 0 ? (
              <EmptyState icon={<IconFolder className="h-5 w-5" />} title="Empty directory" />
            ) : (
              <div className="divide-y divide-line-soft">
                {items.map((item) => (
                  <FileRow
                    key={item.path}
                    item={item}
                    onClick={() => (item.isDir ? fetchDir(item.path) : openFile(item.path))}
                    isSelected={selectedFile?.path === item.path}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>

        <Card className="hidden w-[55%] flex-col overflow-hidden sm:flex" padding={false}>
          {selectedFile ? (
            <>
              <div className="flex shrink-0 items-center justify-between border-b border-line-soft px-4 py-2.5">
                <div className="flex items-center gap-2.5">
                  <IconFile className="h-4 w-4 text-muted" />
                  <span className="text-xs font-medium text-fg">
                    {selectedFile.name}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[11px] tabular-nums text-meta">
                  {selectedFile.ext && (
                    <span
                      className={`rounded-sm px-1.5 py-0.5 font-mono uppercase ${
                        FILE_EXT_STYLES[selectedFile.ext] ?? 'bg-raised text-muted'
                      }`}
                    >
                      {selectedFile.ext}
                    </span>
                  )}
                  <span>{lineCount} lines</span>
                  <span>{formatSize(selectedFile.size)}</span>
                </div>
              </div>
              <div className="flex-1 overflow-auto bg-canvas">
                <pre className="p-5 font-mono text-xs leading-relaxed text-fg-2">
                  {selectedFile.content}
                </pre>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-raised text-muted">
                <IconFile className="h-5 w-5" />
              </div>
              <p className="text-[13px] text-muted">Select a file to view its content</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function FileRow({
  item,
  onClick,
  isSelected,
}: {
  item: FileEntry;
  onClick: () => void;
  isSelected: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-5 py-2.5 text-left text-[13px] transition-colors duration-150 ${
        isSelected ? 'bg-raised' : 'hover:bg-raised/60'
      }`}
    >
      {item.isDir ? (
        <IconFolder className="h-4 w-4 shrink-0 text-muted" />
      ) : (
        <IconFile className="h-4 w-4 shrink-0 text-muted" />
      )}
      <span
        className={`flex-1 truncate font-mono ${
          item.isDir ? 'font-medium text-fg' : 'text-fg-2'
        }`}
      >
        {item.name}
      </span>
      {!item.isDir && (
        <span className="shrink-0 text-[11px] tabular-nums text-meta">
          {formatSize(item.size)}
        </span>
      )}
      {item.isDir && <IconChevronRight className="h-3 w-3 shrink-0 text-line-strong" />}
    </button>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
