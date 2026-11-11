import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, errorMessage } from "../services/api";
import type { DatasetSummary } from "../types/api";
import { useToast } from "../components/Toast";

interface DatasetContextValue {
  summary: DatasetSummary | null;
  loading: boolean;
  error: string | null;
  apiOnline: boolean;
  hasDataset: boolean;
  /** Increments whenever the active dataset or its evaluation changes; pages use it to refetch. */
  version: number;
  refresh: () => Promise<DatasetSummary | null>;
}

const DatasetContext = createContext<DatasetContextValue | null>(null);

export function DatasetProvider({ children }: { children: ReactNode }) {
  const [summary, setSummary] = useState<DatasetSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiOnline, setApiOnline] = useState(true);
  const [version, setVersion] = useState(0);
  const prevKey = useRef<string | null>(null);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      const s = await api.datasetSummary();
      setSummary(s);
      setError(null);
      setApiOnline(true);
      // Bump the version when the active dataset or completed evaluation changes.
      const key = `${s.active?.dataset.id ?? "none"}:${s.active?.dataset.processed_at ?? ""}:${
        s.evaluation.status === "completed" ? s.evaluation.run_id : "pending"
      }`;
      if (prevKey.current !== null && prevKey.current !== key) {
        setVersion((v) => v + 1);
        const prevPending = prevKey.current.endsWith(":pending");
        if (prevPending && s.evaluation.status === "completed" && s.evaluation.best_model_name) {
          toast.success("Model evaluation complete", `Validation-selected model: ${s.evaluation.best_model_name}`);
        }
      }
      prevKey.current = key;
      return s;
    } catch (err) {
      setError(errorMessage(err));
      setApiOnline(false);
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll while an evaluation is running (or the API is offline) so the UI updates by itself.
  const running = summary?.evaluation.status === "running";
  useEffect(() => {
    if (!running && apiOnline) return;
    const id = window.setInterval(() => void refresh(), running ? 2000 : 8000);
    return () => window.clearInterval(id);
  }, [running, apiOnline, refresh]);

  return (
    <DatasetContext.Provider
      value={{ summary, loading, error, apiOnline, hasDataset: !!summary?.has_active_dataset, version, refresh }}
    >
      {children}
    </DatasetContext.Provider>
  );
}

export function useDataset(): DatasetContextValue {
  const ctx = useContext(DatasetContext);
  if (!ctx) throw new Error("useDataset must be used inside DatasetProvider");
  return ctx;
}
