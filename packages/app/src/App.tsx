import { Outlet, NavLink, useLocation } from 'react-router';
import { wsService } from './services/websocket.js';
import { useEffect, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  IconDashboard,
  IconPipelines,
  IconAnalytics,
  IconOrchestration,
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
    <div className="flex h-[100dvh] bg-gray-50 dark:bg-gray-950">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 backdrop-blur-sm md:hidden transition-opacity duration-200"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed z-40 flex h-full w-[260px] flex-col border-r border-gray-200 bg-white/90 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-950/90 transition-transform duration-200 md:static md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo */}
        <div className="flex h-14 items-center gap-2.5 px-5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-xs font-bold text-white shadow-sm">
            B
          </div>
          <span className="text-sm font-semibold tracking-tight text-gray-900 dark:text-white">
            Baton
          </span>
        </div>

        <div className="mx-5 mb-2 h-px bg-gray-100 dark:bg-gray-800" />

        {/* Navigation */}
        <nav className="flex flex-1 flex-col space-y-0.5 px-3">
          <div className="mb-2 px-3 pt-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
            Main
          </div>
          {NAV_ITEMS_MAIN.map(({ to, label, end, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/50 dark:hover:text-gray-200'
                }`
              }
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              {label}
            </NavLink>
          ))}

          <div className="mx-2 my-3 h-px bg-gray-100 dark:bg-gray-800" />

          <div className="mb-2 px-3 pt-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
            System
          </div>
          {NAV_ITEMS_SYSTEM.map(({ to, label, end, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/50 dark:hover:text-gray-200'
                }`
              }
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              {label}
            </NavLink>
          ))}

          {/* Status + Theme toggle */}
          <div className="mt-auto px-1 pt-4">
            <div className="flex items-center justify-between rounded-lg bg-gray-50/80 px-3 py-2.5 dark:bg-gray-800/40">
              <div className="flex items-center gap-2">
                <StatusDot status={connected ? 'connected' : 'disconnected'} />
                <span
                  className={`text-xs font-medium ${
                    connected
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {connected ? 'Online' : 'Offline'}
                </span>
              </div>
              <button
                type="button"
                onClick={toggleDark}
                aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
                className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
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
        <header className="flex h-14 items-center gap-3 border-b border-gray-200/80 bg-white/80 px-4 backdrop-blur-xl dark:border-gray-800/50 dark:bg-gray-950/80 md:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            aria-label="Toggle sidebar"
          >
            <IconMenu className="h-5 w-5" />
          </button>
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-600 text-[10px] font-bold text-white">
            B
          </div>
          <span className="text-sm font-semibold tracking-tight text-gray-900 dark:text-white">
            Baton
          </span>
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
