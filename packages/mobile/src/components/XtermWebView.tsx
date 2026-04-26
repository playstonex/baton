import { forwardRef, useImperativeHandle, useRef, useCallback } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useColorScheme } from 'react-native';
import { XTERM_JS, XTERM_CSS, ADDON_FIT_JS } from './xterm-bundle';

export interface XtermWebViewRef {
  write: (data: string) => void;
}

interface XtermWebViewProps {
  onInput: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onStatus?: (loaded: boolean, error?: string) => void;
  isDark?: boolean;
}

const LIGHT_THEME = {
  background: '#fafaf9',
  foreground: '#1c1917',
  cursor: '#2383e2',
  black: '#78716c',
  red: '#dc2626',
  green: '#16a34a',
  yellow: '#ca8a04',
  blue: '#2383e2',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#292524',
  brightBlack: '#a8a29e',
  brightRed: '#ef4444',
  brightGreen: '#22c55e',
  brightYellow: '#eab308',
  brightBlue: '#3b82f6',
  brightMagenta: '#a855f7',
  brightCyan: '#06b6d4',
  brightWhite: '#1c1917',
};

const DARK_THEME = {
  background: '#191919',
  foreground: '#e8e8e8',
  cursor: '#4193ef',
  black: '#383838',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#e8e8e8',
  brightBlack: '#6b6b6b',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fcd34d',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#a5f3fc',
  brightWhite: '#ffffff',
};

function buildHtml(isDark: boolean): string {
  const theme = isDark ? DARK_THEME : LIGHT_THEME;

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <style>${XTERM_CSS}</style>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #terminal { width: 100%; height: 100%; background: ${theme.background}; overflow: hidden; }
    .xterm { height: 100%; padding: 2px; }
  </style>
</head>
<body>
  <div id="terminal"></div>
  <script>${XTERM_JS}<\/script>
  <script>${ADDON_FIT_JS}<\/script>
  <script>
    function notify(msg) {
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    }
    try {
      var term = new Terminal({
        theme: ${JSON.stringify(theme)},
        fontSize: 13,
        fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
        cursorBlink: true,
        scrollback: 5000,
        convertEol: true,
      });
      var fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);
      term.open(document.getElementById('terminal'));
      setTimeout(function() { fitAddon.fit(); notify({ type: 'resize', cols: term.cols, rows: term.rows }); }, 100);
      window.addEventListener('resize', function() { fitAddon.fit(); notify({ type: 'resize', cols: term.cols, rows: term.rows }); });
      term.onData(function(data) {
        notify({ type: 'input', data: data });
      });
      term.writeln('\\x1b[32mBaton Terminal\\x1b[0m');
      term.writeln('\\x1b[90mWaiting for agent output...\\x1b[0m');
      term.writeln('');
      window._termWrite = function(data) { term.write(data); };
      window._termFit = function() { fitAddon.fit(); };
      window._termSetTheme = function(t) { term.options.theme = t; };
      notify({ type: 'status', loaded: true });
    } catch(e) {
      notify({ type: 'status', loaded: false, error: e.message || String(e) });
    }
  <\/script>
</body>
</html>`;
}

export const XtermWebView = forwardRef<XtermWebViewRef, XtermWebViewProps>(function XtermWebView(
  { onInput, onResize, onStatus, isDark: isDarkProp },
  ref,
) {
  const webViewRef = useRef<WebView>(null);
  const systemScheme = useColorScheme();
  const isDark = isDarkProp ?? systemScheme === 'dark';

  useImperativeHandle(ref, () => ({
    write: (data: string) => {
      webViewRef.current?.injectJavaScript(`window._termWrite(${JSON.stringify(data)}); true;`);
    },
  }));

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (msg.type === 'input' && typeof msg.data === 'string') {
          onInput(msg.data);
        } else if (msg.type === 'status') {
          onStatus?.(msg.loaded, msg.error);
        } else if (msg.type === 'resize' && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
          onResize?.(msg.cols, msg.rows);
        }
      } catch {
        // ignore
      }
    },
    [onInput, onResize, onStatus],
  );

  return (
    <WebView
      ref={webViewRef}
      source={{ html: buildHtml(isDark) }}
      style={{ flex: 1, backgroundColor: isDark ? '#191919' : '#fafaf9' }}
      originWhitelist={['file:*', 'data:*']}
      onMessage={handleMessage}
      allowsBackForwardNavigationGestures={false}
      keyboardDisplayRequiresUserAction={false}
      javaScriptEnabled
      onLoadEnd={() => {
        webViewRef.current?.injectJavaScript(
          'setTimeout(function(){ window._termFit(); }, 200); true;',
        );
      }}
    />
  );
});