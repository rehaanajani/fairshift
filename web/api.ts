/** Fetch helpers: add the right login token, stream live updates, and turn API errors into readable messages. */
export type Role = "worker" | "admin";

// one key per role, so the worker phone and the employer dashboard can share a browser in the live demo
const key = (role: Role) => `fairshift.${role}`;

export const session = {
  get(role: Role): string | null {
    try {
      return sessionStorage.getItem(key(role));
    } catch {
      return null;
    }
  },
  set(role: Role, token: string | null) {
    try {
      if (token) sessionStorage.setItem(key(role), token);
      else sessionStorage.removeItem(key(role));
    } catch {
      /* storage blocked: the login lasts until the page reloads */
    }
  },
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) {
    super(message);
  }
}

const roleFor = (path: string): Role => (path.startsWith("/admin") ? "admin" : "worker");

export async function api<T>(path: string, init: { method?: string; body?: unknown; role?: Role } = {}): Promise<T> {
  const role = init.role ?? roleFor(path);
  const token = session.get(role);
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(token ? { "x-session": token } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  // an expired login (e.g. after a server update) goes back to the sign-in screen instead of a dead end
  if (res.status === 401 && token) {
    session.set(role, null);
    location.reload();
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError((data as { error?: string })?.error ?? "Something went wrong. Try again.", res.status, data);
  return data as T;
}

/** Downloads a file the API protects with a token (registers). */
export async function download(path: string, filename: string, role: Role = "admin") {
  const res = await fetch(`/api${path}`, { headers: { "x-session": session.get(role) ?? "" } });
  if (res.status === 401) {
    session.set(role, null);
    location.reload();
  }
  if (!res.ok) throw new ApiError(res.status === 401 ? "Your session expired. Sign in again to download." : "Download failed. Check your connection and try again.", res.status);
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Opens a print-ready register (A4, headers on every page) in a new tab; the browser's print dialog saves it as PDF. */
export async function printRegister(path: string, role: Role = "admin") {
  const win = window.open("", "_blank");
  const res = await fetch(`/api${path}`, { headers: { "x-session": session.get(role) ?? "" } });
  if (!res.ok) {
    win?.close();
    throw new ApiError(res.status === 401 ? "Your session expired. Sign in again to print." : "Couldn't prepare the register.", res.status);
  }
  const url = URL.createObjectURL(new Blob([await res.text()], { type: "text/html" }));
  if (!win) return void (window.location.href = url);
  win.location.href = url;
  // the page's own print script is blocked by the app's CSP, so open the print dialog from here
  setTimeout(() => win.print(), 800);
}

/** Live updates (Server-Sent Events read over fetch, so the token stays in a header). Returns a stop function. */
export function live<T>(path: string, role: Role, onEvent: (e: T) => void): () => void {
  let stopped = false;
  let ctrl = new AbortController();
  const run = async () => {
    while (!stopped) {
      try {
        ctrl = new AbortController();
        const res = await fetch(`/api${path}`, { headers: { "x-session": session.get(role) ?? "" }, signal: ctrl.signal });
        if (!res.ok || !res.body) throw new Error(String(res.status));
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";
          for (const p of parts) if (p.startsWith("data: ")) onEvent(JSON.parse(p.slice(6)));
        }
      } catch {
        /* reconnect below */
      }
      if (!stopped) await new Promise((r) => setTimeout(r, 2000));
    }
  };
  void run();
  return () => {
    stopped = true;
    ctrl.abort();
  };
}

/** Reads a File as base64 (no data: prefix), downscaling photos so uploads stay small on slow networks. */
export async function fileToBase64(file: Blob, maxSide = 1600): Promise<{ data: string; type: string }> {
  if (file.type.startsWith("image/") && "createImageBitmap" in window) {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
      canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL("image/jpeg", 0.85);
      return { data: url.split(",")[1]!, type: "image/jpeg" };
    } catch {
      /* fall through to the raw file */
    }
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { data: btoa(s), type: file.type };
}
