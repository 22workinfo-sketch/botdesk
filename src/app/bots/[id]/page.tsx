import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getAdminSession } from "@/lib/auth";
import { getBotWithConfig, getBotUsers, getBotButtons } from "@/lib/bot-service";
import { hasBotAccess, canUserViewPhoneNumbers } from "@/lib/permissions";
import { BotdeskLayout } from "@/components/BotdeskLayout";
import { BotEditor } from "@/components/BotEditor";
import { MenuBuilder } from "@/components/MenuBuilder";

interface BotPageProps {
  params: {
    id: string;
  };
}

export default async function BotDetailPage({ params }: BotPageProps) {
  const session = await getAdminSession();
  if (!session) {
    redirect("/login");
  }

  if (session.mustChangePassword) {
    redirect("/login?changePassword=true");
  }

  const { id } = params;

  // Strict bot access authorization check
  const allowed = await hasBotAccess(session, id);
  if (!allowed) {
    redirect("/dashboard");
  }

  const bot = await getBotWithConfig(id);
  if (!bot) {
    notFound();
  }

  // Fetch bot users strictly isolated to this botId
  const rawUsers = await getBotUsers(id);
  const allowPhone = await canUserViewPhoneNumbers(session, id);

  const users = rawUsers.map((u) => ({
    ...u,
    telegramPhNo: allowPhone ? u.telegramPhNo : u.telegramPhNo ? "[REDACTED]" : null,
  }));

  // Fetch bot reply keyboard buttons
  const buttons = await getBotButtons(id);

  const initialWelcomeMessage =
    bot.config?.welcomeMessage ||
    "Hello! Welcome to the bot. Tap the button below to get started.";

  return (
    <BotdeskLayout
      userEmail={session.email}
      role={session.role}
      activeNav="bots"
      breadcrumb={bot.name}
    >
      <div className="space-y-6">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center space-x-2 text-xs text-[var(--muted)]">
          <Link href="/dashboard" className="hover:text-[var(--accent)] transition">
            Bots Dashboard
          </Link>
          <span>/</span>
          <span className="font-semibold text-[var(--text)]">{bot.name}</span>
        </div>

        {/* Bot Profile Header */}
        <div className="mb-8 rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center space-x-3">
                <h1 className="text-2xl font-bold tracking-tight text-white">
                  {bot.name}
                </h1>
                <span className="rounded-full bg-blue-950/70 border border-blue-800/50 px-2.5 py-0.5 text-xs font-semibold text-blue-400">
                  @{bot.username}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                    bot.isActive
                      ? "bg-emerald-950/70 border-emerald-800/50 text-emerald-400"
                      : "bg-slate-800 border-slate-700 text-slate-400"
                  }`}
                >
                  {bot.isActive ? "ACTIVE" : "INACTIVE"}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-slate-400 font-mono">
                <span>BackStage Bot ID: {bot.id}</span>
                {bot.telegramBotId != null && (
                  <span>Telegram Bot ID: {bot.telegramBotId.toString()}</span>
                )}
                <span>
                  Token:{" "}
                  {bot.encryptedToken
                    ? `••••${bot.tokenLast4 || ""}`
                    : `ENV: ${bot.tokenEnvVar}`}
                </span>
                <span>Connection: {bot.connectionStatus || (bot.isActive ? "STANDBY" : "DISCONNECTED")}</span>
                <span>Registered: {new Date(bot.createdAt).toLocaleDateString()}</span>
              </div>
            </div>

            <div className="flex items-center space-x-4 border-t sm:border-t-0 sm:border-l border-slate-800 pt-4 sm:pt-0 sm:pl-6">
              <div className="text-right">
                <div className="text-2xl font-bold text-white">
                  {users.length}
                </div>
                <div className="text-xs text-slate-400">Registered Users</div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-8">
          {/* Editor for Welcome Message */}
          <section>
            <BotEditor
              botId={bot.id}
              initialWelcomeMessage={initialWelcomeMessage}
            />
          </section>

          {/* Bot Reply Keyboard Menu Builder */}
          <section>
            <MenuBuilder botId={bot.id} initialButtons={buttons} />
          </section>

          {/* User List Table */}
          <section className="rounded-xl border border-slate-800 bg-slate-900 shadow-sm overflow-hidden">
            <div className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white">
                  Registered Telegram Users
                </h2>
                <p className="text-xs text-slate-400">
                  Users who interacted with this bot instance (/start or contact sharing).
                </p>
              </div>
              <span className="rounded-full bg-slate-800 border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-300">
                {users.length} {users.length === 1 ? "User" : "Users"}
              </span>
            </div>

            {users.length === 0 ? (
              <div className="p-12 text-center">
                <div className="mx-auto h-12 w-12 text-slate-600">
                  <svg
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
                    />
                  </svg>
                </div>
                <h3 className="mt-2 text-sm font-semibold text-white">
                  No users recorded yet
                </h3>
                <p className="mt-1 text-xs text-slate-400 max-w-sm mx-auto">
                  When you send <code className="font-mono text-blue-400 bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded">/start</code> to your test bot on Telegram, your profile will be recorded and displayed here in real time.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-300">
                  <thead className="bg-slate-900/90 text-xs font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="px-6 py-3">Telegram ID</th>
                      <th className="px-6 py-3">User Name</th>
                      <th className="px-6 py-3">Username</th>
                      <th className="px-6 py-3">Phone Number</th>
                      <th className="px-6 py-3">First Seen</th>
                      <th className="px-6 py-3">Last Seen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 font-sans">
                    {users.map((user) => {
                      const fullName = [user.firstName, user.lastName]
                        .filter(Boolean)
                        .join(" ");

                      return (
                        <tr key={user.id} className="hover:bg-slate-800/40 transition">
                          <td className="px-6 py-4 font-mono text-xs text-slate-200 font-medium">
                            {user.telegramId.toString()}
                          </td>
                          <td className="px-6 py-4 font-medium text-white">
                            {fullName || "—"}
                          </td>
                          <td className="px-6 py-4 text-slate-300">
                            {user.username ? (
                              <span className="text-blue-400">
                                @{user.username}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-6 py-4">
                            {user.telegramPhNo ? (
                              <span className="inline-flex items-center rounded-md bg-emerald-950/70 border border-emerald-800/50 px-2 py-1 text-xs font-medium text-emerald-400 font-mono">
                                📞 {user.telegramPhNo}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-500 italic">
                                Not shared
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-xs text-slate-400">
                            {new Date(user.firstSeenAt).toLocaleString()}
                          </td>
                          <td className="px-6 py-4 text-xs text-slate-400">
                            {new Date(user.lastSeenAt).toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </BotdeskLayout>
  );
}
