"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type Source = {
  document_id: string;
  document_name: string;
  chunk_id: string;
  page_no: number | null;
  text: string;
};
type Message = { role: "user" | "assistant"; content: string; sources?: Source[] };

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, { role: "user", content: message }]);
    setDraft("");
    setErr(null);
    setBusy(true);
    try {
      const response = await api.chat({ message, history });
      setMessages((current) => [...current, { role: "assistant", content: response.answer, sources: response.sources }]);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Chat gagal. Silakan coba lagi.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-10rem)] max-w-4xl flex-col gap-4">
      <div className="rounded border border-border p-4">
        <p className="text-xs font-mono text-muted-foreground">Chat dengan knowledge base. Jawaban tentang informasi perusahaan merujuk pada dokumen yang cocok; sumber ditampilkan di bawah jawaban.</p>
      </div>
      <section className="flex-1 space-y-5" aria-label="Percakapan" aria-live="polite">
        {messages.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">Tanyakan sesuatu tentang dokumen di knowledge base.</p>}
        {messages.map((message, index) => (
          <article key={`${index}-${message.role}`} className={`max-w-[90%] ${message.role === "user" ? "ml-auto" : "mr-auto"}`}>
            <p className="mb-1 text-xs font-mono text-muted-foreground">{message.role === "user" ? "Anda" : "Knowledge Assistant"}</p>
            <div className={`whitespace-pre-wrap rounded border border-border p-3 text-sm leading-6 ${message.role === "user" ? "bg-muted/40" : "bg-card"}`}>{message.content}</div>
            {message.role === "assistant" && !!message.sources?.length && (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer font-mono text-muted-foreground">Sumber ({message.sources.length})</summary>
                <div className="mt-2 space-y-2">
                  {message.sources.map((source, sourceIndex) => (
                    <blockquote key={source.chunk_id} className="rounded border-l-2 border-accent bg-muted/30 p-2">
                      <p className="font-mono text-muted-foreground">[{sourceIndex + 1}] {source.document_name}{source.page_no != null ? `, hlm. ${source.page_no}` : ""}</p>
                      <p className="mt-1 whitespace-pre-wrap">{source.text}</p>
                    </blockquote>
                  ))}
                </div>
              </details>
            )}
          </article>
        ))}
        {busy && <p role="status" className="mr-auto text-sm text-muted-foreground">Sedang menyiapkan jawaban…</p>}
        <div ref={bottomRef} />
      </section>
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      <form className="sticky bottom-0 space-y-2 border-t border-border bg-background py-3" onSubmit={submit}>
        <label htmlFor="chat-message" className="sr-only">Pesan</label>
        <textarea
          id="chat-message"
          className="min-h-[76px] w-full resize-y rounded border border-border p-3 font-sans text-sm outline-none focus-ring"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Tulis pesan… (Enter untuk kirim, Shift+Enter untuk baris baru)"
          disabled={busy}
          maxLength={4000}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Percakapan ini hanya tersimpan selama halaman terbuka.</span>
          <button type="submit" className="rounded bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent/90 disabled:opacity-50" disabled={busy || !draft.trim()}>
            {busy ? "Menjawab…" : "Kirim"}
          </button>
        </div>
      </form>
    </div>
  );
}

