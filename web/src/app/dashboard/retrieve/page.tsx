"use client";

import { useState } from "react";
import { api } from "@/lib/api";

export default function RetrievePage() {
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(20);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setRes(null);
    if (!q.trim()) return;
    setBusy(true);
    try {
      const { results } = await api.search({ q: q.trim(), limit });
      setRes(results);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    if (!res) return;
    const text = res
      .map(
        (r: any) =>
          `— ${r.document_name}${r.page_no != null ? ` (p.${r.page_no})` : ""}\n${r.text}`
      )
      .join("\n\n");
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="max-w-4xl space-y-4">
      <form className="space-y-3" onSubmit={submit}>
        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded border border-border px-3 py-2 font-sans text-sm outline-none focus-ring"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the knowledge base..."
            disabled={busy}
          />
          <input
            type="number"
            className="w-20 rounded border border-border px-2 py-2 font-mono text-sm outline-none focus-ring"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            disabled={busy}
          />
          <button
            type="submit"
            className="rounded bg-accent px-4 py-2 font-semibold text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
            disabled={busy || !q.trim()}
          >
            {busy ? "Searching\u2026" : "Search"}
          </button>
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
      </form>

      {res && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Results ({res.length})</h3>
            <button
              onClick={copy}
              className="text-xs font-mono text-muted-foreground hover:text-foreground"
            >
              Copy
            </button>
          </div>
          {res.map((r: any, i: number) => (
            <blockquote
              key={r.chunk_id || i}
              className="rounded border-l-2 border-accent bg-muted/30 p-3"
            >
              <p className="text-xs font-mono text-muted-foreground">
                {r.document_name}
                {r.page_no != null && `, p.${r.page_no}`}
              </p>
              <p className="mt-1 text-foreground text-sm">{r.text}</p>
            </blockquote>
          ))}
        </div>
      )}
    </div>
  );
}
