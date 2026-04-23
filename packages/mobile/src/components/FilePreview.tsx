import { useMemo } from 'react';
import { WebView } from 'react-native-webview';

type FileCategory = 'code' | 'markdown' | 'html' | 'text';

const CODE_EXTENSIONS: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin',
  swift: 'swift', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
  cs: 'csharp', rb: 'ruby', php: 'php', sh: 'bash', bash: 'bash',
  zsh: 'bash', sql: 'sql', r: 'r', scala: 'scala', lua: 'lua',
  dart: 'dart', yaml: 'yaml', yml: 'yaml', json: 'json', xml: 'xml',
  css: 'css', scss: 'scss', less: 'less', toml: 'ini', ini: 'ini',
  dockerfile: 'dockerfile', makefile: 'makefile', gradle: 'groovy',
  mdx: 'markdown',
};

function classifyFile(name: string): { category: FileCategory; lang?: string } {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const base = name.split('/').pop()?.toLowerCase() ?? '';

  if (ext === 'md' || ext === 'markdown') return { category: 'markdown' };
  if (ext === 'html' || ext === 'htm') return { category: 'html' };
  if (CODE_EXTENSIONS[ext]) return { category: 'code', lang: CODE_EXTENSIONS[ext] };
  if (['dockerfile', 'makefile'].includes(base)) return { category: 'code', lang: base };
  if (base === '.gitignore' || base === '.env' || base.startsWith('.env.')) return { category: 'code', lang: 'bash' };
  return { category: 'text' };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const HLJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js';

const THEME_CSS = `
pre code.hljs{display:block;overflow-x:auto;padding:1em}
code.hljs{padding:3px 5px}
.hljs{color:#c9d1d9;background:#0d1117}
.hljs-keyword,.hljs-selector-tag{color:#ff7b72}
.hljs-literal{color:#79c0ff}
.hljs-section{color:#ffa657}
.hljs-link{color:#ffa657}
.hljs-string,.hljs-doctag{color:#a5d6ff}
.hljs-title,.hljs-name{color:#d2a8ff}
.hljs-type,.hljs-class{color:#ffa657}
.hljs-attr,.hljs-attribute{color:#79c0ff}
.hljs-variable,.hljs-template-variable{color:#ffa657}
.hljs-regexp{color:#a5d6ff}
.hljs-symbol,.hljs-bullet{color:#f2cc60}
.hljs-built_in{color:#ffa657}
.hljs-number{color:#79c0ff}
.hljs-comment{color:#8b949e;font-style:italic}
.hljs-meta{color:#79c0ff}
.hljs-params{color:#c9d1d9}
.hljs-addition{color:#aff5b4;background:rgba(46,160,67,.15)}
.hljs-deletion{color:#ffdcd7;background:rgba(248,81,73,.15)}
.hljs-property{color:#79c0ff}
.hljs-function{color:#d2a8ff}
.hljs-tag{color:#7ee787}
.hljs-subst{color:#c9d1d9}
`;

const BASE_STYLE = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,'SF Pro Text','Helvetica Neue',sans-serif;line-height:1.6;-webkit-text-size-adjust:100%}
`;

function buildMarkdownHtml(content: string): string {
  const body = content
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^---$/gm, '<hr/>')
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code class="language-${lang || 'plaintext'}">${esc(code.trimEnd())}</code></pre>`
    )
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');

  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>${BASE_STYLE}
