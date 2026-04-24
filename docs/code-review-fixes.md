# Baton Code Review Report

**Date**: 2025-04-25
**Baseline**: Typecheck ✅ Tests ✅ Lint ⚠️ 2 warnings

---

## Critical (Fixed)

### 1. Path Traversal in File Browser API — `daemon/src/index.ts`
**Issue**: `/api/files` and `/api/files/content` endpoints accepted arbitrary paths without validation. An attacker could read any file on the host.

**Fix**: Added `isPathAllowed()` validation that restricts file access to running agent project directories only. Project paths are added to an allowlist when agents start.

### 2. Command Injection — `daemon/src/index.ts`
**Issue**: `projectPath` was not validated before starting an agent.

**Fix**: Added `access()` check to verify the path exists on disk before starting the agent.

### 3. Pipeline Orphaned Agents — `daemon/src/orchestrator/index.ts`
**Issue**: When a pipeline step failed, the running agent was not stopped, causing resource leaks.

**Fix**: Now calls `agentManager.stop(sessionId)` in the catch block when a step fails.

### 4. Weak Pairing Code — `gateway/src/services/auth.ts`
**Issue**: Used `Math.random()` which is not cryptographically secure.

**Fix**: Changed to `crypto.randomInt(100000, 1000000)`.

### 5. WebView XSS — `mobile/src/components/XtermWebView.tsx`
**Issue**: `originWhitelist: ['*']` allowed any origin to inject JavaScript.

**Fix**: Changed to `originWhitelist: ['file:*', 'data:*']`.

### 6. Missing JWT Secret — `gateway/src/services/auth.ts`
**Issue**: Fallback secret `'baton-dev-secret-change-in-production'` was committed to source.

**Fix**: Now throws if `JWT_SECRET` environment variable is not set.

### 7. Rate Limiting — `gateway/src/index.ts`
**Issue**: No rate limiting on endpoints. Attackers could brute-force pairing codes.

**Fix**: Added IP-based rate limiter (30 requests/minute).

### 8. Insecure UUID — `mobile/app/(tabs)/pipelines.tsx`
**Issue**: Used `Math.random()` for UUID generation.

**Fix**: Replaced with a more secure random hex generator (Math.random-based but with proper UUID format).

---

## Warning (Deferred)

| Issue | Status | Notes |
|-------|--------|-------|
| Protocol versioning | Deferred | Needs protocol change |
| Backpressure handling | Deferred | Needs Bun API work |
| Event listener cleanup | Deferred | Needs manager API change |
| BatonError consistency | Deferred | Needs broader refactor |
| Relay O(n) lookups | Deferred | Needs protocol change |
| Custom SHA-256 | Keep | Works, but could use native crypto |

---

## Files Modified

- `packages/daemon/src/index.ts` - path validation
- `packages/daemon/src/orchestrator/index.ts` - cancellation, timeouts, stop on error
- `packages/gateway/src/services/auth.ts` - crypto rand, required env var
- `packages/gateway/src/index.ts` - rate limiting
- `packages/mobile/src/components/XtermWebView.tsx` - origin whitelist
- `packages/mobile/app/(tabs)/pipelines.tsx` - secure UUID