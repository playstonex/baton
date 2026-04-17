import { useState, useEffect, useCallback } from 'react';
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

  // Auto-set path from first active agent's project
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
      // ignore
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
      // ignore
    }
  }

  const pathParts = currentPath.split('/').filter(Boolean);

  return (
    <div style={{ display: 'flex', gap: 16, height: 'calc(100dvh - 60px)' }}>
      {/* File tree panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Breadcrumb */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <BreadcrumbPart label="/" onClick={() => fetchDir('/')} />
          {pathParts.map((part, i) => {
            const path = '/' + pathParts.slice(0, i + 1).join('/');
            return (
              <span key={path} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: '#d1d5db' }}>/</span>
                <BreadcrumbPart label={part} onClick={() => fetchDir(path)} active={i === pathParts.length - 1} />
              </span>
            );
          })}
        </div>

        {/* Directory listing */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            background: '#fff',
          }}
        >
          {loading ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}>Loading...</div>
          ) : items.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}>Empty directory</div>
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
        </div>

        {/* Agent project paths */}
        {activeAgents.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {activeAgents.map((a) => (
              <button
                key={a.id}
                onClick={() => fetchDir(a.projectPath)}
                style={{
                  fontSize: 11,
                  padding: '3px 8px',
                  border: '1px solid #e5e7eb',
                  borderRadius: 4,
                  background: currentPath === a.projectPath ? '#eff6ff' : '#fff',
                  color: '#374151',
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                }}
              >
                {a.projectPath.split('/').pop()}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* File content panel */}
      <div
        style={{
          width: '55%',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          background: '#fff',
          overflow: 'hidden',
        }}
      >
        {selectedFile ? (
          <>
            <div
              style={{
                padding: '8px 12px',
                borderBottom: '1px solid #e5e7eb',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 500 }}>{selectedFile.name}</span>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>{formatSize(selectedFile.size)}</span>
            </div>
            <pre
              style={{
                flex: 1,
                overflow: 'auto',
                margin: 0,
                padding: 12,
                fontSize: 12,
                fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                lineHeight: 1.5,
                background: '#fafafa',
              }}
            >
              {selectedFile.content}
            </pre>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d1d5db' }}>
            Select a file to view its content
          </div>
        )}
      </div>
    </div>
  );
}

function BreadcrumbPart({ label, onClick, active }: { label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: 13,
        fontFamily: 'monospace',
        color: active ? '#2563eb' : '#6b7280',
        fontWeight: active ? 600 : 400,
        padding: 0,
      }}
    >
      {label || '/'}
    </button>
  );
}

function FileRow({ item, onClick, isSelected }: { item: FileEntry; onClick: () => void; isSelected: boolean }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        cursor: 'pointer',
        background: isSelected ? '#eff6ff' : 'transparent',
        borderBottom: '1px solid #f3f4f6',
        fontSize: 13,
      }}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.background = '#f9fafb';
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.background = 'transparent';
      }}
    >
      <span style={{ width: 16, textAlign: 'center', color: item.isDir ? '#2563eb' : '#9ca3af', fontSize: 12 }}>
        {item.isDir ? '📁' : '📄'}
      </span>
      <span style={{ flex: 1, fontFamily: 'monospace', fontWeight: item.isDir ? 500 : 400 }}>{item.name}</span>
      {!item.isDir && (
        <span style={{ fontSize: 11, color: '#d1d5db' }}>{formatSize(item.size)}</span>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
