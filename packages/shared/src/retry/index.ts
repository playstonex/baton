import { isRetryable } from '../errors/index.js';

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30_000;

/** min(baseDelay × 2^attempt + jitter, maxDelay), jitter ∈ [0, 20%] */
function computeDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = baseDelayMs * 2 ** attempt;
  const jitter = Math.random() * exponential * 0.2;
  return Math.min(exponential + jitter, maxDelayMs);
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const shouldRetry = options?.shouldRetry ?? isRetryable;
  const onRetry = options?.onRetry;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;

      if (attempt >= maxRetries || !shouldRetry(error, attempt)) {
        throw error;
      }

      const delayMs = computeDelay(attempt, baseDelayMs, maxDelayMs);
      onRetry?.(error, attempt + 1, delayMs);
      await delay(delayMs);
    }
  }

  throw lastError;
}
