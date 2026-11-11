"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError caught]", error);
  }, [error]);

  const isChunkError =
    error.name === "ChunkLoadError" ||
    (typeof error.message === "string" &&
      (error.message.includes("Loading chunk") ||
        error.message.includes("ChunkLoadError")));

  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl text-center space-y-4">
          <div className="w-12 h-12 mx-auto rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 text-xl font-bold">
            !
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Application Error</h2>
            <p className="text-xs text-slate-400 mt-1">
              {isChunkError
                ? "The page assets need to be refreshed. Click below to reload."
                : error.message || "An unexpected error occurred."}
            </p>
          </div>
          <div className="flex gap-2 justify-center pt-2">
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow transition"
            >
              Refresh Application
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
