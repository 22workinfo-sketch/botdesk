import { ComponentType } from "react";

/**
 * Retries a dynamic component import with exponential backoff.
 * Prevents transient network glitches or tunnel blips from crashing the page with ChunkLoadError.
 */
export function retryDynamicImport<T extends ComponentType<any>>(
  importFn: () => Promise<{ default?: T } | T>,
  retriesLeft = 3,
  intervalMs = 500
): Promise<{ default: T }> {
  return new Promise((resolve, reject) => {
    importFn()
      .then((module) => {
        const component =
          (module as any)?.default !== undefined
            ? (module as any).default
            : module;
        resolve({ default: component });
      })
      .catch((error) => {
        if (retriesLeft <= 1) {
          // If all retries failed and it's a ChunkLoadError, force a one-time fresh reload
          if (
            typeof window !== "undefined" &&
            (error?.name === "ChunkLoadError" ||
              String(error?.message).includes("Loading chunk"))
          ) {
            const key = `chunk_retry_${window.location.pathname}`;
            const last = sessionStorage.getItem(key);
            const now = Date.now();
            if (!last || now - parseInt(last, 10) > 10000) {
              sessionStorage.setItem(key, String(now));
              console.warn(
                "Chunk failed to load after retries, reloading page to fetch latest version...",
                error
              );
              window.location.reload();
              return;
            }
          }
          reject(error);
          return;
        }

        setTimeout(() => {
          retryDynamicImport(importFn, retriesLeft - 1, intervalMs * 1.5)
            .then(resolve)
            .catch(reject);
        }, intervalMs);
      });
  });
}
