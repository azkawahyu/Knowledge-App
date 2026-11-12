// ABLATION variant for the discrimination run — NOT A DELIVERABLE.
// Same shape as the fixed api.ts but with the BUGS the phase fixes restored:
//   (1) setToken does NOT persist (pre-fix behaviour: write moved to the caller)
//   (2) hydrateToken is a no-op (pre-fix behaviour: nothing ever reads the key back)
//   (3) 401 does not clearSession and does not dispatch ka:logout
//   (4) no latch / no isHydrated bookkeeping correctness
// This isolates whether the harness's assertions actually discriminate the FIX
// from the BUG (structural identity, unlike api.baseline.ts which lacks the exports).
const API = "http://localhost:4000/api";
const STORAGE_KEY = "ka_token";

let token: string | null = null;
let hydrated = false;
let logoutSignalled = false;

export function hydrateToken(): void {
  // BUG (2): never reads storage -> reload loses the session
  hydrated = true;
}

export function getToken(): string | null {
  return token;
}

export function startSession(t: string): void {
  setToken(t);
}

export function setToken(t: string | null): void {
  // BUG (1): memory only
  token = t;
}

export function isHydrated(): boolean { return hydrated; }

export function clearSession(): void { setToken(null); hydrated = true; }

async function request<T>(path: string, options?: RequestInit) {
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
    // BUG (3)/(4): no clearSession, no event, no latch
    token = null;
    throw new Error("Unauthorized");
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
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      ),
  },
  ingestWatch: () => request<{ status: string }>("/ingest/watch", { method: "POST" }),
  ingestUpload: (body: FormData) =>
    request<{ status: string }>("/ingest/upload", { method: "POST", body } as RequestInit),
  search: (body: { q: string; limit?: number; policy?: string }) =>
    request<{ query: string; limit: number; results: any[] }>("/search", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
  chat: (body: any) =>
    request<{ results: any[] }>("/chat", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
};
