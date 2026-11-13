import React, { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { SidebarLayout } from '../../src/components/SidebarLayout';
import { NewChatView } from '../../src/components/NewChatView';

export default function DashboardScreen() {
  const router = useRouter();

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      router.push(`/chat/${sessionId}`);
    },
    [router],
  );

  const handleStartSession = useCallback(
    (sessionId: string) => {
      router.push(`/chat/${sessionId}`);
    },
    [router],
  );

  return (
    <SidebarLayout
      onSelectSession={handleSelectSession}
      onNewChat={() => {
        // already on new chat view
      }}
    >
      {({ isWide, openSidebar, toggleSidebar }) => (
        <NewChatView
          onStartSession={handleStartSession}
          onOpenSidebar={openSidebar}
          onToggleSidebar={toggleSidebar}
          isWide={isWide}
        />
      )}
    </SidebarLayout>
  );
}
