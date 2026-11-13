import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface ReviewFinding {
  severity: 'P0' | 'P1' | 'P2';
  title: string;
  file?: string;
  line?: number;
  category?: string;
  explanation: string;
  suggestedFix?: string;
}

export interface ReviewChecklistItem {
  checked: boolean;
  text: string;
}

export interface ParsedReviewDoc {
  title: string;
  target?: string;
  author?: string;
  date?: string;
  summary: string;
  checklist: ReviewChecklistItem[];
  findings: ReviewFinding[];
  positiveObservations: string[];
}

export interface DiffLine {
  type: 'add' | 'del' | 'normal' | 'hunk';
  oldLine?: number;
  newLine?: number;
  content: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiffItem {
  path: string;
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface GenerateReviewOptions {
  repoPath: string;
  reviewMarkdown?: string;
  targetRef?: string;
  outputPath?: string;
}

/** Run git in cwd and return stdout */
function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`git ${args.join(' ')} failed (${code}): ${stderr.trim()}`));
    });
  });
}

/** Parses structured review markdown */
export function parseReviewMarkdown(md: string): ParsedReviewDoc {
  const lines = md.split('\n');
  let title = 'Code Review Report';
  let target = '';
  let author = '';
  let date = '';
  const summaryLines: string[] = [];
  const checklist: ReviewChecklistItem[] = [];
  const findings: ReviewFinding[] = [];
  const positiveObservations: string[] = [];

  let section: 'header' | 'summary' | 'checklist' | 'findings' | 'positive' | 'other' = 'header';
  let currentFinding: Partial<ReviewFinding> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('# ') && section === 'header') {
      title = trimmed.slice(2).trim();
      continue;
    }

    if (trimmed.startsWith('**Target**:')) {
      target = trimmed.replace('**Target**:', '').trim();
      continue;
    }
    if (trimmed.startsWith('**Author**:')) {
      author = trimmed.replace('**Author**:', '').trim();
      continue;
    }
    if (trimmed.startsWith('**Date**:')) {
      date = trimmed.replace('**Date**:', '').trim();
      continue;
    }

    if (trimmed.startsWith('## Executive Summary')) {
      section = 'summary';
      continue;
    }
    if (trimmed.startsWith('## Review Checklist')) {
      section = 'checklist';
      continue;
    }
    if (trimmed.startsWith('## Findings')) {
      section = 'findings';
      continue;
    }
    if (trimmed.startsWith('## Positive Observations')) {
      if (currentFinding && currentFinding.title) {
        findings.push(currentFinding as ReviewFinding);
        currentFinding = null;
      }
      section = 'positive';
      continue;
    }

    if (section === 'summary') {
      if (trimmed.startsWith('## ')) {
        section = 'other';
      } else {
        summaryLines.push(line);
      }
    } else if (section === 'checklist') {
      if (
        trimmed.startsWith('- [ ]') ||
        trimmed.startsWith('- [x]') ||
        trimmed.startsWith('- [X]')
      ) {
        const checked = trimmed.startsWith('- [x]') || trimmed.startsWith('- [X]');
        const text = trimmed.slice(5).trim();
        checklist.push({ checked, text });
      }
    } else if (section === 'findings') {
      const findingMatch = trimmed.match(/^###\s*\[(P0|P1|P2)\]\s*(.+)$/i);
      if (findingMatch) {
        if (currentFinding && currentFinding.title) {
          findings.push(currentFinding as ReviewFinding);
        }
        currentFinding = {
          severity: findingMatch[1].toUpperCase() as 'P0' | 'P1' | 'P2',
          title: findingMatch[2].trim(),
          explanation: '',
        };
        continue;
      }

      if (currentFinding) {
        if (trimmed.startsWith('- **File**:') || trimmed.startsWith('- **file**:')) {
          const fileRaw = trimmed
            .replace(/- \*\*[Ff]ile\*\*:/, '')
            .replace(/`/g, '')
            .trim();
          const [filePath, lineStr] = fileRaw.split(':');
          currentFinding.file = filePath.trim();
          if (lineStr) currentFinding.line = parseInt(lineStr, 10);
        } else if (trimmed.startsWith('- **Category**:') || trimmed.startsWith('- **category**:')) {
          currentFinding.category = trimmed.replace(/- \*\*[Cc]ategory\*\*:/, '').trim();
        } else if (
          trimmed.startsWith('- **Explanation**:') ||
          trimmed.startsWith('- **explanation**:')
        ) {
          currentFinding.explanation = trimmed.replace(/- \*\*[Ee]xplanation\*\*:/, '').trim();
        } else {
          currentFinding.explanation = ((currentFinding.explanation ?? '') + '\n' + line).trim();
        }
      }
    } else if (section === 'positive') {
      if (trimmed.startsWith('- ')) {
        positiveObservations.push(trimmed.slice(2).trim());
      }
    }
  }

  if (currentFinding && currentFinding.title) {
    findings.push(currentFinding as ReviewFinding);
  }

  return {
    title,
    target: target || undefined,
    author: author || undefined,
    date: date || new Date().toISOString().slice(0, 10),
    summary: summaryLines.join('\n').trim(),
    checklist,
    findings,
    positiveObservations,
  };
}

/** Parses unified git diff string into structured file items */
export function parseUnifiedDiff(rawDiff: string): FileDiffItem[] {
  const files: FileDiffItem[] = [];
  const fileChunks = rawDiff.split(/^diff --git /m).filter(Boolean);

  for (const chunk of fileChunks) {
    const lines = chunk.split('\n');
    const headerLine = lines[0] ?? '';
    // e.g. "a/path/to/file b/path/to/file"
    const match = headerLine.match(/a\/(.+?)\s+b\/(.+)/);
    const path = match ? match[2] : (headerLine.split(' ').pop() ?? 'unknown');

    let status: FileDiffItem['status'] = 'modified';
    if (chunk.includes('new file mode')) status = 'added';
    else if (chunk.includes('deleted file mode')) status = 'deleted';
    else if (chunk.includes('similarity index') || chunk.includes('rename from'))
      status = 'renamed';

    let additions = 0;
    let deletions = 0;
    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;
    let oldLineNum = 0;
    let newLineNum = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('@@')) {
        const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
        if (hunkMatch) {
          oldLineNum = parseInt(hunkMatch[1], 10);
          newLineNum = parseInt(hunkMatch[2], 10);
        }
        currentHunk = { header: line, lines: [] };
        hunks.push(currentHunk);
        continue;
      }

      if (!currentHunk) continue;

      if (line.startsWith('+')) {
        additions++;
        currentHunk.lines.push({
          type: 'add',
          newLine: newLineNum++,
          content: line.slice(1),
        });
      } else if (line.startsWith('-')) {
        deletions++;
        currentHunk.lines.push({
          type: 'del',
          oldLine: oldLineNum++,
          content: line.slice(1),
        });
      } else if (line.startsWith(' ') || line === '') {
        currentHunk.lines.push({
          type: 'normal',
          oldLine: oldLineNum++,
          newLine: newLineNum++,
          content: line.startsWith(' ') ? line.slice(1) : line,
        });
      }
    }

    files.push({
      path,
      status,
      additions,
      deletions,
      hunks,
    });
  }

  return files;
}

/** Escapes HTML characters */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Builds the standalone self-contained HTML report.
 */
export async function generateStandaloneReviewReport(options: GenerateReviewOptions): Promise<{
  html: string;
  outputPath: string;
  stats: {
    filesCount: number;
    additions: number;
    deletions: number;
    p0: number;
    p1: number;
    p2: number;
  };
}> {
  const repo = options.repoPath;
  let rawDiff = '';
  try {
    // Stage intent-to-add so untracked new files also show up in diff
    await git(repo, ['add', '-N', '.']).catch(() => {});
    const diffArgs = options.targetRef
      ? ['diff', options.targetRef, '--no-color']
      : ['diff', 'HEAD', '--no-color'];
    rawDiff = await git(repo, diffArgs);
  } catch {
    rawDiff = await git(repo, ['diff', '--no-color']).catch(() => '');
  }

  const files = parseUnifiedDiff(rawDiff);
  const doc = options.reviewMarkdown
    ? parseReviewMarkdown(options.reviewMarkdown)
    : {
        title: 'Working Tree Code Review',
        date: new Date().toISOString().slice(0, 10),
        summary: 'Automatic review snapshot for current uncommitted changes.',
        checklist: [],
        findings: [],
        positiveObservations: [],
      };

  const totalAdditions = files.reduce((acc, f) => acc + f.additions, 0);
  const totalDeletions = files.reduce((acc, f) => acc + f.deletions, 0);
  const p0Count = doc.findings.filter((f) => f.severity === 'P0').length;
  const p1Count = doc.findings.filter((f) => f.severity === 'P1').length;
  const p2Count = doc.findings.filter((f) => f.severity === 'P2').length;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(doc.title)} · Baton Review</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #e6edf3;
      --muted: #8b949e;
      --accent: #58a6ff;
      --p0: #f85149;
      --p1: #d29922;
      --p2: #58a6ff;
      --add-bg: rgba(46, 160, 67, 0.15);
      --add-text: #3fb950;
      --del-bg: rgba(248, 81, 73, 0.15);
      --del-text: #f85149;
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      --font-mono: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace;
    }
    @media (prefers-color-scheme: light) {
      :root.auto-theme {
        --bg: #f6f8fa;
        --card-bg: #ffffff;
        --border: #d0d7de;
        --text: #1f2328;
        --muted: #656d76;
        --accent: #0969da;
        --p0: #cf222e;
        --p1: #9a6700;
        --p2: #0969da;
        --add-bg: #dafbe1;
        --add-text: #1a7f37;
        --del-bg: #ffebe9;
        --del-text: #cf222e;
      }
    }
    :root.light {
      --bg: #f6f8fa;
      --card-bg: #ffffff;
      --border: #d0d7de;
      --text: #1f2328;
      --muted: #656d76;
      --accent: #0969da;
      --p0: #cf222e;
      --p1: #9a6700;
      --p2: #0969da;
      --add-bg: #dafbe1;
      --add-text: #1a7f37;
      --del-bg: #ffebe9;
      --del-text: #cf222e;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      line-height: 1.5;
      padding: 24px 16px 80px;
    }
    .container { max-width: 1100px; margin: 0 auto; }
    header {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px 24px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
    }
    .header-info h1 { font-size: 20px; font-weight: 600; margin-bottom: 6px; }
    .header-meta { font-size: 13px; color: var(--muted); display: flex; gap: 16px; flex-wrap: wrap; }
    .theme-toggle {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
    }
    .stats-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 16px;
    }
    .stat-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-value { font-size: 20px; font-weight: 700; margin-top: 2px; }
    .val-p0 { color: var(--p0); }
    .val-p1 { color: var(--p1); }
    .val-p2 { color: var(--p2); }
    .val-add { color: var(--add-text); }
    .val-del { color: var(--del-text); }

    .section-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 18px 20px;
      margin-bottom: 20px;
    }
    .section-title { font-size: 15px; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
    .summary-text { font-size: 14px; white-space: pre-wrap; color: var(--text); }
    
    .checklist-item { display: flex; align-items: center; gap: 10px; padding: 6px 0; font-size: 13px; }
    .checklist-item input { cursor: pointer; }

    .finding-card {
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 14px 16px;
      margin-bottom: 12px;
      background: rgba(255, 255, 255, 0.02);
    }
    .finding-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .pill {
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 12px;
      text-transform: uppercase;
    }
    .pill-P0 { background: rgba(248, 81, 73, 0.2); color: var(--p0); border: 1px solid var(--p0); }
    .pill-P1 { background: rgba(210, 153, 34, 0.2); color: var(--p1); border: 1px solid var(--p1); }
    .pill-P2 { background: rgba(88, 166, 255, 0.2); color: var(--p2); border: 1px solid var(--p2); }
    .finding-title { font-size: 14px; font-weight: 600; }
    .finding-loc { font-size: 12px; font-family: var(--font-mono); color: var(--accent); margin-bottom: 8px; display: inline-block; cursor: pointer; }
    .finding-desc { font-size: 13px; color: var(--text); white-space: pre-wrap; margin-bottom: 8px; }

    .file-diff-card {
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 16px;
      overflow: hidden;
      background: var(--card-bg);
    }
    .file-diff-header {
      padding: 10px 16px;
      background: rgba(255, 255, 255, 0.03);
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
    }
    .file-path { font-family: var(--font-mono); font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    .diff-table {
      width: 100%;
      border-collapse: collapse;
      font-family: var(--font-mono);
      font-size: 12px;
    }
    .diff-table td { padding: 1px 8px; vertical-align: top; white-space: pre-wrap; word-break: break-all; }
    .line-num {
      width: 44px;
      text-align: right;
      color: var(--muted);
      user-select: none;
      border-right: 1px solid var(--border);
    }
    .line-marker { width: 16px; text-align: center; user-select: none; }
    .line-add { background: var(--add-bg); color: var(--text); }
    .line-add .line-marker { color: var(--add-text); font-weight: bold; }
    .line-del { background: var(--del-bg); color: var(--text); }
    .line-del .line-marker { color: var(--del-text); font-weight: bold; }
    .line-hunk { background: rgba(88, 166, 255, 0.08); color: var(--muted); font-size: 11px; padding: 4px 8px; }

    .floating-bar {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #1f242c;
      border: 1px solid var(--border);
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      padding: 10px 18px;
      border-radius: 30px;
      display: flex;
      align-items: center;
      gap: 14px;
      z-index: 100;
    }
    .btn-action {
      background: var(--accent);
      color: #fff;
      border: none;
      padding: 6px 14px;
      border-radius: 16px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
  </style>
</head>
<body class="auto-theme">
  <div class="container">
    <header>
      <div class="header-info">
        <h1>${escapeHtml(doc.title)}</h1>
        <div class="header-meta">
          ${doc.target ? `<span>🎯 <strong>Target:</strong> ${escapeHtml(doc.target)}</span>` : ''}
          ${doc.author ? `<span>👤 <strong>Author:</strong> ${escapeHtml(doc.author)}</span>` : ''}
          <span>📅 <strong>Date:</strong> ${escapeHtml(doc.date ?? '')}</span>
          <span>⚡ <strong>Generated by Baton Review</strong></span>
        </div>
      </div>
      <button class="theme-toggle" onclick="toggleTheme()">🌓 Theme</button>
    </header>

    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-label">Files Changed</div>
        <div class="stat-value">${files.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Additions</div>
        <div class="stat-value val-add">+${totalAdditions}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Deletions</div>
        <div class="stat-value val-del">-${totalDeletions}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Critical (P0)</div>
        <div class="stat-value val-p0">${p0Count}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Warning (P1)</div>
        <div class="stat-value val-p1">${p1Count}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Suggestion (P2)</div>
        <div class="stat-value val-p2">${p2Count}</div>
      </div>
    </div>

    ${
      doc.summary
        ? `
    <div class="section-card">
      <div class="section-title">📋 Executive Summary</div>
      <div class="summary-text">${escapeHtml(doc.summary)}</div>
    </div>`
        : ''
    }

    ${
      doc.checklist.length > 0
        ? `
    <div class="section-card">
      <div class="section-title">✅ Review Checklist</div>
      ${doc.checklist
        .map(
          (item, idx) => `
        <label class="checklist-item">
          <input type="checkbox" id="chk_${idx}" ${item.checked ? 'checked' : ''} onchange="saveChecklist(${idx}, this.checked)">
          <span>${escapeHtml(item.text)}</span>
        </label>
      `,
        )
        .join('')}
    </div>`
        : ''
    }

    ${
      doc.findings.length > 0
        ? `
    <div class="section-card">
      <div class="section-title">🔍 Findings (${doc.findings.length})</div>
      ${doc.findings
        .map(
          (f) => `
        <div class="finding-card">
          <div class="finding-header">
            <span class="pill pill-${f.severity}">${f.severity}</span>
            <span class="finding-title">${escapeHtml(f.title)}</span>
            ${f.category ? `<span style="font-size:11px;color:var(--muted)">• ${escapeHtml(f.category)}</span>` : ''}
          </div>
          ${f.file ? `<div class="finding-loc" onclick="jumpToFile('${escapeHtml(f.file)}')">📁 ${escapeHtml(f.file)}${f.line ? `:${f.line}` : ''}</div>` : ''}
          <div class="finding-desc">${escapeHtml(f.explanation)}</div>
        </div>
      `,
        )
        .join('')}
    </div>`
        : ''
    }

    <div class="section-card" style="padding:0;background:transparent;border:none;">
      <div class="section-title" style="margin-bottom:14px;">📝 Modified Files & Diff Viewer (${files.length})</div>
      ${files
        .map(
          (file, fileIdx) => `
        <div class="file-diff-card" id="file_${fileIdx}">
          <div class="file-diff-header" onclick="toggleFile(${fileIdx})">
            <div class="file-path">
              <span>${file.status === 'added' ? '🟢 A' : file.status === 'deleted' ? '🔴 D' : '🔵 M'}</span>
              <span>${escapeHtml(file.path)}</span>
            </div>
            <div style="font-size:12px;font-family:var(--font-mono)">
              <span class="val-add">+${file.additions}</span>
              <span class="val-del">-${file.deletions}</span>
            </div>
          </div>
          <div id="file_body_${fileIdx}">
            <table class="diff-table">
              <tbody>
                ${file.hunks
                  .map(
                    (hunk) => `
                  <tr>
                    <td colspan="4" class="line-hunk">${escapeHtml(hunk.header)}</td>
                  </tr>
                  ${hunk.lines
                    .map(
                      (l) => `
                    <tr class="line-${l.type}">
                      <td class="line-num">${l.oldLine ?? ''}</td>
                      <td class="line-num">${l.newLine ?? ''}</td>
                      <td class="line-marker">${l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}</td>
                      <td>${escapeHtml(l.content)}</td>
                    </tr>
                  `,
                    )
                    .join('')}
                `,
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      `,
        )
        .join('')}
    </div>

    <div class="floating-bar">
      <span style="font-size:13px;color:#fff;">⚡ Baton Code Review</span>
      <button class="btn-action" onclick="copyMarkdownNotes()">📋 Copy Notes for Agent</button>
      <button class="btn-action" style="background:#30363d;" onclick="window.print()">🖨️ Print / PDF</button>
    </div>
  </div>

  <script>
    function toggleTheme() {
      const root = document.documentElement;
      if (root.classList.contains('light')) {
        root.classList.remove('light');
        localStorage.setItem('baton_review_theme', 'dark');
      } else {
        root.classList.add('light');
        localStorage.setItem('baton_review_theme', 'light');
      }
    }
    if (localStorage.getItem('baton_review_theme') === 'light') {
      document.documentElement.classList.add('light');
    }

    function toggleFile(idx) {
      const body = document.getElementById('file_body_' + idx);
      if (body) {
        body.style.display = body.style.display === 'none' ? 'block' : 'none';
      }
    }

    function jumpToFile(path) {
      const el = Array.from(document.querySelectorAll('.file-path')).find(e => e.textContent.includes(path));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function saveChecklist(idx, checked) {
      localStorage.setItem('baton_chk_' + idx, checked ? '1' : '0');
    }

    function copyMarkdownNotes() {
      const checkedCount = document.querySelectorAll('input[type="checkbox"]:checked').length;
      const totalCount = document.querySelectorAll('input[type="checkbox"]').length;
      let text = "# Code Review Feedback\\n\\n";
      text += "- Checklist Progress: " + checkedCount + "/" + totalCount + " verified\\n\\n";
      text += "## Review Findings to Address\\n";
      const findings = Array.from(document.querySelectorAll('.finding-card')).map(card => {
        const title = card.querySelector('.finding-title')?.textContent || '';
        const loc = card.querySelector('.finding-loc')?.textContent || '';
        const desc = card.querySelector('.finding-desc')?.textContent || '';
        return "- " + title + " (" + loc + "):\\n  " + desc;
      }).join('\\n');
      text += findings;
      navigator.clipboard.writeText(text).then(() => {
        alert('Review summary copied to clipboard! Paste it to your agent.');
      });
    }
  </script>
</body>
</html>`;

  const outputPath =
    options.outputPath ?? join(tmpdir(), `baton-review-${Date.now().toString(36)}.html`);

  await writeFile(outputPath, html, 'utf-8');

  return {
    html,
    outputPath,
    stats: {
      filesCount: files.length,
      additions: totalAdditions,
      deletions: totalDeletions,
      p0: p0Count,
      p1: p1Count,
      p2: p2Count,
    },
  };
}
