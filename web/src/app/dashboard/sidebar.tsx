"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

const NAV = [
  { href: "/dashboard", label: "Inbox" },
  { href: "/dashboard/library", label: "Library" },
  { href: "/dashboard/retrieve", label: "Retrieve" },
  { href: "/dashboard/chat", label: "Chat" },
  { href: "/dashboard/audit", label: "Audit" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 flex-shrink-0 border-r border-border bg-surface px-3 py-4">
      <nav className="flex flex-col gap-1">
        {NAV.map(({ href, label }) => {
          const active =
            href === "/dashboard"
              ? !pathname.startsWith("/dashboard/")
              : pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground hover:bg-muted"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
