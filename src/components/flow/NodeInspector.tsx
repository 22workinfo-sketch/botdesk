"use client";

import React, { useState, useEffect } from "react";
import { FlowGraphNode, FlowNodeData, FlowNodeButton, FlowNodeType } from "@/lib/flow/types";
import { safeFetchJson } from "@/lib/api-client";

interface NodeInspectorProps {
  node: FlowGraphNode | null;
  botId: string;
  onUpdateNode: (updatedNode: FlowGraphNode) => void;
  onDuplicateNode: (node: FlowGraphNode) => void;
  onDeleteNode: (nodeId: string) => void;
  onClose: () => void;
}

export function NodeInspector({
  node,
  botId,
  onUpdateNode,
  onDuplicateNode,
  onDeleteNode,
  onClose,
}: NodeInspectorProps) {
  if (!node) return null;

  const data = node.data;
  const nodeType = data.nodeType;

  // Local channels for condition selector
  const [channels, setChannels] = useState<Array<{ id: string; name: string; telegramChatId: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (nodeType === "CONDITION") {
      fetch(`/api/bots/${botId}/channels`)
        .then((r) => r.json())
        .then((d) => {
          if (d.success && Array.isArray(d.channels)) {
            setChannels(d.channels);
          }
        })
        .catch(() => {});
    }
  }, [botId, nodeType]);

  const updateData = (partial: Partial<FlowNodeData>) => {
    onUpdateNode({
      ...node,
      data: {
        ...node.data,
        ...partial,
      },
    });
  };

  // Button management helpers
  const handleAddButton = () => {
    const currentButtons = data.buttons || [];
    const newBtn: FlowNodeButton = {
      id: `btn-${Date.now()}`,
      label: `Button ${currentButtons.length + 1}`,
      actionType: "TRANSITION",
      isEnabled: true,
      order: currentButtons.length,
    };
    updateData({ buttons: [...currentButtons, newBtn] });
  };

  const handleUpdateButton = (index: number, partial: Partial<FlowNodeButton>) => {
    const currentButtons = [...(data.buttons || [])];
    currentButtons[index] = { ...currentButtons[index], ...partial };
    updateData({ buttons: currentButtons });
  };

  const handleDeleteButton = (index: number) => {
    const currentButtons = (data.buttons || []).filter((_, i) => i !== index);
    updateData({ buttons: currentButtons });
  };

  // Media upload helper
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("botId", botId);

    try {
      const { ok, data: json, error } = await safeFetchJson<{
        filePath?: string;
        url?: string;
        storageKey?: string;
        filename?: string;
      }>("/api/posts/upload", {
        method: "POST",
        body: formData,
      });

      if (!ok || !json) {
        throw new Error(error || "Failed to upload file.");
      }

      const resolvedUrl =
        json.url ||
        json.filePath ||
        (json.filename ? `/api/media/posts/${json.filename}` : "");
      const resolvedStorageKey = json.storageKey || json.filename || "";

      updateData({
        mediaUrl: resolvedUrl,
        mediaStorageKey: resolvedStorageKey,
        mediaMimeType: file.type,
      });
    } catch (err: any) {
      setUploadError(err.message || "Upload error");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="w-80 md:w-96 bg-slate-900/95 border-l border-white/10 p-5 flex flex-col h-full overflow-y-auto text-slate-200 shadow-2xl backdrop-blur-xl">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-white/10">
        <div>
          <span className="text-xs uppercase font-bold tracking-wider text-slate-400">
            Node Inspector
          </span>
          <h3 className="font-semibold text-base text-white truncate max-w-[220px]">
            {data.title || node.id}
          </h3>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white p-1 rounded hover:bg-white/10 transition-colors"
        >
          ✕
        </button>
      </div>

      {/* Common Controls */}
      <div className="space-y-4 py-4 border-b border-white/10">
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">
            Node Title
          </label>
          <input
            type="text"
            value={data.title || ""}
            onChange={(e) => updateData({ title: e.target.value })}
            placeholder="Step label..."
            className="w-full bg-slate-800/80 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500"
          />
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-300">Disable this step</span>
          <input
            type="checkbox"
            checked={Boolean(data.disabled)}
            onChange={(e) => updateData({ disabled: e.target.checked })}
            className="rounded border-slate-700 text-sky-500 focus:ring-sky-500"
          />
        </div>
      </div>

      {/* Node Type Specific Forms */}
      <div className="py-4 space-y-4 flex-1">
        {/* TEXT NODE */}
        {nodeType === "TEXT" && (
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Message Text *
            </label>
            <textarea
              rows={4}
              value={data.text || ""}
              onChange={(e) => updateData({ text: e.target.value })}
              placeholder="Enter message text sent to user..."
              className="w-full bg-slate-800/80 border border-white/10 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-sky-500 resize-y"
            />
          </div>
        )}

        {/* IMAGE / VIDEO NODE */}
        {(nodeType === "IMAGE" || nodeType === "VIDEO") && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Upload {nodeType === "IMAGE" ? "Photo" : "Video"}
              </label>
              <input
                type="file"
                accept={nodeType === "IMAGE" ? "image/*" : "video/*"}
                onChange={handleFileUpload}
                disabled={uploading}
                className="w-full text-xs text-slate-400 file:mr-2 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-sky-600 file:text-white hover:file:bg-sky-500 cursor-pointer"
              />
              {uploading && (
                <p className="text-[11px] text-sky-400 mt-1">Uploading...</p>
              )}
              {uploadError && (
                <p className="text-[11px] text-rose-400 mt-1">{uploadError}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Or Direct Media URL
              </label>
              <input
                type="url"
                value={data.mediaUrl || ""}
                onChange={(e) => updateData({ mediaUrl: e.target.value })}
                placeholder="https://..."
                className="w-full bg-slate-800/80 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Caption (Optional)
              </label>
              <textarea
                rows={2}
                value={data.caption || ""}
                onChange={(e) => updateData({ caption: e.target.value })}
                placeholder="Caption text..."
                className="w-full bg-slate-800/80 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>
        )}

        {/* BUTTON MENU */}
        {nodeType === "BUTTON_MENU" && (
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Menu Prompt Message
            </label>
            <input
              type="text"
              value={data.text || ""}
              onChange={(e) => updateData({ text: e.target.value })}
              placeholder="e.g. Please choose an option from the menu:"
              className="w-full bg-slate-800/80 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500"
            />
          </div>
        )}

        {/* BUTTON MANAGER (for TEXT, BUTTON_MENU, IMAGE, VIDEO) */}
        {(nodeType === "BUTTON_MENU" || nodeType === "TEXT") && (
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-300">
                Menu Buttons ({data.buttons?.length || 0})
              </span>
              <button
                type="button"
                onClick={handleAddButton}
                className="text-[11px] bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 px-2 py-0.5 rounded border border-amber-500/30 transition-colors"
              >
                + Add Button
              </button>
            </div>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {data.buttons?.map((btn, idx) => (
                <div
                  key={btn.id}
                  className="bg-black/40 p-2.5 rounded-lg border border-white/10 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <input
                      type="text"
                      value={btn.label}
                      onChange={(e) =>
                        handleUpdateButton(idx, { label: e.target.value })
                      }
                      placeholder="Button label..."
                      className="flex-1 bg-slate-800 border border-white/10 rounded px-2 py-1 text-white text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => handleDeleteButton(idx)}
                      className="text-slate-400 hover:text-rose-400 p-1"
                      title="Remove button"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-slate-400">Action:</label>
                    <select
                      value={btn.actionType}
                      onChange={(e) =>
                        handleUpdateButton(idx, {
                          actionType: e.target.value as any,
                        })
                      }
                      className="bg-slate-800 border border-white/10 rounded px-1.5 py-0.5 text-xs text-white"
                    >
                      <option value="TRANSITION">Next Step (Edge)</option>
                      <option value="URL">Open URL</option>
                      <option value="BACK">◀ Go Back</option>
                      <option value="MAIN_MENU">🏠 Main Menu</option>
                      <option value="REQUEST_CONTACT">📱 Request Phone</option>
                    </select>
                  </div>

                  {btn.actionType === "URL" && (
                    <input
                      type="url"
                      value={btn.url || ""}
                      onChange={(e) =>
                        handleUpdateButton(idx, { url: e.target.value })
                      }
                      placeholder="https://..."
                      className="w-full bg-slate-800 border border-white/10 rounded px-2 py-1 text-xs text-white"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CONDITION NODE */}
        {nodeType === "CONDITION" && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Target Channel to Check *
              </label>
              <select
                value={data.channelId || ""}
                onChange={(e) => updateData({ channelId: e.target.value })}
                className="w-full bg-slate-800/80 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500"
              >
                <option value="">-- Choose Channel --</option>
                {channels.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.name} ({ch.telegramChatId})
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-slate-400 italic">
              Connect this node's 3 handles on the canvas:
              <br />• <span className="text-emerald-400 font-medium">Joined:</span> User is a verified member
              <br />• <span className="text-rose-400 font-medium">Not Joined:</span> User has not joined
              <br />• <span className="text-amber-400 font-medium">Error:</span> Telegram check failed
            </p>
          </div>
        )}

        {/* USER INPUT NODE */}
        {nodeType === "USER_INPUT" && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Input Prompt *
              </label>
              <textarea
                rows={3}
                value={data.inputPrompt || ""}
                onChange={(e) => updateData({ inputPrompt: e.target.value })}
                placeholder="What should the bot ask the user?"
                className="w-full bg-slate-800/80 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Save Response to Variable *
              </label>
              <div className="flex items-center gap-1">
                <span className="text-teal-400 font-mono text-sm">$</span>
                <input
                  type="text"
                  value={data.variableName || ""}
                  onChange={(e) => updateData({ variableName: e.target.value })}
                  placeholder="e.g. userName, orderNotes"
                  className="flex-1 bg-slate-800/80 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-slate-400 mb-0.5">
                  Min Length
                </label>
                <input
                  type="number"
                  min={0}
                  value={data.minLength ?? ""}
                  onChange={(e) =>
                    updateData({
                      minLength: e.target.value ? parseInt(e.target.value, 10) : undefined,
                    })
                  }
                  className="w-full bg-slate-800 border border-white/10 rounded px-2 py-1 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-0.5">
                  Max Length
                </label>
                <input
                  type="number"
                  min={1}
                  value={data.maxLength ?? ""}
                  onChange={(e) =>
                    updateData({
                      maxLength: e.target.value ? parseInt(e.target.value, 10) : undefined,
                    })
                  }
                  className="w-full bg-slate-800 border border-white/10 rounded px-2 py-1 text-xs text-white"
                />
              </div>
            </div>
          </div>
        )}

        {/* REQUEST PHONE NODE */}
        {nodeType === "REQUEST_PHONE" && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Prompt Explanation
              </label>
              <textarea
                rows={3}
                value={data.promptText || ""}
                onChange={(e) => updateData({ promptText: e.target.value })}
                placeholder="Explain why phone number is requested..."
                className="w-full bg-slate-800/80 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Button Label
              </label>
              <input
                type="text"
                value={data.buttonLabel || ""}
                onChange={(e) => updateData({ buttonLabel: e.target.value })}
                placeholder="📱 Share Phone Number"
                className="w-full bg-slate-800/80 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white"
              />
            </div>
          </div>
        )}

        {/* END NODE */}
        {nodeType === "END" && (
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              End Completion Message
            </label>
            <textarea
              rows={3}
              value={data.endMessage || ""}
              onChange={(e) => updateData({ endMessage: e.target.value })}
              placeholder="Thank you! The flow has ended."
              className="w-full bg-slate-800/80 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-sky-500"
            />
          </div>
        )}

        {/* Auto Delete Toggle */}
        <div className="pt-3 border-t border-white/10 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-300">Auto-delete this message</span>
            <input
              type="checkbox"
              checked={Boolean(data.autoDeleteReply)}
              onChange={(e) => updateData({ autoDeleteReply: e.target.checked })}
              className="rounded border-slate-700 text-amber-500 focus:ring-amber-500"
            />
          </div>

          {data.autoDeleteReply && (
            <div>
              <label className="block text-[11px] text-slate-400 mb-0.5">
                Delete after (seconds)
              </label>
              <input
                type="number"
                min={5}
                max={86400}
                value={data.deleteAfterSeconds || 30}
                onChange={(e) =>
                  updateData({
                    deleteAfterSeconds: parseInt(e.target.value, 10) || 30,
                  })
                }
                className="w-full bg-slate-800 border border-white/10 rounded px-2 py-1 text-xs text-white"
              />
            </div>
          )}
        </div>
      </div>

      {/* Footer Actions */}
      <div className="pt-4 border-t border-white/10 flex items-center justify-between gap-2">
        {nodeType !== "START" && (
          <button
            type="button"
            onClick={() => onDuplicateNode(node)}
            className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs py-1.5 rounded-lg border border-white/10 transition-colors"
          >
            📋 Duplicate
          </button>
        )}
        {nodeType !== "START" && (
          <button
            type="button"
            onClick={() => onDeleteNode(node.id)}
            className="bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-xs px-3 py-1.5 rounded-lg transition-colors"
          >
            🗑️ Delete
          </button>
        )}
      </div>
    </div>
  );
}
