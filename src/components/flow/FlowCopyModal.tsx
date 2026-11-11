"use client";

import React, { useState, useEffect } from "react";
import { FlowCopyPreview } from "@/lib/flow/types";

interface BotOption {
  id: string;
  name: string;
  username: string;
}

interface FlowCopyModalProps {
  sourceBotId: string;
  sourceBotName: string;
  availableBots: BotOption[];
  onClose: () => void;
}

export function FlowCopyModal({
  sourceBotId,
  sourceBotName,
  availableBots,
  onClose,
}: FlowCopyModalProps) {
  const targetCandidates = availableBots.filter((b) => b.id !== sourceBotId);

  const [targetBotId, setTargetBotId] = useState<string>(
    targetCandidates[0]?.id || ""
  );
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [preview, setPreview] = useState<FlowCopyPreview | null>(null);
  const [destChannels, setDestChannels] = useState<
    Array<{ id: string; name: string; telegramChatId: string }>
  >([]);
  const [channelMapping, setChannelMapping] = useState<Record<string, string>>({});
  const [copying, setCopying] = useState(false);
  const [status, setStatus] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (targetBotId) {
      loadPreview(targetBotId);
      loadDestChannels(targetBotId);
    }
  }, [targetBotId]);

  const loadPreview = async (targetId: string) => {
    setLoadingPreview(true);
    setStatus(null);
    try {
      const res = await fetch(
        `/api/bots/${sourceBotId}/flow/copy?targetBotId=${targetId}`
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load copy preview.");
      }
      setPreview(data.preview);
    } catch (err: any) {
      setStatus({ type: "error", text: err.message });
      setPreview(null);
    } finally {
      setLoadingPreview(false);
    }
  };

  const loadDestChannels = async (targetId: string) => {
    try {
      const res = await fetch(`/api/bots/${targetId}/channels`);
      const data = await res.json();
      if (data.success && Array.isArray(data.channels)) {
        setDestChannels(data.channels);
      }
    } catch {
      setDestChannels([]);
    }
  };

  const handleCopy = async () => {
    if (!targetBotId) return;

    setCopying(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/bots/${sourceBotId}/flow/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetBotId,
          channelMapping,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to copy flow.");
      }

      setStatus({
        type: "success",
        text: `Flow successfully copied to ${targetCandidates.find((b) => b.id === targetBotId)?.name}'s DRAFT! The destination bot's published flow remains safe.`,
      });
    } catch (err: any) {
      setStatus({ type: "error", text: err.message });
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-xl max-h-[620px] flex flex-col shadow-2xl overflow-hidden text-slate-200">
        {/* Header */}
        <div className="bg-slate-800/90 px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🔁</span>
            <h3 className="font-semibold text-white text-sm">
              Copy Flow Between Bots
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded">
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 p-5 overflow-y-auto space-y-4">
          {status && (
            <div
              className={`p-3 rounded-lg text-xs border ${
                status.type === "success"
                  ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-300"
                  : "bg-rose-950/40 border-rose-500/40 text-rose-300"
              }`}
            >
              {status.text}
            </div>
          )}

          {targetCandidates.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">
              You do not have any other bots assigned to copy to.
            </p>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Destination Bot *
                </label>
                <select
                  value={targetBotId}
                  onChange={(e) => setTargetBotId(e.target.value)}
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                >
                  {targetCandidates.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} (@{b.username})
                    </option>
                  ))}
                </select>
              </div>

              {loadingPreview ? (
                <p className="text-xs text-slate-400 py-4 text-center">
                  Inspecting flow and analyzing dependencies...
                </p>
              ) : preview ? (
                <div className="space-y-3 bg-slate-800/40 p-4 rounded-xl border border-white/10 text-xs">
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="text-slate-400">Total Nodes:</span>
                    <span className="font-bold text-white">{preview.nodeCount}</span>
                  </div>

                  {/* Channel Conditions Mapping */}
                  {preview.channelConditions.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <span className="font-semibold text-amber-300">
                        Channel Condition Mapping:
                      </span>
                      {preview.channelConditions.map((cond) => (
                        <div
                          key={cond.nodeId}
                          className="bg-black/30 p-2.5 rounded-lg border border-white/5 space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-slate-200">
                              Node: {cond.nodeTitle}
                            </span>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full ${
                                cond.availableInTarget
                                  ? "bg-emerald-500/20 text-emerald-300"
                                  : "bg-amber-500/20 text-amber-300"
                              }`}
                            >
                              {cond.availableInTarget ? "Matched" : "Action Required"}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400">
                            Source Channel: {cond.channelName || cond.channelId}
                          </p>

                          <div>
                            <label className="block text-[10px] text-slate-400 mb-0.5">
                              Map to Target Bot Channel:
                            </label>
                            <select
                              value={channelMapping[cond.channelId] || ""}
                              onChange={(e) =>
                                setChannelMapping({
                                  ...channelMapping,
                                  [cond.channelId]: e.target.value,
                                })
                              }
                              className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1 text-xs text-white"
                            >
                              <option value="">-- Keep Unmapped --</option>
                              {destChannels.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name} ({c.telegramChatId})
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Warnings */}
                  {preview.warnings.length > 0 && (
                    <div className="bg-amber-950/30 border border-amber-500/20 p-2.5 rounded-lg space-y-1 text-amber-300 text-[11px]">
                      <span className="font-bold">⚠️ Pre-flight Notes:</span>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {preview.warnings.map((w, idx) => (
                          <li key={idx}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="bg-sky-950/30 border border-sky-500/20 p-2.5 rounded-lg text-[11px] text-sky-300">
                    ℹ️ The flow will be saved as a new <strong>Draft</strong> on the destination bot. It will <strong>never overwrite</strong> or immediately publish over the destination bot's active flow.
                  </div>
                </div>
              ) : null}

              <button
                type="button"
                disabled={copying || loadingPreview || !preview}
                onClick={handleCopy}
                className="w-full bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white font-semibold text-xs py-2 rounded-lg transition-colors"
              >
                {copying ? "Copying Flow to Draft..." : "Copy to Destination Draft"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
