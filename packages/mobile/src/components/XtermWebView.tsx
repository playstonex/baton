import { forwardRef, useImperativeHandle, useRef, useCallback } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { XTERM_JS, XTERM_CSS, ADDON_FIT_JS } from './xterm-bundle';

export interface XtermWebViewRef {
  write: (data: string) => void;
}

interface XtermWebViewProps {
  onInput: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onStatus?: (loaded: boolean, error?: string) => void;
}

function buildHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <style>${XTERM_CSS}</style>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #terminal { width: 100%; height: 100%; background: #1e1e1e; overflow: hidden; }
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
        theme: { background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#d4d4d4' },
        fontSize: 13,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
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
      term.writeln('\\x1b[32mFlowWhips Terminal\\x1b[0m');
      term.writeln('\\x1b[90mWaiting for agent output...\\x1b[0m');
      term.writeln('');
      window._termWrite = function(data) { term.write(data); };
      window._termFit = function() { fitAddon.fit(); };
      notify({ type: 'status', loaded: true });
    } catch(e) {
      notify({ type: 'status', loaded: false, error: e.message || String(e) });
    }
  <\/script>
</body>
</html>`;
}

const HTML = buildHtml();

export const XtermWebView = forwardRef<XtermWebViewRef, XtermWebViewProps>(function XtermWebView(
  { onInput, onResize, onStatus },
  ref,
) {
  const webViewRef = useRef<WebView>(null);

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
      source={{ html: HTML }}
      style={{ flex: 1, backgroundColor: '#1e1e1e' }}
      originWhitelist={['*']}
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
