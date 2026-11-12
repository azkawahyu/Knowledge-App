const API = "http://localhost:4000/api";
const STORAGE_KEY = "ka_token";

let token: string | null = null;
let hydrated = false;
let logoutSignalled = false;

/** Read the persisted token ONCE and install it. Idempotent. */
export function hydrateToken(): void {
  if (hydrated) return;
  hydrated = true;
  logoutSignalled = false;                       // a fresh page load re-arms the event
  try { if (token === null) token = localStorage.getItem(STORAGE_KEY); } catch { token = null; }  // SSR / private mode; never clobber a fresher in-memory session (A8)
}

export function getToken(): string | null {
  return token;
}

/**
 * Start a new session: install a token AND re-arm the ka:logout latch.
 * Callers that persist a NEW token must use this, not setToken().
 * (Re-arming inside setToken() would be defeatable: clearSession() calls
 * setToken(null) inside the 401 branch, which would re-arm the latch on every
 * 401 and let a burst dispatch once per in-flight request - see A6.)
 */
export function startSession(t: string): void {
  logoutSignalled = false;                       // a new session re-arms the event
  setToken(t);
}

export function setToken(t: string | null): void {
  token = t;
  // Re-arms only the storage->memory handoff, never a logout burst.
  if (t !== null) logoutSignalled = false;
  try { t ? localStorage.setItem(STORAGE_KEY, t) : localStorage.removeItem(STORAGE_KEY); } catch {}
}

export function isHydrated(): boolean { return hydrated; }

// ---- F3-A wire types (PLAN §A8) ------------------------------------------
// A-D7 / LA-1: `source_path` is NOT part of this type — the server does not
// send it. Do not add it "for debugging".
export type LibraryRow = {
  id: string;
  name: string;
  kind: string;
  size_bytes: number | null;      // R-A4: a JSON number, not a string
  sha256: string;
  status: string;
  access_policy: string;
  metadata: Record<string, unknown>;
  chunk_count: number;
  created_at: string;
  updated_at: string;
};

export type LibraryQuery = { limit?: number; cursor?: string | null };

export type LibraryPage = {
  results: LibraryRow[];
  total: number;
  limit: number;
  next_cursor: string | null;      // R-A3: null means "no further rows"
  // NOTE: no offset (R-A1). Do not add it.
};


export type DocumentPreview = {
  document: { id: string; name: string; kind: string };
  text: string;
  truncated: boolean;
};

export type AuditRow = {
  actor: string | null;
  action: string;
  resource: string | null;
  detail: Record<string, unknown>;
  created_at: string;
};

/** full clear used by 401 + logout */
export function clearSession(): void { setToken(null); hydrated = true; }

async function request<T>(path: string, options?: RequestInit) {
  hydrateToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (options?.headers) {
    const src = options.headers as Record<string, string>;
    for (const [k, v] of Object.entries(src)) {
      headers[k] = v;
    }
  }
  const res = await fetch(`${API}${path}`, {
    method: options?.method ?? "GET",
    headers,
    body: options?.body ?? null,
  });
  if (res.status === 401) {
    clearSession();                              // clears BOTH stores + marks hydrated (AC6)
    if (!logoutSignalled) {
      logoutSignalled = true;                    // latch: at most one event per burst
      window.dispatchEvent(new Event("ka:logout"));
    }
    throw new Error("Unauthorized");             // unchanged: pages' catch blocks still work
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => request<{ ok: boolean }>("/health"),

  auth: {
    login: (body: { username: string; password: string }) =>
      request<{ token: string; user: { id: string; username: string } }>(
        "/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      ),
  },

  ingestWatch: () =>
    request<{ status: string }>("/ingest/watch", { method: "POST" }),

  ingestUpload: (body: FormData) =>
    request<{
      results: Array<{
        name: string;
        chunkCount: number;
        documentId: string;
        contentHash: string;
      }>;
      errors?: Array<{ file: string; error: string }>;
    }>("/ingest/upload", {
      method: "POST",
      body,
    } as RequestInit),

  search: (body: {
    q: string;
    limit?: number;
    policy?: string;
  }) =>
    request<{ query: string; limit: number; results: any[] }>("/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  // ---- F3-A: Library (PLAN §A8, A-D2/A-D3) ------------------------------
  library: {
    list: (q: LibraryQuery = {}) => {
      const p = new URLSearchParams();
      if (q.limit !== undefined) p.set("limit", String(q.limit));
      if (q.cursor !== undefined && q.cursor !== null) p.set("cursor", q.cursor);
      const qs = p.toString();
      return request<LibraryPage>(`/library${qs ? `?${qs}` : ""}`);
    },
    preview: (id: string) => request<DocumentPreview>(`/library/${encodeURIComponent(id)}/preview`),
    pdf: async (id: string): Promise<Blob> => {
      hydrateToken();
      const response = await fetch(`${API}/library/${encodeURIComponent(id)}/file`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (response.status === 401) {
        clearSession();
        if (!logoutSignalled) {
          logoutSignalled = true;
          window.dispatchEvent(new Event("ka:logout"));
        }
        throw new Error("Unauthorized");
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || `Request failed (${response.status})`);
      }
      return response.blob();
    },
  },

  audit: () => request<{ rows: AuditRow[] }>("/audit"),

  chat: (body: {
    message: string;
    history: Array<{ role: "user" | "assistant"; content: string }>;
  }) =>
    request<{
      answer: string;
      sources: Array<{
        document_id: string;
        document_name: string;
        chunk_id: string;
        page_no: number | null;
        text: string;
      }>;
      model: string;
    }>("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
};
