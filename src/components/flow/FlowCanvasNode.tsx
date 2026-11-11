"use client";

import React, { memo } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { FlowNodeData, FlowNodeType } from "@/lib/flow/types";

const NODE_STYLES: Record<
  FlowNodeType,
  { bg: string; border: string; badge: string; icon: string; label: string }
> = {
  START: {
    bg: "bg-emerald-950/40",
    border: "border-emerald-500",
    badge: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40",
    icon: "🚀",
    label: "Start",
  },
  TEXT: {
    bg: "bg-blue-950/40",
    border: "border-blue-500",
    badge: "bg-blue-500/20 text-blue-400 border-blue-500/40",
    icon: "💬",
    label: "Text Message",
  },
  IMAGE: {
    bg: "bg-purple-950/40",
    border: "border-purple-500",
    badge: "bg-purple-500/20 text-purple-400 border-purple-500/40",
    icon: "🖼️",
    label: "Photo Message",
  },
  VIDEO: {
    bg: "bg-indigo-950/40",
    border: "border-indigo-500",
    badge: "bg-indigo-500/20 text-indigo-400 border-indigo-500/40",
    icon: "🎥",
    label: "Video Message",
  },
  BUTTON_MENU: {
    bg: "bg-amber-950/40",
    border: "border-amber-500",
    badge: "bg-amber-500/20 text-amber-400 border-amber-500/40",
    icon: "📋",
    label: "Menu & Buttons",
  },
  REQUEST_PHONE: {
    bg: "bg-cyan-950/40",
    border: "border-cyan-500",
    badge: "bg-cyan-500/20 text-cyan-400 border-cyan-500/40",
    icon: "📱",
    label: "Phone Request",
  },
  CONDITION: {
    bg: "bg-violet-950/40",
    border: "border-violet-500",
    badge: "bg-violet-500/20 text-violet-400 border-violet-500/40",
    icon: "🔀",
    label: "Channel Check",
  },
  USER_INPUT: {
    bg: "bg-teal-950/40",
    border: "border-teal-500",
    badge: "bg-teal-500/20 text-teal-400 border-teal-500/40",
    icon: "⌨️",
    label: "User Input",
  },
  END: {
    bg: "bg-rose-950/40",
    border: "border-rose-500",
    badge: "bg-rose-500/20 text-rose-400 border-rose-500/40",
    icon: "🏁",
    label: "End Flow",
  },
};

