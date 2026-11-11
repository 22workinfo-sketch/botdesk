"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChannelInput } from "@/lib/channel-service";

export interface BotOption {
  id: string;
  name: string;
  username: string;
}

interface BotdeskChannelsPageProps {
  bots: BotOption[];
  initialBotId: string;
  initialChannelsByBot: Record<string, ChannelInput[]>;
}

export function BotdeskChannelsPage({
  bots,
  initialBotId,
  initialChannelsByBot,
}: BotdeskChannelsPageProps) {
  const router = useRouter();
  const [selectedBotId, setSelectedBotId] = useState<string>(initialBotId);
  const [channelsByBot, setChannelsByBot] = useState<
    Record<string, ChannelInput[]>
  >(initialChannelsByBot);

  const channels = channelsByBot[selectedBotId] || [];
  const activeBot = bots.find((b) => b.id === selectedBotId) || bots[0];

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [formName, setFormName] = useState("");
  const [formChatId, setFormChatId] = useState("");
  const [formInviteLink, setFormInviteLink] = useState("");
  const [formButtonLabel, setFormButtonLabel] = useState("");
  const [formIsRequired, setFormIsRequired] = useState(true);
  const [formIsEnabled, setFormIsEnabled] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  // Saving state
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const handleOpenAdd = () => {
    setEditingIndex(null);
    setFormName("");
    setFormChatId("");
    setFormInviteLink("");
    setFormButtonLabel("");
    setFormIsRequired(true);
    setFormIsEnabled(true);
    setFormError(null);
    setShowModal(true);
  };

  const handleOpenEdit = (index: number) => {
    const ch = channels[index];
    setEditingIndex(index);
    setFormName(ch.name);
    setFormChatId(ch.telegramChatId);
    setFormInviteLink(ch.inviteLink);
    setFormButtonLabel(ch.buttonLabel);
    setFormIsRequired(ch.isRequired);
    setFormIsEnabled(ch.isEnabled);
    setFormError(null);
    setShowModal(true);
  };

  const handleSaveModal = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = formName.trim();
    if (!trimmedName) {
      setFormError("Channel display name is required.");
      return;
    }

    const trimmedChatId = formChatId.trim();
    if (!trimmedChatId) {
      setFormError("Telegram chat ID or username is required.");
      return;
    }
    if (
      !trimmedChatId.startsWith("@") &&
      !/^-?\d{5,20}$/.test(trimmedChatId)
    ) {
      setFormError(
        "Chat target must be a channel username (e.g. '@mychannel') or a numeric ID (e.g. '-1001234567890')."
      );
      return;
    }

    const trimmedLink = formInviteLink.trim();
    if (!trimmedLink) {
      setFormError("Channel invite link is required.");
      return;
    }
    const lowerLink = trimmedLink.toLowerCase();
    if (
      !lowerLink.startsWith("https://t.me/") &&
      !lowerLink.startsWith("https://telegram.me/")
    ) {
      setFormError(
        "Invite link must be a valid Telegram URL (e.g. 'https://t.me/channel_name' or 'https://t.me/+hash')."
      );
      return;
    }

    const trimmedButtonLabel = formButtonLabel.trim();
    if (!trimmedButtonLabel) {
      setFormError("Inline button label is required.");
      return;
    }

    const newChannel: ChannelInput = {
      ...(editingIndex !== null ? { id: channels[editingIndex].id } : {}),
      name: trimmedName,
      telegramChatId: trimmedChatId,
      inviteLink: trimmedLink,
      buttonLabel: trimmedButtonLabel,
      isRequired: formIsRequired,
      isEnabled: formIsEnabled,
      order: editingIndex !== null ? channels[editingIndex].order : channels.length,
    };

    let updatedList: ChannelInput[];
    if (editingIndex !== null) {
      updatedList = [...channels];
      updatedList[editingIndex] = newChannel;
    } else {
      if (channels.length >= 20) {
        setFormError("Maximum limit of 20 channels reached.");
        return;
      }
      updatedList = [...channels, newChannel];
    }

    setChannelsByBot({
      ...channelsByBot,
      [selectedBotId]: updatedList,
    });
    setShowModal(false);
  };

  const handleMove = (index: number, direction: "up" | "down") => {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= channels.length) return;

    const copy = [...channels];
    const temp = copy[index];
    copy[index] = copy[target];
    copy[target] = temp;
    const reordered = copy.map((c, i) => ({ ...c, order: i }));

    setChannelsByBot({
      ...channelsByBot,
      [selectedBotId]: reordered,
    });
  };

  const handleToggle = (index: number) => {
    const copy = [...channels];
    copy[index] = { ...copy[index], isEnabled: !copy[index].isEnabled };
    setChannelsByBot({
      ...channelsByBot,
      [selectedBotId]: copy,
    });
  };

  const handleDelete = (index: number) => {
    const ch = channels[index];
    if (!confirm(`Delete channel "${ch.name}"?`)) return;

    const filtered = channels
      .filter((_, i) => i !== index)
      .map((c, i) => ({ ...c, order: i }));
    setChannelsByBot({
      ...channelsByBot,
      [selectedBotId]: filtered,
    });
  };

  const handleSaveAllToDatabase = async () => {
    setSaving(true);
    setStatusMessage(null);

    try {
      const res = await fetch(`/api/bots/${selectedBotId}/channels`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save channels");
      }

      setChannelsByBot({
        ...channelsByBot,
        [selectedBotId]: data.channels || channels,
      });

      setStatusMessage({
        type: "success",
        text: "Channels saved successfully in PostgreSQL! Users will see these channels when requesting access in Telegram.",
      });
      router.refresh();
    } catch (err) {
      setStatusMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Error saving channels",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Screen Heading */}
      <div>
        <span className="botdesk-badge blue mb-2 inline-block">
          COMMUNITY & MEMBERSHIP
        </span>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text)]">
          Telegram Channels & Communities
        </h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          Configure official channels for membership verification, gating, and voluntary user subscription.
        </p>
      </div>

      {/* Administrator Setup Advice Banner */}
      <div className="p-4 rounded-lg bg-[var(--bluebg)] border border-[var(--border)] text-xs text-[var(--accent)] leading-relaxed space-y-1.5">
        <strong className="block text-sm">
          ℹ️ Administrator Setup Guide for Channel Verification:
        </strong>
        <p>
          For reliable membership verification via the Telegram Bot API, add your bot (
          <strong>@{activeBot?.username || "your_bot"}</strong>) as an{" "}
          <strong>Administrator</strong> in each channel or supergroup.
        </p>
        <p className="text-[11px] text-[var(--muted)]">
          • <strong>Public Channels:</strong> Enter the username handle (e.g. <code className="font-mono">@mychannel</code>).
          <br />
          • <strong>Private Channels:</strong> Enter the numeric Chat ID (e.g. <code className="font-mono">-1001234567890</code>) and a valid invite link.
          <br />
          • <strong>Important:</strong> The bot never silently forces users to join. Users open links voluntarily and tap "Check Joined" in the bot.
        </p>
      </div>

      {statusMessage && (
        <div
          className={`p-3.5 rounded-lg text-sm border ${
            statusMessage.type === "success"
              ? "bg-[var(--greenbg)] border-[var(--green)] text-[var(--green)]"
              : "bg-[var(--redbg)] border-[var(--red)] text-[var(--red)]"
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      {/* Main Channels Card */}
      <div className="botdesk-card">
        <div className="card-header">
          <div>
            <h2 className="text-base font-bold text-[var(--text)]">
              Configured Channels
            </h2>
            <p className="text-xs text-[var(--muted)]">
              Scoped strictly to {activeBot?.name} (@{activeBot?.username})
            </p>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={selectedBotId}
              onChange={(e) => setSelectedBotId(e.target.value)}
              className="botdesk-select text-xs min-h-[34px] py-1"
            >
              {bots.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} (@{b.username})
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={handleOpenAdd}
              disabled={channels.length >= 20}
              className="botdesk-btn primary text-xs"
            >
              ＋ Add Channel
            </button>
          </div>
        </div>

        <div className="card-body space-y-4">
          {channels.length === 0 ? (
            <div className="py-10 text-center text-xs text-[var(--muted)] border border-dashed border-[var(--border)] rounded-lg">
              No channels configured yet for this bot. Click "＋ Add Channel" to configure your first Telegram channel.
            </div>
          ) : (
            <div className="space-y-3">
              {channels.map((ch, idx) => (
                <div
                  key={idx}
                  className={`p-4 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition ${
                    ch.isEnabled
                      ? "bg-[var(--bg)] border-[var(--border)]"
                      : "bg-[var(--surface)] border-[var(--border)] opacity-60"
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <strong className="text-sm font-semibold text-[var(--text)]">
                        {ch.name}
                      </strong>

                      <span
                        className={`botdesk-badge text-[11px] font-mono ${
                          ch.isRequired ? "paused" : "blue"
                        }`}
                      >
                        {ch.isRequired ? "REQUIRED GATE" : "OPTIONAL"}
                      </span>

                      <span
                        className={`botdesk-badge text-[10px] ${
                          ch.isEnabled ? "enabled" : "paused"
                        }`}
                      >
                        {ch.isEnabled ? "ENABLED" : "DISABLED"}
                      </span>
                    </div>

                    <div className="text-xs text-[var(--muted)] font-mono flex items-center gap-4 flex-wrap">
                      <span>Target: {ch.telegramChatId}</span>
                      <span>Button: "{ch.buttonLabel}"</span>
                      <span className="text-[var(--accent)] truncate max-w-xs">
                        Link: {ch.inviteLink.replace(/^https:\/\/t\.me\/\+?.{4}/, "https://t.me/...")}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 self-end sm:self-center flex-shrink-0">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => handleMove(idx, "up")}
                      className="botdesk-btn text-xs py-1 px-2 min-h-[30px]"
                      title="Move Up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={idx === channels.length - 1}
                      onClick={() => handleMove(idx, "down")}
                      className="botdesk-btn text-xs py-1 px-2 min-h-[30px]"
                      title="Move Down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggle(idx)}
                      className="botdesk-btn text-xs py-1 px-2.5 min-h-[30px]"
                    >
                      {ch.isEnabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(idx)}
                      className="botdesk-btn text-xs py-1 px-2.5 min-h-[30px]"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(idx)}
                      className="botdesk-btn danger text-xs py-1 px-2 min-h-[30px]"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Bottom Action */}
          <div className="pt-4 border-t border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span className="text-xs text-[var(--muted)]">
              Channels are displayed in order as inline URL buttons with a "Check Joined" verification button.
            </span>
            <button
              type="button"
              onClick={handleSaveAllToDatabase}
              disabled={saving}
              className="botdesk-btn primary text-xs"
            >
              {saving ? "Saving Channels..." : "Save Channels to Database"}
            </button>
          </div>
        </div>
      </div>

      {/* Add / Edit Channel Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl bg-[var(--panel)] border border-[var(--border)] p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-[var(--text)] mb-1">
              {editingIndex !== null ? "Edit Channel" : "Add Telegram Channel"}
            </h2>
            <p className="text-xs text-[var(--muted)] mb-4">
              Configure channel identifiers for voluntary joining and Telegram API verification.
            </p>

            {formError && (
              <div className="mb-4 p-2.5 rounded-lg bg-[var(--redbg)] border border-[var(--red)] text-xs text-[var(--red)]">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveModal} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">
                  Display Name (e.g. Official Announcements)
                </label>
                <input
                  type="text"
                  required
                  maxLength={64}
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Official Announcements"
                  className="botdesk-input text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">
                  Telegram Username or Chat ID (for Verification)
                </label>
                <input
                  type="text"
                  required
                  value={formChatId}
                  onChange={(e) => setFormChatId(e.target.value)}
                  placeholder="@mychannel or -1001234567890"
                  className="botdesk-input text-xs font-mono"
                />
                <span className="text-[11px] text-[var(--muted)] mt-0.5 block">
                  Used by the bot to verify membership via <code className="font-mono">getChatMember</code>.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">
                  Invite Link (Opened by User in Telegram)
                </label>
                <input
                  type="url"
                  required
                  value={formInviteLink}
                  onChange={(e) => setFormInviteLink(e.target.value)}
                  placeholder="https://t.me/mychannel or https://t.me/+hash"
                  className="botdesk-input text-xs font-mono"
                />
                <span className="text-[11px] text-[var(--muted)] mt-0.5 block">
                  Must be a valid Telegram URL. Private invite links are treated as sensitive operational data.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">
                  Inline Button Label
                </label>
                <input
                  type="text"
                  required
                  maxLength={64}
                  value={formButtonLabel}
                  onChange={(e) => setFormButtonLabel(e.target.value)}
                  placeholder="📢 Join Announcement Channel"
                  className="botdesk-input text-xs"
                />
              </div>

              <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] space-y-3">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-[var(--text)]">
                  <input
                    type="checkbox"
                    checked={formIsRequired}
                    onChange={(e) => setFormIsRequired(e.target.checked)}
                    className="accent-[var(--accent)]"
                  />
                  <span>Required for Membership Verification</span>
                </label>
                <p className="text-[11px] text-[var(--muted)] pl-6">
                  When checked, the user must join this channel to pass the "Check Joined" gate. Optional channels do not block verification.
                </p>
              </div>

              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-[var(--text)]">
                <input
                  type="checkbox"
                  checked={formIsEnabled}
                  onChange={(e) => setFormIsEnabled(e.target.checked)}
                  className="accent-[var(--accent)]"
                />
                <span>Enabled immediately</span>
              </label>

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="botdesk-btn text-xs"
                >
                  Cancel
                </button>
                <button type="submit" className="botdesk-btn primary text-xs">
                  Save Channel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
