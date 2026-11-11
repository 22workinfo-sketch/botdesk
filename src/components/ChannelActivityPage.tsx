"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { SerializedActivityEvent } from "@/lib/activity-service";

export interface BotOption {
  id: string;
  name: string;
  username: string;
}

export interface ChannelOption {
  id: string;
  botId: string;
  name: string;
  telegramChatId: string;
}

export interface AuditLogItem {
  id: string;
  action: string;
  botName?: string | null;
  botUsername?: string | null;
  adminEmail?: string | null;
  createdAt: string;
  details?: any;
}

interface ChannelActivityPageProps {
  bots: BotOption[];
  channels: ChannelOption[];
  initialEvents: SerializedActivityEvent[];
  initialTotal: number;
  initialTotalPages: number;
  auditLogs: AuditLogItem[];
  userRole: string;
}

export function ChannelActivityPage({
  bots,
  channels,
  initialEvents,
  initialTotal,
  initialTotalPages,
  auditLogs,
  userRole,
}: ChannelActivityPageProps) {
  const [activeTab, setActiveTab] = useState<"activity" | "audit">("activity");

  // Filters
  const [selectedBotId, setSelectedBotId] = useState<string>("all");
  const [selectedChannelId, setSelectedChannelId] = useState<string>("all");
  const [selectedEventType, setSelectedEventType] = useState<string>("all");
  const [selectedDateRange, setSelectedDateRange] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [page, setPage] = useState<number>(1);

  // Data state
  const [events, setEvents] = useState<SerializedActivityEvent[]>(initialEvents);
  const [total, setTotal] = useState<number>(initialTotal);
  const [totalPages, setTotalPages] = useState<number>(initialTotalPages);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Channels filtered by selected bot
  const filteredChannels =
    selectedBotId === "all"
      ? channels
      : channels.filter((ch) => ch.botId === selectedBotId);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const params = new URLSearchParams({
        botId: selectedBotId,
        channelId: selectedChannelId,
        eventType: selectedEventType,
        dateRange: selectedDateRange,
        search: searchQuery.trim(),
        page: String(page),
        limit: "20",
      });

      const res = await fetch(`/api/activity?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Failed to load channel activity: HTTP ${res.status}`);
      }
      const data = await res.json();
      setEvents(data.events || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to load events");
    } finally {
      setLoading(false);
    }
  }, [
    selectedBotId,
    selectedChannelId,
    selectedEventType,
    selectedDateRange,
    searchQuery,
    page,
  ]);

  // Refetch when filters or page change
  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const handleResetFilters = () => {
    setSelectedBotId("all");
    setSelectedChannelId("all");
    setSelectedEventType("all");
    setSelectedDateRange("all");
    setSearchQuery("");
    setPage(1);
  };

  const getEventBadge = (evt: SerializedActivityEvent) => {
    switch (evt.eventType) {
      case "JOINED":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Joined Channel
          </span>
        );
      case "LEFT":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            Left / Removed
          </span>
        );
      case "MEMBERSHIP_CHECK": {
        const isJoined = evt.status === "joined";
        const isError = evt.status === "unable_to_verify";
        return (
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
              isJoined
                ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
                : isError
                ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                : "bg-slate-700 text-slate-300 border-slate-600"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isJoined ? "bg-blue-400" : isError ? "bg-amber-400" : "bg-slate-400"
              }`}
            />
            {isJoined
              ? "Verified Member"
              : isError
              ? "Unable to Verify"
              : "Not Joined"}
          </span>
        );
      }
      case "CHANNEL_SELECTED":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
            Channel Selected
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
            {evt.eventType}
          </span>
        );
    }
  };

  const getSourceLabel = (source: string) => {
    switch (source) {
      case "TELEGRAM_UPDATE":
        return "Telegram Live Update";
      case "FLOW_CHECK":
        return "Bot Flow Branch Check";
      case "MANUAL_CHECK":
        return "'Check Joined' Button";
      case "FLOW_SELECTION":
        return "Bot Flow Link Click";
      default:
        return source;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Navigation Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border)] pb-4">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)]">
            Channel Activity & Audit
          </h1>
          <p className="text-xs text-[var(--muted)]">
            Track user interactions, joins, leaves, and membership verifications across bot-managed channels.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center bg-[var(--surface)] p-1 rounded-lg border border-[var(--border)]">
          <button
            type="button"
            onClick={() => setActiveTab("activity")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              activeTab === "activity"
                ? "bg-[var(--accent)] text-white shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            📡 Channel Activity ({total})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("audit")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              activeTab === "audit"
                ? "bg-[var(--accent)] text-white shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            🛡️ Administrative Audit ({auditLogs.length})
          </button>
        </div>
      </div>

      {/* TAB 1: CHANNEL ACTIVITY */}
      {activeTab === "activity" && (
        <div className="space-y-5">
          {/* Filter Bar */}
          <div className="p-4 rounded-xl bg-[var(--card)] border border-[var(--border)] shadow-sm space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              {/* Bot Selector */}
              <div>
                <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                  Bot
                </label>
                <select
                  value={selectedBotId}
                  onChange={(e) => {
                    setSelectedBotId(e.target.value);
                    setSelectedChannelId("all");
                    setPage(1);
                  }}
                  className="botdesk-input text-xs w-full py-1.5"
                >
                  <option value="all">All Assigned Bots</option>
                  {bots.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} (@{b.username})
                    </option>
                  ))}
                </select>
              </div>

              {/* Channel Selector */}
              <div>
                <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                  Channel
                </label>
                <select
                  value={selectedChannelId}
                  onChange={(e) => {
                    setSelectedChannelId(e.target.value);
                    setPage(1);
                  }}
                  className="botdesk-input text-xs w-full py-1.5"
                >
                  <option value="all">All Channels</option>
                  {filteredChannels.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.name} ({ch.telegramChatId})
                    </option>
                  ))}
                </select>
              </div>

              {/* Event Type */}
              <div>
                <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                  Event Type
                </label>
                <select
                  value={selectedEventType}
                  onChange={(e) => {
                    setSelectedEventType(e.target.value);
                    setPage(1);
                  }}
                  className="botdesk-input text-xs w-full py-1.5"
                >
                  <option value="all">All Events</option>
                  <option value="JOINED">Joined Channel</option>
                  <option value="LEFT">Left / Removed</option>
                  <option value="MEMBERSHIP_CHECK">Membership Check</option>
                  <option value="CHANNEL_SELECTED">Channel Selected</option>
                </select>
              </div>

              {/* Date Range */}
              <div>
                <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                  Date Range
                </label>
                <select
                  value={selectedDateRange}
                  onChange={(e) => {
                    setSelectedDateRange(e.target.value);
                    setPage(1);
                  }}
                  className="botdesk-input text-xs w-full py-1.5"
                >
                  <option value="all">All Time</option>
                  <option value="today">Today</option>
                  <option value="7d">Last 7 Days</option>
                  <option value="30d">Last 30 Days</option>
                </select>
              </div>
            </div>

            {/* Search Input & Reset */}
            <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
              <div className="relative flex-1 w-full">
                <input
                  type="text"
                  placeholder="Search by username, user ID, name, or channel..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  className="botdesk-input text-xs w-full py-1.5 pl-8"
                />
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">
                  🔍
                </span>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-auto">
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="botdesk-btn text-xs py-1.5 px-3"
                  title="Reset all filters"
                >
                  Reset Filters
                </button>
                <button
                  type="button"
                  onClick={() => fetchEvents()}
                  disabled={loading}
                  className="botdesk-btn primary text-xs py-1.5 px-3 min-w-[70px]"
                >
                  {loading ? "..." : "Refresh"}
                </button>
              </div>
            </div>
          </div>

          {/* Error Notice */}
          {errorMessage && (
            <div className="p-3.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center justify-between">
              <span>{errorMessage}</span>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="text-rose-400 hover:text-white"
              >
                ✕
              </button>
            </div>
          )}

          {/* Informational Guidance Callout */}
          <div className="p-3.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--muted)] space-y-1">
            <div className="font-semibold text-[var(--text)] flex items-center gap-1.5">
              <span>ℹ️</span> Channel Activity Notes & Guidelines
            </div>
            <ul className="list-disc list-inside space-y-0.5 pl-1">
              <li>
                <strong>Admin Privileges Required:</strong> Telegram delivers join/leave updates only for channels where your bot is an Administrator with membership inspection permissions.
              </li>
              <li>
                <strong>Point-in-Time Observations:</strong> Membership check records reflect whether the user was a verified channel member at the exact time the check was executed.
              </li>
              <li>
                <strong>Privacy by Design:</strong> Personal phone numbers and private user messages are never displayed in this activity timeline.
              </li>
            </ul>
          </div>

          {/* Events Table / Timeline */}
          <div className="rounded-xl bg-[var(--card)] border border-[var(--border)] overflow-hidden shadow-sm">
            {loading && events.length === 0 ? (
              <div className="p-12 text-center text-sm text-[var(--muted)]">
                <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-indigo-500 border-t-transparent mb-2" />
                <p>Loading channel activity events...</p>
              </div>
            ) : events.length === 0 ? (
              <div className="p-12 text-center space-y-2">
                <span className="text-3xl block">📡</span>
                <h3 className="text-sm font-semibold text-[var(--text)]">
                  No channel activity events found
                </h3>
                <p className="text-xs text-[var(--muted)] max-w-sm mx-auto">
                  No events match the current filter criteria. As users interact with your bots and channels, live activity will appear here.
                </p>
                {(selectedBotId !== "all" ||
                  selectedChannelId !== "all" ||
                  selectedEventType !== "all" ||
                  selectedDateRange !== "all" ||
                  searchQuery) && (
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="botdesk-btn text-xs py-1 px-3 mt-2"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] uppercase font-mono tracking-wider text-[10px]">
                      <th className="py-2.5 px-3">Time</th>
                      <th className="py-2.5 px-3">Event</th>
                      <th className="py-2.5 px-3">User</th>
                      <th className="py-2.5 px-3">Channel</th>
                      <th className="py-2.5 px-3">Bot</th>
                      <th className="py-2.5 px-3">Source</th>
                      <th className="py-2.5 px-3">Actor / Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {events.map((evt) => (
                      <tr
                        key={evt.id}
                        className="hover:bg-[var(--surface)]/50 transition-colors"
                      >
                        {/* Time */}
                        <td className="py-3 px-3 whitespace-nowrap text-[var(--muted)] font-mono">
                          {new Date(evt.createdAt).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </td>

                        {/* Event */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          {getEventBadge(evt)}
                        </td>

                        {/* User */}
                        <td className="py-3 px-3">
                          <div className="font-semibold text-[var(--text)] truncate max-w-[160px]">
                            {evt.userDisplayName}
                          </div>
                          <div className="text-[11px] text-[var(--muted)] font-mono">
                            ID: {evt.telegramUserId}
                          </div>
                        </td>

                        {/* Channel */}
                        <td className="py-3 px-3">
                          <div className="font-medium text-[var(--text)] truncate max-w-[160px]">
                            {evt.channelTitle || evt.channelName || "Channel"}
                          </div>
                          <div className="text-[11px] text-[var(--muted)] font-mono truncate max-w-[160px]">
                            {evt.telegramChatId}
                          </div>
                        </td>

                        {/* Bot */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span className="text-[var(--text)] font-medium">
                            {evt.botName}
                          </span>
                          <span className="block text-[11px] text-[var(--muted)] font-mono">
                            @{evt.botUsername}
                          </span>
                        </td>

                        {/* Source */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded text-[10px] bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] font-mono">
                            {getSourceLabel(evt.source)}
                          </span>
                        </td>

                        {/* Actor / Details */}
                        <td className="py-3 px-3 text-[var(--muted)] max-w-[200px] truncate">
                          {evt.isActorDifferent ? (
                            <span className="text-amber-400 font-medium">
                              By @{evt.actorUsername || `Actor ${evt.actorUserId}`}
                            </span>
                          ) : evt.details?.viaInviteLink ? (
                            <span className="text-blue-400">Via invite link</span>
                          ) : evt.status ? (
                            <span className="font-mono text-[11px]">
                              Status: {evt.status}
                            </span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="p-3 border-t border-[var(--border)] bg-[var(--surface)]/30 flex items-center justify-between text-xs">
                <span className="text-[var(--muted)]">
                  Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} of {total} events
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1 || loading}
                    className="botdesk-btn text-xs py-1 px-2.5 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="px-2 font-mono text-[var(--text)]">
                    {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages || loading}
                    className="botdesk-btn text-xs py-1 px-2.5 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: SYSTEM AUDIT LOG */}
      {activeTab === "audit" && (
        <div className="space-y-4">
          <div className="p-3.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--muted)]">
            <strong>System Audit Log:</strong> Immutable audit trail of administrative actions, staff logins, post broadcasts, and configuration updates.
          </div>

          <div className="rounded-xl bg-[var(--card)] border border-[var(--border)] overflow-hidden shadow-sm">
            {auditLogs.length === 0 ? (
              <div className="p-10 text-center text-xs text-[var(--muted)]">
                No administrative audit logs found.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] uppercase font-mono tracking-wider text-[10px]">
                      <th className="py-2.5 px-3">Time</th>
                      <th className="py-2.5 px-3">Action</th>
                      <th className="py-2.5 px-3">Admin</th>
                      <th className="py-2.5 px-3">Bot</th>
                      <th className="py-2.5 px-3">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {auditLogs.map((log) => (
                      <tr
                        key={log.id}
                        className="hover:bg-[var(--surface)]/50 transition-colors"
                      >
                        <td className="py-3 px-3 whitespace-nowrap text-[var(--muted)] font-mono">
                          {new Date(log.createdAt).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="py-3 px-3 font-semibold text-[var(--text)] whitespace-nowrap">
                          {log.action}
                        </td>
                        <td className="py-3 px-3 text-[var(--muted)] whitespace-nowrap">
                          {log.adminEmail || "System"}
                        </td>
                        <td className="py-3 px-3 text-[var(--muted)] whitespace-nowrap">
                          {log.botName ? `${log.botName} (@${log.botUsername})` : "Global"}
                        </td>
                        <td className="py-3 px-3 text-[var(--muted)] font-mono text-[11px] max-w-[240px] truncate">
                          {log.details ? JSON.stringify(log.details) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
