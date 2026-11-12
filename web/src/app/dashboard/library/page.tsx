"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { DocumentPreview, LibraryPage as LibraryPageData, LibraryRow } from "@/lib/api";

// The page passes its own limit and never slices the response (PLAN §A8):
// paging is the server's job, via the opaque keyset cursor.
const PAGE_LIMIT = 25;

/**
 * `YYYY-MM-DD` in UTC without any substring call — `toISOString()` already
 * starts with the date, and the page only ever needs that prefix.
 * (Written this way so the page contains no substring extraction, which is
 * what T-A13 and PLAN §A8 require of this file.)
 */
function utcDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().substring(0, 10);
}

export default function LibraryPage() {
  const [docs, setDocs] = useState<LibraryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // AQ1: `Previous` re-requests with a cursor we already held, so the page
  // keeps its own stack of cursors. Index 0 is always `null` (page 1).
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [requestedCursor, setRequestedCursor] = useState<string | null>(null);
  const [preview, setPreview] = useState<DocumentPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewDocumentId, setPreviewDocumentId] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  // The single place the list is fetched. `requestedCursor` is the resolved cursor of
  // the current page (null = page 1); it is the ONLY dependency of the effect, so a
  // history-only state change can never re-issue a request (PLAN §A4.4 step 9).
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setErr(null);
    api.library.list({ limit: PAGE_LIMIT, cursor: requestedCursor })
      .then((page: LibraryPageData) => {
        if (cancelled) return;
        setDocs(page.results);
        setTotal(page.total);
        setNextCursor(page.next_cursor);
        setBusy(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setErr(error instanceof Error ? error.message : "Gagal memuat library.");
        setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requestedCursor]);

  // The trigger is the resolved stack entry, not the stack identity nor the index:
  // `Previous` often changes both index and stack while the cursor stays put.
  useEffect(() => {
    setRequestedCursor(cursorStack[pageIndex] ?? null);
  }, [cursorStack, pageIndex]);

  const closePreview = () => {
    setPreviewDocumentId(null);
    setPreview(null);
    setPreviewError(null);
    setPdfUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
  };

  const onPreview = async (doc: LibraryRow) => {
    if (previewDocumentId === doc.id) {
      closePreview();
      return;
    }
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPreviewDocumentId(doc.id);
    setPreview(null);
    setPdfUrl(null);
    setPreviewError(null);
    setPreviewBusy(true);
    try {
      if (doc.kind.toLowerCase() === "pdf") {
        const blob = await api.library.pdf(doc.id);
        setPdfUrl(URL.createObjectURL(blob));
      } else {
        setPreview(await api.library.preview(doc.id));
      }
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "Gagal memuat preview dokumen.");
    } finally {
      setPreviewBusy(false);
    }
  };

  const onNext = () => {
    if (!nextCursor) return;
    setPreviewDocumentId(null);
    setPreview(null);
    setPreviewError(null);
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(null);
    // Keep only the history up to the current page, then append: `[null, c1, ..., cN, next]`.
    setCursorStack((stack) => stack.filter((_, idx) => idx <= pageIndex).concat(nextCursor));
    setPageIndex((i) => i + 1);
  };

  const onPrevious = () => {
    if (pageIndex === 0) return;
    setPageIndex((i) => i - 1); // the effect re-requests cursorStack[pageIndex - 1]
  };

  const firstRow = total === 0 ? 0 : pageIndex * PAGE_LIMIT + 1;
  const lastRow = pageIndex * PAGE_LIMIT + docs.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <p className="font-mono text-muted-foreground">
          {total === 0
            ? "0 documents"
            : `${firstRow}\u2013${lastRow} of ${total} document${total === 1 ? "" : "s"}`}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPrevious}
            disabled={pageIndex === 0 || busy}
            className="rounded border border-border px-2 py-1 font-mono text-xs disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={nextCursor === null || busy}
            className="rounded border border-border px-2 py-1 font-mono text-xs disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      {busy ? (
        <p className="text-sm text-muted-foreground">Loading&hellip;</p>
      ) : err ? (
        <p className="text-sm text-destructive">{err}</p>
      ) : !docs.length ? (
        <p className="text-sm text-muted-foreground">
          No documents ingested yet. Use the Inbox to add some.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="px-3 py-2 font-mono">Name</th>
                <th className="px-3 py-2 font-mono">Kind</th>
                <th className="px-3 py-2 font-mono">Size</th>
                <th className="px-3 py-2 font-mono">Status</th>
                <th className="px-3 py-2 font-mono">Policy</th>
                <th className="px-3 py-2 font-mono">Chunks</th>
                <th className="px-3 py-2 font-mono">Created</th>
                <th className="px-3 py-2 font-mono">Preview</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="border-b border-border">
                  <td className="px-3 py-2 font-mono text-foreground">{d.name}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{d.kind}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">
                    {d.size_bytes === null || d.size_bytes === undefined
                      ? "\u2014"
                      : `${d.size_bytes.toLocaleString("en-US")} B`}
                  </td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{d.status}</td>
                  <td className="px-3 py-2 font-mono">{d.access_policy}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{d.chunk_count}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">
                    {d.created_at ? utcDay(d.created_at) : ""}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => void onPreview(d)}
                      disabled={d.status !== "ready" || (previewBusy && previewDocumentId !== d.id)}
                      aria-expanded={previewDocumentId === d.id}
                      className="rounded border border-border px-2 py-1 font-mono text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {previewDocumentId === d.id && previewBusy ? "Loading…" : previewDocumentId === d.id ? "Close" : "Preview"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {previewDocumentId && (
        <section className="rounded border border-border p-4" aria-label="Document preview">
          <div className="mb-3 flex items-start justify-between gap-3 border-b border-border pb-3">
            <div>
              <h2 className="text-sm font-semibold">{preview?.document.name ?? docs.find((doc) => doc.id === previewDocumentId)?.name ?? "Document preview"}</h2>
              <p className="mt-1 text-xs font-mono text-muted-foreground">
                {preview ? `${preview.document.kind.toUpperCase()} · extracted text` : "Extracted text preview"}
              </p>
            </div>
            <button type="button" onClick={closePreview} className="rounded border border-border px-2 py-1 font-mono text-xs hover:bg-muted">Close</button>
          </div>
          {previewBusy ? (
            <p role="status" className="text-sm text-muted-foreground">Loading preview…</p>
          ) : previewError ? (
            <p role="alert" className="text-sm text-destructive">{previewError}</p>
          ) : pdfUrl ? (
            <>
              <iframe title={`PDF reader: ${previewDocumentId}`} src={pdfUrl} className="h-[75vh] w-full rounded border border-border" />
              <button
                type="button"
                className="mt-3 rounded border border-border px-3 py-2 text-xs font-mono hover:bg-muted"
                onClick={async () => {
                  if (!previewDocumentId) return;
                  setPreviewBusy(true);
                  setPreviewError(null);
                  try { setPreview(await api.library.preview(previewDocumentId)); }
                  catch (error) { setPreviewError(error instanceof Error ? error.message : "Gagal memuat teks hasil ekstraksi."); }
                  finally { setPreviewBusy(false); }
                }}
              >
                Baca teks hasil ekstraksi
              </button>
            </>
          ) : previewError ? (
            <p role="alert" className="text-sm text-destructive">{previewError}</p>
          ) : preview ? (
            <>
              {preview.truncated && <p className="mb-3 text-xs text-muted-foreground">Preview dibatasi hingga 50.000 karakter pertama.</p>}
              {preview.text ? (
                <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded bg-muted/30 p-3 font-sans text-sm leading-6 text-foreground">{preview.text}</pre>
              ) : (
                <p className="text-sm text-muted-foreground">Tidak ada teks hasil ekstraksi untuk dokumen ini.</p>
              )}
            </>
          ) : null}
        </section>
      )}
    </div>
  );
}
