import { Outlet, NavLink } from 'react-router';
import { wsService } from './services/websocket.js';
import { useEffect, useState } from 'react';

export function App() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const unsub = wsService.on('_state', () => setConnected(wsService.connected));
    setConnected(wsService.connected);

    // Auto-connect local mode on first load
    if (!wsService.connected) {
      wsService.configure({ mode: 'local' });
      wsService.connect();
    }

    return unsub;
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      {/* Header — responsive */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 16px',
          borderBottom: '1px solid #e5e7eb',
          background: '#fff',
          flexShrink: 0,
        }}
      >
        <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0, whiteSpace: 'nowrap' }}>FlowWhips</h1>
        <nav style={{ display: 'flex', gap: 4 }}>
          <NavLink
            to="/"
            end
            style={({ isActive }) => ({
              fontSize: 13,
              padding: '4px 10px',
              borderRadius: 6,
              textDecoration: 'none',
              color: isActive ? '#2563eb' : '#6b7280',
              background: isActive ? '#eff6ff' : 'transparent',
              fontWeight: isActive ? 600 : 400,
            })}
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/files"
            style={({ isActive }) => ({
              fontSize: 13,
              padding: '4px 10px',
              borderRadius: 6,
              textDecoration: 'none',
              color: isActive ? '#2563eb' : '#6b7280',
              background: isActive ? '#eff6ff' : 'transparent',
              fontWeight: isActive ? 600 : 400,
            })}
          >
            Files
          </NavLink>
          <NavLink
            to="/pipelines"
            style={({ isActive }) => ({
              fontSize: 13,
              padding: '4px 10px',
              borderRadius: 6,
              textDecoration: 'none',
              color: isActive ? '#2563eb' : '#6b7280',
              background: isActive ? '#eff6ff' : 'transparent',
              fontWeight: isActive ? 600 : 400,
            })}
          >
            Pipelines
          </NavLink>
          <NavLink
            to="/settings"
            style={({ isActive }) => ({
              fontSize: 13,
              padding: '4px 10px',
              borderRadius: 6,
              textDecoration: 'none',
              color: isActive ? '#2563eb' : '#6b7280',
              background: isActive ? '#eff6ff' : 'transparent',
              fontWeight: isActive ? 600 : 400,
            })}
          >
            Settings
          </NavLink>
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: connected ? '#22c55e' : '#ef4444',
              display: 'inline-block',
            }}
          />
          <span style={{ fontSize: 11, color: '#9ca3af' }}>
            {connected ? 'Online' : 'Offline'}
          </span>
        </div>
      </header>

      {/* Main content — fills remaining space, scrollable */}
      <main
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '16px',
          // Responsive: less padding on small screens
          ...(window.innerWidth < 640 ? { padding: '12px' } : {}),
        }}
      >
        <Outlet />
      </main>
    </div>
  );
}
