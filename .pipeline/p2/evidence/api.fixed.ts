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
  try { token = localStorage.getItem(STORAGE_KEY); } catch { token = null; }  // SSR / private mode
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
    request<{ status: string }>("/ingest/upload", {
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

  chat: (body: any) =>
    request<{ results: any[] }>("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
};
