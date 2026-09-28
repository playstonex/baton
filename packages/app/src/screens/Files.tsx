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

const FILE_EXT_ICONS: Record<string, string> = {
  ts: 'bg-geist-blue-100 text-geist-blue-700 dark:bg-geist-blue-1000 dark:text-geist-blue-900',
  tsx: 'bg-geist-blue-100 text-geist-blue-700 dark:bg-geist-blue-1000 dark:text-geist-blue-900',
  js: 'bg-geist-amber-100 text-geist-amber-900 dark:bg-geist-amber-1000 dark:text-geist-amber-600',
  jsx: 'bg-geist-blue-100 text-geist-blue-700 dark:bg-geist-blue-1000 dark:text-geist-blue-900',
  json: 'bg-geist-gray-alpha-200 text-geist-gray-900',
  css: 'bg-geist-pink-100 text-geist-pink-700 dark:bg-geist-pink-1000 dark:text-geist-pink-900',
  html: 'bg-geist-amber-100 text-geist-amber-900 dark:bg-geist-amber-1000 dark:text-geist-amber-600',
  md: 'bg-geist-gray-alpha-200 text-geist-gray-900',
  py: 'bg-geist-green-100 text-geist-green-700 dark:bg-geist-green-1000 dark:text-geist-green-900',
  rs: 'bg-geist-amber-100 text-geist-amber-900 dark:bg-geist-amber-1000 dark:text-geist-amber-600',
  go: 'bg-geist-teal-100 text-geist-teal-700 dark:bg-geist-teal-1000 dark:text-geist-teal-900',
  toml: 'bg-geist-gray-alpha-200 text-geist-gray-900',
  yaml: 'bg-geist-gray-alpha-200 text-geist-gray-900',
  yml: 'bg-geist-gray-alpha-200 text-geist-gray-900',
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
      <div className="flex items-center gap-4">
        <BackButton onClick={() => navigate(-1)} />
        <span className="text-sm font-medium text-geist-gray-800">
          {agent?.projectPath.split('/').pop() ?? 'Files'}
        </span>
        <span className="font-mono text-xs text-geist-gray-700">{sessionId?.slice(0, 8)}</span>
      </div>

      <div className="flex flex-1 gap-4 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-geist-gray-alpha-400 bg-geist-background-100 px-5 py-3">
            <button
              type="button"
              onClick={() => fetchDir('/')}
              className="px-1.5 font-mono text-[13px] text-geist-gray-700 transition-colors hover:text-geist-gray-1000"
            >
              <IconHome className="h-3.5 w-3.5" />
            </button>
            {pathParts.map((part, i) => {
              const path = '/' + pathParts.slice(0, i + 1).join('/');
              const isLast = i === pathParts.length - 1;
              return (
                <span key={path} className="flex items-center gap-1">
                  <IconChevronRight className="h-3 w-3 text-geist-gray-alpha-500" />
                  <button
                    type="button"
                    onClick={() => fetchDir(path)}
                    className={`px-1.5 font-mono text-[13px] transition-colors ${
                      isLast
                        ? 'font-semibold text-geist-gray-1000'
                        : 'text-geist-gray-800 hover:text-geist-gray-1000'
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
              <EmptyState icon={<IconFolder className="h-6 w-6 text-geist-gray-700" />} title="Empty directory" />
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
        </div>

        <Card className="hidden w-[55%] flex-col overflow-hidden sm:flex" padding={false}>
          {selectedFile ? (
            <>
              <div className="flex shrink-0 items-center justify-between border-b border-geist-gray-alpha-300 px-5 py-3.5">
                <div className="flex items-center gap-2.5">
                  <IconFile className="h-4 w-4 text-geist-gray-700" />
                  <span className="text-[13px] font-medium text-geist-gray-1000">
                    {selectedFile.name}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-geist-gray-700">
                  {selectedFile.ext && (
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono uppercase text-[11px] ${
                        FILE_EXT_ICONS[selectedFile.ext] ?? 'bg-geist-gray-alpha-200 text-geist-gray-900'
                      }`}
                    >
                      {selectedFile.ext}
                    </span>
                  )}
                  <span>{lineCount} lines</span>
                  <span>{formatSize(selectedFile.size)}</span>
                </div>
              </div>
              <div className="flex-1 overflow-auto bg-geist-gray-alpha-100">
                <pre className="p-5 font-mono text-xs leading-relaxed text-geist-gray-1000">
                  {selectedFile.content}
                </pre>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-[var(--radius-md)] bg-geist-gray-alpha-200">
                <IconFile className="h-6 w-6 text-geist-gray-600" />
              </div>
              <p className="text-sm text-geist-gray-700">Select a file to view its content</p>
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
      className={`flex w-full items-center gap-3.5 border-b border-geist-gray-alpha-200 px-6 py-3.5 text-left text-[13px] transition-colors last:border-0 ${
        isSelected ? 'bg-geist-gray-alpha-100' : 'hover:bg-geist-gray-alpha-100'
      }`}
    >
      {item.isDir ? (
        <IconFolder className="h-4 w-4 shrink-0 text-geist-gray-700" />
      ) : (
        <IconFile className="h-4 w-4 shrink-0 text-geist-gray-700" />
      )}
      <span
        className={`flex-1 truncate font-mono ${
          item.isDir ? 'font-medium text-geist-gray-1000' : 'text-geist-gray-900'
        }`}
      >
        {item.name}
      </span>
      {!item.isDir && (
        <span className="shrink-0 text-[11px] tabular-nums text-geist-gray-700">
          {formatSize(item.size)}
        </span>
      )}
      {item.isDir && <IconChevronRight className="h-3 w-3 shrink-0 text-geist-gray-alpha-500" />}
    </button>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
