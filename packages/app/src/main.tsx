import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router';
import { App } from './App.js';
import { DashboardScreen } from './screens/Dashboard.js';
import { TerminalScreen } from './screens/Terminal.js';
import { AgentDetailScreen } from './screens/AgentDetail.js';
import { SettingsScreen } from './screens/Settings.js';
import { FilesScreen } from './screens/Files.js';
import { PipelinesScreen } from './screens/Pipelines.js';
import '@xterm/xterm/css/xterm.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<DashboardScreen />} />
          <Route path="terminal/:sessionId" element={<TerminalScreen />} />
          <Route path="agent/:sessionId" element={<AgentDetailScreen />} />
          <Route path="files" element={<FilesScreen />} />
          <Route path="pipelines" element={<PipelinesScreen />} />
          <Route path="settings" element={<SettingsScreen />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
