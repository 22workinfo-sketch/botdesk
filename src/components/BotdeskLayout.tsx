"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export interface BotdeskLayoutProps {
  userEmail?: string;
  role?: string;
  activeNav:
    | "bots"
    | "menus"
    | "channels"
    | "posts"
    | "marketing"
    | "staff"
    | "activity"
    | "workspace";
  breadcrumb: string;
  children: React.ReactNode;
}

export function BotdeskLayout({
  userEmail = "admin@local.test",
  role = "SUPER_ADMIN",
  activeNav,
  breadcrumb,
  children,
}: BotdeskLayoutProps) {
  const router = useRouter();
  const [showAddBotModal, setShowAddBotModal] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // Restore sidebar collapse preference from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("backstage_sidebar_collapsed");
      if (saved === "true") {
        setIsCollapsed(true);
      }
    } catch {
      // Ignore localStorage access issues
    }
  }, []);

  // Keyboard accessibility: Close mobile drawer on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isMobileOpen) {
        setIsMobileOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobileOpen]);

  const toggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("backstage_sidebar_collapsed", String(next));
      } catch {}
      return next;
    });
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Ignore network errors on logout
    }
    router.push("/login");
    router.refresh();
  };

  const navLinks = [
    { id: "bots", label: "Bots", href: "/dashboard", icon: "▦" },
    { id: "menus", label: "Bot menu", href: "/menu", icon: "☰" },
    { id: "channels", label: "Channels", href: "/channels", icon: "📢" },
    { id: "posts", label: "Channel posts", href: "/posts", icon: "✉" },
    { id: "marketing", label: "Marketing", href: "/marketing", icon: "📈" },
    { id: "staff", label: "Users & access", href: "/staff", icon: "♙" },
    { id: "activity", label: "Channel Activity", href: "/activity", icon: "≡" },
    { id: "workspace", label: "Workspace", href: "/workspace", icon: "⚙" },
  ];

  return (
    <div className={`app-shell ${isCollapsed ? "sidebar-collapsed" : ""}`}>
      {/* Botdesk Desktop Sidebar */}
      <aside
        className={`sidebar-panel hidden md:flex ${isCollapsed ? "collapsed" : ""}`}
        aria-label="Sidebar navigation"
      >
        <div className="flex items-center justify-between">
          <Link
            href="/dashboard"
            className="brand-title"
            title="Botdesk Backstage"
            aria-label="Botdesk Home"
          >
            <span className="brand-mark" aria-hidden="true">
              ↗
            </span>
            <span className="brand-label">botdesk</span>
          </Link>

          <button
            type="button"
            onClick={toggleCollapse}
            className="sidebar-collapse-toggle"
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? "▶" : "◀"}
          </button>
        </div>

        <div className="workspace-box">
          <strong className="text-sm font-semibold block text-[var(--text)]">
            My workspace
          </strong>
          <span className="text-xs text-[var(--muted)]">Telegram management</span>
        </div>

        <nav className="nav-group" aria-label="Main navigation">
          {navLinks.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              prefetch={false}
              className={`nav-link ${activeNav === item.id ? "active" : ""}`}
              title={item.label}
              aria-label={item.label}
            >
              <span className="nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="nav-link-label">{item.label}</span>
            </Link>
          ))}
        </nav>

        <footer className="sidebar-footer mt-auto text-xs text-[var(--muted)] leading-relaxed pt-4 border-t border-[var(--border)]">
          One control center.
          <br />
          Independent bots.
        </footer>
      </aside>

      {/* Mobile Drawer Backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden animate-fade-in"
          onClick={() => setIsMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile Drawer Panel */}
      {isMobileOpen && (
        <div
          className="fixed inset-y-0 left-0 z-50 w-72 bg-[var(--panel)] border-r border-[var(--border)] p-6 shadow-2xl flex flex-col gap-6 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation drawer"
        >
          <div className="flex items-center justify-between">
            <Link
              href="/dashboard"
              className="brand-title"
              onClick={() => setIsMobileOpen(false)}
            >
              <span className="brand-mark" aria-hidden="true">
                ↗
              </span>
              <span>botdesk</span>
            </Link>
            <button
              type="button"
              onClick={() => setIsMobileOpen(false)}
              className="botdesk-btn text-sm py-1 px-2.5 min-h-[32px]"
              aria-label="Close menu"
            >
              ✕
            </button>
          </div>

          <div className="workspace-box">
            <strong className="text-sm font-semibold block text-[var(--text)]">
              My workspace
            </strong>
            <span className="text-xs text-[var(--muted)]">Telegram management</span>
          </div>

          <nav className="nav-group" aria-label="Mobile navigation">
            {navLinks.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                prefetch={false}
                className={`nav-link ${activeNav === item.id ? "active" : ""}`}
                onClick={() => setIsMobileOpen(false)}
              >
                <span className="nav-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>

          <footer className="mt-auto text-xs text-[var(--muted)] pt-4 border-t border-[var(--border)]">
            <div className="mb-3">
              <span className="font-semibold text-[var(--text)] block truncate">
                {userEmail}
              </span>
              <span className="text-[11px] font-mono text-[var(--muted)]">
                {role}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="botdesk-btn text-xs w-full py-2 hover:text-[var(--red)]"
            >
              Sign out
            </button>
          </footer>
        </div>
      )}

      {/* Main Work Area */}
      <main className="main-content">
        {/* Topline Bar */}
        <header className="topline-bar">
          <div className="flex items-center gap-3">
            {/* Mobile Hamburger Button */}
            <button
              type="button"
              onClick={() => setIsMobileOpen(true)}
              className="sidebar-collapse-toggle md:hidden inline-flex"
              title="Open Navigation Menu"
              aria-label="Open Navigation Menu"
            >
              ☰
            </button>

            <span className="crumb-label">
              Workspace / <strong className="text-[var(--text)]">{breadcrumb}</strong>
            </span>
            <span className="demo-pill font-mono">Local MVP</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <span className="text-xs font-semibold text-[var(--text)] block">
                {userEmail}
              </span>
              <span className="text-[11px] text-[var(--muted)] font-mono">
                {role}
              </span>
            </div>

            <button
              onClick={handleLogout}
              className="botdesk-btn text-xs py-1.5 px-3 min-h-[34px] hover:text-[var(--red)]"
            >
              Sign out
            </button>
          </div>
        </header>

        {/* Content Body */}
        {children}
      </main>

      {/* Add Bot Entry Point Dialog (Safe Honest Notice) */}
      {showAddBotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-[var(--panel)] border border-[var(--border)] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-[var(--text)]">
                Add a Bot (Multi-Bot Onboarding)
              </h2>
              <span className="botdesk-badge paused">Coming Soon</span>
            </div>

            <div className="space-y-3 text-sm text-[var(--muted)] mb-6">
              <p>
                Dynamic multi-bot onboarding with runtime token management is planned for the next expansion phase.
              </p>
              <div className="p-3 rounded-lg bg-[var(--bluebg)] text-[var(--accent)] text-xs border border-[var(--border)]">
                <strong>Current Scope:</strong> Your backstage is currently running in local MVP mode managing <strong>one test Telegram bot</strong> configured securely via your local <code className="font-mono font-bold">.env</code> file.
              </div>
              <p className="text-xs text-[var(--text)]">
                To test your bot or adjust its settings, select your existing connected bot from the list.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={() => setShowAddBotModal(false)}
                className="botdesk-btn primary"
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
