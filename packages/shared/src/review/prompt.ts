/**
 * Authoritative prompt template for Coding Agents generating Baton Code Reviews.
 * Inspired by Lody Review & Google/Anthropic engineering standards.
 */

export const CODE_REVIEW_PROMPT = `# Baton Code Review Guide for AI Agents

You are performing a rigorous, production-grade Code Review.
Inspect the Git diff, pull request, or target files and produce a structured Markdown document named \`<feature-name>.review.md\`.

## Review Priorities (Severity Levels)

Classify all findings into exactly three levels:
- **[P0] Critical**: Exploitable security flaw, credential leak, authentication/authorization bypass, potential data loss, unhandled race condition, or breaking public contract. Must block merge.
- **[P1] Warning**: Probable runtime bug, memory leak, missing error handling, performance bottleneck, missing validation, or flaky concurrency.
- **[P2] Suggestion**: Architecture improvement, dead code, typing refinement, readability, or test coverage expansion.

## Required Output Format

Structure your \`.review.md\` report using the following markdown format:

\`\`\`markdown
# Code Review: <Short Descriptive Title>

**Target**: <Branch or Commit SHA>
**Author**: <Agent or Developer>
**Date**: <YYYY-MM-DD>

## Executive Summary
<A concise 2-3 paragraph overview of what changes were introduced, overall code quality, and whether it is safe to merge.>

## Review Checklist
- [ ] Security & Secrets: No leaked tokens, SQL injection, path traversal, or privilege bypass.
- [ ] Concurrency & Race Safety: No deadlocks, race conditions, or unhandled async rejections.
- [ ] Error Handling & Failure Containment: Failures degrade gracefully; errors are logged with context.
- [ ] Performance & Allocations: No unbounded loops, unthrottled streams, or memory leaks.
- [ ] Test & Regression Guard: Critical paths and edge cases are covered with deterministic tests.

## Findings

### [P0] <Critical finding title>
- **File**: \`path/to/file.ts:line\`
- **Category**: Security / Bug / Data Loss / Breaking Change
- **Explanation**: <What the defect is, why it occurs, and the failure scenario.>
- **Suggested Fix**:
\`\`\`ts
// Corrected code snippet
\`\`\`

### [P1] <Warning finding title>
- **File**: \`path/to/file.ts:line\`
- **Category**: Logic / Performance / Error Handling
- **Explanation**: <Detailed description of the concern.>
- **Suggested Fix**:
\`\`\`ts
// Suggested fix
\`\`\`

### [P2] <Suggestion finding title>
- **File**: \`path/to/file.ts:line\`
- **Category**: Refactor / Typing / Polish
- **Explanation**: <Description and suggested improvement.>

## Positive Observations
- <Highlights of well-designed patterns, clean idioms, or robust testing in this change.>
\`\`\`
`;
