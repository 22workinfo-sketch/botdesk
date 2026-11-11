"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface BotEditorProps {
  botId: string;
  initialWelcomeMessage: string;
}

export function BotEditor({ botId, initialWelcomeMessage }: BotEditorProps) {
  const router = useRouter();
  const [welcomeMessage, setWelcomeMessage] = useState(initialWelcomeMessage);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);
    setSaving(true);

    try {
      const res = await fetch(`/api/bots/${botId}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ welcomeMessage }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to update welcome message");
      }

      setStatusMessage({
        type: "success",
        text: "Welcome message saved! The next /start command in Telegram will immediately use this updated greeting.",
      });

      router.refresh();
    } catch (err) {
      setStatusMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to save changes",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-sm">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-white">
          Bot Welcome Message Configuration
        </h3>
        <p className="mt-1 text-sm text-slate-400">
          This message is dynamically fetched and sent whenever a Telegram user executes the <code className="bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded text-blue-400 font-mono">/start</code> command.
        </p>
      </div>

      {statusMessage && (
        <div
          className={`mb-4 rounded-lg p-3 text-sm border ${
            statusMessage.type === "success"
              ? "bg-emerald-950/60 border-emerald-800/60 text-emerald-300"
              : "bg-red-950/60 border-red-800/60 text-red-300"
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
            Welcome Greeting Text
          </label>
          <textarea
            rows={5}
            required
            value={welcomeMessage}
            onChange={(e) => setWelcomeMessage(e.target.value)}
            className="w-full rounded-lg bg-slate-950 border border-slate-700 p-3 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-sans"
            placeholder="Enter welcome message..."
          />
          <div className="mt-1 text-right text-xs text-slate-400">
            {welcomeMessage.length} characters
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-slate-400">
            Changes are audited and stored in PostgreSQL with timestamp & admin ID.
          </span>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-blue-600/20 hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 transition"
          >
            {saving ? "Saving Changes..." : "Save Welcome Message"}
          </button>
        </div>
      </form>
    </div>
  );
}
