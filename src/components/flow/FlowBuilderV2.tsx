"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  MarkerType,
} from "reactflow";
import "reactflow/dist/style.css";

import {
  FlowGraph,
  FlowGraphNode,
  FlowGraphEdge,
  FlowNodeData,
  FlowNodeType,
  BotFlowData,
} from "@/lib/flow/types";
import { ensureFlowGraph } from "@/lib/flow/converter";
import { validateFlowGraph } from "@/lib/flow/validation";
import { FlowCanvasNode } from "./FlowCanvasNode";
import { NodeInspector } from "./NodeInspector";
import { FlowSimulator } from "./FlowSimulator";
import { FlowTemplateModal } from "./FlowTemplateModal";
import { FlowCopyModal } from "./FlowCopyModal";
import { FlowAnalyticsView } from "./FlowAnalyticsView";
import { safeFetchJson } from "@/lib/api-client";

export interface BotOption {
  id: string;
  name: string;
  username: string;
  welcomeMessage?: string;
}

interface FlowBuilderV2Props {
  bots: BotOption[];
  initialBotId: string;
}

const nodeTypes = {
  customNode: FlowCanvasNode,
  startNode: FlowCanvasNode,
  menuNode: FlowCanvasNode,
};

export function FlowBuilderV2({ bots, initialBotId }: FlowBuilderV2Props) {
  const [selectedBotId, setSelectedBotId] = useState<string>(initialBotId);
  const activeBot = bots.find((b) => b.id === selectedBotId) || bots[0];

  // View Mode: Canvas, Analytics, Simulator
  const [viewMode, setViewMode] = useState<"canvas" | "analytics">("canvas");
  const [showSimulator, setShowSimulator] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showCopy, setShowCopy] = useState(false);
  const [showRollback, setShowRollback] = useState(false);

  // Flow State
  const [loading, setLoading] = useState(true);
  const [flowData, setFlowData] = useState<BotFlowData | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Status & Actions
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{
    type: "success" | "error" | "info";
    text: string;
    errors?: string[];
  } | null>(null);

  // Rollback state
  const [selectedRollbackVer, setSelectedRollbackVer] = useState<number | null>(null);
  const [preserveDraftOnRollback, setPreserveDraftOnRollback] = useState(true);
  const [rollingBack, setRollingBack] = useState(false);

  // Fetch bot flow data on bot change
  useEffect(() => {
    fetchBotFlow(selectedBotId);
  }, [selectedBotId]);

  const fetchBotFlow = async (botId: string) => {
    setLoading(true);
    setStatusMsg(null);
    setSelectedNodeId(null);
    try {
      const { ok, data, error } = await safeFetchJson<BotFlowData>(`/api/bots/${botId}/flow`);
      if (!ok || !data) {
        throw new Error(error || "Failed to load flow data.");
      }
      setFlowData(data);

      const rawStructure = data.draft?.structure || data.published?.structure;
      const graph = ensureFlowGraph(rawStructure);

      // Map to React Flow nodes
      const rfNodes: Node[] = graph.nodes.map((n) => ({
        id: n.id,
        type: "customNode",
        position: n.position || { x: 250, y: 150 },
        data: n.data,
      }));

      // Map to React Flow edges
      const rfEdges: Edge[] = graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle || undefined,
        label: e.label || undefined,
        type: "smoothstep",
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8" },
        style: { stroke: "#64748b", strokeWidth: 2 },
      }));

      setNodes(rfNodes);
      setEdges(rfEdges);
      setHasUnsavedChanges(false);
    } catch (err: any) {
      setStatusMsg({ type: "error", text: err.message || "Failed to load flow." });
    } finally {
      setLoading(false);
    }
  };

  // Convert current ReactFlow state to FlowGraph
  const currentFlowGraph: FlowGraph = useMemo(() => {
    return {
      version: 2,
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: n.data as FlowNodeData,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle || null,
        label: (e.label as string) || null,
      })),
    };
  }, [nodes, edges]);

  // Selected node object
  const selectedNode: FlowGraphNode | null = useMemo(() => {
    if (!selectedNodeId) return null;
    const n = nodes.find((node) => node.id === selectedNodeId);
    if (!n) return null;
    return {
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data as FlowNodeData,
    };
  }, [selectedNodeId, nodes]);

  // Connect edge handler
  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: "smoothstep",
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8" },
            style: { stroke: "#64748b", strokeWidth: 2 },
          },
          eds
        )
      );
      setHasUnsavedChanges(true);
    },
    [setEdges]
  );

  // Click node on canvas
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  // Pane click (deselect)
  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  // Update selected node data
  const handleUpdateNode = useCallback(
    (updated: FlowGraphNode) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === updated.id ? { ...n, data: updated.data } : n))
      );
      setHasUnsavedChanges(true);
    },
    [setNodes]
  );

  // Duplicate node
  const handleDuplicateNode = useCallback(
    (node: FlowGraphNode) => {
      const newId = `node-${Date.now()}`;
      const duplicated: Node = {
        id: newId,
        type: "customNode",
        position: { x: node.position.x + 40, y: node.position.y + 40 },
        data: {
          ...node.data,
          title: `${node.data.title || "Step"} (Copy)`,
          buttons: (node.data.buttons || []).map((b) => ({
            ...b,
            id: `btn-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          })),
        },
      };

      setNodes((nds) => [...nds, duplicated]);
      setSelectedNodeId(newId);
      setHasUnsavedChanges(true);
    },
    [setNodes]
  );

  // Delete node
  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      if (selectedNodeId === nodeId) {
        setSelectedNodeId(null);
      }
      setHasUnsavedChanges(true);
    },
    [selectedNodeId, setNodes, setEdges]
  );

  // Add a new node to canvas
  const handleAddNode = (type: FlowNodeType) => {
    const newId = `node-${type.toLowerCase()}-${Date.now().toString().slice(-4)}`;
    const defaultData: FlowNodeData = {
      nodeType: type,
      title:
        type === "TEXT"
          ? "Text Message"
          : type === "IMAGE"
          ? "Photo Step"
          : type === "VIDEO"
          ? "Video Step"
          : type === "BUTTON_MENU"
          ? "Submenu"
          : type === "CONDITION"
          ? "Channel Check"
          : type === "USER_INPUT"
          ? "Ask User"
          : type === "REQUEST_PHONE"
          ? "Phone Request"
          : "End Step",
      text: type === "TEXT" ? "Enter your message here..." : undefined,
      inputPrompt: type === "USER_INPUT" ? "Please enter your response:" : undefined,
      variableName: type === "USER_INPUT" ? `input_${Date.now().toString().slice(-3)}` : undefined,
      buttons:
        type === "BUTTON_MENU"
          ? [
              {
                id: `btn-${Date.now()}-1`,
                label: "Option 1",
                actionType: "TRANSITION",
                isEnabled: true,
                order: 0,
              },
            ]
          : undefined,
    };

    const newNode: Node = {
      id: newId,
      type: "customNode",
      position: { x: 300 + Math.random() * 50, y: 250 + Math.random() * 50 },
      data: defaultData,
    };

    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newId);
    setHasUnsavedChanges(true);
  };

  // Save Draft
  const handleSaveDraft = async () => {
    setSaving(true);
    setStatusMsg(null);
    try {
      const { ok, error } = await safeFetchJson(
        `/api/bots/${selectedBotId}/flow/draft`,
        {
          method: "PUT",
          body: { structure: currentFlowGraph },
        }
      );
      if (!ok) {
        throw new Error(error || "Failed to save draft flow.");
      }

      setHasUnsavedChanges(false);
      setStatusMsg({ type: "success", text: "Draft flow saved successfully!" });
      fetchBotFlow(selectedBotId);
    } catch (err: any) {
      setStatusMsg({ type: "error", text: err.message || "Failed to save draft." });
    } finally {
      setSaving(false);
    }
  };

  // Publish Flow
  const handlePublish = async () => {
    // 1. Client-side pre-flight validation
    const validation = validateFlowGraph(currentFlowGraph);
    if (!validation.isValid) {
      setStatusMsg({
        type: "error",
        text: "Please resolve validation errors before publishing:",
        errors: validation.errors,
      });
      return;
    }

    if (
      !confirm(
        "Are you ready to publish this flow? The real Telegram bot will immediately begin executing this flow when users interact with it."
      )
    ) {
      return;
    }

    setPublishing(true);
    setStatusMsg(null);
    try {
      // First save draft if changed
      const draftRes = await safeFetchJson(
        `/api/bots/${selectedBotId}/flow/draft`,
        {
          method: "PUT",
          body: { structure: currentFlowGraph },
        }
      );
      if (!draftRes.ok) {
        throw new Error(draftRes.error || "Failed to save draft before publishing.");
      }

      // Then publish
      const { ok, data, error, validationErrors } = await safeFetchJson<{
        published: { version: number };
      }>(`/api/bots/${selectedBotId}/flow/publish`, {
        method: "POST",
      });

      if (!ok) {
        const errorList = validationErrors || (error ? [error] : ["Publishing failed."]);
        setStatusMsg({
          type: "error",
          text: error || "Publishing failed.",
          errors: errorList,
        });
        return;
      }

      setHasUnsavedChanges(false);
      setStatusMsg({
        type: "success",
        text: `🎉 Flow Version v${data?.published?.version || ""} published live! Telegram bot is executing this flow.`,
      });
      fetchBotFlow(selectedBotId);
    } catch (err: any) {
      setStatusMsg({ type: "error", text: err.message || "Publishing failed." });
    } finally {
      setPublishing(false);
    }
  };

  // Rollback Action
  const handleRollback = async () => {
    if (!selectedRollbackVer) return;

    setRollingBack(true);
    setStatusMsg(null);
    try {
      const { ok, error } = await safeFetchJson(
        `/api/bots/${selectedBotId}/flow/rollback`,
        {
          method: "POST",
          body: {
            targetVersion: selectedRollbackVer,
            preserveDraft: preserveDraftOnRollback,
          },
        }
      );

      if (!ok) {
        throw new Error(error || "Rollback failed.");
      }

      setStatusMsg({
        type: "success",
        text: `Successfully rolled back to version v${selectedRollbackVer}! ${
          preserveDraftOnRollback
            ? "Your working draft was preserved."
            : "Working draft was reset to match restored flow."
        }`,
      });
      setShowRollback(false);
      fetchBotFlow(selectedBotId);
    } catch (err: any) {
      setStatusMsg({ type: "error", text: err.message || "Rollback error." });
    } finally {
      setRollingBack(false);
    }
  };

  // Apply template
  const handleApplyTemplate = async (templateId: string) => {
    const { ok, error } = await safeFetchJson(
      `/api/bots/${selectedBotId}/flow/templates/${templateId}/apply`,
      { method: "POST" }
    );
    if (!ok) {
      throw new Error(error || "Failed to apply template.");
    }
    fetchBotFlow(selectedBotId);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] min-h-[600px] w-full bg-slate-950 rounded-2xl border border-white/10 overflow-hidden shadow-2xl relative">
      {/* Top Main Toolbar */}
      <div className="bg-slate-900 border-b border-white/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3 z-20">
        {/* Left: Bot Selector & Mode Toggle */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-400">Bot:</label>
            <select
              value={selectedBotId}
              onChange={(e) => setSelectedBotId(e.target.value)}
              className="bg-slate-800 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white font-medium focus:outline-none focus:border-sky-500 cursor-pointer"
            >
              {bots.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} (@{b.username})
                </option>
              ))}
            </select>
          </div>

          <div className="flex bg-slate-800 p-0.5 rounded-lg border border-white/10 text-xs">
            <button
              onClick={() => setViewMode("canvas")}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                viewMode === "canvas"
                  ? "bg-sky-500 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              🎨 Flow Canvas
            </button>
            <button
              onClick={() => setViewMode("analytics")}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                viewMode === "analytics"
                  ? "bg-sky-500 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              📊 Analytics
            </button>
          </div>
        </div>

        {/* Center: Quick Add Node Pill Buttons (only in canvas mode) */}
        {viewMode === "canvas" && (
          <div className="hidden lg:flex items-center gap-1.5 bg-slate-800/80 px-2 py-1 rounded-xl border border-white/10 text-xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">
              Add:
            </span>
            <button
              onClick={() => handleAddNode("TEXT")}
              className="bg-slate-700/80 hover:bg-slate-600 text-blue-300 px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
            >
              💬 Text
            </button>
            <button
              onClick={() => handleAddNode("IMAGE")}
              className="bg-slate-700/80 hover:bg-slate-600 text-purple-300 px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
            >
              🖼️ Photo
            </button>
            <button
              onClick={() => handleAddNode("VIDEO")}
              className="bg-slate-700/80 hover:bg-slate-600 text-indigo-300 px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
            >
              🎥 Video
            </button>
            <button
              onClick={() => handleAddNode("BUTTON_MENU")}
              className="bg-slate-700/80 hover:bg-slate-600 text-amber-300 px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
            >
              📋 Menu
            </button>
            <button
              onClick={() => handleAddNode("CONDITION")}
              className="bg-slate-700/80 hover:bg-slate-600 text-violet-300 px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
            >
              🔀 Channel Check
            </button>
            <button
              onClick={() => handleAddNode("USER_INPUT")}
              className="bg-slate-700/80 hover:bg-slate-600 text-teal-300 px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
            >
              ⌨️ Input
            </button>
            <button
              onClick={() => handleAddNode("REQUEST_PHONE")}
              className="bg-slate-700/80 hover:bg-slate-600 text-cyan-300 px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
            >
              📱 Phone
            </button>
            <button
              onClick={() => handleAddNode("END")}
              className="bg-slate-700/80 hover:bg-slate-600 text-rose-300 px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
            >
              🏁 End
            </button>
          </div>
        )}

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {viewMode === "canvas" && (
            <>
              <button
                type="button"
                onClick={() => setShowSimulator(true)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-2.5 py-1.5 rounded-lg border border-white/10 transition-colors flex items-center gap-1"
                title="Preview and test flow in simulated Telegram chat"
              >
                📱 Simulate
              </button>

              <button
                type="button"
                onClick={() => setShowTemplates(true)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-2.5 py-1.5 rounded-lg border border-white/10 transition-colors flex items-center gap-1"
                title="Templates library"
              >
                📚 Templates
              </button>

              <button
                type="button"
                onClick={() => setShowCopy(true)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-2.5 py-1.5 rounded-lg border border-white/10 transition-colors flex items-center gap-1"
                title="Copy flow to another bot"
              >
                🔁 Copy to Bot
              </button>

              {flowData?.versions && flowData.versions.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowRollback(true)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-2 py-1.5 rounded-lg border border-white/10 transition-colors"
                  title="Roll back to a previous version"
                >
                  ⏪ Rollback
                </button>
              )}

              <button
                type="button"
                disabled={saving}
                onClick={handleSaveDraft}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                  hasUnsavedChanges
                    ? "bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30"
                    : "bg-slate-800 text-slate-300 border-white/10 hover:bg-slate-700"
                }`}
              >
                {saving ? "Saving..." : hasUnsavedChanges ? "💾 Save Draft *" : "Saved"}
              </button>

              <button
                type="button"
                disabled={publishing}
                onClick={handlePublish}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-xs px-3.5 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 shadow-md"
              >
                <span>🚀</span>
                <span>{publishing ? "Publishing..." : "Publish Live"}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Validation / Status Notice Bar */}
      {statusMsg && (
        <div
          className={`px-4 py-2.5 text-xs border-b flex items-center justify-between z-20 ${
            statusMsg.type === "success"
              ? "bg-emerald-950/80 border-emerald-500/30 text-emerald-300"
              : statusMsg.type === "error"
              ? "bg-rose-950/80 border-rose-500/30 text-rose-300"
              : "bg-sky-950/80 border-sky-500/30 text-sky-300"
          }`}
        >
          <div className="flex-1">
            <span className="font-semibold">{statusMsg.text}</span>
            {statusMsg.errors && statusMsg.errors.length > 0 && (
              <ul className="mt-1 list-disc pl-5 space-y-0.5 text-[11px]">
                {statusMsg.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            )}
          </div>
          <button
            onClick={() => setStatusMsg(null)}
            className="text-white/60 hover:text-white p-1 ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Body */}
      <div className="flex-1 relative flex overflow-hidden">
        {viewMode === "analytics" ? (
          <div className="flex-1 overflow-y-auto p-6">
            <FlowAnalyticsView
              botId={selectedBotId}
              botName={activeBot.name}
              flowVersion={flowData?.published?.version}
            />
          </div>
        ) : loading ? (
          <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
            Loading visual canvas...
          </div>
        ) : (
          <>
            {/* React Flow Canvas */}
            <div className="flex-1 h-full w-full relative">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={onNodeClick}
                onPaneClick={onPaneClick}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                minZoom={0.2}
                maxZoom={2}
                proOptions={{ hideAttribution: true }}
                className="bg-slate-950"
              >
                <Background color="#334155" gap={24} size={1.2} />
                <Controls
                  className="!bg-slate-900 !border-white/10 !rounded-xl !shadow-xl !fill-white"
                  showInteractive={false}
                />
                <MiniMap
                  className="!bg-slate-900 !border !border-white/10 !rounded-xl !shadow-xl"
                  nodeColor={(node) => {
                    const t = (node.data as any)?.nodeType;
                    if (t === "START") return "#10b981";
                    if (t === "TEXT") return "#3b82f6";
                    if (t === "IMAGE") return "#a855f7";
                    if (t === "VIDEO") return "#6366f1";
                    if (t === "BUTTON_MENU") return "#f59e0b";
                    if (t === "CONDITION") return "#8b5cf6";
                    if (t === "USER_INPUT") return "#14b8a6";
                    if (t === "REQUEST_PHONE") return "#06b6d4";
                    return "#f43f5e";
                  }}
                  maskColor="rgba(15, 23, 42, 0.7)"
                />
              </ReactFlow>

              {/* Mobile Quick Add Menu Overlay */}
              <div className="lg:hidden absolute bottom-4 left-4 z-10 flex flex-wrap gap-1 bg-slate-900/90 p-1.5 rounded-xl border border-white/10">
                <button
                  onClick={() => handleAddNode("TEXT")}
                  className="bg-slate-800 text-blue-300 text-xs px-2 py-1 rounded"
                >
                  +Text
                </button>
                <button
                  onClick={() => handleAddNode("IMAGE")}
                  className="bg-slate-800 text-purple-300 text-xs px-2 py-1 rounded"
                >
                  +Photo
                </button>
                <button
                  onClick={() => handleAddNode("BUTTON_MENU")}
                  className="bg-slate-800 text-amber-300 text-xs px-2 py-1 rounded"
                >
                  +Menu
                </button>
                <button
                  onClick={() => handleAddNode("USER_INPUT")}
                  className="bg-slate-800 text-teal-300 text-xs px-2 py-1 rounded"
                >
                  +Input
                </button>
              </div>
            </div>

            {/* Inspector Drawer */}
            {selectedNode && (
              <NodeInspector
                node={selectedNode}
                botId={selectedBotId}
                onUpdateNode={handleUpdateNode}
                onDuplicateNode={handleDuplicateNode}
                onDeleteNode={handleDeleteNode}
                onClose={() => setSelectedNodeId(null)}
              />
            )}
          </>
        )}
      </div>

      {/* Simulator Modal */}
      {showSimulator && (
        <FlowSimulator
          graph={currentFlowGraph}
          botName={activeBot.name}
          onClose={() => setShowSimulator(false)}
        />
      )}

      {/* Template Modal */}
      {showTemplates && (
        <FlowTemplateModal
          botId={selectedBotId}
          graph={currentFlowGraph}
          onApplyTemplate={handleApplyTemplate}
          onClose={() => setShowTemplates(false)}
        />
      )}

      {/* Copy Modal */}
      {showCopy && (
        <FlowCopyModal
          sourceBotId={selectedBotId}
          sourceBotName={activeBot.name}
          availableBots={bots}
          onClose={() => setShowCopy(false)}
        />
      )}

      {/* Rollback Modal */}
      {showRollback && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg p-5 shadow-2xl text-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="font-semibold text-white text-base">
                Rollback Flow Version
              </h3>
              <button
                onClick={() => setShowRollback(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Select a previous published version to restore as the active live flow:
            </p>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {(flowData?.versions || [])
                .filter((v) => v.version > 0)
                .map((v) => (
                  <label
                    key={v.id}
                    className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-colors ${
                      selectedRollbackVer === v.version
                        ? "bg-sky-950/40 border-sky-500 text-white"
                        : "bg-slate-800/40 border-white/10 text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="rollbackVersion"
                        checked={selectedRollbackVer === v.version}
                        onChange={() => setSelectedRollbackVer(v.version)}
                        className="text-sky-500 focus:ring-sky-500"
                      />
                      <div>
                        <span className="font-bold text-xs">Version v{v.version}</span>
                        <p className="text-[11px] text-slate-400">
                          {v.nodeCount ?? v.submenuCount + 1} steps • Published:{" "}
                          {v.publishedAt ? new Date(v.publishedAt).toLocaleString() : "N/A"}
                        </p>
                      </div>
                    </div>
                    {v.status === "PUBLISHED" && (
                      <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-semibold">
                        CURRENT LIVE
                      </span>
                    )}
                  </label>
                ))}
            </div>

            {/* Preserve draft check */}
            <div className="bg-slate-800/60 p-3 rounded-xl border border-white/10 space-y-1.5">
              <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={preserveDraftOnRollback}
                  onChange={(e) => setPreserveDraftOnRollback(e.target.checked)}
                  className="rounded border-slate-700 text-sky-500 focus:ring-sky-500"
                />
                <span className="font-semibold">Preserve working draft</span>
              </label>
              <p className="text-[11px] text-slate-400 pl-6">
                When checked, your current uncommitted draft changes will stay safe and will not be overwritten by the restored version.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowRollback(false)}
                className="px-3 py-1.5 text-xs text-slate-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={rollingBack || !selectedRollbackVer}
                onClick={handleRollback}
                className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-semibold text-xs px-4 py-1.5 rounded-lg transition-colors"
              >
                {rollingBack ? "Restoring..." : "Restore Version"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
