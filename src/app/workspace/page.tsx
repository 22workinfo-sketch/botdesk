import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { BotdeskLayout } from "@/components/BotdeskLayout";

export default async function WorkspacePage() {
  const session = await getAdminSession();
  if (!session) {
    redirect("/login");
  }

  if (session.mustChangePassword) {
    redirect("/login?changePassword=true");
  }

  return (
    <BotdeskLayout
      userEmail={session.email}
      role={session.role}
      activeNav="workspace"
      breadcrumb="Workspace"
    >
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text)]">
            Workspace
          </h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            Control center for independently running bots and local environment settings.
          </p>
        </div>

        <div className="botdesk-card">
          <div className="card-header">
            <h2 className="text-base font-bold text-[var(--text)]">
              Environment & Infrastructure Status
            </h2>
            <span className="botdesk-badge enabled">Local MVP Operational</span>
          </div>

          <div className="card-body divide-y divide-[var(--border)] text-sm">
            {/* Database */}
            <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <strong className="text-sm font-semibold text-[var(--text)] block">
                  PostgreSQL Database Engine
                </strong>
                <p className="text-xs text-[var(--muted)]">
                  Docker container <code className="font-mono text-[var(--accent)]">backstage-pg</code> listening on <code className="font-mono">127.0.0.1:5432</code>.
                </p>
              </div>
              <span className="botdesk-badge healthy">Connected</span>
            </div>

            {/* Telegram Bot Runner */}
            <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <strong className="text-sm font-semibold text-[var(--text)] block">
                  Telegram Long Polling Runner
                </strong>
                <p className="text-xs text-[var(--muted)]">
                  grammY long polling engine listening for /start, contact verification, and menu button taps.
                </p>
              </div>
              <span className="botdesk-badge healthy">Active</span>
            </div>

            {/* Auto-Delete Background Sweeper */}
            <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <strong className="text-sm font-semibold text-[var(--text)] block">
                  Auto-Delete Background Sweeper
                </strong>
                <p className="text-xs text-[var(--muted)]">
                  3-second PostgreSQL sweeper executing due deletions with atomic claiming and error resilience.
                </p>
              </div>
              <span className="botdesk-badge healthy">Active</span>
            </div>

            {/* Security Isolation */}
            <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <strong className="text-sm font-semibold text-[var(--text)] block">
                  Network Security Boundary
                </strong>
                <p className="text-xs text-[var(--muted)]">
                  Next.js development server strictly bound to <code className="font-mono">127.0.0.1:3000</code>. Not exposed to public internet.
                </p>
              </div>
              <span className="botdesk-badge enabled">Loopback Only</span>
            </div>

            {/* Token Privacy */}
            <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <strong className="text-sm font-semibold text-[var(--text)] block">
                  Bot Token Configuration
                </strong>
                <p className="text-xs text-[var(--muted)]">
                  Loaded exclusively through local <code className="font-mono">.env</code> variable. Never stored in git or printed in logs.
                </p>
              </div>
              <span className="botdesk-badge blue font-mono">TELEGRAM_BOT_TOKEN</span>
            </div>
          </div>
        </div>

        {/* Multi-bot Roadmap Card */}
        <div className="botdesk-card">
          <div className="card-header">
            <h2 className="text-base font-bold text-[var(--text)]">
              Multi-Bot Production Roadmap
            </h2>
          </div>
          <div className="card-body text-xs text-[var(--muted)] space-y-2">
            <p>
              When expanding from the local single-bot MVP to full multi-bot production:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Token Encryption at Rest:</strong> Use AES-256-GCM with a master KMS key to encrypt multiple bot tokens in PostgreSQL.
              </li>
              <li>
                <strong>Webhook Mode:</strong> Transition from long polling to Telegram webhook ingress routes (<code className="font-mono">/api/telegram/webhook/[botId]</code>) with secret token verification.
              </li>
              <li>
                <strong>Per-Bot Worker Isolation:</strong> Run independent background tasks or queue workers for message deletion and broadcasts.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </BotdeskLayout>
  );
}
