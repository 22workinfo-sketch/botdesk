"use client";

import { useEffect, useState } from "react";

/**
 * Global ChunkLoadRecovery component.
 * Catches Webpack ChunkLoadError (such as when Next.js dev server recompiles,
 * dev tunnel drops or resets, or older client attempts to fetch non-existent chunks).
 * Automatically reloads the current page once to get fresh chunk manifests,
 * and shows a non-intrusive recovery banner if reloads are exhausted.
 */
export function ChunkLoadRecovery() {
  const [showRecoveryBanner, setShowRecoveryBanner] = useState(false);
  const [failedChunk, setFailedChunk] = useState<string | null>(null);

  useEffect(() => {
    const handleScriptError = (event: ErrorEvent) => {
      const target = event.target as HTMLElement | null;
      const isScript = target && target.tagName === "SCRIPT";
      const src = (target as HTMLScriptElement)?.src || "";
      const isChunk = src.includes("/_next/static/chunks/");

      const isChunkError =
        isChunk ||
        (event.message &&
          (event.message.includes("Loading chunk") ||
            event.message.includes("ChunkLoadError")));

      if (isChunkError) {
        attemptReload(src || event.message);
      }
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const isChunkError =
        reason &&
        (reason.name === "ChunkLoadError" ||
          (typeof reason.message === "string" &&
            (reason.message.includes("Loading chunk") ||
              reason.message.includes("ChunkLoadError"))));

      if (isChunkError) {
        attemptReload(reason.message || "dynamic import");
      }
    };

    const attemptReload = (chunkInfo: string) => {
      let targetRoute: string | null = null;
      const match = String(chunkInfo).match(/\/chunks\/app\/([a-zA-Z0-9_\-[\]/]+)\/page/);
      if (match && match[1]) {
        targetRoute = "/" + match[1];
      }

      const storageKey = `backstage_chunk_reload_${targetRoute || window.location.pathname}`;
      const lastReload = sessionStorage.getItem(storageKey);
      const now = Date.now();

      // Guard: only auto-reload once every 6 seconds to prevent infinite reload loops
      if (!lastReload || now - parseInt(lastReload, 10) > 6000) {
        sessionStorage.setItem(storageKey, String(now));
        console.warn(
          "[ChunkLoadRecovery] Chunk loading failure detected. Automatically refreshing...",
          chunkInfo
        );
        if (targetRoute && window.location.pathname !== targetRoute) {
          window.location.href = targetRoute;
        } else {
          window.location.reload();
        }
      } else {
        console.error(
          "[ChunkLoadRecovery] Chunk loading persistently failed:",
          chunkInfo
        );
        setFailedChunk(chunkInfo);
        setShowRecoveryBanner(true);
      }
    };

    // Use capture phase (true) because script loading error events do NOT bubble
    window.addEventListener("error", handleScriptError, true);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleScriptError, true);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  if (!showRecoveryBanner) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-50 max-w-md bg-slate-900 border border-amber-500/50 text-slate-100 rounded-xl p-4 shadow-2xl backdrop-blur-md flex flex-col gap-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
          <span>⚠️</span>
          <span>Connection / Asset Out of Sync</span>
        </div>
        <button
          onClick={() => setShowRecoveryBanner(false)}
          className="text-slate-400 hover:text-white text-xs px-1"
          aria-label="Dismiss banner"
        >
          ✕
        </button>
      </div>
      <p className="text-xs text-slate-300">
        A newer version of the page was compiled or the connection was reset by the dev tunnel.
      </p>
      {failedChunk && (
        <p className="text-[10px] font-mono text-slate-400 truncate max-w-full">
          {failedChunk}
        </p>
      )}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => {
            sessionStorage.removeItem(`backstage_chunk_reload_${window.location.pathname}`);
            window.location.reload();
          }}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow transition"
        >
          ↻ Refresh Page
        </button>
        <button
          onClick={() => {
            window.location.href = "/dashboard";
          }}
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold transition"
        >
          Go to Dashboard
        </button>
      </div>
    </div>
  );
}
