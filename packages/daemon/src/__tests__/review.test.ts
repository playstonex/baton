import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import {
  parseReviewMarkdown,
  generateStandaloneReviewReport,
  CODE_REVIEW_PROMPT,
} from '../review/index.js';

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`git ${args.join(' ')} failed (${code}): ${stderr}`));
    });
  });
}

describe('Code Review Generator (Lody-style Standalone Review)', () => {
  let tempRepo: string;

  beforeEach(async () => {
    tempRepo = await mkdtemp(join(tmpdir(), 'baton-review-test-'));

    await runGit(tempRepo, ['init', '-b', 'main']);
    await runGit(tempRepo, ['config', 'user.name', 'Review Tester']);
    await runGit(tempRepo, ['config', 'user.email', 'review@example.com']);

    await writeFile(join(tempRepo, 'app.ts'), 'console.log("hello");\n');
    await runGit(tempRepo, ['add', 'app.ts']);
    await runGit(tempRepo, ['commit', '-m', 'initial']);
  });

  afterEach(async () => {
    await rm(tempRepo, { recursive: true, force: true });
  });

  it('exposes the standard code review prompt guide', () => {
    expect(CODE_REVIEW_PROMPT).toContain('# Baton Code Review Guide for AI Agents');
    expect(CODE_REVIEW_PROMPT).toContain('[P0] Critical');
    expect(CODE_REVIEW_PROMPT).toContain('[P1] Warning');
    expect(CODE_REVIEW_PROMPT).toContain('[P2] Suggestion');
  });

  it('parses structured review markdown into findings and checklist', () => {
    const sampleMd = `
# Code Review: Authentication Refactor

**Target**: main
**Author**: Claude Code

## Executive Summary
This PR replaces legacy token storage with encrypted session credentials.

## Review Checklist
- [x] Security & Secrets
- [ ] Concurrency & Race Safety

## Findings

### [P0] Hardcoded JWT Secret in Test
- **File**: src/auth.test.ts:42
- **Category**: Security
- **Explanation**: A live API key was committed into test mock files.

### [P1] Missing Timeout on Token Fetch
- **File**: src/token.ts:15
- **Category**: Performance
- **Explanation**: Fetch request can hang indefinitely without abort signal.

## Positive Observations
- Clean migration path and thorough types.
`;

    const doc = parseReviewMarkdown(sampleMd);
    expect(doc.title).toBe('Code Review: Authentication Refactor');
    expect(doc.target).toBe('main');
    expect(doc.checklist.length).toBe(2);
    expect(doc.checklist[0].checked).toBe(true);
    expect(doc.checklist[1].checked).toBe(false);
    expect(doc.findings.length).toBe(2);
    expect(doc.findings[0].severity).toBe('P0');
    expect(doc.findings[0].title).toBe('Hardcoded JWT Secret in Test');
    expect(doc.findings[0].file).toBe('src/auth.test.ts');
    expect(doc.findings[0].line).toBe(42);
    expect(doc.findings[1].severity).toBe('P1');
  });

  it('generates a standalone HTML review report with embedded diffs and metrics', async () => {
    // Make modified and added files
    await writeFile(join(tempRepo, 'app.ts'), 'console.log("hello world");\nconst x = 100;\n');
    await writeFile(join(tempRepo, 'secret.ts'), 'export const key = "abc";\n');

    const sampleMd = `
# Code Review: Security Review

## Findings
### [P0] Potential Exposed Key
- **File**: secret.ts:1
- **Category**: Security
- **Explanation**: Key should come from env.
`;

    const result = await generateStandaloneReviewReport({
      repoPath: tempRepo,
      reviewMarkdown: sampleMd,
    });

    expect(result.html).toContain('<!DOCTYPE html>');
    expect(result.html).toContain('Baton Review');
    expect(result.html).toContain('Potential Exposed Key');
    expect(result.html).toContain('app.ts');
    expect(result.html).toContain('secret.ts');
    expect(result.stats.filesCount).toBe(2);
    expect(result.stats.p0).toBe(1);

    const savedHtml = await readFile(result.outputPath, 'utf-8');
    expect(savedHtml).toBe(result.html);
  });
});
