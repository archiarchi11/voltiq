import { StrictMode, Suspense, lazy, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import { ToastProvider } from "./components/Toast";
import { DatasetProvider } from "./hooks/useDataset";
import { AppLayout } from "./layouts/AppLayout";
import { ChartSkeleton } from "./components/ui";

// Route-level code splitting keeps the initial bundle small.
const Overview = lazy(() => import("./pages/Overview"));
const Forecasting = lazy(() => import("./pages/Forecasting"));
const ModelPerformance = lazy(() => import("./pages/ModelPerformance"));
const Stations = lazy(() => import("./pages/Stations"));
const DatasetPage = lazy(() => import("./pages/Dataset"));
const TimeSeries = lazy(() => import("./pages/TimeSeries"));

const page = (el: ReactNode) => (
  <Suspense fallback={<div className="card p-5"><ChartSkeleton height={360} /></div>}>{el}</Suspense>
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <DatasetProvider>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={page(<Overview />)} />
              <Route path="forecasting" element={page(<Forecasting />)} />
              <Route path="models" element={page(<ModelPerformance />)} />
              <Route path="stations" element={page(<Stations />)} />
              <Route path="timeseries" element={page(<TimeSeries />)} />
              <Route path="dataset" element={page(<DatasetPage />)} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </DatasetProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
