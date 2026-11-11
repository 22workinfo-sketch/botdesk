"use client";

import React, { useState, useEffect } from "react";
import { FlowGraph, FlowNodeType } from "@/lib/flow/types";

interface FlowSimulatorProps {
  graph: FlowGraph;
  botName: string;
  onClose: () => void;
}

interface SimMessage {
  id: string;
  sender: "bot" | "user" | "system";
  text?: string;
  mediaUrl?: string;
  mediaType?: "IMAGE" | "VIDEO";
  caption?: string;
  buttons?: Array<{ id: string; label: string; actionType: string; url?: string | null }>;
  isInputPrompt?: boolean;
}

export function FlowSimulator({ graph, botName, onClose }: FlowSimulatorProps) {
  const [messages, setMessages] = useState<SimMessage[]>([]);
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [userInputText, setUserInputText] = useState("");
  const [waitingForInput, setWaitingForInput] = useState<{
    nodeId: string;
    variableName: string;
    minLength?: number;
    maxLength?: number;
  } | null>(null);

  // Initialize simulation from START node
  useEffect(() => {
    restartSimulation();
  }, [graph]);

  const restartSimulation = () => {
    const startNode = graph.nodes.find((n) => n.data.nodeType === "START");
    if (!startNode) return;

    setMessages([
      {
        id: "sys-start",
        sender: "system",
        text: `Starting interactive simulation for @${botName}. (No real messages sent)`,
      },
    ]);
    setWaitingForInput(null);

    // Find first connected node
    const edge = graph.edges.find((e) => e.source === startNode.id);
    if (edge) {
      stepToNode(edge.target);
    }
  };

  const stepToNode = (nodeId: string) => {
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    setCurrentNodeId(nodeId);
    const data = node.data;
    const type = data.nodeType;

    const newMsgs: SimMessage[] = [];

    if (type === "IMAGE") {
      newMsgs.push({
        id: `msg-${Date.now()}-img`,
        sender: "bot",
        mediaUrl: data.mediaUrl || undefined,
        mediaType: "IMAGE",
        caption: data.caption || undefined,
      });

      // If no buttons, auto-advance
      if (!data.buttons || data.buttons.length === 0) {
        setMessages((prev) => [...prev, ...newMsgs]);
        const nextEdge = graph.edges.find((e) => e.source === nodeId);
        if (nextEdge) {
          stepToNode(nextEdge.target);
        }
        return;
      }
    }

    if (type === "VIDEO") {
      newMsgs.push({
        id: `msg-${Date.now()}-vid`,
        sender: "bot",
        mediaUrl: data.mediaUrl || undefined,
        mediaType: "VIDEO",
        caption: data.caption || undefined,
      });

      if (!data.buttons || data.buttons.length === 0) {
        setMessages((prev) => [...prev, ...newMsgs]);
        const nextEdge = graph.edges.find((e) => e.source === nodeId);
        if (nextEdge) {
          stepToNode(nextEdge.target);
        }
        return;
      }
    }

    if (type === "TEXT") {
      const hasButtons = data.buttons && data.buttons.length > 0;
      newMsgs.push({
        id: `msg-${Date.now()}-txt`,
        sender: "bot",
        text: data.text || "...",
        buttons: hasButtons ? data.buttons : undefined,
      });

      if (!hasButtons) {
        setMessages((prev) => [...prev, ...newMsgs]);
        const nextEdge = graph.edges.find((e) => e.source === nodeId);
        if (nextEdge) {
          stepToNode(nextEdge.target);
        }
        return;
      }
    }

    if (type === "BUTTON_MENU") {
      newMsgs.push({
        id: `msg-${Date.now()}-menu`,
        sender: "bot",
        text: data.text || "Please choose an option:",
        buttons: (data.buttons || []).filter((b) => b.isEnabled),
      });
    }

    if (type === "REQUEST_PHONE") {
      newMsgs.push({
        id: `msg-${Date.now()}-phone`,
        sender: "bot",
        text: data.promptText || "Please share your contact:",
        buttons: [
          {
            id: "btn-phone-sim",
            label: data.buttonLabel || "📱 Share Phone Number",
            actionType: "REQUEST_CONTACT",
          },
        ],
      });
    }

    if (type === "USER_INPUT") {
      setWaitingForInput({
        nodeId: node.id,
        variableName: data.variableName || "input",
        minLength: data.minLength,
        maxLength: data.maxLength,
      });
      newMsgs.push({
        id: `msg-${Date.now()}-input`,
        sender: "bot",
        text: data.inputPrompt || "Please enter text:",
        isInputPrompt: true,
      });
    }

    if (type === "CONDITION") {
      newMsgs.push({
        id: `msg-${Date.now()}-cond`,
        sender: "system",
        text: `🔀 Channel Condition: Choose membership status to simulate:`,
        buttons: [
          { id: "sim-joined", label: "✅ Simulate: Joined", actionType: "SIM_JOINED" },
          { id: "sim-not-joined", label: "❌ Simulate: Not Joined", actionType: "SIM_NOT_JOINED" },
          { id: "sim-error", label: "⚠️ Simulate: API Error", actionType: "SIM_ERROR" },
        ],
      });
    }

    if (type === "END") {
      newMsgs.push({
        id: `msg-${Date.now()}-end`,
        sender: "bot",
        text: data.endMessage || "Flow completed.",
        buttons: [{ id: "restart", label: "🔄 Restart Simulation", actionType: "RESTART" }],
      });
    }

    setMessages((prev) => [...prev, ...newMsgs]);
  };

  const handleButtonClick = (button: { id: string; label: string; actionType: string; url?: string | null }) => {
    // Echo user click
    setMessages((prev) => [
      ...prev,
      {
        id: `msg-${Date.now()}-user`,
        sender: "user",
        text: button.label,
      },
    ]);

    if (button.actionType === "URL") {
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}-url`,
          sender: "system",
          text: `🔗 URL button would open: ${button.url || "https://..."}`,
        },
      ]);
      return;
    }

    if (button.actionType === "RESTART") {
      restartSimulation();
      return;
    }

    if (button.actionType === "REQUEST_CONTACT") {
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}-phone-shared`,
          sender: "system",
          text: `📱 Simulated phone sharing: +1 (555) 019-2834 (Verified)`,
        },
      ]);
      const nextEdge = graph.edges.find((e) => e.source === currentNodeId);
      if (nextEdge) stepToNode(nextEdge.target);
      return;
    }

    // Condition simulator outcomes
    if (button.actionType === "SIM_JOINED") {
      const edge = graph.edges.find((e) => e.source === currentNodeId && e.sourceHandle === "joined");
      if (edge) stepToNode(edge.target);
      else setMessages((prev) => [...prev, { id: `m-${Date.now()}`, sender: "system", text: "No 'joined' edge configured." }]);
      return;
    }
    if (button.actionType === "SIM_NOT_JOINED") {
      const edge = graph.edges.find((e) => e.source === currentNodeId && e.sourceHandle === "not_joined");
      if (edge) stepToNode(edge.target);
      else setMessages((prev) => [...prev, { id: `m-${Date.now()}`, sender: "system", text: "No 'not_joined' edge configured." }]);
      return;
    }
    if (button.actionType === "SIM_ERROR") {
      const edge = graph.edges.find((e) => e.source === currentNodeId && e.sourceHandle === "verification_error");
      if (edge) stepToNode(edge.target);
      else setMessages((prev) => [...prev, { id: `m-${Date.now()}`, sender: "system", text: "⚠️ Verification error: No explicit edge, fallback warning triggered." }]);
      return;
    }

    // Standard transition
    const edge =
      graph.edges.find((e) => e.source === currentNodeId && e.sourceHandle === button.id) ||
      graph.edges.find((e) => e.source === currentNodeId);

    if (edge) {
      stepToNode(edge.target);
    } else {
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}-no-edge`,
          sender: "system",
          text: "ℹ️ No outgoing edge connected for this button.",
        },
      ]);
    }
  };

  const handleSendUserInput = (e: React.FormEvent) => {
    e.preventDefault();
    if (!waitingForInput) return;

    const trimmed = userInputText.trim();
    if (!trimmed) return;

    if (waitingForInput.minLength && trimmed.length < waitingForInput.minLength) {
      setMessages((prev) => [
        ...prev,
        {
          id: `m-${Date.now()}`,
          sender: "system",
          text: `⚠️ Input too short (min ${waitingForInput.minLength} chars).`,
        },
      ]);
      return;
    }

    setMessages((prev) => [
      ...prev,
      { id: `m-${Date.now()}-u`, sender: "user", text: trimmed },
      {
        id: `m-${Date.now()}-v`,
        sender: "system",
        text: `💾 Saved to $${waitingForInput.variableName} = "${trimmed}"`,
      },
    ]);

    const inputNodeId = waitingForInput.nodeId;
    setWaitingForInput(null);
    setUserInputText("");

    const edge = graph.edges.find((e) => e.source === inputNodeId);
    if (edge) {
      stepToNode(edge.target);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md h-[640px] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-slate-800/90 px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-semibold text-sm text-white">
              Telegram Simulator (@{botName})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={restartSimulation}
              className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-2 py-1 rounded transition-colors"
            >
              🔄 Restart
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Message Thread */}
        <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col ${
                m.sender === "user"
                  ? "items-end"
                  : m.sender === "system"
                  ? "items-center"
                  : "items-start"
              }`}
            >
              {m.sender === "system" ? (
                <div className="bg-slate-800/80 border border-white/10 text-slate-300 text-[11px] px-3 py-1.5 rounded-lg max-w-[90%] text-center">
                  {m.text}
                  {m.buttons && (
                    <div className="mt-2 flex flex-wrap gap-1.5 justify-center">
                      {m.buttons.map((b) => (
                        <button
                          key={b.id}
                          onClick={() => handleButtonClick(b)}
                          className="bg-slate-700 hover:bg-slate-600 text-white text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors"
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div
                  className={`max-w-[85%] rounded-2xl p-3 text-xs shadow-md ${
                    m.sender === "user"
                      ? "bg-sky-600 text-white rounded-br-sm"
                      : "bg-slate-800 border border-white/10 text-slate-200 rounded-bl-sm"
                  }`}
                >
                  {m.mediaUrl && (
                    <div className="mb-2 rounded-lg overflow-hidden bg-black/40 border border-white/10 p-2 text-center text-slate-400">
                      <span>{m.mediaType === "IMAGE" ? "🖼️ [Photo Preview]" : "🎥 [Video Preview]"}</span>
                      <p className="text-[10px] truncate">{m.mediaUrl}</p>
                    </div>
                  )}

                  {m.text && <p className="whitespace-pre-wrap">{m.text}</p>}
                  {m.caption && <p className="mt-1 text-slate-300 italic">{m.caption}</p>}

                  {/* Buttons inside bot message */}
                  {m.buttons && m.buttons.length > 0 && (
                    <div className="mt-2.5 pt-2 border-t border-white/10 flex flex-wrap gap-1.5">
                      {m.buttons.map((btn) => (
                        <button
                          key={btn.id}
                          onClick={() => handleButtonClick(btn)}
                          className="bg-slate-700 hover:bg-sky-600 text-white text-xs px-3 py-1.5 rounded-lg border border-white/10 transition-colors"
                        >
                          {btn.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* User Input Bar */}
        <div className="p-3 bg-slate-800/90 border-t border-white/10">
          {waitingForInput ? (
            <form onSubmit={handleSendUserInput} className="flex gap-2">
              <input
                type="text"
                value={userInputText}
                onChange={(e) => setUserInputText(e.target.value)}
                placeholder={`Type response for $${waitingForInput.variableName}...`}
                className="flex-1 bg-slate-900 border border-sky-500 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none"
                autoFocus
              />
              <button
                type="submit"
                className="bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
              >
                Send
              </button>
            </form>
          ) : (
            <div className="text-[11px] text-center text-slate-400 italic">
              Tap buttons above or restart to simulate navigation.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
