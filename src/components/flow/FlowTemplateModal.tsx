"use client";

import React, { useState, useEffect } from "react";
import { FlowGraph, FlowTemplateSummary } from "@/lib/flow/types";

interface FlowTemplateModalProps {
  botId: string;
  graph: FlowGraph;
  onApplyTemplate: (templateId: string) => Promise<void>;
  onClose: () => void;
}

export function FlowTemplateModal({
  botId,
  graph,
  onApplyTemplate,
  onClose,
}: FlowTemplateModalProps) {
  const [tab, setTab] = useState<"browse" | "save">("browse");
  const [templates, setTemplates] = useState<FlowTemplateSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState<string>("ALL");
  const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Save Form State
  const [saveName, setSaveName] = useState("");
  const [saveDesc, setSaveDesc] = useState("");
  const [saveCategory, setSaveCategory] = useState("GENERAL");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchTemplates();
  }, [category]);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const url =
        category !== "ALL"
          ? `/api/bots/${botId}/flow/templates?category=${category}`
          : `/api/bots/${botId}/flow/templates`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.success && Array.isArray(data.templates)) {
        setTemplates(data.templates);
      }
    } catch {
      setStatus({ type: "error", text: "Failed to load flow templates." });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAsTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!saveName.trim()) return;

    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/bots/${botId}/flow/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: saveName.trim(),
          description: saveDesc.trim() || undefined,
          category: saveCategory,
          structure: graph,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save template.");
      }

      setStatus({ type: "success", text: "Template saved successfully!" });
      setSaveName("");
      setSaveDesc("");
      setTab("browse");
      fetchTemplates();
    } catch (err: any) {
      setStatus({ type: "error", text: err.message || "Failed to save template." });
    } finally {
      setSaving(false);
    }
  };

  const handleApply = async (templateId: string) => {
    if (
      !confirm(
        "Applying this template will load its nodes and edges into your current working draft. Your live published flow will remain untouched. Continue?"
      )
    ) {
      return;
    }

    try {
      await onApplyTemplate(templateId);
      onClose();
    } catch (err: any) {
      setStatus({ type: "error", text: err.message || "Failed to apply template." });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-xl max-h-[620px] flex flex-col shadow-2xl overflow-hidden text-slate-200">
        {/* Header */}
        <div className="bg-slate-800/90 px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">📚</span>
            <h3 className="font-semibold text-white text-sm">Flow Templates Library</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded">
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10 px-5 pt-2 bg-slate-900/60">
          <button
            onClick={() => setTab("browse")}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-colors ${
              tab === "browse"
                ? "border-sky-400 text-sky-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            Browse Templates
          </button>
          <button
            onClick={() => setTab("save")}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-colors ${
              tab === "save"
                ? "border-sky-400 text-sky-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            + Save Current Flow as Template
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

          {tab === "browse" ? (
            <div className="space-y-3">
              {/* Filter */}
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-400">Category:</span>
                {["ALL", "GENERAL", "ONBOARDING", "SUPPORT", "CUSTOM"].map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setCategory(cat)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      category === cat
                        ? "bg-sky-500 text-white"
                        : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {loading ? (
                <p className="text-xs text-slate-400 py-6 text-center">Loading templates...</p>
              ) : templates.length === 0 ? (
                <div className="text-center py-10 bg-slate-800/30 rounded-xl border border-white/5 space-y-2">
                  <span className="text-3xl">📭</span>
                  <p className="text-xs text-slate-400">No flow templates found in this category.</p>
                  <button
                    onClick={() => setTab("save")}
                    className="text-xs text-sky-400 hover:underline"
                  >
                    Save your current flow as the first template!
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2.5">
                  {templates.map((tpl) => (
                    <div
                      key={tpl.id}
                      className="bg-slate-800/60 hover:bg-slate-800 border border-white/10 rounded-xl p-3.5 flex items-center justify-between gap-3 transition-colors"
                    >
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold text-xs text-white">{tpl.name}</h4>
                          <span className="text-[10px] bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full border border-white/5">
                            {tpl.category}
                          </span>
                        </div>
                        {tpl.description && (
                          <p className="text-[11px] text-slate-400 line-clamp-2">
                            {tpl.description}
                          </p>
                        )}
                        <p className="text-[10px] text-slate-500">
                          {tpl.nodeCount} node(s) • Created:{" "}
                          {new Date(tpl.createdAt).toLocaleDateString()}
                        </p>
                      </div>

                      <button
                        onClick={() => handleApply(tpl.id)}
                        className="bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                      >
                        Load to Draft
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleSaveAsTemplate} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Template Name *
                </label>
                <input
                  type="text"
                  required
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="e.g. VIP Member Onboarding Flow"
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Category
                </label>
                <select
                  value={saveCategory}
                  onChange={(e) => setSaveCategory(e.target.value)}
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                >
                  <option value="GENERAL">General</option>
                  <option value="ONBOARDING">Onboarding</option>
                  <option value="SUPPORT">Customer Support</option>
                  <option value="CUSTOM">Custom</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Description (Optional)
                </label>
                <textarea
                  rows={3}
                  value={saveDesc}
                  onChange={(e) => setSaveDesc(e.target.value)}
                  placeholder="Briefly describe what this flow does..."
                  className="w-full bg-slate-800 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="bg-sky-950/30 border border-sky-500/20 p-3 rounded-xl text-[11px] text-sky-300">
                ℹ️ This will package the currently displayed nodes, edges and settings ({graph.nodes.length} nodes). Tokens, staff permissions, user states, and real phone numbers are never stored in templates.
              </div>

              <button
                type="submit"
                disabled={saving || !saveName.trim()}
                className="w-full bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white font-semibold text-xs py-2 rounded-lg transition-colors"
              >
                {saving ? "Saving Template..." : "Save Template"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
