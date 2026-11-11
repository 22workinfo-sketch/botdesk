"use client";

import { useState, useEffect, useCallback } from "react";

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

export interface CampaignItem {
  id: string;
  botId: string;
  botName: string;
  botUsername: string;
  name: string;
  slug: string;
  description: string | null;
  deepLink: string;
  targetChannelId: string | null;
  targetChannelName: string | null;
  clicksCount: number;
  uniqueStartsCount: number;
  totalTouches: number;
  isActive: boolean;
  createdAt: string;
}

export interface AudienceProfile {
  id: string;
  botId: string;
  botName: string;
  botUsername: string;
  telegramId: string;
  displayName: string;
  username: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  marketingConsent: string;
  marketingConsentAt: string | null;
  marketingConsentSource: string | null;
  firstCampaignSource: string | null;
  lastCampaignSource: string | null;
  associatedChannels: Array<{
    channelId: string | null;
    channelName: string;
    latestStatus: string;
    lastObservedAt: string;
  }>;
}

export interface MarketingMetrics {
  newBotUsers: number;
  observedJoins: number;
  observedLeaves: number;
  netObservedJoins: number;
  uniqueChannelSelectors: number;
  uniqueMembershipConfirmed: number;
  marketingConsent: {
    optedIn: number;
    optedOut: number;
    unspecified: number;
  };
  trackingStartDate: string | null;
  growthTrend: Array<{ date: string; joins: number; leaves: number }>;
  dataCompletenessNote: string;
}

interface MarketingDashboardProps {
  bots: BotOption[];
  channels: ChannelOption[];
  initialMetrics: MarketingMetrics;
  initialAudience: AudienceProfile[];
  initialAudienceTotal: number;
  initialAudiencePages: number;
  initialCampaigns: CampaignItem[];
  userRole: string;
}