export const FlowCanvasNode = memo(({ data, selected }: NodeProps<FlowNodeData>) => {
  const type = data.nodeType || "TEXT";
  const style = NODE_STYLES[type] || NODE_STYLES.TEXT;
  const isStart = type === "START";
  const isEnd = type === "END";
  const isCondition = type === "CONDITION";
  const hasButtons = (data.buttons || []).length > 0;

  return (
    <div
      className={`min-w-[240px] max-w-[280px] rounded-xl border-2 backdrop-blur-md shadow-xl transition-all duration-200 ${
        style.bg
      } ${
        selected
          ? "border-sky-400 ring-2 ring-sky-400/50 shadow-sky-500/20"
          : style.border
      } ${data.disabled ? "opacity-50" : "opacity-100"}`}
    >
      {/* Target handle on top (except START node) */}
      {!isStart && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3 !h-3 !bg-slate-300 !border-2 !border-slate-800 hover:!bg-sky-400 transition-colors"
        />
      )}

      {/* Header */}
      <div className="px-3.5 py-2.5 border-b border-white/10 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 overflow-hidden">
          <span className="text-base select-none">{style.icon}</span>
          <span className="font-semibold text-xs tracking-wide text-slate-100 truncate">
            {data.title || style.label}
          </span>
        </div>
        <span
          className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${style.badge}`}
        >
          {style.label}
        </span>
      </div>

      {/* Body Content */}
      <div className="p-3 text-xs text-slate-300 space-y-2">
        {/* Text Snippet */}
        {data.text && (
          <p className="line-clamp-2 text-slate-300 italic bg-black/20 p-1.5 rounded border border-white/5">
            "{data.text}"
          </p>
        )}

        {/* Media Preview */}
        {(type === "IMAGE" || type === "VIDEO") && (
          <div className="bg-black/30 rounded p-1.5 border border-white/5 text-[11px] text-slate-400">
            {data.mediaUrl ? (
              <span className="truncate block">📎 {data.mediaUrl}</span>
            ) : data.mediaStorageKey ? (
              <span className="truncate block">💾 Key: {data.mediaStorageKey}</span>
            ) : (
              <span className="text-amber-400">⚠️ No media configured</span>
            )}
            {data.caption && (
              <p className="line-clamp-1 mt-1 text-slate-300">
                Caption: {data.caption}
              </p>
            )}
          </div>
        )}

        {/* Input Variable Pill */}
        {type === "USER_INPUT" && (
          <div className="flex items-center gap-1.5 bg-black/30 px-2 py-1 rounded text-[11px] text-teal-300 border border-teal-500/20">
            <span>Variable:</span>
            <code className="font-mono bg-teal-950/60 px-1 rounded text-teal-200">
              ${data.variableName || "input"}
            </code>
          </div>
        )}

        {/* Condition details */}
        {isCondition && (
          <div className="bg-black/30 p-1.5 rounded border border-white/5 space-y-1">
            <div className="text-[11px] text-slate-400">
              Channel:{" "}
              <span className="text-violet-300 font-medium">
                {data.channelId ? "Associated Channel" : "None selected"}
              </span>
            </div>
          </div>
        )}

        {/* Auto delete badge */}
        {data.autoDeleteReply && (
          <div className="text-[10px] text-amber-300 flex items-center gap-1">
            <span>⏱️ Auto-deletes after {data.deleteAfterSeconds || 30}s</span>
          </div>
        )}

        {/* Buttons List Preview */}
        {hasButtons && (
          <div className="space-y-1 pt-1">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
              Buttons:
            </span>
            <div className="space-y-1">
              {data.buttons?.map((btn) => (
                <div
                  key={btn.id}
                  className="relative flex items-center justify-between bg-black/40 hover:bg-black/60 px-2 py-1 rounded border border-white/10 text-[11px] text-slate-200"
                >
                  <span className="truncate pr-4">
                    {btn.label || "Untitled Button"}
                  </span>
                  {/* Distinct source handle for each button */}
                  <Handle
                    type="source"
                    id={btn.id}
                    position={Position.Right}
                    className="!w-2.5 !h-2.5 !bg-amber-400 !border-2 !border-slate-900 hover:!bg-amber-300"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Condition Outcomes Handles */}
      {isCondition && (
        <div className="border-t border-white/10 p-2 space-y-1.5 bg-black/20">
          <div className="relative flex items-center justify-between text-[11px] text-emerald-400 font-medium px-1">
            <span>✅ Joined</span>
            <Handle
              type="source"
              id="joined"
              position={Position.Right}
              className="!w-2.5 !h-2.5 !bg-emerald-400 !border-2 !border-slate-900"
            />
          </div>
          <div className="relative flex items-center justify-between text-[11px] text-rose-400 font-medium px-1">
            <span>❌ Not Joined</span>
            <Handle
              type="source"
              id="not_joined"
              position={Position.Right}
              className="!w-2.5 !h-2.5 !bg-rose-400 !border-2 !border-slate-900"
            />
          </div>
          <div className="relative flex items-center justify-between text-[11px] text-amber-400 font-medium px-1">
            <span>⚠️ Error</span>
            <Handle
              type="source"
              id="verification_error"
              position={Position.Right}
              className="!w-2.5 !h-2.5 !bg-amber-400 !border-2 !border-slate-900"
            />
          </div>
        </div>
      )}

      {/* Default bottom source handle (for non-condition, non-end nodes, or fallback) */}
      {!isEnd && !isCondition && !hasButtons && (
        <Handle
          type="source"
          id="default"
          position={Position.Bottom}
          className="!w-3 !h-3 !bg-slate-300 !border-2 !border-slate-800 hover:!bg-sky-400 transition-colors"
        />
      )}
    </div>
  );
});

FlowCanvasNode.displayName = "FlowCanvasNode";
