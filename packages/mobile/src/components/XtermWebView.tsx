import { forwardRef, useImperativeHandle, useRef, useCallback, useEffect } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useColorScheme } from 'react-native';
import { XTERM_JS, XTERM_CSS, ADDON_FIT_JS } from './xterm-bundle';
import type { TerminalTheme, TerminalFont } from '../stores/terminal-settings';
import { getTerminalThemeColors } from '../stores/terminal-settings';

export interface XtermWebViewRef {
  write: (data: string) => void;
}

interface XtermWebViewProps {
  onInput: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onStatus?: (loaded: boolean, error?: string) => void;
  isDark?: boolean;
  termFontSize?: number;
  termFontFamily?: TerminalFont;
  termThemeName?: TerminalTheme;
  termScrollback?: number;
  termCursorBlink?: boolean;
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

function buildHtml(
  isDark: boolean,
  fontSize: number,
  fontFamily: TerminalFont,
  themeName: TerminalTheme,
  scrollback: number,
  cursorBlink: boolean,
): string {
  const baseTheme = isDark ? DARK_THEME : LIGHT_THEME;
  const customTheme = getTerminalThemeColors(themeName, isDark);
  const theme = customTheme ?? baseTheme;
  const bg = (customTheme ?? baseTheme).background;

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <style>${XTERM_CSS}</style>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: ${bg}; overflow: hidden; margin: 0; padding: 0; }
    #terminal { width: 100%; height: 100%; }
    .xterm { height: 100%; padding: 0 !important; margin: 0 !important; }
    .xterm-viewport { padding: 0 !important; margin: 0 !important; }
    .xterm-screen { padding: 0 !important; margin: 0 !important; }
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
        fontSize: ${fontSize},
        fontFamily: '${fontFamily}, Menlo, Monaco, monospace',
        cursorBlink: ${cursorBlink},
        scrollback: ${scrollback},
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
      window._termSetFont = function(s) { term.options.fontSize = s; };
      window._termSetFontFamily = function(f) { term.options.fontFamily = f; };
      notify({ type: 'status', loaded: true });
    } catch(e) {
      notify({ type: 'status', loaded: false, error: e.message || String(e) });
    }
  <\/script>
</body>
</html>`;
}

export const XtermWebView = forwardRef<XtermWebViewRef, XtermWebViewProps>(function XtermWebView(
  {
    onInput,
    onResize,
    onStatus,
    isDark: isDarkProp,
    termFontSize = 13,
    termFontFamily = 'JetBrains Mono',
    termThemeName = 'default',
    termScrollback = 5000,
    termCursorBlink = true,
  },
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

  useEffect(() => {
    const customTheme = getTerminalThemeColors(termThemeName, isDark);
    if (customTheme) {
      webViewRef.current?.injectJavaScript(
        `window._termSetTheme(${JSON.stringify(customTheme)}); true;`,
      );
    }
  }, [termThemeName, isDark]);

  useEffect(() => {
    webViewRef.current?.injectJavaScript(
      `window._termSetFont(${termFontSize}); true;`,
    );
  }, [termFontSize]);

  useEffect(() => {
    webViewRef.current?.injectJavaScript(
      `window._termSetFontFamily('${termFontFamily}, Menlo, Monaco, monospace'); true;`,
    );
  }, [termFontFamily]);

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

  const html = buildHtml(isDark, termFontSize, termFontFamily, termThemeName, termScrollback, termCursorBlink);
  const bg = (() => {
    const customTheme = getTerminalThemeColors(termThemeName, isDark);
    if (customTheme) return customTheme.background;
    return isDark ? '#191919' : '#fafaf9';
  })();

  return (
    <WebView
      ref={webViewRef}
      source={{ html }}
      style={{ flex: 1, backgroundColor: bg, overflow: 'hidden' }}
      originWhitelist={['file:*', 'data:*']}
      onMessage={handleMessage}
      allowsBackForwardNavigationGestures={false}
      keyboardDisplayRequiresUserAction={false}
      javaScriptEnabled
      nestedScrollEnabled={false}
      scrollEnabled={false}
      bounces={false}
      overScrollMode="never"
      onLoadEnd={() => {
        webViewRef.current?.injectJavaScript(
          'setTimeout(function(){ window._termFit(); }, 200); true;',
        );
      }}
    />
  );
});
