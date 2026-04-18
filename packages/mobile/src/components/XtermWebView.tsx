import { forwardRef, useImperativeHandle, useRef, useCallback } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

export interface XtermWebViewRef {
  write: (data: string) => void;
}

interface XtermWebViewProps {
  onInput: (data: string) => void;
}

const XTERM_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #terminal { width: 100%; height: 100%; background: #1e1e1e; overflow: hidden; }
    .xterm { height: 100%; padding: 2px; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js"><\/script>
  <script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js"><\/script>
</head>
<body>
  <div id="terminal"></div>
  <script>
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
    setTimeout(function() { fitAddon.fit(); }, 100);
    window.addEventListener('resize', function() { fitAddon.fit(); });
    term.onData(function(data) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'input', data: data }));
    });
    window._termWrite = function(data) { term.write(data); };
    window._termFit = function() { fitAddon.fit(); };
  </script>
</body>
</html>`;

export const XtermWebView = forwardRef<XtermWebViewRef, XtermWebViewProps>(function XtermWebView(
  { onInput },
  ref,
) {
  const webViewRef = useRef<WebView>(null);

  useImperativeHandle(ref, () => ({
    write: (data: string) => {
      webViewRef.current?.injectJavaScript(
        `window._termWrite(${JSON.stringify(data)}); true;`,
      );
    },
  }));

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (msg.type === 'input' && typeof msg.data === 'string') {
          onInput(msg.data);
        }
      } catch {
        // ignore
      }
    },
    [onInput],
  );

  return (
    <WebView
      ref={webViewRef}
      source={{ html: XTERM_HTML }}
      style={{ flex: 1, backgroundColor: '#1e1e1e' }}
      originWhitelist={['*']}
      onMessage={handleMessage}
      allowsBackForwardNavigationGestures={false}
      keyboardDisplayRequiresUserAction={false}
      javaScriptEnabled
      injectedJavaScript=""
      onLoadEnd={() => {
        webViewRef.current?.injectJavaScript('setTimeout(function(){ window._termFit(); }, 200); true;');
      }}
    />
  );
});
