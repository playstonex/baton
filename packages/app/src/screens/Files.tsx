import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useAgentStore } from '../stores/connection.js';
import { Card, EmptyState, LoadingSpinner, BackButton } from '../lib/ui.js';
import {
  IconChevronRight,
  IconHome,
  IconFile,
  IconFolder,
} from '../lib/icons.js';

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
  ts: 'bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400',
  tsx: 'bg-sky-100 text-sky-600 dark:bg-sky-900/50 dark:text-sky-400',
  js: 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/50 dark:text-yellow-400',
  jsx: 'bg-sky-100 text-sky-600 dark:bg-sky-900/50 dark:text-sky-400',
  json: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  css: 'bg-pink-100 text-pink-600 dark:bg-pink-900/50 dark:text-pink-400',
  html: 'bg-orange-100 text-orange-600 dark:bg-orange-900/50 dark:text-orange-400',
  md: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  py: 'bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400',
  rs: 'bg-orange-100 text-orange-600 dark:bg-orange-900/50 dark:text-orange-400',
  go: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-900/50 dark:text-cyan-400',
  toml: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  yaml: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  yml: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
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
        <span className="text-sm font-medium text-gray-500">
          {agent?.projectPath.split('/').pop() ?? 'Files'}
        </span>
        <span className="font-mono text-xs text-gray-400">{sessionId?.slice(0, 8)}</span>
      </div>

      <div className="flex flex-1 gap-6 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-5 py-3 dark:border-gray-700 dark:bg-gray-800/50">
            <button
              type="button"
              onClick={() => fetchDir('/')}
              className="font-mono text-[13px] px-1.5 text-gray-400 transition-colors hover:text-primary-500"
            >
              <IconHome className="h-3.5 w-3.5" />
            </button>
            {pathParts.map((part, i) => {
              const path = '/' + pathParts.slice(0, i + 1).join('/');
              const isLast = i === pathParts.length - 1;
              return (
                <span key={path} className="flex items-center gap-1">
                  <IconChevronRight className="h-3 w-3 text-gray-300 dark:text-gray-600" />
                  <button
                    type="button"
                    onClick={() => fetchDir(path)}
                    className={`font-mono text-[13px] px-1.5 transition-colors ${
                      isLast
                        ? 'font-semibold text-primary-600 dark:text-primary-400'
                        : 'text-gray-500 hover:text-primary-500'
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
              <LoadingSpinner text="Loading..." />
            ) : items.length === 0 ? (
              <EmptyState
                icon={<IconFolder className="h-6 w-6 text-gray-400" />}
                title="Empty directory"
              />
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

        <Card className="hidden w-[55%] overflow-hidden sm:flex flex-col" padding={false}>
          {selectedFile ? (
            <>
              <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-5 py-3.5 dark:border-gray-700">
                <div className="flex items-center gap-2.5">
                  <IconFile className="h-4 w-4 text-gray-400" />
                  <span className="text-[13px] font-medium text-gray-900 dark:text-white">{selectedFile.name}</span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-gray-400">
                  {selectedFile.ext && (
                    <span className={`rounded px-1.5 py-0.5 font-mono uppercase text-[11px] ${FILE_EXT_ICONS[selectedFile.ext] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}>
                      {selectedFile.ext}
                    </span>
                  )}
                  <span>{lineCount} lines</span>
                  <span>{formatSize(selectedFile.size)}</span>
                </div>
              </div>
              <div className="flex-1 overflow-auto bg-gray-50/50 dark:bg-gray-950/50">
                <pre className="p-5 font-mono text-xs leading-relaxed text-gray-700 dark:text-gray-300">
                  {selectedFile.content}
                </pre>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center text-center p-6">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
                <IconFile className="h-6 w-6 text-gray-300 dark:text-gray-600" />
              </div>
              <p className="text-sm text-gray-400">Select a file to view its content</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function FileRow({ item, onClick, isSelected }: { item: FileEntry; onClick: () => void; isSelected: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3.5 border-b border-gray-100 px-6 py-3.5 text-left text-[13px] transition-all duration-150 last:border-0 dark:border-gray-700/50 ${
        isSelected
          ? 'bg-primary-50 dark:bg-primary-950/30'
          : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
      }`}
    >
      {item.isDir ? (
        <IconFolder className="h-4 w-4 shrink-0 text-gray-400" />
      ) : (
        <IconFile className="h-4 w-4 shrink-0 text-gray-400" />
      )}
      <span className={`flex-1 truncate font-mono ${item.isDir ? 'font-medium text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'}`}>
        {item.name}
      </span>
      {!item.isDir && (
        <span className="shrink-0 text-[11px] tabular-nums text-gray-300 dark:text-gray-500">
          {formatSize(item.size)}
        </span>
      )}
      {item.isDir && (
        <IconChevronRight className="h-3 w-3 shrink-0 text-gray-300 dark:text-gray-600" />
      )}
    </button>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
