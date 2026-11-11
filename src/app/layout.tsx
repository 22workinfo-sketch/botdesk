import type { Metadata } from "next";
import "./globals.css";
import { ChunkLoadRecovery } from "@/components/ChunkLoadRecovery";

export const metadata: Metadata = {
  title: "Telegram Bot Backstage",
  description: "Administrative panel for managing Telegram bots",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                function isChunkError(err) {
                  if (!err) return false;
                  var str = String(err.message || err.name || err);
                  return str.indexOf("ChunkLoadError") !== -1 ||
                         str.indexOf("Loading chunk") !== -1 ||
                         str.indexOf("Failed to fetch dynamically imported module") !== -1;
                }
                function handleChunkFailure(chunkInfo) {
                  try {
                    var targetRoute = null;
                    var match = String(chunkInfo).match(/\\/chunks\\/app\\/([a-zA-Z0-9_\\-\\[\\]\\/]+)\\/page/);
                    if (match && match[1]) {
                      targetRoute = "/" + match[1];
                    }
                    var key = "backstage_last_chunk_recovery";
                    var last = sessionStorage.getItem(key);
                    var now = Date.now();
                    if (!last || (now - parseInt(last, 10)) > 6000) {
                      sessionStorage.setItem(key, String(now));
                      if (targetRoute && window.location.pathname !== targetRoute) {
                        window.location.href = targetRoute;
                      } else {
                        window.location.reload();
                      }
                    }
                  } catch(e) {}
                }
                window.addEventListener("error", function(e) {
                  var target = e.target;
                  var src = (target && target.src) || "";
                  if (src.indexOf("/_next/static/chunks/") !== -1 || isChunkError(e.error) || isChunkError(e.message)) {
                    if (e.preventDefault) e.preventDefault();
                    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                    handleChunkFailure(src || (e.error && e.error.message) || e.message);
                  }
                }, true);
                window.addEventListener("unhandledrejection", function(e) {
                  if (isChunkError(e.reason)) {
                    if (e.preventDefault) e.preventDefault();
                    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                    handleChunkFailure(e.reason && (e.reason.message || e.reason.request || String(e.reason)));
                  }
                });
              })();
            `,
          }}
        />
      </head>
      <body className="min-h-screen antialiased bg-slate-950 text-slate-100">
        <ChunkLoadRecovery />
        {children}
      </body>
    </html>
  );
}
