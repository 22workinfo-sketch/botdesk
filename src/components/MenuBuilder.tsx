"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface BotButtonDTO {
  id?: string;
  label: string;
  actionType: "SEND_TEXT" | "REQUEST_CONTACT" | string;
  replyText?: string | null;
  autoDeleteReply?: boolean;
  deleteAfterSeconds?: number;
  isEnabled: boolean;
  order: number;
}

interface MenuBuilderProps {
  botId: string;
  initialButtons: BotButtonDTO[];
}

export function MenuBuilder({ botId, initialButtons }: MenuBuilderProps) {
  const router = useRouter();
  const [buttons, setButtons] = useState<BotButtonDTO[]>(initialButtons);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);

  // Form states for adding/editing
  const [formLabel, setFormLabel] = useState("");
  const [formActionType, setFormActionType] = useState<
    "SEND_TEXT" | "REQUEST_CONTACT" | "JOIN_CHANNELS"
  >("SEND_TEXT");
  const [formReplyText, setFormReplyText] = useState("");
  const [formAutoDelete, setFormAutoDelete] = useState(false);
  const [formDeleteAfterSeconds, setFormDeleteAfterSeconds] = useState(30);
  const [formIsEnabled, setFormIsEnabled] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Open form for adding a new button
  const handleOpenAdd = () => {
    setEditingIndex(null);
    setFormLabel("");
    setFormActionType("SEND_TEXT");
    setFormReplyText("");
    setFormAutoDelete(false);
    setFormDeleteAfterSeconds(30);
    setFormIsEnabled(true);
    setFormError(null);
    setShowAddForm(true);
  };

  // Open form for editing an existing button
  const handleOpenEdit = (index: number) => {
    const btn = buttons[index];
    setEditingIndex(index);
    setFormLabel(btn.label);
    setFormActionType(
      btn.actionType === "REQUEST_CONTACT"
        ? "REQUEST_CONTACT"
        : btn.actionType === "JOIN_CHANNELS"
        ? "JOIN_CHANNELS"
        : "SEND_TEXT"
    );
    setFormReplyText(btn.replyText || "");
    setFormAutoDelete(Boolean(btn.autoDeleteReply));
    setFormDeleteAfterSeconds(btn.deleteAfterSeconds || 30);
    setFormIsEnabled(btn.isEnabled);
    setFormError(null);
    setShowAddForm(true);
  };

  // Close form
  const handleCloseForm = () => {
    setShowAddForm(false);
    setEditingIndex(null);
    setFormError(null);
  };

  // Validate and apply item to local state
  const handleApplyForm = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedLabel = formLabel.trim();
    if (!trimmedLabel) {
      setFormError("Button label is required.");
      return;
    }

    if (trimmedLabel.length > 64) {
      setFormError("Button label cannot exceed 64 characters.");
      return;
    }

    // Check duplicate label (excluding the current item if editing)
    const duplicate = buttons.some(
      (b, idx) =>
        idx !== editingIndex && b.label.trim().toLowerCase() === trimmedLabel.toLowerCase()
    );
    if (duplicate) {
      setFormError(`A button with the label "${trimmedLabel}" already exists.`);
      return;
    }

    if (formActionType === "SEND_TEXT") {
      const trimmedReply = formReplyText.trim();
      if (!trimmedReply) {
        setFormError("Reply text is required when action is 'Send Text Reply'.");
        return;
      }
      if (trimmedReply.length > 2000) {
        setFormError("Reply text cannot exceed 2000 characters.");
        return;
      }
      if (formAutoDelete) {
        const delay = Math.floor(formDeleteAfterSeconds);
        if (isNaN(delay) || delay < 5 || delay > 86400) {
          setFormError(
            "Auto-delete delay must be an integer between 5 and 86,400 seconds (24 hours)."
          );
          return;
        }
      }
    } else if (formActionType === "JOIN_CHANNELS") {
      if (formReplyText.trim().length > 2000) {
        setFormError("Prompt text cannot exceed 2000 characters.");
        return;
      }
    }

    const itemToSave: BotButtonDTO = {
      ...(editingIndex !== null ? { id: buttons[editingIndex].id } : {}),
      label: trimmedLabel,
      actionType: formActionType,
      replyText:
        formActionType === "SEND_TEXT"
          ? formReplyText.trim()
          : formActionType === "JOIN_CHANNELS"
          ? formReplyText.trim() ||
            "Please join our official channels below, then tap 'Check Joined' to verify your membership."
          : null,
      autoDeleteReply: formActionType === "SEND_TEXT" ? formAutoDelete : false,
      deleteAfterSeconds:
        formActionType === "SEND_TEXT" && formAutoDelete
          ? Math.floor(formDeleteAfterSeconds || 30)
          : 30,
      isEnabled: formIsEnabled,
      order:
        editingIndex !== null ? buttons[editingIndex].order : buttons.length,
    };

    if (editingIndex !== null) {
      const updated = [...buttons];
      updated[editingIndex] = itemToSave;
      setButtons(updated);
    } else {
      if (buttons.length >= 12) {
        setFormError("Maximum limit of 12 buttons reached.");
        return;
      }
      setButtons([...buttons, itemToSave]);
    }

    handleCloseForm();
  };

  // Reorder buttons: Move item up
  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const updated = [...buttons];
    const temp = updated[index - 1];
    updated[index - 1] = updated[index];
    updated[index] = temp;
    // Reassign order indices
    const reordered = updated.map((b, i) => ({ ...b, order: i }));
    setButtons(reordered);
  };

  // Reorder buttons: Move item down
  const handleMoveDown = (index: number) => {
    if (index === buttons.length - 1) return;
    const updated = [...buttons];
    const temp = updated[index + 1];
    updated[index + 1] = updated[index];
    updated[index] = temp;
    const reordered = updated.map((b, i) => ({ ...b, order: i }));
    setButtons(reordered);
  };

  // Toggle enabled/disabled
  const handleToggleEnabled = (index: number) => {
    const updated = [...buttons];
    updated[index] = { ...updated[index], isEnabled: !updated[index].isEnabled };
    setButtons(updated);
  };

  // Confirm delete
  const handleDelete = (index: number) => {
    const updated = buttons.filter((_, i) => i !== index).map((b, i) => ({ ...b, order: i }));
    setButtons(updated);
    setDeletingIndex(null);
  };

  // Save all buttons to PostgreSQL
  const handleSaveAll = async () => {
    setSaving(true);
    setStatusMessage(null);

    try {
      const res = await fetch(`/api/bots/${botId}/menu`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buttons }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to save bot menu");
      }

      setButtons(data.buttons || buttons);
      setStatusMessage({
        type: "success",
        text: "Bot menu saved successfully! Telegram users will receive the updated keyboard on their next /start or menu refresh.",
      });

      router.refresh();
    } catch (err) {
      setStatusMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Error saving bot menu",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h3 className="text-base font-semibold text-white">
            Bot Menu Builder (Reply Keyboard)
          </h3>
          <p className="mt-1 text-sm text-slate-400">
            Configure the reply buttons displayed at the bottom of the user's Telegram chat input.
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenAdd}
          disabled={buttons.length >= 12}
          className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-blue-600/20 hover:bg-blue-500 disabled:opacity-50 transition"
        >
          + Add Button
        </button>
      </div>

      {statusMessage && (
        <div
          className={`mb-6 rounded-lg p-3 text-sm border ${
            statusMessage.type === "success"
              ? "bg-emerald-950/60 border-emerald-800/60 text-emerald-300"
              : "bg-red-950/60 border-red-800/60 text-red-300"
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      {/* Telegram Reply Keyboard Live Preview */}
      <div className="mb-6 rounded-xl border border-slate-800 bg-slate-950 p-5 text-white shadow-inner">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Telegram User Keyboard Preview
          </span>
          <span className="text-xs text-slate-400">
            {buttons.filter((b) => b.isEnabled).length} active buttons (1 per row)
          </span>
        </div>

        <div className="max-w-md mx-auto space-y-2 py-2">
          {buttons.filter((b) => b.isEnabled).length === 0 ? (
            <div className="text-center py-4 text-xs text-slate-500 italic">
              No buttons currently enabled. Telegram will show the standard text keyboard only.
            </div>
          ) : (
            buttons
              .filter((b) => b.isEnabled)
              .map((btn, idx) => (
                <div
                  key={idx}
                  className="rounded-lg bg-slate-900 border border-slate-800 py-2.5 px-4 text-center font-medium text-sm text-slate-200 shadow-sm flex items-center justify-between"
                >
                  <span className="flex-1 text-center font-medium">{btn.label}</span>
                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
                    {btn.actionType === "REQUEST_CONTACT"
                      ? "Phone"
                      : btn.actionType === "JOIN_CHANNELS"
                      ? "Channels"
                      : "Text"}
                  </span>
                </div>
              ))
          )}
        </div>
      </div>

      {/* Button Configuration List */}
      <div className="space-y-3 mb-6">
        {buttons.length === 0 ? (
          <div className="text-center py-8 rounded-lg border border-dashed border-slate-800 bg-slate-950/50">
            <p className="text-sm text-slate-400">No buttons configured yet.</p>
            <button
              onClick={handleOpenAdd}
              className="mt-2 text-xs font-semibold text-blue-400 hover:text-blue-300 hover:underline"
            >
              Add your first button
            </button>
          </div>
        ) : (
          buttons.map((btn, idx) => (
            <div
              key={idx}
              className={`rounded-lg border p-4 transition ${
                btn.isEnabled
                  ? "border-slate-800 bg-slate-950/80"
                  : "border-slate-800/60 bg-slate-950/30 opacity-60"
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center space-x-3">
                  {/* Reordering Controls */}
                  <div className="flex flex-col space-y-1">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => handleMoveUp(idx)}
                      className="rounded p-1 text-slate-500 hover:text-white hover:bg-slate-800 disabled:opacity-20 text-xs transition"
                      title="Move Up"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      disabled={idx === buttons.length - 1}
                      onClick={() => handleMoveDown(idx)}
                      className="rounded p-1 text-slate-500 hover:text-white hover:bg-slate-800 disabled:opacity-20 text-xs transition"
                      title="Move Down"
                    >
                      ▼
                    </button>
                  </div>

                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-white text-sm">
                        {btn.label}
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                          btn.actionType === "REQUEST_CONTACT"
                            ? "bg-purple-950/70 text-purple-400 border border-purple-800/50"
                            : btn.actionType === "JOIN_CHANNELS"
                            ? "bg-emerald-950/70 text-emerald-400 border border-emerald-800/50"
                            : "bg-blue-950/70 text-blue-400 border border-blue-800/50"
                        }`}
                      >
                        {btn.actionType === "REQUEST_CONTACT"
                          ? "REQUEST_CONTACT"
                          : btn.actionType === "JOIN_CHANNELS"
                          ? "JOIN_CHANNELS"
                          : "SEND_TEXT"}
                      </span>
                      {btn.actionType === "SEND_TEXT" && btn.autoDeleteReply && (
                        <span className="rounded px-2 py-0.5 text-[11px] font-semibold bg-amber-950/70 text-amber-400 border border-amber-800/50">
                          ⏱ Auto-delete: {btn.deleteAfterSeconds ?? 30}s
                        </span>
                      )}
                      <span
                        className={`rounded-full px-2 py-0.2 text-[10px] font-semibold border ${
                          btn.isEnabled
                            ? "bg-emerald-950/70 border-emerald-800/50 text-emerald-400"
                            : "bg-slate-800 border-slate-700 text-slate-400"
                        }`}
                      >
                        {btn.isEnabled ? "ENABLED" : "DISABLED"}
                      </span>
                    </div>

                    {btn.actionType === "SEND_TEXT" && btn.replyText && (
                      <p className="mt-1 text-xs text-slate-400 line-clamp-1">
                        Reply: <span className="italic text-slate-200">"{btn.replyText}"</span>
                        {btn.autoDeleteReply && (
                          <span className="ml-1.5 text-amber-400 font-medium">
                            (auto-deletes after {btn.deleteAfterSeconds ?? 30}s)
                          </span>
                        )}
                      </p>
                    )}
                    {btn.actionType === "REQUEST_CONTACT" && (
                      <p className="mt-1 text-xs text-purple-400 font-mono">
                        Prompts user to share personal phone number (with ownership check)
                      </p>
                    )}
                    {btn.actionType === "JOIN_CHANNELS" && (
                      <p className="mt-1 text-xs text-emerald-400 font-mono">
                        Sends inline Join Channel buttons and "Check Joined" verification
                      </p>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => handleToggleEnabled(idx)}
                    className={`rounded px-2.5 py-1 text-xs font-medium border transition ${
                      btn.isEnabled
                        ? "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                        : "border-emerald-800/60 bg-emerald-950/50 text-emerald-400 hover:bg-emerald-900/50"
                    }`}
                  >
                    {btn.isEnabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(idx)}
                    className="rounded px-2.5 py-1 text-xs font-medium border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 transition"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingIndex(idx)}
                    className="rounded px-2.5 py-1 text-xs font-medium border border-red-900/50 bg-red-950/30 text-red-400 hover:bg-red-900/40 transition"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Inline Delete Confirmation */}
              {deletingIndex === idx && (
                <div className="mt-3 rounded-lg bg-red-950/40 border border-red-900/60 p-3 flex items-center justify-between text-xs text-red-200">
                  <span>
                    Confirm deletion of button <strong>"{btn.label}"</strong>? This will remove it from the keyboard.
                  </span>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => handleDelete(idx)}
                      className="rounded bg-red-600 px-3 py-1 font-semibold text-white hover:bg-red-500 shadow-sm"
                    >
                      Yes, Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingIndex(null)}
                      className="rounded border border-slate-700 bg-slate-800 px-3 py-1 text-slate-300 hover:bg-slate-700"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Save Button */}
      <div className="flex items-center justify-between border-t border-slate-800 pt-4">
        <span className="text-xs text-slate-400">
          Buttons are ordered top-to-bottom. Changes are saved to PostgreSQL with an audit log record.
        </span>
        <button
          type="button"
          onClick={handleSaveAll}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-blue-600/20 hover:bg-blue-500 disabled:opacity-50 transition"
        >
          {saving ? "Saving Menu..." : "Save Menu Changes"}
        </button>
      </div>

      {/* Add / Edit Button Modal */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 p-6 shadow-2xl border border-slate-700">
            <h4 className="text-lg font-bold text-white mb-1">
              {editingIndex !== null ? "Edit Menu Button" : "Add Menu Button"}
            </h4>
            <p className="text-xs text-slate-400 mb-4">
              Configure the button label and what action the bot performs when pressed.
            </p>

            {formError && (
              <div className="mb-4 rounded-lg bg-red-950/60 border border-red-800/60 p-2.5 text-xs text-red-300">
                {formError}
              </div>
            )}

            <form onSubmit={handleApplyForm} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                  Button Label (Max 64 chars)
                </label>
                <input
                  type="text"
                  required
                  value={formLabel}
                  onChange={(e) => setFormLabel(e.target.value)}
                  maxLength={64}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="e.g. ℹ️ Help & FAQ"
                />
                <div className="mt-1 text-right text-[11px] text-slate-400">
                  {formLabel.length} / 64
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                  Action Type
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label
                    className={`flex flex-col p-3 rounded-lg border cursor-pointer transition ${
                      formActionType === "SEND_TEXT"
                        ? "border-blue-500 bg-blue-950/40"
                        : "border-slate-800 bg-slate-950/60 hover:bg-slate-800/50"
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        name="actionType"
                        value="SEND_TEXT"
                        checked={formActionType === "SEND_TEXT"}
                        onChange={() => setFormActionType("SEND_TEXT")}
                        className="text-blue-500 focus:ring-blue-400"
                      />
                      <span className="text-sm font-semibold text-slate-100">
                        Send Text
                      </span>
                    </div>
                    <span className="mt-1 text-xs text-slate-400 pl-6">
                      Bot replies with configured text message
                    </span>
                  </label>

                  <label
                    className={`flex flex-col p-3 rounded-lg border cursor-pointer transition ${
                      formActionType === "REQUEST_CONTACT"
                        ? "border-purple-500 bg-purple-950/40"
                        : "border-slate-800 bg-slate-950/60 hover:bg-slate-800/50"
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        name="actionType"
                        value="REQUEST_CONTACT"
                        checked={formActionType === "REQUEST_CONTACT"}
                        onChange={() => setFormActionType("REQUEST_CONTACT")}
                        className="text-purple-500 focus:ring-purple-400"
                      />
                      <span className="text-sm font-semibold text-slate-100">
                        Phone Number
                      </span>
                    </div>
                    <span className="mt-1 text-xs text-slate-400 pl-6">
                      Telegram phone share button (with ownership validation)
                    </span>
                  </label>

                  <label
                    className={`flex flex-col p-3 rounded-lg border cursor-pointer transition ${
                      formActionType === "JOIN_CHANNELS"
                        ? "border-emerald-500 bg-emerald-950/40"
                        : "border-slate-800 bg-slate-950/60 hover:bg-slate-800/50"
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        name="actionType"
                        value="JOIN_CHANNELS"
                        checked={formActionType === "JOIN_CHANNELS"}
                        onChange={() => setFormActionType("JOIN_CHANNELS")}
                        className="text-emerald-500 focus:ring-emerald-400"
                      />
                      <span className="text-sm font-semibold text-slate-100">
                        Join Channels
                      </span>
                    </div>
                    <span className="mt-1 text-xs text-slate-400 pl-6">
                      Inline channel buttons & membership check
                    </span>
                  </label>
                </div>
              </div>

              {formActionType === "JOIN_CHANNELS" && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                    Instructions / Prompt Text (Optional)
                  </label>
                  <textarea
                    rows={3}
                    value={formReplyText}
                    onChange={(e) => setFormReplyText(e.target.value)}
                    maxLength={2000}
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 p-2.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-sans"
                    placeholder="Please join our official channels below, then tap 'Check Joined' to verify your membership."
                  />
                  <div className="mt-1 text-right text-[11px] text-slate-400">
                    {formReplyText.length} / 2000 (Defaults to standard message
                    if empty)
                  </div>
                </div>
              )}

              {formActionType === "SEND_TEXT" && (
                <>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                      Bot Response Text (Max 2000 chars)
                    </label>
                    <textarea
                      rows={4}
                      required
                      value={formReplyText}
                      onChange={(e) => setFormReplyText(e.target.value)}
                      maxLength={2000}
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 p-2.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-sans"
                      placeholder="Enter the message the bot will send when this button is pressed..."
                    />
                    <div className="mt-1 text-right text-[11px] text-slate-400">
                      {formReplyText.length} / 2000
                    </div>
                  </div>

                  {/* Auto-Delete Configuration */}
                  <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <label
                          htmlFor="autoDeleteToggle"
                          className="text-xs font-semibold uppercase tracking-wider text-slate-200 cursor-pointer"
                        >
                          Auto-Delete Bot Reply
                        </label>
                        <p className="text-[11px] text-slate-400">
                          Automatically delete this bot reply message after the specified delay.
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        id="autoDeleteToggle"
                        checked={formAutoDelete}
                        onChange={(e) => setFormAutoDelete(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-500 focus:ring-blue-400"
                      />
                    </div>

                    {formAutoDelete && (
                      <div className="pt-2 border-t border-slate-800">
                        <label className="block text-xs font-medium text-slate-300 mb-1">
                          Delete after (seconds)
                        </label>
                        <div className="flex items-center space-x-2">
                          <input
                            type="number"
                            min={5}
                            max={86400}
                            required
                            value={formDeleteAfterSeconds}
                            onChange={(e) =>
                              setFormDeleteAfterSeconds(parseInt(e.target.value) || 0)
                            }
                            className="w-32 rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          <span className="text-xs text-slate-400">
                            seconds (5 to 86,400s / max 24h)
                          </span>
                        </div>
                        <p className="mt-1.5 text-[11px] text-slate-400 italic">
                          ℹ️ Timer starts strictly after Telegram confirms the bot message was sent. User messages and other chats are never deleted.
                        </p>
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="isEnabledCheckbox"
                  checked={formIsEnabled}
                  onChange={(e) => setFormIsEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-500 focus:ring-blue-400"
                />
                <label
                  htmlFor="isEnabledCheckbox"
                  className="text-sm font-medium text-slate-300 cursor-pointer"
                >
                  Enable button immediately
                </label>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={handleCloseForm}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-700 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-blue-600/20 hover:bg-blue-500 transition"
                >
                  {editingIndex !== null ? "Update Button" : "Add to Menu"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
