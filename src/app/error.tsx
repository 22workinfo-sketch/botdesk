"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isChunkError =
    error.name === "ChunkLoadError" ||
    (typeof error.message === "string" &&
      (error.message.includes("Loading chunk") ||
        error.message.includes("ChunkLoadError")));

  useEffect(() => {
    console.error("[AppError caught]", error);

    // If chunk loading failed, attempt one auto-reload
    if (isChunkError) {
      const storageKey = `backstage_chunk_reload_${window.location.pathname}`;
      const lastReload = sessionStorage.getItem(storageKey);
      const now = Date.now();
      if (!lastReload || now - parseInt(lastReload, 10) > 12000) {
        sessionStorage.setItem(storageKey, String(now));
        window.location.reload();
      }
    }
  }, [error, isChunkError]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl text-center space-y-4">
        <div className="w-12 h-12 mx-auto rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 text-xl font-bold">
          {isChunkError ? "↻" : "!"}
        </div>

        <div>
          <h2 className="text-lg font-bold text-white">
            {isChunkError
              ? "New Version Available or Network Reconnected"
              : "Something went wrong"}
          </h2>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            {isChunkError
              ? "The application was updated or the connection via dev tunnel was momentarily reset. Refreshing will load the latest version."
              : error.message || "An unexpected error occurred while loading this page."}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-2">
          <button
            onClick={() => {
              if (isChunkError) {
                window.location.reload();
              } else {
                reset();
              }
            }}
            className="w-full sm:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow transition"
          >
            {isChunkError ? "Reload Page" : "Try Again"}
          </button>
          <button
            onClick={() => {
              window.location.href = "/dashboard";
            }}
            className="w-full sm:w-auto px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
