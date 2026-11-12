const API = "http://localhost:4000/api";

let token: string | null = null;

export function getToken(): string | null {
  return token;
}

export function setToken(t: string | null) {
  token = t;
}

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
    token = null;
    setToken(null);
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
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      ),
  },

  logout: () =>
    request<void>("/auth/logout", { method: "POST" }).finally(() => {
      setToken(null);
    }),

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
