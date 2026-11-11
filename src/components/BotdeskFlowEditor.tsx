"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  FlowStructure,
  FlowMenu,
  FlowButton,
  FlowActionType,
  FlowVersionSummary,
  BotFlowData,
} from "@/lib/flow/types";
import { validateFlowStructure } from "@/lib/flow/validation";
import { safeFetchJson } from "@/lib/api-client";

export interface BotOption {
  id: string;
  name: string;
  username: string;
  welcomeMessage?: string;
}

interface BotdeskFlowEditorProps {
  bots: BotOption[];
  initialBotId: string;
}

interface PreviewMessage {
  id: number;
  sender: "user" | "bot" | "system";
  text: string;
  inlineButton?: { label: string; url?: string };
  autoDeleteSec?: number;
}

export function BotdeskFlowEditor({ bots, initialBotId }: BotdeskFlowEditorProps) {
  const router = useRouter();
  const [selectedBotId, setSelectedBotId] = useState<string>(initialBotId);
  const activeBot = bots.find((b) => b.id === selectedBotId) || bots[0];

  // Flow State
  const [loading, setLoading] = useState(true);
  const [flowData, setFlowData] = useState<BotFlowData | null>(null);
  const [structure, setStructure] = useState<FlowStructure | null>(null);
  const [isV2Flow, setIsV2Flow] = useState(false);
  const [activeMenuId, setActiveMenuId] = useState<string>("root");
  const [hasChanges, setHasChanges] = useState(false);

  // Status / Alerts
  const [statusMsg, setStatusMsg] = useState<{
    type: "success" | "error" | "info";
    text: string;
    errors?: string[];
  } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Button Modal
  const [showButtonModal, setShowButtonModal] = useState(false);
  const [editingButtonIndex, setEditingButtonIndex] = useState<number | null>(null);
  const [btnLabel, setBtnLabel] = useState("");
  const [btnAction, setBtnAction] = useState<FlowActionType>("SEND_TEXT");
  const [btnReplyText, setBtnReplyText] = useState("");
  const [btnTargetMenuId, setBtnTargetMenuId] = useState("");
  const [btnUrl, setBtnUrl] = useState("");
  const [btnUrlLabel, setBtnUrlLabel] = useState("");
  const [btnAutoDelete, setBtnAutoDelete] = useState(false);
  const [btnDeleteSeconds, setBtnDeleteSeconds] = useState(30);
  const [btnEnabled, setBtnEnabled] = useState(true);
  const [modalError, setModalError] = useState<string | null>(null);

  // Submenu Modal
  const [showSubmenuModal, setShowSubmenuModal] = useState(false);
  const [submenuTitle, setSubmenuTitle] = useState("");
  const [submenuPrompt, setSubmenuPrompt] = useState("");

  // Rollback Modal
  const [showRollbackModal, setShowRollbackModal] = useState(false);
  const [rollbackVersion, setRollbackVersion] = useState<number | null>(null);
  const [preserveDraft, setPreserveDraft] = useState(true);

  // Phone Simulation Preview State
  const [previewMenuId, setPreviewMenuId] = useState<string>("root");
  const [previewStack, setPreviewStack] = useState<string[]>([]);
  const [previewMessages, setPreviewMessages] = useState<PreviewMessage[]>([]);

  // Fetch Flow Data
  const fetchFlow = async (botId: string) => {
    setLoading(true);
    setStatusMsg(null);
    try {
      const { ok, data, error } = await safeFetchJson<BotFlowData>(`/api/bots/${botId}/flow`);
      if (!ok || !data) {
        throw new Error(error || "Failed to load flow data.");
      }
      setFlowData(data);

      const rawStruct: any = data.draft?.structure || data.published?.structure;
      const isV2 = Boolean(rawStruct && Array.isArray(rawStruct.nodes));
      setIsV2Flow(isV2);

      let activeStruct: FlowStructure;
      if (isV2) {
        activeStruct = {
          rootMenu: {
            id: "root",
            title: "Main Menu",
            promptText: activeBot?.welcomeMessage || "Welcome! Choose an option:",
            buttons: [],
          },
          submenus: {},
        };
      } else if (rawStruct && rawStruct.rootMenu) {
        activeStruct = {
          rootMenu: rawStruct.rootMenu,
          submenus: rawStruct.submenus && typeof rawStruct.submenus === "object" ? rawStruct.submenus : {},
        };
      } else {
        activeStruct = {
          rootMenu: {
            id: "root",
            title: "Main Menu",
            promptText: activeBot?.welcomeMessage || "Welcome! Choose an option:",
            buttons: [],
          },
          submenus: {},
        };
      }

      setStructure(activeStruct);
      setActiveMenuId("root");
      setHasChanges(data.hasUnpublishedChanges);
      resetPreview(activeStruct);
    } catch (err) {
      setStatusMsg({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to load bot flow.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFlow(selectedBotId);
  }, [selectedBotId]);

  // Reset Preview Simulation
  const resetPreview = (struct?: FlowStructure) => {
    const s = struct || structure;
    if (!s) return;
    setPreviewMenuId("root");
    setPreviewStack([]);
    setPreviewMessages([
      { id: 1, sender: "user", text: "/start" },
      {
        id: 2,
        sender: "bot",
        text:
          s.rootMenu.promptText ||
          activeBot.welcomeMessage ||
          "Welcome! Please choose an option from the menu.",
      },
    ]);
  };

  // Preview Button Click Handler
  const handlePreviewButtonClick = (label: string) => {
    if (!structure) return;

    const submenus =
      structure.submenus && typeof structure.submenus === "object"
        ? structure.submenus
        : {};

    const currentMenu: FlowMenu =
      previewMenuId === "root"
        ? structure.rootMenu || { id: "root", title: "Main Menu", promptText: "", buttons: [] }
        : submenus[previewMenuId] || structure.rootMenu;

    // Handle "◀ Back"
    if (label === "◀ Back") {
      const newMsgId = previewMessages.length + 1;
      const targetId = previewStack.length > 0 ? previewStack[previewStack.length - 1] : "root";
      const newStack = previewStack.slice(0, -1);
      const targetMenu =
        targetId === "root" ? structure.rootMenu : submenus[targetId] || structure.rootMenu;

      setPreviewMenuId(targetId);
      setPreviewStack(newStack);
      setPreviewMessages((prev) => [
        ...prev,
        { id: newMsgId, sender: "user", text: "◀ Back" },
        {
          id: newMsgId + 1,
          sender: "bot",
          text: targetMenu?.promptText || `📂 ${targetMenu?.title || "Menu"}`,
        },
      ]);
      return;
    }

    // Handle "🏠 Main Menu"
    if (label === "🏠 Main Menu") {
      const newMsgId = previewMessages.length + 1;
      setPreviewMenuId("root");
      setPreviewStack([]);
      setPreviewMessages((prev) => [
        ...prev,
        { id: newMsgId, sender: "user", text: "🏠 Main Menu" },
        {
          id: newMsgId + 1,
          sender: "bot",
          text: structure.rootMenu?.promptText || "Main Menu",
        },
      ]);
      return;
    }

    // Match Button
    const btn = (currentMenu?.buttons || []).find((b) => b.isEnabled && b.label === label);
    if (!btn) return;

    const newMsgId = previewMessages.length + 1;
    const userMsg: PreviewMessage = { id: newMsgId, sender: "user", text: label };

    if (btn.actionType === "OPEN_SUBMENU") {
      const targetSubmenu = btn.targetMenuId ? submenus[btn.targetMenuId] : null;
      if (!targetSubmenu) {
        setPreviewMessages((prev) => [
          ...prev,
          userMsg,
          {
            id: newMsgId + 1,
            sender: "bot",
            text: "⚠️ This submenu destination is missing.",
          },
        ]);
        return;
      }
      setPreviewStack((prev) => [...prev, previewMenuId]);
      setPreviewMenuId(targetSubmenu.id);
      setPreviewMessages((prev) => [
        ...prev,
        userMsg,
        {
          id: newMsgId + 1,
          sender: "bot",
          text: targetSubmenu.promptText || `📂 ${targetSubmenu.title}`,
        },
      ]);
    } else if (btn.actionType === "SEND_TEXT") {
      setPreviewMessages((prev) => [
        ...prev,
        userMsg,
        {
          id: newMsgId + 1,
          sender: "bot",
          text: btn.replyText || "(No reply text configured)",
          autoDeleteSec: btn.autoDeleteReply ? btn.deleteAfterSeconds : undefined,
        },
      ]);
    } else if (btn.actionType === "URL") {
      setPreviewMessages((prev) => [
        ...prev,
        userMsg,
        {
          id: newMsgId + 1,
          sender: "bot",
          text: btn.replyText || "Please visit the official link below:",
          inlineButton: {
            label: btn.urlLabel || "🌐 Open Link",
            url: btn.url || "#",
          },
        },
      ]);
    } else if (btn.actionType === "REQUEST_CONTACT") {
      setPreviewMessages((prev) => [
        ...prev,
        userMsg,
        {
          id: newMsgId + 1,
          sender: "system",
          text: `📱 [Simulation: Tapped native contact button '${btn.label}'. Real bot securely verifies and saves phone number.]`,
        },
      ]);
    } else if (btn.actionType === "JOIN_CHANNELS") {
      setPreviewMessages((prev) => [
        ...prev,
        userMsg,
        {
          id: newMsgId + 1,
          sender: "bot",
          text: btn.replyText || "Please join our official channels below:",
          inlineButton: {
            label: "📢 Join Channel (Mock)",
            url: "#",
          },
        },
      ]);
    }
  };

  // Safe Submenu Dictionary
  const submenus =
    structure && structure.submenus && typeof structure.submenus === "object"
      ? structure.submenus
      : {};

  // Active Menu Object
  const currentMenu = structure
    ? activeMenuId === "root"
      ? structure.rootMenu || { id: "root", title: "Main Menu", promptText: "", buttons: [] }
      : submenus[activeMenuId] || null
    : null;

  // Submenu Keys
  const submenuList = Object.values(submenus);

  // Save Draft
  const handleSaveDraft = async () => {
    if (!structure) return;
    setActionLoading(true);
    setStatusMsg(null);
    try {
      const { ok, error } = await safeFetchJson(
        `/api/bots/${selectedBotId}/flow/draft`,
        {
          method: "PUT",
          body: { structure },
        }
      );
      if (!ok) {
        throw new Error(error || "Failed to save draft flow.");
      }
      setStatusMsg({
        type: "success",
        text: "Draft saved successfully. (Active bot runtime continues running published flow).",
      });
      setHasChanges(true);
      fetchFlow(selectedBotId);
    } catch (err) {
      setStatusMsg({
        type: "error",
        text: err instanceof Error ? err.message : "Error saving draft.",
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Publish Flow
  const handlePublish = async () => {
    if (!structure) return;

    // Run client-side pre-flight validation first
    const clientValidation = validateFlowStructure(structure);
    if (!clientValidation.isValid) {
      setStatusMsg({
        type: "error",
        text: "Cannot publish flow: validation issues must be resolved first.",
        errors: clientValidation.errors,
      });
      return;
    }

    setActionLoading(true);
    setStatusMsg(null);
    try {
      // 1. Save draft first to ensure server has latest edits
      const saveDraftRes = await safeFetchJson(
        `/api/bots/${selectedBotId}/flow/draft`,
        {
          method: "PUT",
          body: { structure },
        }
      );
      if (!saveDraftRes.ok) {
        throw new Error(saveDraftRes.error || "Failed to save draft before publishing.");
      }

      // 2. Publish
      const { ok, data, error, validationErrors } = await safeFetchJson<{
        published: { version: number };
      }>(`/api/bots/${selectedBotId}/flow/publish`, {
        method: "POST",
      });

      if (!ok) {
        const errorList = validationErrors || (error ? [error] : ["Failed to publish flow."]);
        setStatusMsg({
          type: "error",
          text: error || "Failed to publish flow.",
          errors: errorList,
        });
        return;
      }

      setStatusMsg({
        type: "success",
        text: `🚀 Flow successfully published as Version ${data?.published?.version}! Live bot is now executing this flow.`,
      });
      fetchFlow(selectedBotId);
    } catch (err) {
      setStatusMsg({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to publish flow.",
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Rollback Flow
  const handleRollback = async () => {
    if (rollbackVersion === null) return;
    setActionLoading(true);
    setStatusMsg(null);
    try {
      const { ok, data, error } = await safeFetchJson<{ restored: { version: number } }>(
        `/api/bots/${selectedBotId}/flow/rollback`,
        {
          method: "POST",
          body: {
            targetVersion: rollbackVersion,
            preserveDraft: preserveDraft,
          },
        }
      );
      if (!ok) {
        throw new Error(error || "Failed to rollback flow.");
      }
      setShowRollbackModal(false);
      setStatusMsg({
        type: "success",
        text: `Flow successfully rolled back to Version ${rollbackVersion} (Published as Version ${data?.restored?.version}).`,
      });
      fetchFlow(selectedBotId);
    } catch (err) {
      setStatusMsg({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to rollback flow.",
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Open Button Modal
  const handleOpenAddButton = () => {
    setEditingButtonIndex(null);
    setBtnLabel("");
    setBtnAction("SEND_TEXT");
    setBtnReplyText("");
    setBtnTargetMenuId(submenuList[0]?.id || "");
    setBtnUrl("");
    setBtnUrlLabel("");
    setBtnAutoDelete(false);
    setBtnDeleteSeconds(30);
    setBtnEnabled(true);
    setModalError(null);
    setShowButtonModal(true);
  };

  const handleOpenEditButton = (index: number) => {
    if (!currentMenu) return;
    const btn = currentMenu.buttons[index];
    setEditingButtonIndex(index);
    setBtnLabel(btn.label);
    setBtnAction(btn.actionType);
    setBtnReplyText(btn.replyText || "");
    setBtnTargetMenuId(btn.targetMenuId || submenuList[0]?.id || "");
    setBtnUrl(btn.url || "");
    setBtnUrlLabel(btn.urlLabel || "");
    setBtnAutoDelete(Boolean(btn.autoDeleteReply));
    setBtnDeleteSeconds(btn.deleteAfterSeconds || 30);
    setBtnEnabled(btn.isEnabled);
    setModalError(null);
    setShowButtonModal(true);
  };

  // Save Button in Form
  const handleSaveButton = (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    const trimmedLabel = btnLabel.trim();
    if (!trimmedLabel) {
      setModalError("Button label is required.");
      return;
    }
    if (trimmedLabel.length > 64) {
      setModalError("Button label cannot exceed 64 characters.");
      return;
    }

    if (btnAction === "SEND_TEXT" && !btnReplyText.trim()) {
      setModalError("Reply text is required for Send Text action.");
      return;
    }

    if (btnAction === "OPEN_SUBMENU" && !btnTargetMenuId) {
      setModalError("Please select a target submenu.");
      return;
    }

    if (btnAction === "URL") {
      if (!btnUrl.trim()) {
        setModalError("URL is required.");
        return;
      }
      try {
        const u = new URL(btnUrl.trim());
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          setModalError("URL must start with http:// or https://");
          return;
        }
      } catch {
        setModalError("Invalid URL format.");
        return;
      }
    }

    if (!structure || !currentMenu) return;

    const newButton: FlowButton = {
      id:
        editingButtonIndex !== null
          ? currentMenu.buttons[editingButtonIndex].id
          : `btn-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      label: trimmedLabel,
      actionType: btnAction,
      replyText: btnReplyText.trim() || null,
      targetMenuId: btnAction === "OPEN_SUBMENU" ? btnTargetMenuId : null,
      url: btnAction === "URL" ? btnUrl.trim() : null,
      urlLabel: btnAction === "URL" ? btnUrlLabel.trim() || null : null,
      autoDeleteReply: btnAction === "SEND_TEXT" ? btnAutoDelete : false,
      deleteAfterSeconds: btnAction === "SEND_TEXT" && btnAutoDelete ? btnDeleteSeconds : 30,
      isEnabled: btnEnabled,
      order: editingButtonIndex !== null ? currentMenu.buttons[editingButtonIndex].order : currentMenu.buttons.length,
    };

    const updatedButtons = [...currentMenu.buttons];
    if (editingButtonIndex !== null) {
      updatedButtons[editingButtonIndex] = newButton;
    } else {
      updatedButtons.push(newButton);
    }

    updateCurrentMenuButtons(updatedButtons);
    setShowButtonModal(false);
  };

  const updateCurrentMenuButtons = (buttons: FlowButton[]) => {
    if (!structure) return;
    const nextStruct: FlowStructure = JSON.parse(JSON.stringify(structure));
    nextStruct.submenus = nextStruct.submenus || {};
    if (activeMenuId === "root") {
      if (nextStruct.rootMenu) nextStruct.rootMenu.buttons = buttons;
    } else if (nextStruct.submenus[activeMenuId]) {
      nextStruct.submenus[activeMenuId].buttons = buttons;
    }
    setStructure(nextStruct);
    setHasChanges(true);
    resetPreview(nextStruct);
  };

  const handleDeleteButton = (index: number) => {
    if (!currentMenu) return;
    const updated = currentMenu.buttons.filter((_, i) => i !== index);
    updateCurrentMenuButtons(updated);
  };

  const handleMoveButton = (index: number, direction: "up" | "down") => {
    if (!currentMenu) return;
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= currentMenu.buttons.length) return;

    const updated = [...currentMenu.buttons];
    const temp = updated[index];
    updated[index] = updated[targetIdx];
    updated[targetIdx] = temp;

    // reindex order
    updated.forEach((b, i) => (b.order = i));
    updateCurrentMenuButtons(updated);
  };

  // Add Submenu
  const handleCreateSubmenu = (e: React.FormEvent) => {
    e.preventDefault();
    if (!structure || !submenuTitle.trim()) return;

    const id = `sub-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 5)}`;
    const newSubmenu: FlowMenu = {
      id,
      title: submenuTitle.trim(),
      promptText: submenuPrompt.trim() || `📂 ${submenuTitle.trim()}`,
      buttons: [],
    };

    const nextStruct: FlowStructure = JSON.parse(JSON.stringify(structure));
    nextStruct.submenus = nextStruct.submenus || {};
    nextStruct.submenus[id] = newSubmenu;
    setStructure(nextStruct);
    setActiveMenuId(id);
    setHasChanges(true);
    setShowSubmenuModal(false);
    setSubmenuTitle("");
    setSubmenuPrompt("");
  };

  // Delete Submenu
  const handleDeleteSubmenu = (id: string) => {
    if (!structure) return;
    const submenus = structure.submenus && typeof structure.submenus === "object" ? structure.submenus : {};
    const title = submenus[id]?.title || id;
    if (!confirm(`Delete submenu "${title}"? Any buttons pointing to this menu will need to be updated.`)) {
      return;
    }

    const nextStruct: FlowStructure = JSON.parse(JSON.stringify(structure));
    nextStruct.submenus = nextStruct.submenus || {};
    delete nextStruct.submenus[id];
    setStructure(nextStruct);
    setActiveMenuId("root");
    setHasChanges(true);
    resetPreview(nextStruct);
  };

  // Prompt update
  const handleUpdatePrompt = (prompt: string) => {
    if (!structure || !currentMenu) return;
    const nextStruct: FlowStructure = JSON.parse(JSON.stringify(structure));
    nextStruct.submenus = nextStruct.submenus || {};
    if (activeMenuId === "root") {
      if (nextStruct.rootMenu) nextStruct.rootMenu.promptText = prompt;
    } else if (nextStruct.submenus[activeMenuId]) {
      nextStruct.submenus[activeMenuId].promptText = prompt;
    }
    setStructure(nextStruct);
    setHasChanges(true);
  };

  // Preview current buttons
  const previewCurrentButtons = () => {
    if (!structure) return [];
    const submenus = structure.submenus && typeof structure.submenus === "object" ? structure.submenus : {};
    const menu =
      previewMenuId === "root"
        ? structure.rootMenu
        : submenus[previewMenuId] || structure.rootMenu;
    const list = (menu?.buttons || []).filter((b) => b.isEnabled);
    return list;
  };

  return (
    <div className="flow-editor-container space-y-6">
      {/* Bot Selector & Status Bar */}
      <div className="card-panel p-4 flex flex-wrap items-center justify-between gap-4 border border-[var(--border)] rounded-lg bg-[var(--card)]">
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            Active Bot:
          </label>
          <select
            className="input-field max-w-xs font-medium text-sm py-1.5 px-3 bg-[var(--bg)] border border-[var(--border)] rounded"
            value={selectedBotId}
            onChange={(e) => setSelectedBotId(e.target.value)}
          >
            {bots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} (@{b.username})
              </option>
            ))}
          </select>
        </div>

        {/* Status Indicators & Action Buttons */}
        <div className="flex items-center flex-wrap gap-2">
          {flowData?.published ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Live: v{flowData.published.version}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-zinc-700/50 text-zinc-400 border border-zinc-700">
              No Published Flow
            </span>
          )}

          {hasChanges && (
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
              Draft has unpublished changes
            </span>
          )}

          <button
            onClick={handleSaveDraft}
            disabled={actionLoading || loading}
            className="btn-secondary text-xs px-3 py-1.5 rounded border border-[var(--border)] hover:bg-zinc-800"
          >
            {actionLoading ? "Saving..." : "Save Draft"}
          </button>

          <button
            onClick={handlePublish}
            disabled={actionLoading || loading}
            className="btn-primary text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-sm"
          >
            {actionLoading ? "Publishing..." : "🚀 Publish Flow"}
          </button>

          {flowData?.versions && flowData.versions.length > 1 && (
            <button
              onClick={() => {
                const past = flowData.versions.filter((v) => v.status === "ARCHIVED");
                if (past.length > 0) {
                  setRollbackVersion(past[0].version);
                  setShowRollbackModal(true);
                }
              }}
              className="text-xs px-3 py-1.5 rounded border border-zinc-700 hover:bg-zinc-800 text-zinc-300"
            >
              ⏪ Rollback
            </button>
          )}
        </div>
      </div>

      {/* Alert / Status Banner */}
      {statusMsg && (
        <div
          className={`p-4 rounded-lg text-sm border ${
            statusMsg.type === "success"
              ? "bg-emerald-950/40 border-emerald-800 text-emerald-200"
              : statusMsg.type === "error"
              ? "bg-red-950/40 border-red-800 text-red-200"
              : "bg-blue-950/40 border-blue-800 text-blue-200"
          }`}
        >
          <div className="font-semibold">{statusMsg.text}</div>
          {statusMsg.errors && statusMsg.errors.length > 0 && (
            <ul className="mt-2 list-disc list-inside space-y-1 text-xs opacity-90">
              {statusMsg.errors.map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {isV2Flow && (
        <div className="p-4 rounded-xl bg-indigo-950/40 border border-indigo-700/50 text-indigo-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-xl">⚡</span>
            <div>
              <p className="text-xs font-semibold text-white">
                This bot is configured with Visual Canvas (Flow V2)
              </p>
              <p className="text-xs text-indigo-300/80">
                Switch to the &ldquo;⚡ Visual Flow Canvas (V2)&rdquo; tab above to view and visually connect nodes on the canvas.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Main Grid: Flow Hierarchy & Editor on Left (7 cols), Phone Preview on Right (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Menu Structure & Buttons */}
        <div className="lg:col-span-7 space-y-6">
          {/* Menu Level Switcher Tabs */}
          <div className="card-panel p-4 border border-[var(--border)] rounded-lg bg-[var(--card)]">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)] mb-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Menu Navigation Hierarchy
              </span>
              <button
                onClick={() => setShowSubmenuModal(true)}
                className="text-xs px-2.5 py-1 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-500/30"
              >
                + Add Submenu
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setActiveMenuId("root")}
                className={`text-xs px-3 py-1.5 rounded font-medium border transition ${
                  activeMenuId === "root"
                    ? "bg-blue-600 text-white border-blue-500 shadow-sm"
                    : "bg-[var(--bg)] text-[var(--text)] border-[var(--border)] hover:bg-zinc-800"
                }`}
              >
                🏠 Main Menu ({structure?.rootMenu.buttons.length || 0})
              </button>

              {submenuList.map((sub) => (
                <div key={sub.id} className="inline-flex rounded shadow-sm">
                  <button
                    onClick={() => setActiveMenuId(sub.id)}
                    className={`text-xs px-3 py-1.5 rounded-l font-medium border-y border-l transition ${
                      activeMenuId === sub.id
                        ? "bg-blue-600 text-white border-blue-500"
                        : "bg-[var(--bg)] text-[var(--text)] border-[var(--border)] hover:bg-zinc-800"
                    }`}
                  >
                    📂 {sub.title} ({sub.buttons.length})
                  </button>
                  <button
                    onClick={() => handleDeleteSubmenu(sub.id)}
                    className="text-xs px-2 py-1.5 rounded-r border border-[var(--border)] text-red-400 hover:bg-red-950/40"
                    title="Delete submenu"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Current Menu Config Card */}
          {currentMenu && (
            <div className="card-panel p-5 border border-[var(--border)] rounded-lg bg-[var(--card)] space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-[var(--text)]">
                    {activeMenuId === "root" ? "Main Menu (Root)" : `Submenu: ${currentMenu.title}`}
                  </h3>
                  <p className="text-xs text-[var(--muted)]">
                    {activeMenuId === "root"
                      ? "Top-level menu displayed when users send /start or tap '🏠 Main Menu'"
                      : "Displayed when a user taps the parent button pointing to this submenu"}
                  </p>
                </div>
                <button
                  onClick={handleOpenAddButton}
                  className="btn-primary text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium"
                >
                  + Add Button
                </button>
              </div>

              {/* Menu Prompt Text */}
              <div>
                <label className="text-xs font-semibold block mb-1 text-[var(--text)]">
                  Message Prompt / Title:
                </label>
                <textarea
                  className="input-field w-full text-xs p-2 rounded bg-[var(--bg)] border border-[var(--border)]"
                  rows={2}
                  value={currentMenu.promptText || ""}
                  onChange={(e) => handleUpdatePrompt(e.target.value)}
                  placeholder="Message sent by bot when this menu is displayed..."
                />
              </div>

              {/* Buttons List */}
              <div className="space-y-2 mt-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Configured Buttons ({currentMenu.buttons.length})
                </span>

                {currentMenu.buttons.length === 0 ? (
                  <div className="p-6 text-center border border-dashed border-[var(--border)] rounded text-xs text-[var(--muted)]">
                    No buttons in this menu yet. Click "+ Add Button" to create one.
                  </div>
                ) : (
                  currentMenu.buttons.map((btn, index) => (
                    <div
                      key={btn.id}
                      className={`flex items-center justify-between p-3 rounded border text-xs transition ${
                        btn.isEnabled
                          ? "bg-[var(--bg)] border-[var(--border)]"
                          : "bg-zinc-900/40 border-zinc-800 text-zinc-500"
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-[var(--text)]">
                            {btn.label}
                          </span>
                          {/* Action Badge */}
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide ${
                              btn.actionType === "SEND_TEXT"
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                : btn.actionType === "OPEN_SUBMENU"
                                ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                                : btn.actionType === "URL"
                                ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                                : btn.actionType === "REQUEST_CONTACT"
                                ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                            }`}
                          >
                            {btn.actionType === "SEND_TEXT"
                              ? "Text Reply"
                              : btn.actionType === "OPEN_SUBMENU"
                              ? "Submenu"
                              : btn.actionType === "URL"
                              ? "Inline URL"
                              : btn.actionType === "REQUEST_CONTACT"
                              ? "Share Phone"
                              : "Channels"}
                          </span>
                          {!btn.isEnabled && (
                            <span className="text-[10px] text-zinc-500 italic">
                              (Disabled)
                            </span>
                          )}
                        </div>

                        {/* Destination or Reply Details */}
                        <div className="text-xs text-[var(--muted)]">
                          {btn.actionType === "SEND_TEXT" && (
                            <span>
                              Replies: &ldquo;{btn.replyText?.substring(0, 50)}
                              {(btn.replyText?.length || 0) > 50 ? "..." : ""}&rdquo;
                              {btn.autoDeleteReply && (
                                <span className="ml-2 text-amber-400">
                                  ⏱ Auto-deletes in {btn.deleteAfterSeconds}s
                                </span>
                              )}
                            </span>
                          )}
                          {btn.actionType === "OPEN_SUBMENU" && (
                            <span className="text-purple-400">
                              ➜ Opens:{" "}
                              {submenus?.[btn.targetMenuId || ""]?.title ||
                                "Missing Submenu"}
                            </span>
                          )}
                          {btn.actionType === "URL" && (
                            <span className="text-cyan-400">
                              ➜ Link: {btn.url}
                            </span>
                          )}
                          {btn.actionType === "REQUEST_CONTACT" && (
                            <span>Prompts user to share verified phone</span>
                          )}
                          {btn.actionType === "JOIN_CHANNELS" && (
                            <span>Displays required channels & verify button</span>
                          )}
                        </div>
                      </div>

                      {/* Button Actions: Move, Edit, Delete */}
                      <div className="flex items-center gap-1.5">
                        <button
                          disabled={index === 0}
                          onClick={() => handleMoveButton(index, "up")}
                          className="px-2 py-1 rounded border border-[var(--border)] hover:bg-zinc-800 disabled:opacity-30"
                          title="Move up"
                        >
                          ▲
                        </button>
                        <button
                          disabled={index === currentMenu.buttons.length - 1}
                          onClick={() => handleMoveButton(index, "down")}
                          className="px-2 py-1 rounded border border-[var(--border)] hover:bg-zinc-800 disabled:opacity-30"
                          title="Move down"
                        >
                          ▼
                        </button>
                        <button
                          onClick={() => handleOpenEditButton(index)}
                          className="px-2.5 py-1 rounded border border-[var(--border)] text-blue-400 hover:bg-blue-950/30"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteButton(index)}
                          className="px-2 py-1 rounded border border-[var(--border)] text-red-400 hover:bg-red-950/30"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Interactive Phone Simulation Preview */}
        <div className="lg:col-span-5 space-y-4">
          <div className="card-panel p-4 border border-[var(--border)] rounded-lg bg-[var(--card)]">
            <div className="flex items-center justify-between pb-2 border-b border-[var(--border)] mb-3">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Simulation Preview
                </span>
                <span className="text-[11px] block text-zinc-400">
                  Runs local draft state machine
                </span>
              </div>
              <button
                onClick={() => resetPreview()}
                className="text-xs px-2.5 py-1 rounded border border-[var(--border)] hover:bg-zinc-800"
              >
                🔄 Restart
              </button>
            </div>

            {/* Telegram Phone Mockup */}
            <div className="phone-mockup border-2 border-zinc-700 rounded-2xl bg-zinc-950 shadow-2xl overflow-hidden flex flex-col h-[520px]">
              {/* Phone Header */}
              <div className="bg-zinc-900 px-4 py-3 border-b border-zinc-800 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center font-bold text-xs text-white">
                  🤖
                </div>
                <div>
                  <div className="text-xs font-semibold text-white">
                    {activeBot.name}
                  </div>
                  <div className="text-[10px] text-zinc-400">
                    @{activeBot.username} • bot
                  </div>
                </div>
              </div>

              {/* Chat Message Stream */}
              <div className="chat-stream flex-1 p-3 overflow-y-auto space-y-2 text-xs">
                {previewMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${
                      msg.sender === "user"
                        ? "justify-end"
                        : msg.sender === "system"
                        ? "justify-center"
                        : "justify-start"
                    }`}
                  >
                    {msg.sender === "system" ? (
                      <div className="p-2 rounded bg-zinc-900/80 text-zinc-400 text-[11px] text-center max-w-[90%] border border-zinc-800">
                        {msg.text}
                      </div>
                    ) : (
                      <div
                        className={`max-w-[85%] p-2.5 rounded-lg whitespace-pre-wrap ${
                          msg.sender === "user"
                            ? "bg-blue-600 text-white rounded-br-none"
                            : "bg-zinc-800 text-zinc-100 rounded-bl-none border border-zinc-700/50"
                        }`}
                      >
                        <div>{msg.text}</div>

                        {/* Inline URL Button Mockup */}
                        {msg.inlineButton && (
                          <div className="mt-2 pt-2 border-t border-zinc-700">
                            <a
                              href={msg.inlineButton.url || "#"}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => {
                                if (!msg.inlineButton?.url || msg.inlineButton.url === "#") {
                                  e.preventDefault();
                                }
                              }}
                              className="block text-center text-xs py-1.5 px-3 rounded bg-zinc-700 hover:bg-zinc-600 text-blue-300 font-medium"
                            >
                              {msg.inlineButton.label} ↗
                            </a>
                          </div>
                        )}

                        {/* Auto delete badge */}
                        {msg.autoDeleteSec && (
                          <div className="mt-1 text-[10px] text-amber-300/80 flex items-center gap-1">
                            ⏱ Auto-deletes in {msg.autoDeleteSec}s
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Simulated Reply Keyboard Panel */}
              <div className="reply-keyboard-panel bg-zinc-900/90 p-2.5 border-t border-zinc-800">
                <div className="text-[10px] text-zinc-400 mb-1.5 px-1 flex justify-between">
                  <span>
                    Current Menu:{" "}
                    <strong>
                      {previewMenuId === "root"
                        ? "Main Menu"
                        : submenus?.[previewMenuId]?.title || previewMenuId}
                    </strong>
                  </span>
                  <span>(Tap button to test)</span>
                </div>

                <div className="grid grid-cols-1 gap-1.5 max-h-[140px] overflow-y-auto">
                  {previewCurrentButtons().map((btn) => (
                    <button
                      key={btn.id}
                      onClick={() => handlePreviewButtonClick(btn.label)}
                      className="py-1.5 px-3 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-medium text-center border border-zinc-700 shadow-sm active:scale-95 transition"
                    >
                      {btn.label}
                    </button>
                  ))}

                  {/* Navigation row if inside submenu */}
                  {previewMenuId !== "root" && (
                    <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-zinc-800">
                      <button
                        onClick={() => handlePreviewButtonClick("◀ Back")}
                        className="py-1 px-2 rounded bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold text-center border border-zinc-700"
                      >
                        ◀ Back
                      </button>
                      <button
                        onClick={() => handlePreviewButtonClick("🏠 Main Menu")}
                        className="py-1 px-2 rounded bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold text-center border border-zinc-700"
                      >
                        🏠 Main Menu
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="text-[11px] text-zinc-500 mt-2 text-center">
              * Simulated Telegram behavior for testing draft flow before publishing.
            </div>
          </div>
        </div>
      </div>

      {/* Button Add / Edit Modal */}
      {showButtonModal && (
        <div className="modal-backdrop fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="modal-content card-panel p-6 border border-[var(--border)] rounded-xl bg-[var(--card)] max-w-lg w-full space-y-4">
            <h3 className="text-base font-semibold text-[var(--text)]">
              {editingButtonIndex !== null ? "Edit Button" : "Add New Button"}
            </h3>

            {modalError && (
              <div className="p-3 rounded bg-red-950/40 border border-red-800 text-red-200 text-xs">
                {modalError}
              </div>
            )}

            <form onSubmit={handleSaveButton} className="space-y-4 text-xs">
              <div>
                <label className="font-semibold block mb-1 text-[var(--text)]">
                  Button Label (Max 64 chars):
                </label>
                <input
                  type="text"
                  className="input-field w-full p-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs"
                  value={btnLabel}
                  onChange={(e) => setBtnLabel(e.target.value)}
                  placeholder="e.g. 📁 Products & Pricing"
                  required
                />
              </div>

              <div>
                <label className="font-semibold block mb-1 text-[var(--text)]">
                  Action Type:
                </label>
                <select
                  className="input-field w-full p-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs"
                  value={btnAction}
                  onChange={(e) => setBtnAction(e.target.value as FlowActionType)}
                >
                  <option value="SEND_TEXT">Send Text Response</option>
                  <option value="OPEN_SUBMENU">Open Submenu</option>
                  <option value="URL">Open Web URL (Inline Button)</option>
                  <option value="REQUEST_CONTACT">Request Phone Number</option>
                  <option value="JOIN_CHANNELS">Join Official Channels</option>
                </select>
              </div>

              {/* Submenu Destination Selector */}
              {btnAction === "OPEN_SUBMENU" && (
                <div>
                  <label className="font-semibold block mb-1 text-[var(--text)]">
                    Target Submenu:
                  </label>
                  {submenuList.length === 0 ? (
                    <div className="p-2 border border-dashed border-amber-600/50 rounded text-amber-300">
                      No submenus created yet. Please close this modal and click &ldquo;+ Add Submenu&rdquo; first.
                    </div>
                  ) : (
                    <select
                      className="input-field w-full p-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs"
                      value={btnTargetMenuId}
                      onChange={(e) => setBtnTargetMenuId(e.target.value)}
                    >
                      {submenuList
                        .filter((s) => s.id !== activeMenuId)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            📂 {s.title}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
              )}

              {/* URL Input */}
              {btnAction === "URL" && (
                <div className="space-y-3">
                  <div>
                    <label className="font-semibold block mb-1 text-[var(--text)]">
                      Web URL (http:// or https://):
                    </label>
                    <input
                      type="url"
                      className="input-field w-full p-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs"
                      value={btnUrl}
                      onChange={(e) => setBtnUrl(e.target.value)}
                      placeholder="https://example.com"
                      required
                    />
                  </div>
                  <div>
                    <label className="font-semibold block mb-1 text-[var(--text)]">
                      Inline Button Label (Optional):
                    </label>
                    <input
                      type="text"
                      className="input-field w-full p-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs"
                      value={btnUrlLabel}
                      onChange={(e) => setBtnUrlLabel(e.target.value)}
                      placeholder="e.g. 🌐 Visit Official Site"
                    />
                  </div>
                  <div>
                    <label className="font-semibold block mb-1 text-[var(--text)]">
                      Message Text Sent with Link:
                    </label>
                    <textarea
                      className="input-field w-full p-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs"
                      rows={2}
                      value={btnReplyText}
                      onChange={(e) => setBtnReplyText(e.target.value)}
                      placeholder="Please tap the button below to open our website:"
                    />
                  </div>
                </div>
              )}

              {/* Send Text Response */}
              {btnAction === "SEND_TEXT" && (
                <div className="space-y-3">
                  <div>
                    <label className="font-semibold block mb-1 text-[var(--text)]">
                      Bot Text Reply:
                    </label>
                    <textarea
                      className="input-field w-full p-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs"
                      rows={3}
                      value={btnReplyText}
                      onChange={(e) => setBtnReplyText(e.target.value)}
                      placeholder="Text returned by bot..."
                      required
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="autoDeleteToggle"
                      checked={btnAutoDelete}
                      onChange={(e) => setBtnAutoDelete(e.target.checked)}
                      className="rounded"
                    />
                    <label htmlFor="autoDeleteToggle" className="font-semibold text-[var(--text)]">
                      Enable Auto-Delete for this reply
                    </label>
                  </div>

                  {btnAutoDelete && (
                    <div>
                      <label className="font-semibold block mb-1 text-[var(--text)]">
                        Delete after seconds (5 - 86,400):
                      </label>
                      <input
                        type="number"
                        min={5}
                        max={86400}
                        className="input-field w-full p-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs"
                        value={btnDeleteSeconds}
                        onChange={(e) => setBtnDeleteSeconds(Number(e.target.value))}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Enable / Disable */}
              <div className="flex items-center gap-2 pt-2 border-t border-[var(--border)]">
                <input
                  type="checkbox"
                  id="btnEnableToggle"
                  checked={btnEnabled}
                  onChange={(e) => setBtnEnabled(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="btnEnableToggle" className="text-[var(--text)]">
                  Button is enabled and visible in menu
                </label>
              </div>

              {/* Modal Actions */}
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowButtonModal(false)}
                  className="px-3 py-1.5 rounded border border-[var(--border)] hover:bg-zinc-800 text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
                >
                  Save Button
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Submenu Create Modal */}
      {showSubmenuModal && (
        <div className="modal-backdrop fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="modal-content card-panel p-6 border border-[var(--border)] rounded-xl bg-[var(--card)] max-w-md w-full space-y-4">
            <h3 className="text-base font-semibold text-[var(--text)]">Create Submenu</h3>
            <form onSubmit={handleCreateSubmenu} className="space-y-4 text-xs">
              <div>
                <label className="font-semibold block mb-1 text-[var(--text)]">
                  Submenu Title:
                </label>
                <input
                  type="text"
                  className="input-field w-full p-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs"
                  value={submenuTitle}
                  onChange={(e) => setSubmenuTitle(e.target.value)}
                  placeholder="e.g. Customer Support"
                  required
                />
              </div>

              <div>
                <label className="font-semibold block mb-1 text-[var(--text)]">
                  Message Prompt when menu opens:
                </label>
                <textarea
                  className="input-field w-full p-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs"
                  rows={2}
                  value={submenuPrompt}
                  onChange={(e) => setSubmenuPrompt(e.target.value)}
                  placeholder="e.g. Please choose a support topic below:"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSubmenuModal(false)}
                  className="px-3 py-1.5 rounded border border-[var(--border)] hover:bg-zinc-800 text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
                >
                  Create Submenu
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rollback Modal */}
      {showRollbackModal && (
        <div className="modal-backdrop fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="modal-content card-panel p-6 border border-[var(--border)] rounded-xl bg-[var(--card)] max-w-md w-full space-y-4">
            <h3 className="text-base font-semibold text-[var(--text)]">
              Rollback to Previous Published Version
            </h3>
            <p className="text-xs text-[var(--muted)]">
              Select an archived version to restore. The chosen flow will immediately become the active published flow for live Telegram users.
            </p>

            <div>
              <label className="font-semibold block mb-1 text-xs text-[var(--text)]">
                Select Version to Restore:
              </label>
              <select
                className="input-field w-full p-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs"
                value={rollbackVersion || ""}
                onChange={(e) => setRollbackVersion(Number(e.target.value))}
              >
                {flowData?.versions
                  .filter((v) => v.status === "ARCHIVED")
                  .map((v) => (
                    <option key={v.id} value={v.version}>
                      Version {v.version} — {v.buttonCount} buttons, {v.submenuCount} submenus{" "}
                      {v.publishedAt ? `(${new Date(v.publishedAt).toLocaleDateString()})` : ""}
                    </option>
                  ))}
              </select>
            </div>

            {hasChanges && (
              <div className="p-3 rounded bg-amber-950/40 border border-amber-700/60 text-amber-200 text-xs space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <span>⚠️</span> Unsaved Draft Changes Detected
                </div>
                <div className="text-[11px] opacity-90 leading-relaxed">
                  You currently have unpublished draft edits. If you uncheck &ldquo;Preserve current draft&rdquo;, your working draft will be overwritten with Version {rollbackVersion}.
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2 border-t border-[var(--border)]">
              <input
                type="checkbox"
                id="preserveDraftToggle"
                checked={preserveDraft}
                onChange={(e) => setPreserveDraft(e.target.checked)}
                className="rounded"
              />
              <label htmlFor="preserveDraftToggle" className="text-xs text-[var(--text)]">
                Preserve current working draft (only change live Telegram bot)
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowRollbackModal(false)}
                className="px-3 py-1.5 rounded border border-[var(--border)] hover:bg-zinc-800 text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRollback}
                disabled={actionLoading}
                className="px-4 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold"
              >
                {actionLoading ? "Restoring..." : "Confirm Rollback"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
