"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

interface SidebarProps {
  totalThoughts: number;
}

export default function Sidebar({ totalThoughts }: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed top-4 left-4 z-50 p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] md:hidden"
        aria-label="Toggle menu"
      >
        <svg
          className="w-5 h-5 text-[var(--text-primary)]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          {mobileOpen ? (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          ) : (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          )}
        </svg>
      </button>

      {/* Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed md:sticky top-0 left-0 z-40 h-screen w-64 bg-[var(--bg-secondary)] border-r border-[var(--border)] flex flex-col transition-transform md:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="p-6">
          <h1 className="text-xl font-bold text-[var(--text-primary)] tracking-tight">
            Open Brain
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Your second brain
          </p>
        </div>

        <nav className="flex-1 px-4">
          <a
            href="/"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-[var(--text-primary)] bg-[var(--accent)]/10 border border-[var(--accent)]/20"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
              />
            </svg>
            Dashboard
          </a>
        </nav>

        <div className="p-4 border-t border-[var(--border)]">
          <div className="text-xs text-[var(--text-muted)] mb-3">
            <span className="text-[var(--text-secondary)] font-medium">
              {totalThoughts.toLocaleString()}
            </span>{" "}
            thoughts captured
          </div>
          <button
            onClick={handleLogout}
            className="w-full px-3 py-2 rounded-lg text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-[var(--border)] transition-colors"
          >
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
