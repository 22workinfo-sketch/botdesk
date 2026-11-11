"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { safeFetchJson } from "@/lib/api-client";

export interface BotData {
  id: string;
  name: string;
  username: string;
  telegramBotId?: string | null;
  isActive: boolean;
  tokenEnvVar: string;
  hasStoredToken?: boolean;
  tokenLast4?: string | null;
  description?: string | null;
  connectionStatus?: string;
  lastError?: string | null;
  lastCheckedAt?: string | null;
  createdAt: string | Date;
  config?: {
    welcomeMessage: string;
  } | null;
  _count?: {
    users: number;
  };
}

export interface TelegramUserData {
  id: string;
  telegramId: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  telegramPhNo: string | null;
  firstSeenAt: string | Date;
  lastSeenAt: string | Date;
}

interface BotdeskDashboardProps {
  bots: BotData[];
  initialUsersByBot: Record<string, TelegramUserData[]>;
  isSuperAdmin?: boolean;
}

export function BotdeskDashboard({
  bots: initialBots,
  initialUsersByBot,
  isSuperAdmin = true,
}: BotdeskDashboardProps) {
  const router = useRouter();
  const [bots, setBots] = useState<BotData[]>(initialBots);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(initialBots.length > 0 ? [initialBots[0].id] : [])
  );
  const [activeBotId, setActiveBotId] = useState<string>(
    initialBots.length > 0 ? initialBots[0].id : ""
  );
  const [activeTab, setActiveTab] = useState<"settings" | "users">("settings");

  // Add Bot Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [addName, setAddName] = useState("");
  const [addToken, setAddToken] = useState("");
  const [addDescription, setAddDescription] = useState("");
  const [showAddTokenText, setShowAddTokenText] = useState(false);
  const [addingBot, setAddingBot] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Edit / Replace Token Modal State
  const [editingBot, setEditingBot] = useState<BotData | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);
  const [editToken, setEditToken] = useState("");
  const [showEditTokenText, setShowEditTokenText] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Connection Testing State
  const [testingId, setTestingId] = useState<string | null>(null);
  const [globalNotice, setGlobalNotice] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  // Active bot welcome message edit state
  const activeBot = bots.find((b) => b.id === activeBotId) || bots[0];
  const [welcomeText, setWelcomeText] = useState(
    activeBot?.config?.welcomeMessage ||
      "Hello! Welcome to the bot. Tap the button below to get started."
  );
  const [savingWelcome, setSavingWelcome] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Chat simulator state
  const [chatMessages, setChatMessages] = useState<
    Array<{ id: number; text: string; sender: "user" | "bot" | "note" }>
  >([
    {
      id: 1,
      text: "Draft preview — send /start to test a response.",
      sender: "note",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [simFlowStructure, setSimFlowStructure] = useState<any | null>(null);
  const [simCurrentMenuId, setSimCurrentMenuId] = useState<string>("root");
  const [simStack, setSimStack] = useState<string[]>([]);
  const [simActiveButtons, setSimActiveButtons] = useState<Array<{ id: string; label: string; actionType?: string }>>([]);

  useEffect(() => {
    // Load active bot's flow or menu structure
    const loadBotFlowForSimulator = async () => {
      try {
        const { ok, data } = await safeFetchJson<any>(`/api/bots/${activeBotId}/flow`);
        const struct = data?.published?.structure || data?.draft?.structure;
        if (ok && struct) {
          setSimFlowStructure(struct);
          setSimCurrentMenuId("root");
          setSimStack([]);
          const rootButtons = struct.rootMenu?.buttons?.filter((b: any) => b.isEnabled) || [];
          setSimActiveButtons(rootButtons);
        } else {
          // Fallback to classic menu buttons
          const menuRes = await safeFetchJson<any>(`/api/bots/${activeBotId}/menu`);
          if (menuRes.ok && Array.isArray(menuRes.data?.buttons)) {
            const btns = menuRes.data.buttons.filter((b: any) => b.isEnabled);
            setSimFlowStructure(null);
            setSimCurrentMenuId("root");
            setSimStack([]);
            setSimActiveButtons(btns);
          }
        }
      } catch {
        // Fallback gracefully
      }
    };

    loadBotFlowForSimulator();
  }, [activeBotId]);

  const filteredBots = bots.filter((b) =>
    (b.name + " " + b.username + " " + (b.description || "")).toLowerCase().includes(search.toLowerCase())
  );

  const handleSelectBot = (id: string) => {
    setActiveBotId(id);
    const bot = bots.find((b) => b.id === id);
    if (bot) {
      setWelcomeText(
        bot.config?.welcomeMessage ||
          "Hello! Welcome to the bot. Tap the button below to get started."
      );
      setSaveStatus(null);
      setChatMessages([
        {
          id: Date.now(),
          text: `Now viewing ${bot.name} (@${bot.username}). Send /start to test.`,
          sender: "note",
        },
      ]);
    }
  };

  // 1. Add Bot Handler
  const handleOpenAdd = () => {
    setAddName("");
    setAddToken("");
    setAddDescription("");
    setAddError(null);
    setShowAddTokenText(false);
    setShowAddModal(true);
  };

  const handleSaveAddBot = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);

    const name = addName.trim();
    const token = addToken.trim();

    if (!name) {
      setAddError("Bot display name is required.");
      return;
    }
    if (!token) {
      setAddError("Telegram bot token from @BotFather is required.");
      return;
    }

    setAddingBot(true);

    try {
      const res = await fetch("/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          token,
          description: addDescription.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to add bot.");
      }

      const newBot: BotData = data.bot;
      setBots((prev) => [...prev, newBot]);
      setActiveBotId(newBot.id);
      setSelectedIds((prev) => new Set([...prev, newBot.id]));
      setShowAddModal(false);
      setAddToken(""); // Securely wipe token from memory

      setGlobalNotice({
        type: "success",
        text: `✅ Bot "${newBot.name}" (@${newBot.username}) successfully added and verified! If your background bot runner (npm run bot) is running, restart it to begin polling this new bot.`,
      });
      router.refresh();
    } catch (err: any) {
      setAddError(err.message || "Failed to add bot.");
    } finally {
      setAddingBot(false);
    }
  };

  // 2. Open Edit / Replace Token Modal
  const handleOpenEdit = (bot: BotData) => {
    setEditingBot(bot);
    setEditName(bot.name);
    setEditDescription(bot.description || "");
    setEditIsActive(bot.isActive);
    setEditToken("");
    setShowEditTokenText(false);
    setEditError(null);
  };

  const handleSaveEditBot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBot) return;

    setEditError(null);
    setSavingEdit(true);

    try {
      const payload: any = {
        name: editName.trim(),
        description: editDescription.trim(),
        isActive: editIsActive,
      };

      if (editToken.trim()) {
        payload.token = editToken.trim();
      }

      const res = await fetch(`/api/bots/${editingBot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update bot.");
      }

      const updatedBot: BotData = data.bot;
      setBots((prev) => prev.map((b) => (b.id === updatedBot.id ? updatedBot : b)));
      setEditingBot(null);
      setEditToken(""); // Securely wipe token

      setGlobalNotice({
        type: "success",
        text: `✅ Bot "${updatedBot.name}" updated successfully.`,
      });
      router.refresh();
    } catch (err: any) {
      setEditError(err.message || "Failed to update bot.");
    } finally {
      setSavingEdit(false);
    }
  };

  // 3. Quick Toggle Active/Paused
  const handleToggleActive = async (bot: BotData) => {
    const nextState = !bot.isActive;
    try {
      const res = await fetch(`/api/bots/${bot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextState }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to toggle status");

      setBots((prev) =>
        prev.map((b) =>
          b.id === bot.id
            ? {
                ...b,
                isActive: nextState,
                connectionStatus: nextState ? "STANDBY" : "DISCONNECTED",
              }
            : b
        )
      );

      setGlobalNotice({
        type: "info",
        text: `Bot "${bot.name}" is now ${nextState ? "Enabled" : "Paused"}.`,
      });
    } catch (err: any) {
      setGlobalNotice({
        type: "error",
        text: `Failed to toggle status: ${err.message}`,
      });
    }
  };

  // 4. Live Test Connection
  const handleTestConnection = async (botId: string) => {
    setTestingId(botId);
    try {
      const res = await fetch(`/api/bots/${botId}/test-connection`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Connection test failed");

      const result = data.result;
      setBots((prev) =>
        prev.map((b) =>
          b.id === botId
            ? {
                ...b,
                connectionStatus: result.status,
                lastError: result.error || null,
              }
            : b
        )
      );

      if (result.ok) {
        setGlobalNotice({
          type: "success",
          text: `✅ Connected! Verified with Telegram as @${result.botInfo?.username} (ID: ${result.botInfo?.id}).`,
        });
      } else {
        setGlobalNotice({
          type: "error",
          text: `❌ Connection error: ${result.error || "Could not verify bot token with Telegram."}`,
        });
      }
    } catch (err: any) {
      setGlobalNotice({
        type: "error",
        text: `Connection test error: ${err.message}`,
      });
    } finally {
      setTestingId(null);
    }
  };

  const handleSaveWelcome = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBot) return;
    setSavingWelcome(true);
    setSaveStatus(null);

    try {
      const res = await fetch(`/api/bots/${activeBot.id}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ welcomeMessage: welcomeText }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to update configuration");
      }

      setSaveStatus("Saved to PostgreSQL database successfully!");
      setBots((prev) =>
        prev.map((b) =>
          b.id === activeBot.id
            ? { ...b, config: { welcomeMessage: welcomeText } }
            : b
        )
      );
    } catch (error) {
      setSaveStatus(
        error instanceof Error ? error.message : "Error saving welcome message"
      );
    } finally {
      setSavingWelcome(false);
    }
  };

  const handleSimulateAction = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const userMsgId = Date.now();
    const botMsgId = userMsgId + 1;

    if (trimmed.startsWith("/start")) {
      setSimCurrentMenuId("root");
      setSimStack([]);
      const rootButtons =
        simFlowStructure?.rootMenu?.buttons?.filter((b: any) => b.isEnabled) ||
        (Array.isArray(simActiveButtons) ? simActiveButtons : []);
      setSimActiveButtons(rootButtons);

      const prompt = simFlowStructure?.rootMenu?.promptText || welcomeText;
      setChatMessages((prev) => [
        ...prev,
        { id: userMsgId, text: trimmed, sender: "user" },
        { id: botMsgId, text: prompt, sender: "bot" },
      ]);
      return;
    }

    // Handle "◀ Back"
    if (trimmed === "◀ Back") {
      const prevId = simStack.length > 0 ? simStack[simStack.length - 1] : "root";
      const newStack = simStack.slice(0, -1);
      const submenus = simFlowStructure?.submenus || {};
      const targetMenu = prevId === "root" ? simFlowStructure?.rootMenu : submenus[prevId];
      setSimCurrentMenuId(prevId);
      setSimStack(newStack);

      const navButtons = targetMenu?.buttons?.filter((b: any) => b.isEnabled) || [];
      const updatedButtons =
        prevId === "root"
          ? navButtons
          : [...navButtons, { id: "back", label: "◀ Back" }, { id: "main", label: "🏠 Main Menu" }];
      setSimActiveButtons(updatedButtons);

      setChatMessages((prev) => [
        ...prev,
        { id: userMsgId, text: "◀ Back", sender: "user" },
        { id: botMsgId, text: targetMenu?.promptText || `📂 ${targetMenu?.title || "Menu"}`, sender: "bot" },
      ]);
      return;
    }

    // Handle "🏠 Main Menu"
    if (trimmed === "🏠 Main Menu") {
      setSimCurrentMenuId("root");
      setSimStack([]);
      const rootButtons = simFlowStructure?.rootMenu?.buttons?.filter((b: any) => b.isEnabled) || [];
      setSimActiveButtons(rootButtons);

      setChatMessages((prev) => [
        ...prev,
        { id: userMsgId, text: "🏠 Main Menu", sender: "user" },
        { id: botMsgId, text: simFlowStructure?.rootMenu?.promptText || welcomeText, sender: "bot" },
      ]);
      return;
    }

    // Match Button in simActiveButtons
    const matchedBtn = simActiveButtons.find((b) => b.label === trimmed);

    if (matchedBtn) {
      if (matchedBtn.actionType === "OPEN_SUBMENU" && simFlowStructure?.submenus) {
        const targetMenuId = (matchedBtn as any).targetMenuId;
        const targetMenu = simFlowStructure.submenus[targetMenuId];
        if (targetMenu) {
          setSimStack((prev) => [...prev, simCurrentMenuId]);
          setSimCurrentMenuId(targetMenuId);
          const subBtns = (targetMenu.buttons || []).filter((b: any) => b.isEnabled);
          setSimActiveButtons([...subBtns, { id: "back", label: "◀ Back" }, { id: "main", label: "🏠 Main Menu" }]);

          setChatMessages((prev) => [
            ...prev,
            { id: userMsgId, text: trimmed, sender: "user" },
            { id: botMsgId, text: targetMenu.promptText || `📂 ${targetMenu.title}`, sender: "bot" },
          ]);
          return;
        }
      }

      if (matchedBtn.actionType === "REQUEST_CONTACT") {
        setChatMessages((prev) => [
          ...prev,
          { id: userMsgId, text: trimmed, sender: "user" },
          { id: botMsgId, text: "📱 [Telegram Contact Prompt]\n\nTap 'Share Phone Number' to verify your contact with this bot.", sender: "bot" },
        ]);
        return;
      }

      if (matchedBtn.actionType === "JOIN_CHANNELS") {
        setChatMessages((prev) => [
          ...prev,
          { id: userMsgId, text: trimmed, sender: "user" },
          { id: botMsgId, text: (matchedBtn as any).replyText || "Please join our official channels below, then tap 'Check Joined' to verify your membership.", sender: "bot" },
        ]);
        return;
      }

      if (matchedBtn.actionType === "URL") {
        setChatMessages((prev) => [
          ...prev,
          { id: userMsgId, text: trimmed, sender: "user" },
          { id: botMsgId, text: `🔗 Link: ${(matchedBtn as any).url || "https://t.me"}`, sender: "bot" },
        ]);
        return;
      }

      // SEND_TEXT
      const reply = (matchedBtn as any).replyText || `Action response for "${trimmed}"`;
      setChatMessages((prev) => [
        ...prev,
        { id: userMsgId, text: trimmed, sender: "user" },
        { id: botMsgId, text: reply, sender: "bot" },
      ]);
      return;
    }

    // Default response
    setChatMessages((prev) => [
      ...prev,
      { id: userMsgId, text: trimmed, sender: "user" },
      { id: botMsgId, text: `Received: "${trimmed}". Tap one of the configured buttons or send /start.`, sender: "bot" },
    ]);
  };

  const handleSendChatMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text) return;
    setChatInput("");
    handleSimulateAction(text);
  };

  const activeBotUsers = initialUsersByBot[activeBotId] || [];

  return (
    <div className="space-y-6">
      {/* Heading */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text)]">
            Your bots, in sync.
          </h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            Manage multiple Telegram bots independently from one backstage panel.
          </p>
        </div>

        {isSuperAdmin && (
          <button
            type="button"
            onClick={handleOpenAdd}
            className="botdesk-btn primary self-start sm:self-auto font-semibold flex items-center gap-1.5"
          >
            <span>＋</span> Add Telegram Bot
          </button>
        )}
      </div>

      {/* Global Notice Alert */}
      {globalNotice && (
        <div
          className={`p-3.5 rounded-lg border text-xs flex items-center justify-between ${
            globalNotice.type === "success"
              ? "bg-[var(--greenbg)] border-[var(--green)] text-[var(--green)]"
              : globalNotice.type === "error"
              ? "bg-[var(--redbg)] border-[var(--red)] text-[var(--red)]"
              : "bg-[var(--bluebg)] border-[var(--border)] text-[var(--accent)]"
          }`}
        >
          <span>{globalNotice.text}</span>
          <button
            type="button"
            onClick={() => setGlobalNotice(null)}
            className="text-xs font-bold hover:underline ml-4 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Summary Metrics */}
      <div className="summary-grid">
        <div className="metric-box">
          <span>Connected bots</span>
          <strong>{bots.length}</strong>
        </div>
        <div className="metric-box">
          <span>Automation enabled</span>
          <strong className="text-[var(--green)]">
            {bots.filter((b) => b.isActive).length}
          </strong>
        </div>
        <div className="metric-box">
          <span>Total registered users</span>
          <strong className="text-[var(--accent)]">
            {bots.reduce((acc, b) => acc + (b._count?.users || 0), 0)}
          </strong>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <input
          type="search"
          placeholder="Search by bot name, username, description…"
          aria-label="Search bots"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="botdesk-input sm:max-w-xs text-sm"
        />
        <span className="text-xs text-[var(--muted)]">
          Scope:{" "}
          <strong className="text-[var(--text)]">
            {selectedIds.size === 0
              ? "No bots selected"
              : selectedIds.size === bots.length
              ? "All bots"
              : `${selectedIds.size} selected`}
          </strong>
        </span>
      </div>

      {/* Bots Table */}
      <div className="botdesk-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] text-xs uppercase font-medium">
                <th className="py-2.5 px-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={
                      filteredBots.length > 0 &&
                      filteredBots.every((b) => selectedIds.has(b.id))
                    }
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(new Set(filteredBots.map((b) => b.id)));
                      } else {
                        setSelectedIds(new Set());
                      }
                    }}
                    className="accent-[var(--accent)] cursor-pointer"
                  />
                </th>
                <th className="py-2.5 px-4">Bot</th>
                <th className="py-2.5 px-4">Token Source</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">Connection State</th>
                <th className="py-2.5 px-4">Users</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filteredBots.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[var(--muted)]">
                    No bots found matching "{search}".
                  </td>
                </tr>
              ) : (
                filteredBots.map((b) => {
                  const isViewing = b.id === activeBotId;
                  const isChecked = selectedIds.has(b.id);
                  const isTesting = testingId === b.id;

                  const statusClass =
                    b.connectionStatus === "CONNECTED"
                      ? "healthy"
                      : b.connectionStatus === "STANDBY"
                      ? "paused"
                      : b.connectionStatus === "ERROR"
                      ? "failed"
                      : "paused";

                  return (
                    <tr
                      key={b.id}
                      className={`hover:bg-[var(--surface)] transition ${
                        isChecked ? "bg-[var(--bluebg)]/40" : ""
                      }`}
                    >
                      <td className="py-3 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            const next = new Set(selectedIds);
                            e.target.checked ? next.add(b.id) : next.delete(b.id);
                            setSelectedIds(next);
                          }}
                          className="accent-[var(--accent)] cursor-pointer"
                        />
                      </td>

                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => handleSelectBot(b.id)}
                          className="flex items-center gap-3 text-left w-full group cursor-pointer"
                        >
                          <span className="w-8 h-8 rounded-lg bg-[var(--surface)] border border-[var(--border)] grid place-items-center font-bold text-sm text-[var(--accent)] flex-shrink-0">
                            {b.name.charAt(0).toUpperCase()}
                          </span>
                          <div>
                            <div className="font-semibold text-sm text-[var(--text)] group-hover:text-[var(--accent)] flex items-center gap-1.5">
                              {b.name}
                              {isViewing && (
                                <span className="text-[10px] font-normal text-[var(--accent)] bg-[var(--bluebg)] px-1.5 py-0.2 rounded">
                                  Viewing
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-[var(--muted)] font-mono">
                              @{b.username}
                              {b.telegramBotId ? ` · Telegram Bot ID: ${b.telegramBotId}` : ""}
                            </div>
                          </div>
                        </button>
                      </td>

                      <td className="py-3 px-4">
                        <span className="text-xs font-mono text-[var(--muted)] bg-[var(--surface)] px-2 py-0.5 rounded border border-[var(--border)]">
                          {b.hasStoredToken
                            ? `Encrypted (${b.tokenLast4 || "••••"})`
                            : `ENV: ${b.tokenEnvVar}`}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        <span
                          className={`botdesk-badge ${
                            b.isActive ? "enabled" : "paused"
                          }`}
                        >
                          {b.isActive ? "Active" : "Paused"}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-0.5">
                          <span className={`botdesk-badge ${statusClass} inline-flex items-center gap-1`}>
                            {b.connectionStatus || (b.isActive ? "STANDBY" : "DISCONNECTED")}
                          </span>
                          {b.lastError && (
                            <span
                              className="text-[10px] text-[var(--red)] truncate max-w-[160px]"
                              title={b.lastError}
                            >
                              ⚠️ {b.lastError}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-4 font-mono text-xs text-[var(--text)]">
                        {b._count?.users || 0}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleTestConnection(b.id)}
                            disabled={isTesting}
                            className="botdesk-btn text-xs py-1 px-2 border border-[var(--border)]"
                            title="Test connection via Telegram getMe"
                          >
                            {isTesting ? "Testing…" : "Test"}
                          </button>

                          {isSuperAdmin && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleToggleActive(b)}
                                className="botdesk-btn text-xs py-1 px-2 border border-[var(--border)]"
                                title={b.isActive ? "Pause automation" : "Enable automation"}
                              >
                                {b.isActive ? "Pause" : "Enable"}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleOpenEdit(b)}
                                className="botdesk-btn text-xs py-1 px-2 border border-[var(--border)]"
                                title="Edit display settings or replace token"
                              >
                                Settings
                              </button>
                            </>
                          )}

                          <Link
                            href={`/bots/${b.id}`}
                            className="text-xs font-semibold text-[var(--accent)] hover:underline ml-1"
                          >
                            Details →
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Details Split View for Active Bot */}
      {activeBot && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-6">
          {/* Left Card: Bot Configuration */}
          <section className="lg:col-span-7 botdesk-card">
            <div className="card-header">
              <div>
                <h2 className="text-base font-bold text-[var(--text)]">
                  {activeBot.name}
                </h2>
                <div className="text-xs text-[var(--muted)] font-mono flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>@{activeBot.username}</span>
                  <span title="Internal Database UUID">BackStage Bot ID: {activeBot.id}</span>
                  {activeBot.telegramBotId && (
                    <span title="Numeric Telegram Bot ID">Telegram Bot ID: {activeBot.telegramBotId}</span>
                  )}
                </div>
              </div>
              <span className="text-xs text-[var(--muted)] font-mono border border-[var(--border)] px-2 py-0.5 rounded">
                Individual Bot
              </span>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-[var(--border)] px-4 gap-2 bg-[var(--surface)]">
              <button
                type="button"
                onClick={() => setActiveTab("settings")}
                className={`py-2.5 px-3 text-xs font-semibold border-b-2 transition ${
                  activeTab === "settings"
                    ? "border-[var(--accent)] text-[var(--accent)]"
                    : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                Welcome Message
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("users")}
                className={`py-2.5 px-3 text-xs font-semibold border-b-2 transition ${
                  activeTab === "users"
                    ? "border-[var(--accent)] text-[var(--accent)]"
                    : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                Registered Users ({activeBotUsers.length})
              </button>
            </div>

            <div className="card-body">
              {activeTab === "settings" ? (
                <form onSubmit={handleSaveWelcome} className="space-y-4">
                  <div>
                    <label
                      htmlFor="welcome-message-input"
                      className="block text-xs font-medium text-[var(--text)] mb-1"
                    >
                      Welcome Greeting (/start)
                    </label>
                    <textarea
                      id="welcome-message-input"
                      rows={6}
                      value={welcomeText}
                      onChange={(e) => setWelcomeText(e.target.value)}
                      className="botdesk-input text-xs font-mono leading-relaxed"
                      placeholder="Enter the message your bot sends when a user taps /start..."
                    />
                    <p className="text-[11px] text-[var(--muted)] mt-1">
                      Dynamically loaded from PostgreSQL for this specific bot.
                    </p>
                  </div>

                  {saveStatus && (
                    <div
                      className={`p-2.5 rounded text-xs ${
                        saveStatus.includes("successfully")
                          ? "bg-[var(--greenbg)] border border-[var(--green)] text-[var(--green)]"
                          : "bg-[var(--redbg)] border border-[var(--red)] text-[var(--red)]"
                      }`}
                    >
                      {saveStatus}
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2">
                    <span className="text-xs text-[var(--muted)]">
                      Bot Status:{" "}
                      <strong className="text-[var(--text)]">
                        {activeBot.isActive ? "Active" : "Paused"}
                      </strong>
                    </span>
                    <button
                      type="submit"
                      disabled={savingWelcome}
                      className="botdesk-btn primary text-xs"
                    >
                      {savingWelcome ? "Saving..." : "Save Welcome Message"}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--muted)]">
                      Users who interacted with <strong>{activeBot.name}</strong>
                    </span>
                    <span className="text-xs text-[var(--muted)] font-mono">
                      {activeBotUsers.length} total
                    </span>
                  </div>

                  {activeBotUsers.length === 0 ? (
                    <div className="py-8 text-center text-xs text-[var(--muted)] border border-dashed border-[var(--border)] rounded-lg">
                      No users have sent /start to this bot yet.
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-[var(--border)] rounded-lg">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]">
                            <th className="py-2 px-3">User</th>
                            <th className="py-2 px-3">Telegram ID</th>
                            <th className="py-2 px-3">Phone</th>
                            <th className="py-2 px-3">Last Seen</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)] font-mono">
                          {activeBotUsers.map((u) => (
                            <tr key={u.id} className="hover:bg-[var(--surface)]">
                              <td className="py-2 px-3 text-[var(--text)] font-sans">
                                {u.firstName || ""} {u.lastName || ""}
                                {u.username && (
                                  <span className="text-[var(--muted)] ml-1 font-mono">
                                    (@{u.username})
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-[var(--muted)]">
                                {u.telegramId}
                              </td>
                              <td className="py-2 px-3 text-[var(--accent)] font-semibold">
                                {u.telegramPhNo || "—"}
                              </td>
                              <td className="py-2 px-3 text-[var(--muted)]">
                                {new Date(u.lastSeenAt).toLocaleDateString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Right Card: Interactive Telegram Simulator */}
          <section className="lg:col-span-5 botdesk-card">
            <div className="card-header">
              <div>
                <h2 className="text-base font-bold text-[var(--text)]">
                  Chat Simulator
                </h2>
                <p className="text-xs text-[var(--muted)]">
                  Preview for {activeBot.name} (@{activeBot.username})
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setChatMessages([
                    {
                      id: Date.now(),
                      text: "Draft preview — send /start to test a response.",
                      sender: "note",
                    },
                  ])
                }
                className="botdesk-btn text-xs py-1 px-2 border border-[var(--border)]"
              >
                Reset
              </button>
            </div>

            <div className="card-body space-y-3">
              <div className="chat-window">
                {chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`chat-bubble ${
                      msg.sender === "user"
                        ? "user"
                        : msg.sender === "note"
                        ? "note"
                        : ""
                    }`}
                  >
                    {msg.text}
                  </div>
                ))}
              </div>

              {/* Simulated Reply Keyboard */}
              {simActiveButtons.length > 0 && (
                <div className="p-2 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                  <div className="text-[10px] uppercase font-bold text-[var(--muted)] mb-1.5 flex justify-between">
                    <span>
                      Menu: {simCurrentMenuId === "root" ? "Main Menu" : simCurrentMenuId}
                    </span>
                    <span>(Click button to test)</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {simActiveButtons.map((btn) => (
                      <button
                        key={btn.id}
                        type="button"
                        onClick={() => handleSimulateAction(btn.label)}
                        className="py-1.5 px-2 rounded bg-[var(--card)] hover:bg-[var(--border)] text-[var(--text)] text-xs font-medium text-center border border-[var(--border)] truncate transition active:scale-95"
                        title={btn.label}
                      >
                        {btn.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <form onSubmit={handleSendChatMessage} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Send /start or test a message..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  className="botdesk-input text-xs"
                />
                <button type="submit" className="botdesk-btn primary text-xs">
                  Send
                </button>
              </form>

              <p className="text-[11px] text-[var(--muted)] italic">
                Local simulation only. Live messages are processed in real time by your running long polling bot runner.
              </p>
            </div>
          </section>
        </div>
      )}

      {/* Modal: Add Telegram Bot */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl bg-[var(--panel)] border border-[var(--border)] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <div>
                <h2 className="text-lg font-bold text-[var(--text)]">
                  Connect a New Telegram Bot
                </h2>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  Register another Telegram bot to manage its menu, channels, users, and posts.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-xs text-[var(--muted)] hover:text-[var(--text)] font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {addError && (
              <div className="p-3 rounded-lg bg-[var(--redbg)] border border-[var(--red)] text-xs text-[var(--red)]">
                ⚠️ {addError}
              </div>
            )}

            <form onSubmit={handleSaveAddBot} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--text)] mb-1">
                  Bot Display Name <span className="text-[var(--red)]">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. VIP Member Bot, Customer Support Bot"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  className="botdesk-input text-xs"
                  maxLength={64}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-[var(--text)]">
                    Telegram Bot Token <span className="text-[var(--red)]">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowAddTokenText((prev) => !prev)}
                    className="text-[11px] text-[var(--accent)] hover:underline cursor-pointer"
                  >
                    {showAddTokenText ? "Hide token" : "Show token"}
                  </button>
                </div>
                <input
                  type={showAddTokenText ? "text" : "password"}
                  required
                  placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ"
                  value={addToken}
                  onChange={(e) => setAddToken(e.target.value)}
                  className="botdesk-input text-xs font-mono"
                  autoComplete="off"
                />
                <p className="text-[11px] text-[var(--muted)] mt-1">
                  Obtain your token by messaging <strong>@BotFather</strong> on Telegram.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text)] mb-1">
                  Description / Notes (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Primary subscriber bot for Myanmar channel"
                  value={addDescription}
                  onChange={(e) => setAddDescription(e.target.value)}
                  className="botdesk-input text-xs"
                  maxLength={255}
                />
              </div>

              <div className="p-3 rounded-lg bg-[var(--bluebg)] border border-[var(--border)] text-xs text-[var(--accent)] space-y-1">
                <strong className="block font-semibold">🔒 Authenticated Token Encryption:</strong>
                <p className="text-[11px] leading-relaxed">
                  Your bot token will be verified via Telegram <code className="font-mono">getMe</code> and encrypted with <strong>AES-256-GCM</strong> before saving. It is never exposed in responses or logs.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  disabled={addingBot}
                  className="botdesk-btn text-xs py-2 px-3 border border-[var(--border)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingBot}
                  className="botdesk-btn primary text-xs py-2 px-4 font-semibold"
                >
                  {addingBot ? "Verifying & Adding..." : "Verify & Connect Bot"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Bot / Replace Token */}
      {editingBot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl bg-[var(--panel)] border border-[var(--border)] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <div>
                <h2 className="text-lg font-bold text-[var(--text)]">
                  Edit Bot Settings
                </h2>
                <div className="text-xs text-[var(--muted)] font-mono mt-0.5 flex flex-wrap gap-x-3">
                  <span>@{editingBot.username}</span>
                  <span>BackStage Bot ID: {editingBot.id}</span>
                  {editingBot.telegramBotId && (
                    <span>Telegram Bot ID: {editingBot.telegramBotId}</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingBot(null)}
                className="text-xs text-[var(--muted)] hover:text-[var(--text)] font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {editError && (
              <div className="p-3 rounded-lg bg-[var(--redbg)] border border-[var(--red)] text-xs text-[var(--red)]">
                ⚠️ {editError}
              </div>
            )}

            <form onSubmit={handleSaveEditBot} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--text)] mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="botdesk-input text-xs"
                  maxLength={64}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text)] mb-1">
                  Description / Notes
                </label>
                <input
                  type="text"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="botdesk-input text-xs"
                  maxLength={255}
                />
              </div>

              <div className="flex items-center gap-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                <input
                  type="checkbox"
                  id="bot-active-checkbox"
                  checked={editIsActive}
                  onChange={(e) => setEditIsActive(e.target.checked)}
                  className="accent-[var(--accent)] w-4 h-4 cursor-pointer"
                />
                <label
                  htmlFor="bot-active-checkbox"
                  className="text-xs font-semibold text-[var(--text)] cursor-pointer"
                >
                  Enable bot automation (Active)
                  <span className="block text-[11px] font-normal text-[var(--muted)]">
                    When paused, incoming webhook updates or long polling are gracefully suspended.
                  </span>
                </label>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-[var(--text)]">
                    Replace Telegram Bot Token (Optional)
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowEditTokenText((prev) => !prev)}
                    className="text-[11px] text-[var(--accent)] hover:underline cursor-pointer"
                  >
                    {showEditTokenText ? "Hide token" : "Show token"}
                  </button>
                </div>
                <input
                  type={showEditTokenText ? "text" : "password"}
                  placeholder="Leave blank to keep existing token"
                  value={editToken}
                  onChange={(e) => setEditToken(e.target.value)}
                  className="botdesk-input text-xs font-mono"
                  autoComplete="off"
                />
                <p className="text-[11px] text-[var(--muted)] mt-1">
                  Current Token:{" "}
                  <code className="font-mono text-[var(--text)]">
                    {editingBot.hasStoredToken
                      ? `••••${editingBot.tokenLast4 || ""}`
                      : `ENV: ${editingBot.tokenEnvVar}`}
                  </code>
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setEditingBot(null)}
                  disabled={savingEdit}
                  className="botdesk-btn text-xs py-2 px-3 border border-[var(--border)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="botdesk-btn primary text-xs py-2 px-4 font-semibold"
                >
                  {savingEdit ? "Saving Changes..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
