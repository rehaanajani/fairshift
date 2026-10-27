/** Small shared pieces: logo, avatar, modal, async-state helper. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export function Logo({ light }: { light?: boolean }) {
  return (
    <a href="#/" className="logo" style={light ? { color: "#fff" } : undefined} aria-label="FairShift home">
      <span className="logo-mark" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M6 20V5h12M6 12h9" />
        </svg>
      </span>
      FairShift
    </a>
  );
}

const COLORS = ["#0b5d3b", "#b45309", "#1d4ed8", "#7c3aed", "#be123c", "#0f766e", "#a16207"];
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  const color = COLORS[[...name].reduce((h, c) => h + c.charCodeAt(0), 0) % COLORS.length];
  return (
    <span className="avatar" style={{ background: color, width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">
      {initials}
    </span>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("button, input, select, textarea")?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("keydown", esc);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal card" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="row">
          <h2 className="grow" style={{ fontSize: 20 }}>{title}</h2>
          <button type="button" className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Loads data and reloads on demand; keeps the last good value while refreshing. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      setData(await load());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, reload, setData };
}

export const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
export const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
export const SECTOR_LABEL: Record<string, string> = { construction: "Construction site", hospital: "Hospital", college: "College campus", factory: "Factory" };
