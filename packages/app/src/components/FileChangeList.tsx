import { Card, CardContent, Chip } from '@heroui/react';

interface FileChangeListProps {
  fileChanges: Array<{ path: string; changeType: string }>;
}

const CHANGE_COLOR: Record<string, 'success' | 'accent' | 'danger'> = {
  create: 'success',
  modify: 'accent',
  delete: 'danger',
};

export function FileChangeList({ fileChanges }: FileChangeListProps) {
  if (fileChanges.length === 0) return null;

  return (
    <div className="mb-5 space-y-2">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">File Changes</h3>
      <div className="space-y-1.5">
        {fileChanges.map((change, i) => (
          <Card key={i}>
            <CardContent className="flex items-center gap-2.5 px-4 py-2">
              <Chip size="sm" variant="soft" color={CHANGE_COLOR[change.changeType] ?? 'accent'}>
                {change.changeType}
              </Chip>
              <span className="truncate font-mono text-[13px] text-gray-700 dark:text-gray-300">{change.path}</span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
