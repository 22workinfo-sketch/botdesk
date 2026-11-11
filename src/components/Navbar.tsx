"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";

interface NavbarProps {
  userEmail: string;
  role: string;
}

export function Navbar({ userEmail, role }: NavbarProps) {
  const router = useRouter();

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-900/90 backdrop-blur px-6 py-3.5 shadow-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <div className="flex items-center space-x-3">
          <Link href="/dashboard" className="flex items-center space-x-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white font-bold text-sm shadow-md shadow-blue-500/20">
              TG
            </span>
            <span className="text-lg font-bold tracking-tight text-white">
              Bot Backstage
            </span>
          </Link>
          <span className="rounded-full bg-slate-800 border border-slate-700 px-2.5 py-0.5 text-xs font-medium text-slate-400">
            Local MVP
          </span>
        </div>

        <div className="flex items-center space-x-4">
          <div className="text-right">
            <div className="text-sm font-semibold text-slate-200">{userEmail}</div>
            <div className="text-xs text-slate-400 font-mono">{role}</div>
          </div>
          <button
            onClick={handleLogout}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 shadow-sm hover:bg-slate-700 hover:text-red-400 transition"
          >
            Sign Out
          </button>
        </div>
      </div>
    </header>
  );
}