body{padding:16px;color:#1a1a1a;background:#fff}
h1{font-size:24px;font-weight:700;margin:20px 0 12px}
h2{font-size:20px;font-weight:700;margin:18px 0 10px;border-bottom:1px solid #e5e7eb;padding-bottom:6px}
h3{font-size:17px;font-weight:600;margin:14px 0 8px}
h4{font-size:15px;font-weight:600;margin:12px 0 6px}
p{margin:8px 0}
code{font-family:'SF Mono',Menlo,monospace;font-size:13px;background:#f1f3f5;padding:2px 6px;border-radius:4px}
pre{margin:12px 0;border-radius:8px;overflow-x:auto}
pre code{display:block;padding:14px;font-size:12px;line-height:1.5;border-radius:8px}
blockquote{border-left:3px solid #2563eb;padding:4px 12px;margin:8px 0;color:#6b7280;background:#f8fafc;border-radius:0 4px 4px 0}
li{margin:4px 0 4px 20px}
a{color:#2563eb;text-decoration:none}
hr{border:none;border-top:1px solid #e5e7eb;margin:16px 0}
${THEME_CSS}
</style>
<script src="${HLJS_CDN}"></script>
</head><body><p>${body}</p>
<script>document.querySelectorAll('pre code').forEach(function(b){try{hljs.highlightElement(b)}catch(e){}});</script>
</body></html>`;
}

function buildCodeHtml(content: string, lang: string, fileName: string): string {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>${BASE_STYLE}
body{background:#0d1117;color:#c9d1d9;font-family:'SF Mono',Menlo,Monaco,monospace;font-size:12px;line-height:1.6}
.hdr{padding:8px 14px;background:#161b22;border-bottom:1px solid #30363d;display:flex;align-items:center;gap:8px;position:sticky;top:0;z-index:10}
.hdr .lang{color:#58a6ff;font-size:11px;background:#0d1117;padding:2px 8px;border-radius:4px;font-weight:600;border:1px solid #30363d}
.hdr .name{color:#8b949e;font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wrap{display:flex}
.ln{padding:12px 8px 12px 14px;text-align:right;color:#484f58;user-select:none;font-size:12px;line-height:1.6;min-width:44px;border-right:1px solid #21262d;flex-shrink:0}
.cd{padding:12px 14px;overflow-x:auto;flex:1}
pre{margin:0;white-space:pre}
.hljs{background:transparent;padding:0}
${THEME_CSS.replace(/background:#0d1117/g, 'background:transparent').replace(/color:#c9d1d9;/g, 'color:#c9d1d9;')}
</style>
<script src="${HLJS_CDN}"></script>
</head><body>
<div class="hdr"><span class="lang">${esc(lang)}</span><span class="name">${esc(fileName)}</span></div>
<div class="wrap"><div class="ln" id="ln"></div><div class="cd"><pre><code class="language-${esc(lang)} hljs" id="code">${esc(content)}</code></pre></div></div>
<script>
try{hljs.highlightElement(document.getElementById('code'))}catch(e){}
var c=document.getElementById('code'),ln=document.getElementById('ln'),n=c.textContent.split('\\n').length,s='';
for(var i=1;i<=n;i++)s+=i+'\\n';
ln.textContent=s;
</script>
</body></html>`;
}

function buildTextHtml(content: string, fileName: string): string {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>${BASE_STYLE}
body{background:#fafafa;color:#333;font-family:'SF Mono',Menlo,monospace;font-size:12px;line-height:1.6}
.hdr{padding:8px 14px;background:#fff;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:12px;font-family:-apple-system,sans-serif}
pre{padding:14px;white-space:pre-wrap;word-break:break-all}
</style>
</head><body>
<div class="hdr">${esc(fileName)}</div>
<pre>${esc(content)}</pre>
</body></html>`;
}

function buildHtmlPreview(content: string): string {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>${BASE_STYLE}
body{margin:0;padding:0}
.bar{padding:6px 14px;background:#f8fafc;border-bottom:1px solid #e5e7eb;font-size:11px;color:#94a3b8;font-family:-apple-system,sans-serif}
iframe{border:none;width:100%;height:calc(100vh - 28px)}
</style>
</head><body>
<div class="bar">HTML Preview</div>
<iframe srcdoc="${esc(content)}"></iframe>
</body></html>`;
}

interface FilePreviewProps {
  fileName: string;
  content: string;
}

export function FilePreview({ fileName, content }: FilePreviewProps) {
  const html = useMemo(() => {
    const { category, lang } = classifyFile(fileName);
    switch (category) {
      case 'markdown': return buildMarkdownHtml(content);
      case 'html': return buildHtmlPreview(content);
      case 'code': return buildCodeHtml(content, lang ?? 'plaintext', fileName);
      default: return buildTextHtml(content, fileName);
    }
  }, [fileName, content]);

  return (
    <WebView
      source={{ html }}
      style={{ flex: 1, backgroundColor: '#0d1117' }}
      originWhitelist={['*']}
      javaScriptEnabled
      showsVerticalScrollIndicator={false}
    />
  );
}
