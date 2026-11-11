"use client";

import React, { useState, useEffect } from "react";
import { FlowAnalyticsSummary } from "@/lib/flow/types";

interface FlowAnalyticsViewProps {
  botId: string;
  botName: string;
  flowVersion?: number;
}

export function FlowAnalyticsView({
  botId,
  botName,
  flowVersion,
}: FlowAnalyticsViewProps) {
  const [data, setData] = useState<FlowAnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<"24h" | "7d" | "30d" | "all">("7d");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAnalytics();
  }, [botId, flowVersion, dateRange]);

  const fetchAnalytics = async () => {
    setLoading(true);
    setError(null);
    try {
      let url = `/api/bots/${botId}/flow/analytics?range=${dateRange}`;
      if (flowVersion) {
        url += `&version=${flowVersion}`;
      }
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Failed to load flow analytics.");
      }
      setData(json.analytics);
    } catch (err: any) {
      setError(err.message || "Failed to fetch analytics.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 text-slate-200">
      {/* Top Header & Range Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-800/40 p-4 rounded-2xl border border-white/10">
        <div>
          <h3 className="font-bold text-base text-white">
            Flow Performance & Funnel ({botName})
          </h3>
          <p className="text-xs text-slate-400">
            Real-time analytics for Flow Version v{data?.flowVersion ?? flowVersion ?? 1}
          </p>
        </div>

        <div className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-xl border border-white/10 text-xs">
          {(["24h", "7d", "30d", "all"] as const).map((range) => (
            <button
              key={range}
              onClick={() => setDateRange(range)}
              className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                dateRange === range
                  ? "bg-sky-500 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {range === "24h"
                ? "Last 24h"
                : range === "7d"
                ? "7 Days"
                : range === "30d"
                ? "30 Days"
                : "All Time"}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-rose-950/40 border border-rose-500/40 p-3 rounded-xl text-xs text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-xs text-slate-400">
          Loading flow analytics...
        </div>
      ) : !data ? (
        <div className="py-12 text-center text-xs text-slate-400">
          No analytics data available yet.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-slate-800/50 border border-white/10 p-4 rounded-2xl">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Total Started
              </span>
              <span className="text-2xl font-bold text-white mt-1 block">
                {data.totalStarted}
              </span>
              <span className="text-[10px] text-slate-500">Flow starts recorded</span>
            </div>

            <div className="bg-slate-800/50 border border-white/10 p-4 rounded-2xl">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Unique Users
              </span>
              <span className="text-2xl font-bold text-sky-400 mt-1 block">
                {data.uniqueUsers}
              </span>
              <span className="text-[10px] text-slate-500">Distinct Telegram accounts</span>
            </div>

            <div className="bg-slate-800/50 border border-white/10 p-4 rounded-2xl">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Completed
              </span>
              <span className="text-2xl font-bold text-emerald-400 mt-1 block">
                {data.completedCount}
              </span>
              <span className="text-[10px] text-slate-500">Reached end node</span>
            </div>

            <div className="bg-slate-800/50 border border-white/10 p-4 rounded-2xl">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Completion Rate
              </span>
              <span className="text-2xl font-bold text-amber-400 mt-1 block">
                {data.completionRate}%
              </span>
              <span className="text-[10px] text-slate-500">Completed vs Started</span>
            </div>
          </div>

          {/* Node Visits & Funnel Table */}
          <div className="bg-slate-800/40 border border-white/10 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <h4 className="font-semibold text-sm text-white">
                  Step-by-Step Node Visits & Drop-Off
                </h4>
                <p className="text-[11px] text-slate-400">
                  Drop-off represents users whose last recorded activity was at this node and who have been inactive for &gt;24 hours.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-900/60 text-[10px] uppercase font-bold text-slate-400 tracking-wider border-b border-white/5">
                  <tr>
                    <th className="py-3 px-4">Node / Step</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4 text-right">Total Visits</th>
                    <th className="py-3 px-4 text-right">Unique Users</th>
                    <th className="py-3 px-4 text-right">Drop-Offs (&gt;24h)</th>
                    <th className="py-3 px-4 text-right">Drop-Off Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {data.nodeVisits.map((item) => (
                    <tr key={item.nodeId} className="hover:bg-white/[0.02]">
                      <td className="py-3 px-4 font-medium text-white flex items-center gap-2">
                        <span>{item.nodeTitle || item.nodeId}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-[10px] border border-white/10">
                          {item.nodeType}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-200">
                        {item.visitCount}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-sky-300">
                        {item.uniqueUsers}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-amber-400">
                        {item.dropOffCount}
                      </td>
                      <td className="py-3 px-4 text-right font-mono">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[11px] ${
                            item.dropOffRate > 50
                              ? "bg-rose-500/20 text-rose-300"
                              : "bg-slate-800 text-slate-300"
                          }`}
                        >
                          {item.dropOffRate}%
                        </span>
                      </td>
                    </tr>
                  ))}
                  {data.nodeVisits.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-slate-500">
                        No node visit events recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Button Interactions & Variable Submissions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Button Taps */}
            <div className="bg-slate-800/40 border border-white/10 rounded-2xl p-4 space-y-3">
              <h4 className="font-semibold text-xs text-white uppercase tracking-wider">
                Button Taps
              </h4>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {data.buttonClicks.map((b, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between text-xs bg-slate-900/60 px-3 py-2 rounded-xl border border-white/5"
                  >
                    <span className="font-medium text-slate-200 truncate pr-2">
                      {b.actionLabel}
                    </span>
                    <span className="font-mono text-sky-400 font-bold">
                      {b.clickCount} taps
                    </span>
                  </div>
                ))}
                {data.buttonClicks.length === 0 && (
                  <p className="text-[11px] text-slate-500 py-3 text-center">
                    No button clicks recorded.
                  </p>
                )}
              </div>
            </div>

            {/* Input Variables */}
            <div className="bg-slate-800/40 border border-white/10 rounded-2xl p-4 space-y-3">
              <h4 className="font-semibold text-xs text-white uppercase tracking-wider">
                User Input Submissions
              </h4>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {data.inputSubmissions.map((inp, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between text-xs bg-slate-900/60 px-3 py-2 rounded-xl border border-white/5"
                  >
                    <span className="font-mono text-teal-300 truncate pr-2">
                      ${inp.variableName}
                    </span>
                    <span className="font-mono text-teal-400 font-bold">
                      {inp.submissionCount} submissions
                    </span>
                  </div>
                ))}
                {data.inputSubmissions.length === 0 && (
                  <p className="text-[11px] text-slate-500 py-3 text-center">
                    No input submissions recorded.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Privacy & Retention Notice */}
          <div className="bg-sky-950/20 border border-sky-500/20 p-3.5 rounded-2xl text-[11px] text-sky-300 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>🔒</span>
              <span>
                <strong>Privacy Guaranteed:</strong> Raw user inputs, telephone numbers, and passwords are never tracked or stored in flow analytics logs. Events are strictly deduplicated by Telegram update ID.
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
