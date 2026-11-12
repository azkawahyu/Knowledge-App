"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";

const ACCEPTED_EXTENSIONS = [".txt", ".md", ".markdown", ".csv", ".json", ".xml", ".yaml", ".yml", ".log", ".html", ".htm", ".pdf", ".docx", ".xlsx", ".pptx"];
const ACCEPTED_LABEL = "TXT, Markdown, CSV, JSON, XML, YAML, LOG, HTML, PDF, DOCX, XLSX, PPTX";

function isSupportedFile(file: File) {
  return ACCEPTED_EXTENSIONS.includes(file.name.slice(file.name.lastIndexOf(".")).toLowerCase());
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Upload gagal. Silakan coba kembali.";
}

export default function InboxPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const uploadFiles = async (selected: File[]) => {
    if (!selected.length) return;
    if (selected.length > 10) {
      setIsError(true);
      setMsg("Pilih maksimal 10 dokumen dalam satu kali upload.");
      return;
    }
    const rejected = selected.filter((file) => !isSupportedFile(file));
    const files = selected.filter(isSupportedFile);
    if (rejected.length && !files.length) {
      setIsError(true);
      setMsg(`Format tidak didukung: ${rejected.map((file) => file.name).join(", ")}. Format diterima: ${ACCEPTED_LABEL}.`);
      return;
    }

    setUploading(true);
    setMsg(null);
    try {
      const form = new FormData();
      files.forEach((file) => form.append("files", file));
      const response = await api.ingestUpload(form);
      const succeeded = response.results ?? [];
      const failed = response.errors ?? [];
      const lines = [
        ...succeeded.map((result) => result.chunkCount > 0
          ? `${result.name}: berhasil, ${result.chunkCount} potongan teks`
          : `${result.name}: sudah ada di knowledge base (duplikat)`),
        ...failed.map((item) => `${item.file}: gagal — ${item.error}`),
      ];
      if (rejected.length) lines.push(`Format tidak didukung: ${rejected.map((file) => file.name).join(", ")}.`);
      setIsError(failed.length > 0 || rejected.length > 0);
      setMsg(lines.join("\n") || "Tidak ada dokumen yang diproses.");
    } catch (error) {
      setIsError(true);
      setMsg(errorMessage(error));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    void uploadFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <div className="max-w-3xl space-y-4">
      <input ref={inputRef} type="file" multiple accept={ACCEPTED_EXTENSIONS.join(",")} className="sr-only" aria-label="Pilih dokumen untuk diunggah" disabled={uploading} onChange={(event) => void uploadFiles(Array.from(event.currentTarget.files ?? []))} />
      <div
        role="button"
        tabIndex={uploading ? -1 : 0}
        aria-disabled={uploading}
        aria-label="Pilih atau jatuhkan dokumen untuk diunggah"
        className={`flex cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed p-10 text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${dragOver ? "border-accent bg-accent/5" : "border-border hover:border-accent"} ${uploading ? "cursor-wait opacity-60" : ""}`}
        onClick={() => !uploading && inputRef.current?.click()}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !uploading) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted" aria-hidden="true">
          <svg className="h-6 w-6 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M19 5l-7 7-7-7" /></svg>
        </div>
        <p className="mt-3 text-sm font-medium">{uploading ? "Mengunggah dan memproses dokumen…" : "Klik untuk pilih dokumen, atau jatuhkan di sini"}</p>
        <p className="mt-1 text-xs text-muted-foreground">{ACCEPTED_LABEL} · maks. 10 file, 25 MB per file</p>
        <button type="button" disabled={uploading} className="mt-4 rounded border border-input px-4 py-2 text-sm font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50" onClick={(event) => { event.stopPropagation(); inputRef.current?.click(); }}>
          {uploading ? "Memproses…" : "Pilih dokumen"}
        </button>
      </div>
      {msg && <p role={isError ? "alert" : "status"} className={`whitespace-pre-line text-sm ${isError ? "text-destructive" : "text-muted-foreground"}`}>{msg}</p>}
      <div className="rounded border border-border p-4">
        <h3 className="text-sm font-semibold">Status ingestion</h3>
        <p className="mt-1 text-xs text-muted-foreground">Dokumen yang berhasil diproses disimpan sebagai sumber informasi di knowledge base dan dapat digunakan untuk pencarian serta fitur chat.</p>
      </div>
    </div>
  );
}
