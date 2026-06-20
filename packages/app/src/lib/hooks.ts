import { useEffect, useRef, useCallback, useState } from 'react';

/**
 * Poll a fetch callback at a given interval. Cleans up on unmount.
 * The callback is wrapped in a ref so it doesn't need to be stable.
 */
export function usePolling(fetchFn: () => void | Promise<void>, intervalMs: number) {
  const saved = useRef(fetchFn);
  saved.current = fetchFn;

  useEffect(() => {
    saved.current();
    const id = setInterval(() => saved.current(), intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]);
}

/**
 * Generic async data fetcher with loading/error state.
 * Returns { data, loading, error, refetch }.
 */
export function useAsyncData<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): { data: T | null; loading: boolean; error: string | null; refetch: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      setData(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    fetch_();
  }, [fetch_, tick]);

  return {
    data,
    loading,
    error,
    refetch: useCallback(() => setTick((t) => t + 1), []),
  };
}

/**
 * Debounce a value by `delay` ms. Returns the debounced value.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
}
