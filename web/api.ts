/** Fetch helper: adds the login token, and turns API errors into messages people can read. */
const KEY = "fairshift.session";

export interface Stored {
  role: "worker" | "admin";
  token: string;
}

export const session = {
  get(): Stored | null {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    } catch {
      return null;
    }
  },
  set(s: Stored | null) {
    try {
      if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
      else sessionStorage.removeItem(KEY);
    } catch {
      /* private mode: the session lasts until the tab closes */
    }
  },
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = session.get()?.token;
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError((data as { error?: string })?.error ?? "Something went wrong. Try again.", res.status);
  return data as T;
}
