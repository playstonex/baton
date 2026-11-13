import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { exec } from 'node:child_process';
import { CODE_REVIEW_PROMPT } from '@baton/shared';
import { apiFetch } from '../client/api.js';

interface ReviewResponse {
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
}

function openBrowser(filePath: string): void {
  const cmd =
    process.platform === 'darwin'
      ? `open "${filePath}"`
      : process.platform === 'win32'
        ? `start "" "${filePath}"`
        : `xdg-open "${filePath}"`;
  exec(cmd, () => {});
}

export async function reviewCommand(sub: string | undefined, args: string[]): Promise<void> {
  if (sub === 'prompt') {
    console.log(CODE_REVIEW_PROMPT);
    return;
  }

  let reviewFilePath: string | undefined = sub && !sub.startsWith('-') ? sub : undefined;
  let repoPath = process.cwd();
  let targetRef: string | undefined;
  let outputPath: string | undefined;
  let shouldOpen = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--repo' && args[i + 1]) {
      repoPath = resolve(args[++i]);
    } else if (arg === '--target' && args[i + 1]) {
      targetRef = args[++i];
    } else if (arg === '--output' && args[i + 1]) {
      outputPath = resolve(args[++i]);
    } else if (arg === '--no-open') {
      shouldOpen = false;
    } else if (!reviewFilePath && !arg.startsWith('-')) {
      reviewFilePath = arg;
    }
  }

  let reviewMarkdown: string | undefined;
  if (reviewFilePath) {
    try {
      reviewMarkdown = await readFile(resolve(reviewFilePath), 'utf-8');
    } catch (err) {
      console.error(`Failed to read review file ${reviewFilePath}:`, err);
      process.exit(1);
    }
  }

  console.log(`Generating code review report for ${repoPath}...`);
  try {
    const res = await apiFetch<ReviewResponse>('/api/review/generate', {
      method: 'POST',
      body: JSON.stringify({
        projectPath: repoPath,
        reviewMarkdown,
        targetRef,
        outputPath,
      }),
    });

    console.log(`\nReview report generated successfully!`);
    console.log(`📄 Report Path: ${res.outputPath}`);
    console.log(
      `📊 Files: ${res.stats.filesCount} (+${res.stats.additions} -${res.stats.deletions})`,
    );
    console.log(`🔍 Findings: P0: ${res.stats.p0} | P1: ${res.stats.p1} | P2: ${res.stats.p2}\n`);

    if (shouldOpen) {
      console.log(`Opening report in default browser...`);
      openBrowser(res.outputPath);
    }
  } catch (err) {
    console.error(`Error generating review report:`, err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
