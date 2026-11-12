"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearSession, getToken } from "@/lib/api";

export default function Header({ authVersion = 0 }: { authVersion?: number }) {
  const router = useRouter();
  const [user, setUser] = useState<{ username: string } | null>(null);

  // Re-derive on every auth state change (F-PB-1). A child's mount effect runs
  // BEFORE the layout's, so on a hard reload this read runs pre-hydration and
  // yields null; `authVersion` re-runs it right after the layout hydrates.
  useEffect(() => {
    // Read the token through the single owner. No direct storage access here (AC1).
    const t = getToken();
    if (!t) { setUser(null); return; }
    try {
      const payload = t.split(".")[1];
      const decoded = JSON.parse(
        atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
      );
      setUser({ username: String(decoded.username || "admin") });
    } catch {
      setUser({ username: "admin" });
    }
  }, [authVersion]);

  return (
    <header className="flex h-14 items-center justify-between border border-border px-4 bg-surface">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-semibold tracking-tight">
          Knowledge Assistant
        </h1>
      </div>
      <div className="flex items-center gap-3">
        {user && (
          <span className="text-xs font-mono text-muted-foreground">
            {user.username}
          </span>
        )}
        <button
          className="rounded border border-input px-3 py-1.5 text-xs font-semibold hover:bg-muted"
          onClick={() => {
            clearSession();            // clears BOTH stores (AC6)
            router.replace("/login");  // replace, not push (see §B2.5)
          }}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
