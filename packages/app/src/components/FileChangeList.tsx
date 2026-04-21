interface FileChangeListProps {
  fileChanges: Array<{ path: string; changeType: string }>;
}

export function FileChangeList({ fileChanges }: FileChangeListProps) {
  if (fileChanges.length === 0) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <h3 style={{ fontSize: 14, marginBottom: 8 }}>File Changes</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {fileChanges.map((change, i) => (
          <FileChangeRow key={i} path={change.path} changeType={change.changeType} />
        ))}
      </div>
    </div>
  );
}

const CHANGE_COLORS: Record<string, { bg: string; text: string }> = {
  create: { bg: '#dcfce7', text: '#166534' },
  modify: { bg: '#dbeafe', text: '#1e40af' },
  delete: { bg: '#fef2f2', text: '#991b1b' },
};

function FileChangeRow({ path, changeType }: { path: string; changeType: string }) {
  const color = CHANGE_COLORS[changeType] ?? CHANGE_COLORS.modify;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        background: '#fff',
        borderRadius: 4,
        border: '1px solid #f3f4f6',
      }}
    >
      <span
        style={{
          fontSize: 10,
          padding: '1px 6px',
          borderRadius: 3,
          background: color.bg,
          color: color.text,
          fontWeight: 500,
          textTransform: 'uppercase',
        }}
      >
        {changeType}
      </span>
      <span style={{ fontSize: 13, fontFamily: 'monospace' }}>{path}</span>
    </div>
  );
}