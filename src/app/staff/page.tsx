import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { BotdeskLayout } from "@/components/BotdeskLayout";
import { BotdeskStaffPage } from "@/components/BotdeskStaffPage";

export default async function StaffPage() {
  const session = await getAdminSession();
  if (!session) {
    redirect("/login");
  }

  const isSuper = session.role === "SUPER_ADMIN";

  return (
    <BotdeskLayout
      userEmail={session.email}
      role={session.role}
      activeNav="staff"
      breadcrumb="Users & access"
    >
      {isSuper ? (
        <BotdeskStaffPage sessionUser={session} />
      ) : (
        <div className="space-y-6">
          <div>
            <span className="botdesk-badge paused mb-2 inline-block">
              ACCESS RESTRICTED
            </span>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text)]">
              Users & Access Control
            </h1>
            <p className="text-sm text-[var(--muted)] mt-1">
              User delegation and account administration.
            </p>
          </div>

          <div className="p-6 rounded-xl border border-[var(--border)] bg-[var(--panel)] text-center space-y-3">
            <span className="text-3xl block">🔒</span>
            <h2 className="text-base font-bold text-[var(--text)]">
              Administrator Privileges Required
            </h2>
            <p className="text-xs text-[var(--muted)] max-w-md mx-auto leading-relaxed">
              Staff account creation, role editing, and bot delegation are restricted strictly to <strong>SUPER_ADMIN</strong> accounts. Your current role (<code className="font-mono text-[var(--accent)]">{session.role}</code>) has access to manage your assigned bots and channel posts.
            </p>
          </div>
        </div>
      )}
    </BotdeskLayout>
  );
}
