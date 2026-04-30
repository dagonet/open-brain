"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

interface SidebarProps {
  totalThoughts: number;
  wikiPages?: number;
  openContradictions?: number;
}

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  badge?: number;
  match: (path: string) => boolean;
}

function HomeIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
      />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
      />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  );
}

function GraphIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <circle cx="7" cy="17" r="2" />
      <circle cx="17" cy="7" r="2" />
      <circle cx="12" cy="5" r="2" />
      <circle cx="5" cy="12" r="2" />
      <circle cx="19" cy="15" r="2" />
      <line x1="7" y1="15.5" x2="10.7" y2="6.2" strokeWidth={1} />
      <line x1="11" y1="5.8" x2="15.5" y2="7.5" strokeWidth={1} />
      <line x1="6.5" y1="12.5" x2="8.5" y2="15.5" strokeWidth={1} />
      <line x1="17.5" y1="9" x2="17" y2="13" strokeWidth={1} />
    </svg>
  );
}

export default function Sidebar({
  totalThoughts,
  wikiPages,
  openContradictions,
}: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  const navItems: NavItem[] = [
    {
      href: "/",
      label: "Thoughts",
      icon: <HomeIcon />,
      match: (p) => p === "/" || (p !== "/wiki" && p !== "/contradictions" && p !== "/graph" && !p.startsWith("/wiki/") && !p.startsWith("/contradictions/")),
    },
    {
      href: "/wiki",
      label: "Wiki",
      icon: <BookIcon />,
      badge: wikiPages,
      match: (p) => p === "/wiki" || p.startsWith("/wiki/"),
    },
    {
      href: "/contradictions",
      label: "Contradictions",
      icon: <AlertIcon />,
      badge: openContradictions,
      match: (p) => p === "/contradictions" || p.startsWith("/contradictions/"),
    },
    {
      href: "/graph",
      label: "Graph",
      icon: <GraphIcon />,
      match: (p) => p === "/graph",
    },
  ];

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

        <nav className="flex-1 px-4 space-y-1">
          {navItems.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active
                    ? "text-[var(--text-primary)] bg-[var(--accent)]/10 border border-[var(--accent)]/20"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                <span className="flex items-center gap-3">
                  {item.icon}
                  {item.label}
                </span>
                {typeof item.badge === "number" && item.badge > 0 ? (
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded ${
                      item.label === "Contradictions"
                        ? "bg-amber-500/20 text-amber-300"
                        : "bg-[var(--bg-card)] text-[var(--text-muted)]"
                    }`}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
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
