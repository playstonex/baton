import { Outlet, NavLink } from 'react-router';
import { Button } from '@heroui/react';
import { wsService } from './services/websocket.js';
import { useEffect, useState, useCallback } from 'react';

const NAV_ITEMS_MAIN = [
  { to: '/', label: 'Dashboard', end: true, icon: DashboardIcon },
  { to: '/files', label: 'Files', end: false, icon: FilesIcon },
  { to: '/pipelines', label: 'Pipelines', end: false, icon: PipelinesIcon },
] as const;

const NAV_ITEMS_SYSTEM = [
  { to: '/settings', label: 'Settings', end: false, icon: SettingsIcon },
] as const;

export function App() {
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
    <div className="flex h-[100dvh] bg-surface-50 dark:bg-surface-950">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm md:hidden transition-opacity duration-200"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed z-40 flex h-full w-[260px] flex-col border-r border-surface-100 bg-white/80 backdrop-blur-xl dark:border-surface-800/60 dark:bg-surface-950/80 transition-transform duration-200 md:static md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-14 items-center gap-2.5 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 text-xs font-bold text-white shadow-sm shadow-primary-500/25">
            B
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-surface-900 dark:text-white">
            Baton
          </span>
        </div>

        <div className="mx-4 mb-2 h-px bg-surface-100 dark:bg-surface-800/60" />

        <nav className="flex-1 space-y-0.5 px-3">
          <div className="mb-1.5 px-2 pt-1 text-[10px] font-semibold uppercase tracking-widest text-surface-400 dark:text-surface-600">
            Main
          </div>
          {NAV_ITEMS_MAIN.map(({ to, label, end, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `group relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-primary-50 text-primary-700 dark:bg-primary-950/60 dark:text-primary-400'
                    : 'text-surface-500 hover:bg-surface-50 hover:text-surface-900 dark:text-surface-400 dark:hover:bg-surface-800/40 dark:hover:text-surface-200'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-primary-600 dark:bg-primary-400" />
                  )}
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  {label}
                </>
              )}
            </NavLink>
          ))}

          <div className="mx-1 my-3 h-px bg-surface-100 dark:bg-surface-800/60" />

          <div className="mb-1.5 px-2 pt-1 text-[10px] font-semibold uppercase tracking-widest text-surface-400 dark:text-surface-600">
            System
          </div>
          {NAV_ITEMS_SYSTEM.map(({ to, label, end, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `group relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-primary-50 text-primary-700 dark:bg-primary-950/60 dark:text-primary-400'
                    : 'text-surface-500 hover:bg-surface-50 hover:text-surface-900 dark:text-surface-400 dark:hover:bg-surface-800/40 dark:hover:text-surface-200'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-primary-600 dark:bg-primary-400" />
                  )}
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mx-3 mb-1 h-px bg-surface-100 dark:bg-surface-800/60" />

        <div className="p-3">
          <div className="flex items-center justify-between rounded-xl bg-surface-50/80 px-3 py-2 dark:bg-surface-800/30">
            <div className="flex items-center gap-1.5">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  connected ? 'bg-success-500' : 'bg-danger-500'
                } ${connected ? 'animate-pulse-dot' : ''}`}
              />
              <span
                className={`text-xs font-medium ${
                  connected
                    ? 'text-success-600 dark:text-success-400'
                    : 'text-danger-600 dark:text-danger-400'
                }`}
              >
                {connected ? 'Online' : 'Offline'}
              </span>
            </div>
            <Button
              variant="ghost"
              isIconOnly
              size="sm"
              onPress={toggleDark}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="text-surface-400 transition-all duration-300 hover:text-surface-700 dark:text-surface-500 dark:hover:text-surface-300"
            >
              <span className="relative h-4 w-4">
                <MoonIcon
                  className={`absolute inset-0 h-4 w-4 transition-all duration-300 ${
                    dark ? 'rotate-0 scale-100 opacity-100' : 'rotate-90 scale-0 opacity-0'
                  }`}
                />
                <SunIcon
                  className={`absolute inset-0 h-4 w-4 transition-all duration-300 ${
                    dark ? '-rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100'
                  }`}
                />
              </span>
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center gap-3 border-b border-surface-200/80 bg-white/80 px-4 backdrop-blur-xl dark:border-surface-800/40 dark:bg-surface-950/80 md:hidden">
          <Button
            variant="ghost"
            isIconOnly
            size="sm"
            onPress={() => setSidebarOpen(!sidebarOpen)}
            className="text-surface-600 dark:text-surface-400"
          >
            <MenuIcon className="h-5 w-5" />
          </Button>
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-primary-500 to-primary-700 text-[10px] font-bold text-white shadow-sm shadow-primary-500/25">
            B
          </div>
          <span className="text-sm font-semibold tracking-tight text-surface-900 dark:text-white">
            Baton
          </span>
        </header>

        <main className="flex-1 overflow-auto bg-surface-50/50 dark:bg-surface-950/50">
          <div className="mx-auto max-w-[1440px] p-6 md:p-8 lg:p-10">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function DashboardIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
    </svg>
  );
}

function FilesIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h4.172a1 1 0 0 1 .707.293l1.328 1.328a1 1 0 0 0 .707.293H12.5A1.5 1.5 0 0 1 14 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9Z" />
    </svg>
  );
}

function PipelinesIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="3" cy="8" r="2" />
      <circle cx="13" cy="8" r="2" />
      <circle cx="8" cy="8" r="2" />
      <path d="M5 8h1M10 8h1" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 8.5A5.5 5.5 0 0 1 7.5 2 6 6 0 1 0 14 8.5Z" />
    </svg>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
    </svg>
  );
}

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 3.5h12" strokeWidth="1.5" />
      <path d="M2 8h12" strokeWidth="1.5" />
      <path d="M2 12.5h12" strokeWidth="1.5" />
    </svg>
  );
}
