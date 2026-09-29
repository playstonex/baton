import { Outlet, NavLink, useLocation } from 'react-router';
import { wsService } from './services/websocket.js';
import { useEffect, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  IconDashboard,
  IconPipelines,
  IconAnalytics,
  IconOrchestration,
  IconGitBranch,
  IconServer,
  IconApiProviders,
  IconSettings,
  IconMoon,
  IconSun,
  IconMenu,
  StatusDot,
} from './lib/icons.js';

const NAV_ITEMS_MAIN = [
  { to: '/', label: 'Dashboard', end: true, icon: IconDashboard },
  { to: '/pipelines', label: 'Pipelines', end: false, icon: IconPipelines },
  { to: '/analytics', label: 'Analytics', end: false, icon: IconAnalytics },
  { to: '/orchestration', label: 'Orchestration', end: false, icon: IconOrchestration },
  { to: '/pull-requests', label: 'Pull Requests', end: false, icon: IconGitBranch },
  { to: '/worktrees', label: 'Worktrees', end: false, icon: IconServer },
] as const;

const NAV_ITEMS_SYSTEM = [
  { to: '/api-providers', label: 'API Providers', end: false, icon: IconApiProviders },
  { to: '/settings', label: 'Settings', end: false, icon: IconSettings },
] as const;

export function App() {
  const location = useLocation();
  const [connected, setConnected] = useState(false);
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('baton-theme');
    if (stored === 'dark') return true;
    if (stored === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  // With no explicit choice stored, keep following the OS light/dark setting
  // live (the old useTheme 'system' mode did this). An explicit toggle writes
  // localStorage, after which OS changes are ignored.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem('baton-theme')) setDark(e.matches);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const unsub = wsService.on('_state', () => setConnected(wsService.connected));
    setConnected(wsService.connected);

    if (!wsService.connected) {
      wsService.configure({ mode: 'local' });
      wsService.connect();
    }

    return unsub;
  }, []);

  const toggleDark = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      localStorage.setItem('baton-theme', next ? 'dark' : 'light');
      return next;
    });
  }, []);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-sm px-2.5 py-[7px] text-[13px] font-medium transition-colors duration-150 ${
      isActive
        ? 'bg-raised text-fg'
        : 'text-fg-2 hover:bg-raised/60 hover:text-fg'
    }`;

  return (
    <div className="flex h-[100dvh] bg-canvas">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-overlay transition-opacity duration-200 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed z-40 flex h-full w-[240px] flex-col border-r border-line-soft bg-panel transition-transform duration-200 md:static md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo */}
        <div className="flex h-14 items-center gap-2.5 px-5">
          <div className="flex h-6 w-6 items-center justify-center rounded-sm bg-accent text-[11px] font-bold text-accent-on">
            B
          </div>
          <span className="text-[13px] font-semibold tracking-tight text-fg">Baton</span>
        </div>

        {/* Navigation */}
        <nav className="flex flex-1 flex-col space-y-0.5 overflow-y-auto px-3">
          <div className="mb-1.5 px-2.5 pt-3 text-[11px] font-medium uppercase tracking-[0.08em] text-meta">
            Main
          </div>
          {NAV_ITEMS_MAIN.map(({ to, label, end, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setSidebarOpen(false)}
              className={navLinkClass}
            >
              <Icon
                className={`h-4 w-4 shrink-0 ${location.pathname === to ? 'text-fg-2' : 'text-muted'}`}
              />
              {label}
            </NavLink>
          ))}

          <div className="mx-2 my-3 h-px bg-line-soft" />

          <div className="mb-1.5 px-2.5 pt-1 text-[11px] font-medium uppercase tracking-[0.08em] text-meta">
            System
          </div>
          {NAV_ITEMS_SYSTEM.map(({ to, label, end, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setSidebarOpen(false)}
              className={navLinkClass}
            >
              <Icon
                className={`h-4 w-4 shrink-0 ${location.pathname === to ? 'text-fg-2' : 'text-muted'}`}
              />
              {label}
            </NavLink>
          ))}

          {/* Status + Theme toggle */}
          <div className="mt-auto px-1 pb-4 pt-4">
            <div className="flex items-center justify-between rounded-sm bg-raised/60 px-2.5 py-2">
              <div className="flex items-center gap-2">
                <StatusDot status={connected ? 'connected' : 'disconnected'} />
                <span
                  className={`text-xs font-medium ${
                    connected ? 'text-success' : 'text-danger'
                  }`}
                >
                  {connected ? 'Online' : 'Offline'}
                </span>
              </div>
              <button
                type="button"
                onClick={toggleDark}
                aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
                className="flex h-6 w-6 items-center justify-center rounded-sm text-muted transition-colors hover:bg-active hover:text-fg focus-visible:focus-ring"
              >
                <span className="relative h-3.5 w-3.5">
                  <IconMoon
                    className={`absolute inset-0 h-3.5 w-3.5 transition-all duration-300 ${
                      dark ? 'rotate-0 scale-100 opacity-100' : 'rotate-90 scale-0 opacity-0'
                    }`}
                  />
                  <IconSun
                    className={`absolute inset-0 h-3.5 w-3.5 transition-all duration-300 ${
                      dark ? '-rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100'
                    }`}
                  />
                </span>
              </button>
            </div>
          </div>
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile header */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line-soft bg-panel px-4 md:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="flex h-8 w-8 items-center justify-center rounded-sm text-muted transition-colors hover:bg-raised hover:text-fg focus-visible:focus-ring"
            aria-label="Toggle sidebar"
          >
            <IconMenu className="h-4.5 w-4.5" />
          </button>
          <div className="flex h-6 w-6 items-center justify-center rounded-sm bg-accent text-[11px] font-bold text-accent-on">
            B
          </div>
          <span className="text-[13px] font-semibold tracking-tight text-fg">Baton</span>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-[1200px] px-6 py-8 md:px-10 md:py-10">
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}
