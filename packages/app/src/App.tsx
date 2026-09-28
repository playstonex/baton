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

  return (
    <div className="flex h-[100dvh] bg-geist-background-200 dark:bg-geist-background-100">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 transition-opacity duration-200 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed z-40 flex h-full w-[260px] flex-col border-r border-geist-gray-alpha-400 bg-geist-background-100 transition-transform duration-200 md:static md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo */}
        <div className="flex h-14 items-center gap-2.5 px-5">
          <div className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] bg-geist-gray-1000 text-xs font-bold text-geist-background-100">
            B
          </div>
          <span className="text-sm font-semibold tracking-tight text-geist-gray-1000">Baton</span>
        </div>

        <div className="mx-5 mb-2 h-px bg-geist-gray-alpha-200" />

        {/* Navigation */}
        <nav className="flex flex-1 flex-col space-y-0.5 px-3">
          <div className="mb-2 px-3 pt-2 text-[10px] font-semibold uppercase tracking-widest text-geist-gray-800">
            Main
          </div>
          {NAV_ITEMS_MAIN.map(({ to, label, end, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-geist-gray-alpha-200 text-geist-gray-1000'
                    : 'text-geist-gray-800 hover:bg-geist-gray-alpha-100 hover:text-geist-gray-1000'
                }`
              }
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              {label}
            </NavLink>
          ))}

          <div className="mx-2 my-3 h-px bg-geist-gray-alpha-200" />

          <div className="mb-2 px-3 pt-1 text-[10px] font-semibold uppercase tracking-widest text-geist-gray-800">
            System
          </div>
          {NAV_ITEMS_SYSTEM.map(({ to, label, end, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-geist-gray-alpha-200 text-geist-gray-1000'
                    : 'text-geist-gray-800 hover:bg-geist-gray-alpha-100 hover:text-geist-gray-1000'
                }`
              }
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              {label}
            </NavLink>
          ))}

          {/* Status + Theme toggle */}
          <div className="mt-auto px-1 pt-4">
            <div className="flex items-center justify-between rounded-[var(--radius-sm)] bg-geist-gray-alpha-100 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <StatusDot status={connected ? 'connected' : 'disconnected'} />
                <span
                  className={`text-xs font-medium ${
                    connected ? 'text-geist-green-700' : 'text-geist-red-700'
                  }`}
                >
                  {connected ? 'Online' : 'Offline'}
                </span>
              </div>
              <button
                type="button"
                onClick={toggleDark}
                aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
                className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-geist-gray-800 transition-colors hover:bg-geist-gray-alpha-200 hover:text-geist-gray-1000 focus-visible:focus-ring"
              >
                <span className="relative h-4 w-4">
                  <IconMoon
                    className={`absolute inset-0 h-4 w-4 transition-all duration-300 ${
                      dark ? 'rotate-0 scale-100 opacity-100' : 'rotate-90 scale-0 opacity-0'
                    }`}
                  />
                  <IconSun
                    className={`absolute inset-0 h-4 w-4 transition-all duration-300 ${
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
        <header className="flex h-14 items-center gap-3 border-b border-geist-gray-alpha-400 bg-geist-background-100 px-4 md:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-geist-gray-800 transition-colors hover:bg-geist-gray-alpha-200 hover:text-geist-gray-1000 focus-visible:focus-ring"
            aria-label="Toggle sidebar"
          >
            <IconMenu className="h-5 w-5" />
          </button>
          <div className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] bg-geist-gray-1000 text-[10px] font-bold text-geist-background-100">
            B
          </div>
          <span className="text-sm font-semibold tracking-tight text-geist-gray-1000">Baton</span>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-[1440px] px-8 py-10 md:px-12 lg:px-16">
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