export function MarketingDashboard({
  bots,
  channels,
  initialMetrics,
  initialAudience,
  initialAudienceTotal,
  initialAudiencePages,
  initialCampaigns,
  userRole,
}: MarketingDashboardProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "audience" | "campaigns">("overview");

  // Global Filters
  const [selectedBotId, setSelectedBotId] = useState<string>("all");
  const [selectedChannelId, setSelectedChannelId] = useState<string>("all");
  const [selectedDateRange, setSelectedDateRange] = useState<"all" | "today" | "7d" | "30d">("all");

  // Metrics State
  const [metrics, setMetrics] = useState<MarketingMetrics>(initialMetrics);
  const [loadingMetrics, setLoadingMetrics] = useState<boolean>(false);

  // Audience State & Filters
  const [audience, setAudience] = useState<AudienceProfile[]>(initialAudience);
  const [audienceTotal, setAudienceTotal] = useState<number>(initialAudienceTotal);
  const [audiencePages, setAudiencePages] = useState<number>(initialAudiencePages);
  const [audiencePage, setAudiencePage] = useState<number>(1);
  const [audienceSearch, setAudienceSearch] = useState<string>("");
  const [audienceConsent, setAudienceConsent] = useState<string>("all");
  const [audienceCampaign, setAudienceCampaign] = useState<string>("all");
  const [loadingAudience, setLoadingAudience] = useState<boolean>(false);

  // Campaigns State
  const [campaigns, setCampaigns] = useState<CampaignItem[]>(initialCampaigns);
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [newCampBotId, setNewCampBotId] = useState<string>(bots[0]?.id || "");
  const [newCampName, setNewCampName] = useState<string>("");
  const [newCampSlug, setNewCampSlug] = useState<string>("");
  const [newCampDesc, setNewCampDesc] = useState<string>("");
  const [newCampChannelId, setNewCampChannelId] = useState<string>("");
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [campaignSuccess, setCampaignSuccess] = useState<string | null>(null);
  const [creatingCampaign, setCreatingCampaign] = useState<boolean>(false);

  // Filter channels based on selected bot
  const filteredChannels =
    selectedBotId === "all"
      ? channels
      : channels.filter((ch) => ch.botId === selectedBotId);

  // 1. Fetch Metrics
  const fetchMetrics = useCallback(async () => {
    setLoadingMetrics(true);
    try {
      const params = new URLSearchParams({
        botId: selectedBotId,
        channelId: selectedChannelId,
        dateRange: selectedDateRange,
      });
      const res = await fetch(`/api/marketing/metrics?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setMetrics(data);
      }
    } catch (err) {
      console.error("Failed to load marketing metrics", err);
    } finally {
      setLoadingMetrics(false);
    }
  }, [selectedBotId, selectedChannelId, selectedDateRange]);

  // 2. Fetch Audience
  const fetchAudience = useCallback(async () => {
    setLoadingAudience(true);
    try {
      const params = new URLSearchParams({
        botId: selectedBotId,
        channelId: selectedChannelId,
        dateRange: selectedDateRange,
        consentStatus: audienceConsent,
        campaignSource: audienceCampaign,
        search: audienceSearch.trim(),
        page: String(audiencePage),
        limit: "20",
      });
      const res = await fetch(`/api/marketing/audience?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setAudience(data.audience || []);
        setAudienceTotal(data.total || 0);
        setAudiencePages(data.totalPages || 1);
      }
    } catch (err) {
      console.error("Failed to load audience", err);
    } finally {
      setLoadingAudience(false);
    }
  }, [
    selectedBotId,
    selectedChannelId,
    selectedDateRange,
    audienceConsent,
    audienceCampaign,
    audienceSearch,
    audiencePage,
  ]);

  // 3. Fetch Campaigns
  const fetchCampaigns = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        botId: selectedBotId,
      });
      const res = await fetch(`/api/marketing/campaigns?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setCampaigns(data.campaigns || []);
      }
    } catch (err) {
      console.error("Failed to load campaigns", err);
    }
  }, [selectedBotId]);

  useEffect(() => {
    if (activeTab === "overview") {
      fetchMetrics();
    } else if (activeTab === "audience") {
      fetchAudience();
    } else if (activeTab === "campaigns") {
      fetchCampaigns();
    }
  }, [activeTab, fetchMetrics, fetchAudience, fetchCampaigns]);

  // Handle Create Campaign
  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    setCampaignError(null);
    setCampaignSuccess(null);
    setCreatingCampaign(true);

    try {
      const res = await fetch("/api/marketing/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botId: newCampBotId,
          name: newCampName,
          slug: newCampSlug,
          description: newCampDesc || undefined,
          targetChannelId: newCampChannelId || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create campaign.");
      }

      setCampaignSuccess(`Campaign "${data.campaign.name}" created successfully!`);
      setShowCreateModal(false);
      setNewCampName("");
      setNewCampSlug("");
      setNewCampDesc("");
      fetchCampaigns();
    } catch (err: any) {
      setCampaignError(err.message || "Failed to create campaign.");
    } finally {
      setCreatingCampaign(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("Campaign link copied to clipboard!");
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Tab Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border)] pb-4">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)]">
            Marketing Intelligence & Audience Segmentation
          </h1>
          <p className="text-xs text-[var(--muted)]">
            Measure bot and channel growth, analyze permission-based audience segments, and track campaign acquisition links.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center bg-[var(--surface)] p-1 rounded-lg border border-[var(--border)]">
          <button
            type="button"
            onClick={() => setActiveTab("overview")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              activeTab === "overview"
                ? "bg-[var(--accent)] text-white shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            📊 Growth & Metrics
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("audience")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              activeTab === "audience"
                ? "bg-[var(--accent)] text-white shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            👥 Audience Profiles ({audienceTotal})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("campaigns")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              activeTab === "campaigns"
                ? "bg-[var(--accent)] text-white shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            🔗 Campaign Links ({campaigns.length})
          </button>
        </div>
      </div>

      {/* Global Filter Bar */}
      <div className="p-4 rounded-xl bg-[var(--card)] border border-[var(--border)] shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Bot Selector */}
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">
              Select Bot
            </label>
            <select
              value={selectedBotId}
              onChange={(e) => {
                setSelectedBotId(e.target.value);
                setSelectedChannelId("all");
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
              Channel Filter
            </label>
            <select
              value={selectedChannelId}
              onChange={(e) => setSelectedChannelId(e.target.value)}
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

          {/* Date Range Selector */}
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">
              Date Range
            </label>
            <select
              value={selectedDateRange}
              onChange={(e) => setSelectedDateRange(e.target.value as any)}
              className="botdesk-input text-xs w-full py-1.5"
            >
              <option value="all">All Time (Since Tracking Inception)</option>
              <option value="today">Today</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* TAB 1: OVERVIEW METRICS & GROWTH TRENDS                  */}
      {/* ======================================================== */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Tracking Inception Notice */}
          <div className="p-3.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--muted)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-base">📅</span>
              <span>
                <strong>Tracking Inception:</strong>{" "}
                {metrics.trackingStartDate
                  ? `Activity observation active since ${new Date(
                      metrics.trackingStartDate
                    ).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}`
                  : "No events recorded yet."}
              </span>
            </div>
            <span className="text-[11px] text-[var(--muted)] italic">
              {metrics.dataCompletenessNote}
            </span>
          </div>

          {/* KPI Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* New Bot Users */}
            <div className="p-4 rounded-xl bg-[var(--card)] border border-[var(--border)] shadow-sm space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--muted)]">
                  New Bot Users
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-blue-500/10 text-blue-400">
                  Bot
                </span>
              </div>
              <div className="text-2xl font-bold text-[var(--text)]">
                {metrics.newBotUsers.toLocaleString()}
              </div>
              <p className="text-[11px] text-[var(--muted)] leading-tight">
                First-time users who initiated contact with your bot in this period.
              </p>
            </div>

            {/* Observed Channel Joins */}
            <div className="p-4 rounded-xl bg-[var(--card)] border border-[var(--border)] shadow-sm space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--muted)]">
                  Observed Joins
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400">
                  Channel
                </span>
              </div>
              <div className="text-2xl font-bold text-emerald-400">
                +{metrics.observedJoins.toLocaleString()}
              </div>
              <p className="text-[11px] text-[var(--muted)] leading-tight">
                Users observed joining managed channels via live Telegram updates.
              </p>
            </div>

            {/* Observed Channel Leaves */}
            <div className="p-4 rounded-xl bg-[var(--card)] border border-[var(--border)] shadow-sm space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--muted)]">
                  Observed Leaves / Removed
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-rose-500/10 text-rose-400">
                  Channel
                </span>
              </div>
              <div className="text-2xl font-bold text-rose-400">
                -{metrics.observedLeaves.toLocaleString()}
              </div>
              <p className="text-[11px] text-[var(--muted)] leading-tight">
                Users observed leaving or removed/banned by administrators.
              </p>
            </div>

            {/* Net Observed Joins */}
            <div className="p-4 rounded-xl bg-[var(--card)] border border-[var(--border)] shadow-sm space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--muted)]">
                  Net Observed Joins
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400">
                  Net Delta
                </span>
              </div>
              <div
                className={`text-2xl font-bold ${
                  metrics.netObservedJoins >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {metrics.netObservedJoins >= 0 ? "+" : ""}
                {metrics.netObservedJoins.toLocaleString()}
              </div>
              <p className="text-[11px] text-[var(--muted)] leading-tight">
                Observed Joins minus Leaves. Represents event delta, not total subscriber count.
              </p>
            </div>

            {/* Channel Link Selectors */}
            <div className="p-4 rounded-xl bg-[var(--card)] border border-[var(--border)] shadow-sm space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--muted)]">
                  Unique Channel Selectors
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-purple-500/10 text-purple-400">
                  Intent
                </span>
              </div>
              <div className="text-2xl font-bold text-purple-400">
                {metrics.uniqueChannelSelectors.toLocaleString()}
              </div>
              <p className="text-[11px] text-[var(--muted)] leading-tight">
                Distinct users who tapped an official channel join button in your bot.
              </p>
            </div>

            {/* Verified Channel Members */}
            <div className="p-4 rounded-xl bg-[var(--card)] border border-[var(--border)] shadow-sm space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--muted)]">
                  Confirmed Members
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-blue-500/10 text-blue-400">
                  Verified
                </span>
              </div>
              <div className="text-2xl font-bold text-blue-400">
                {metrics.uniqueMembershipConfirmed.toLocaleString()}
              </div>
              <p className="text-[11px] text-[var(--muted)] leading-tight">
                Distinct users whose membership was actively verified by bot check.
              </p>
            </div>
          </div>

          {/* Marketing Consent Breakdown */}
          <div className="p-5 rounded-xl bg-[var(--card)] border border-[var(--border)] shadow-sm space-y-4">
            <div>
              <h3 className="text-sm font-bold text-[var(--text)]">
                Marketing Consent & Eligibility Distribution
              </h3>
              <p className="text-xs text-[var(--muted)]">
                In strict compliance with privacy standards, only explicit opt-ins are marked eligible.
                Starting the bot or joining a channel does NOT constitute marketing consent.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-1">
                <div className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  Explicitly Opted In
                </div>
                <div className="text-xl font-bold text-[var(--text)]">
                  {metrics.marketingConsent.optedIn.toLocaleString()}
                </div>
                <span className="text-[10px] text-[var(--muted)]">
                  Eligible for future broadcasts via /optin
                </span>
              </div>

              <div className="p-3.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-1">
                <div className="text-xs font-semibold text-rose-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-400" />
                  Opted Out / Revoked
                </div>
                <div className="text-xl font-bold text-[var(--text)]">
                  {metrics.marketingConsent.optedOut.toLocaleString()}
                </div>
                <span className="text-[10px] text-[var(--muted)]">
                  Excluded from all marketing via /optout
                </span>
              </div>

              <div className="p-3.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-1">
                <div className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-slate-400" />
                  Unspecified (No Consent)
                </div>
                <div className="text-xl font-bold text-[var(--text)]">
                  {metrics.marketingConsent.unspecified.toLocaleString()}
                </div>
                <span className="text-[10px] text-[var(--muted)]">
                  Protected: Excluded from broadcasts until explicit opt-in
                </span>
              </div>
            </div>
          </div>

          {/* Growth Trend Timeline */}
          <div className="p-5 rounded-xl bg-[var(--card)] border border-[var(--border)] shadow-sm space-y-4">
            <div>
              <h3 className="text-sm font-bold text-[var(--text)]">
                Observed Channel Growth Timeline
              </h3>
              <p className="text-xs text-[var(--muted)]">
                Daily timeline of observed channel joins versus departures.
              </p>
            </div>

            {metrics.growthTrend.length === 0 ? (
              <div className="p-8 text-center text-xs text-[var(--muted)]">
                No join/leave activity recorded in this period.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[500px] flex items-end gap-2 h-44 pt-6 border-b border-[var(--border)] pb-2 px-2">
                  {metrics.growthTrend.map((t) => {
                    const maxHeight = 100;
                    const maxVal = Math.max(
                      1,
                      ...metrics.growthTrend.map((x) => Math.max(x.joins, x.leaves))
                    );
                    const joinH = Math.round((t.joins / maxVal) * maxHeight);
                    const leaveH = Math.round((t.leaves / maxVal) * maxHeight);

                    return (
                      <div
                        key={t.date}
                        className="flex-1 flex flex-col items-center gap-1 h-full justify-end group"
                      >
                        <div className="text-[10px] font-mono text-[var(--muted)] opacity-0 group-hover:opacity-100 transition-opacity">
                          +{t.joins}/-{t.leaves}
                        </div>
                        <div className="w-full flex items-end justify-center gap-0.5">
                          {/* Joins Bar */}
                          <div
                            style={{ height: `${Math.max(4, joinH)}px` }}
                            className="w-1/2 bg-emerald-500/80 rounded-t-sm"
                            title={`${t.date}: +${t.joins} joins`}
                          />
                          {/* Leaves Bar */}
                          <div
                            style={{ height: `${Math.max(4, leaveH)}px` }}
                            className="w-1/2 bg-rose-500/80 rounded-t-sm"
                            title={`${t.date}: -${t.leaves} leaves`}
                          />
                        </div>
                        <span className="text-[10px] text-[var(--muted)] font-mono whitespace-nowrap mt-1">
                          {t.date.slice(5)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-center gap-6 pt-3 text-xs text-[var(--muted)]">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-sm bg-emerald-500/80" />
                    <span>Observed Joins</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-sm bg-rose-500/80" />
                    <span>Observed Leaves</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 2: AUDIENCE PROFILES & SEGMENTS                      */}
      {/* ======================================================== */}
      {activeTab === "audience" && (
        <div className="space-y-4">
          {/* Audience Filter Bar */}
          <div className="p-4 rounded-xl bg-[var(--card)] border border-[var(--border)] shadow-sm space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              {/* Marketing Consent Filter */}
              <div>
                <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                  Consent Status
                </label>
                <select
                  value={audienceConsent}
                  onChange={(e) => {
                    setAudienceConsent(e.target.value);
                    setAudiencePage(1);
                  }}
                  className="botdesk-input text-xs w-full py-1.5"
                >
                  <option value="all">All Consent Types</option>
                  <option value="OPTED_IN">🟢 Explicitly Opted In</option>
                  <option value="OPTED_OUT">🔴 Opted Out / Revoked</option>
                  <option value="UNSPECIFIED">⚪ Unspecified (No Consent)</option>
                </select>
              </div>

              {/* Campaign Source Filter */}
              <div>
                <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                  Campaign Source
                </label>
                <select
                  value={audienceCampaign}
                  onChange={(e) => {
                    setAudienceCampaign(e.target.value);
                    setAudiencePage(1);
                  }}
                  className="botdesk-input text-xs w-full py-1.5"
                >
                  <option value="all">All Campaign Sources</option>
                  {campaigns.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.name} ({c.slug})
                    </option>
                  ))}
                </select>
              </div>

              {/* Search */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                  Search Audience
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search by name, @username, or Telegram ID..."
                    value={audienceSearch}
                    onChange={(e) => {
                      setAudienceSearch(e.target.value);
                      setAudiencePage(1);
                    }}
                    className="botdesk-input text-xs w-full py-1.5 pl-8"
                  />
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">
                    🔍
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Privacy & Methodology Callout */}
          <div className="p-3.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--muted)] space-y-1">
            <div className="font-semibold text-[var(--text)] flex items-center gap-1.5">
              <span>🛡️</span> Audience Integrity & Privacy Protections
            </div>
            <ul className="list-disc list-inside space-y-0.5 pl-1">
              <li>
                <strong>Unique User Integrity:</strong> Each Telegram user is represented as <strong>1 unique profile</strong> regardless of how many channels they interact with.
              </li>
              <li>
                <strong>Point-in-Time Observations:</strong> Channel badges indicate the <em>last observed state</em> and timestamp. They are not guaranteed real-time unless re-verified.
              </li>
              <li>
                <strong>Privacy by Design:</strong> Phone numbers are never exposed in marketing audience lists.
              </li>
            </ul>
          </div>

          {/* Audience Table */}
          <div className="rounded-xl bg-[var(--card)] border border-[var(--border)] overflow-hidden shadow-sm">
            {loadingAudience ? (
              <div className="p-12 text-center text-xs text-[var(--muted)]">
                <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-indigo-500 border-t-transparent mb-2" />
                <p>Loading audience profiles...</p>
              </div>
            ) : audience.length === 0 ? (
              <div className="p-12 text-center space-y-2">
                <span className="text-3xl block">👥</span>
                <h3 className="text-sm font-semibold text-[var(--text)]">
                  No audience profiles match filters
                </h3>
                <p className="text-xs text-[var(--muted)] max-w-sm mx-auto">
                  Try broadening your search or adjusting consent filters.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] uppercase font-mono tracking-wider text-[10px]">
                      <th className="py-2.5 px-3">User Profile</th>
                      <th className="py-2.5 px-3">Bot</th>
                      <th className="py-2.5 px-3">Associated Channels & Last Status</th>
                      <th className="py-2.5 px-3">Consent Status</th>
                      <th className="py-2.5 px-3">Campaign Source</th>
                      <th className="py-2.5 px-3">First Seen</th>
                      <th className="py-2.5 px-3">Last Active</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {audience.map((u) => (
                      <tr
                        key={u.id}
                        className="hover:bg-[var(--surface)]/50 transition-colors"
                      >
                        {/* User Profile */}
                        <td className="py-3 px-3">
                          <div className="font-semibold text-[var(--text)] truncate max-w-[160px]">
                            {u.displayName}
                          </div>
                          <div className="text-[11px] text-[var(--muted)] font-mono">
                            ID: {u.telegramId}
                          </div>
                        </td>

                        {/* Bot */}
                        <td className="py-3 px-3 whitespace-nowrap text-[var(--text)]">
                          <span>{u.botName}</span>
                          <span className="block text-[11px] text-[var(--muted)] font-mono">
                            @{u.botUsername}
                          </span>
                        </td>

                        {/* Channels */}
                        <td className="py-3 px-3 max-w-[220px]">
                          {u.associatedChannels.length === 0 ? (
                            <span className="text-slate-500">None observed</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {u.associatedChannels.map((ch, idx) => (
                                <span
                                  key={idx}
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                                    ch.latestStatus === "member"
                                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                      : ch.latestStatus === "left" || ch.latestStatus === "kicked"
                                      ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                                      : "bg-slate-800 text-slate-300 border-slate-700"
                                  }`}
                                  title={`Last observed: ${new Date(
                                    ch.lastObservedAt
                                  ).toLocaleString()}`}
                                >
                                  {ch.channelName}: {ch.latestStatus}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>

                        {/* Consent Status */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          {u.marketingConsent === "OPTED_IN" ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                              Opted In
                            </span>
                          ) : u.marketingConsent === "OPTED_OUT" ||
                            u.marketingConsent === "REVOKED" ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                              Opted Out
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                              No Consent
                            </span>
                          )}
                          {u.marketingConsentSource && (
                            <span className="block text-[10px] text-[var(--muted)] font-mono">
                              via {u.marketingConsentSource}
                            </span>
                          )}
                        </td>

                        {/* Campaign Source */}
                        <td className="py-3 px-3 text-[var(--muted)] font-mono text-[11px] whitespace-nowrap">
                          {u.firstCampaignSource ? (
                            <span className="px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)] text-[var(--accent)]">
                              c_{u.firstCampaignSource}
                            </span>
                          ) : (
                            <span className="text-slate-500">Organic / Direct</span>
                          )}
                        </td>

                        {/* First Seen */}
                        <td className="py-3 px-3 whitespace-nowrap text-[var(--muted)] font-mono text-[11px]">
                          {new Date(u.firstSeenAt).toLocaleDateString()}
                        </td>

                        {/* Last Active */}
                        <td className="py-3 px-3 whitespace-nowrap text-[var(--muted)] font-mono text-[11px]">
                          {new Date(u.lastSeenAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {audiencePages > 1 && (
              <div className="p-3 border-t border-[var(--border)] bg-[var(--surface)]/30 flex items-center justify-between text-xs">
                <span className="text-[var(--muted)]">
                  Showing {(audiencePage - 1) * 20 + 1}–
                  {Math.min(audiencePage * 20, audienceTotal)} of {audienceTotal} profiles
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAudiencePage((p) => Math.max(1, p - 1))}
                    disabled={audiencePage <= 1 || loadingAudience}
                    className="botdesk-btn text-xs py-1 px-2.5 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="px-2 font-mono text-[var(--text)]">
                    {audiencePage} / {audiencePages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAudiencePage((p) => Math.min(audiencePages, p + 1))}
                    disabled={audiencePage >= audiencePages || loadingAudience}
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

      {/* ======================================================== */}
      {/* TAB 3: CAMPAIGN DEEP LINKS                               */}
      {/* ======================================================== */}
      {activeTab === "campaigns" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-[var(--text)]">
                Acquisition Campaigns & Deep Tracking Links
              </h3>
              <p className="text-xs text-[var(--muted)]">
                Generate Telegram deep links (<code className="font-mono">t.me/Bot?start=c_slug</code>) to attribute incoming bot starts and downstream channel growth.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="botdesk-btn primary text-xs py-1.5 px-3"
            >
              + Create Campaign Link
            </button>
          </div>

          {campaignSuccess && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs">
              {campaignSuccess}
            </div>
          )}

          {/* Campaigns Table */}
          <div className="rounded-xl bg-[var(--card)] border border-[var(--border)] overflow-hidden shadow-sm">
            {campaigns.length === 0 ? (
              <div className="p-12 text-center space-y-2">
                <span className="text-3xl block">🔗</span>
                <h3 className="text-sm font-semibold text-[var(--text)]">
                  No campaigns created yet
                </h3>
                <p className="text-xs text-[var(--muted)] max-w-sm mx-auto">
                  Create your first tracking link to start measuring promotional campaign performance.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] uppercase font-mono tracking-wider text-[10px]">
                      <th className="py-2.5 px-3">Campaign Name & Slug</th>
                      <th className="py-2.5 px-3">Bot</th>
                      <th className="py-2.5 px-3">Deep Link</th>
                      <th className="py-2.5 px-3">Target Channel</th>
                      <th className="py-2.5 px-3">Clicks</th>
                      <th className="py-2.5 px-3">Unique Starts</th>
                      <th className="py-2.5 px-3">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {campaigns.map((c) => (
                      <tr
                        key={c.id}
                        className="hover:bg-[var(--surface)]/50 transition-colors"
                      >
                        <td className="py-3 px-3">
                          <div className="font-semibold text-[var(--text)]">
                            {c.name}
                          </div>
                          <div className="text-[11px] text-[var(--muted)] font-mono">
                            slug: c_{c.slug}
                          </div>
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap text-[var(--text)]">
                          {c.botName}
                        </td>

                        <td className="py-3 px-3">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[11px] text-[var(--accent)] truncate max-w-[200px]">
                              {c.deepLink}
                            </span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(c.deepLink)}
                              className="botdesk-btn text-[10px] py-0.5 px-1.5"
                              title="Copy Telegram Link"
                            >
                              Copy
                            </button>
                          </div>
                        </td>

                        <td className="py-3 px-3 text-[var(--muted)]">
                          {c.targetChannelName || "General Bot Onboarding"}
                        </td>

                        <td className="py-3 px-3 font-semibold text-[var(--text)]">
                          {c.clicksCount}
                        </td>

                        <td className="py-3 px-3 font-semibold text-emerald-400">
                          {c.uniqueStartsCount}
                        </td>

                        <td className="py-3 px-3 text-[var(--muted)] font-mono text-[11px] whitespace-nowrap">
                          {new Date(c.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Attribution Rules Guidance */}
          <div className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--muted)] space-y-2">
            <h4 className="font-semibold text-[var(--text)]">
              ℹ️ Campaign Source Attribution Rules
            </h4>
            <ul className="list-disc list-inside space-y-1 pl-1">
              <li>
                <strong>First-Touch Attribution:</strong> When a user starts the bot for the first time via <code className="font-mono font-bold">t.me/Bot?start=c_slug</code>, that campaign slug is permanently stored on their profile.
              </li>
              <li>
                <strong>Return-Touch Attribution:</strong> Returning users starting via campaign links have each touch recorded in the campaign ledger with timestamp.
              </li>
              <li>
                <strong>Channel Join Attribution Integrity:</strong> A channel join is only credited to a campaign if the user actively interacted with the campaign within the attribution window. Organic or direct joins are never falsely credited.
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* CREATE CAMPAIGN MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-[var(--panel)] border border-[var(--border)] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[var(--text)]">
                Create Campaign Tracking Link
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-[var(--muted)] hover:text-[var(--text)] text-sm"
              >
                ✕
              </button>
            </div>

            {campaignError && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
                {campaignError}
              </div>
            )}

            <form onSubmit={handleCreateCampaign} className="space-y-3 text-xs">
              <div>
                <label className="block text-[var(--muted)] font-medium mb-1">
                  Target Bot
                </label>
                <select
                  value={newCampBotId}
                  onChange={(e) => setNewCampBotId(e.target.value)}
                  className="botdesk-input w-full text-xs py-1.5"
                  required
                >
                  {bots.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} (@{b.username})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[var(--muted)] font-medium mb-1">
                  Campaign Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Summer Promo 2026"
                  value={newCampName}
                  onChange={(e) => setNewCampName(e.target.value)}
                  className="botdesk-input w-full text-xs py-1.5"
                  required
                />
              </div>

              <div>
                <label className="block text-[var(--muted)] font-medium mb-1">
                  URL Slug (unique, lowercase, alphanumeric, 2-32 chars)
                </label>
                <div className="flex items-center gap-1">
                  <span className="font-mono text-[var(--muted)]">?start=c_</span>
                  <input
                    type="text"
                    placeholder="summer26"
                    value={newCampSlug}
                    onChange={(e) =>
                      setNewCampSlug(
                        e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "")
                      )
                    }
                    className="botdesk-input flex-1 text-xs py-1.5 font-mono"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-[var(--muted)] font-medium mb-1">
                  Target Channel (Optional)
                </label>
                <select
                  value={newCampChannelId}
                  onChange={(e) => setNewCampChannelId(e.target.value)}
                  className="botdesk-input w-full text-xs py-1.5"
                >
                  <option value="">General Bot Onboarding (No Specific Channel)</option>
                  {channels
                    .filter((ch) => ch.botId === newCampBotId)
                    .map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        {ch.name} ({ch.telegramChatId})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-[var(--muted)] font-medium mb-1">
                  Description / Notes (Optional)
                </label>
                <textarea
                  placeholder="Notes about placement (e.g. Twitter post, influencer partnership)..."
                  value={newCampDesc}
                  onChange={(e) => setNewCampDesc(e.target.value)}
                  className="botdesk-input w-full text-xs py-1.5 h-16 resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="botdesk-btn text-xs py-1.5 px-3"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingCampaign}
                  className="botdesk-btn primary text-xs py-1.5 px-3"
                >
                  {creatingCampaign ? "Creating..." : "Create Link"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
