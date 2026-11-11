import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, isNoDataset } from "../services/api";

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  noDataset: boolean;
  reload: () => void;
}

/**
 * Fetch data whenever `deps` change. Stale responses (from superseded requests) are ignored.
 * Pass `enabled = false` to skip fetching (e.g. when no dataset is active).
 */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[], enabled = true): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);
  const [noDataset, setNoDataset] = useState(false);
  const [tick, setTick] = useState(0);
  const reqId = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    fetcherRef
      .current()
      .then((res) => {
        if (id !== reqId.current) return;
        setData(res);
        setNoDataset(false);
      })
      .catch((err) => {
        if (id !== reqId.current) return;
        setNoDataset(isNoDataset(err));
        setError(errorMessage(err));
      })
      .finally(() => {
        if (id === reqId.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, noDataset, reload };
}
