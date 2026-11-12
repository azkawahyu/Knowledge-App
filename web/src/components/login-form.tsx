"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, startSession } from "@/lib/api";

export default function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await api.auth.login({ username, password });
      startSession(data.token);        // installs + persists + re-arms the logout latch
      router.push("/dashboard");
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface text-foreground">
      <form
        className="w-full max-w-sm space-y-5 p-6 sm:p-8"
        onSubmit={onSubmit}
      >
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Knowledge Assistant
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Local company knowledge store
          </p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="space-y-2">
          <label className="text-xs font-mono text-muted-foreground">
            Username
          </label>
          <input
            className="w-full rounded border border-input px-3 py-2 font-sans outline-none focus-ring"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-mono text-muted-foreground">
            Password
          </label>
          <input
            type="password"
            className="w-full rounded border border-input px-3 py-2 font-sans outline-none focus-ring"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </div>

        <button
          type="submit"
          className="w-full rounded bg-accent px-4 py-2 font-semibold text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
          disabled={busy}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <p className="text-xs text-muted-foreground">
          Demo credentials:{" "}
          <code className="font-mono">admin / admin123</code>
        </p>
      </form>
    </div>
  );
}
