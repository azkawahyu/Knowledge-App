"use client";

import { useEffect, useState } from "react";
import { api, type AuditRow } from "@/lib/api";

function detailText(detail: Record<string, unknown>): string {
  return Object.entries(detail)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" · ");
}

export default function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.audit()
      .then(({ rows: auditRows }) => setRows(auditRows))
      .catch((error: unknown) => setErr(error instanceof Error ? error.message : "Gagal memuat audit log."))
      .finally(() => setBusy(false));
  }, []);

  if (busy) return <p className="text-sm text-muted-foreground">Memuat aktivitas…</p>;
  if (err) return <p role="alert" className="text-sm text-destructive">{err}</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground">Belum ada aktivitas.</p>;

  return (
    <div className="space-y-3">
      <p className="text-xs font-mono text-muted-foreground">{rows.length} aktivitas terbaru (maks. 200)</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="px-3 py-2 font-mono">Waktu</th>
              <th className="px-3 py-2 font-mono">Pengguna</th>
              <th className="px-3 py-2 font-mono">Aksi</th>
              <th className="px-3 py-2 font-mono">Resource</th>
              <th className="px-3 py-2 font-mono">Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.created_at}-${row.action}-${index}`} className="border-b border-border align-top">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted-foreground">{new Date(row.created_at).toLocaleString()}</td>
                <td className="px-3 py-2 font-mono">{row.actor ?? "—"}</td>
                <td className="px-3 py-2 font-mono">{row.action}</td>
                <td className="px-3 py-2 font-mono text-muted-foreground">{row.resource ?? "—"}</td>
                <td className="max-w-xl px-3 py-2 text-xs text-muted-foreground">{detailText(row.detail ?? {}) || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

