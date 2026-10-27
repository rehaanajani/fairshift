/** Small shared pieces: logo, avatar, modal, async-state helper. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type ThemeChoice = "system" | "light" | "dark";
const THEME_KEY = "fairshift.theme";
const media = () => window.matchMedia?.("(prefers-color-scheme: dark)");
function applyTheme(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && !!media()?.matches);
  document.documentElement.dataset.mode = dark ? "dark" : "light";
}
/** Light, Dark or Auto (follows the phone or computer). Remembered on this device. */
export function ThemeToggle({ labels = { system: "Auto", light: "Light", dark: "Dark" } }: { labels?: Record<ThemeChoice, string> }) {
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    try {
      return (localStorage.getItem(THEME_KEY) as ThemeChoice) || "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    applyTheme(choice);
    try {
      localStorage.setItem(THEME_KEY, choice);
    } catch {
      /* private mode: the choice lasts this visit */
    }
    const m = media();
    const on = () => applyTheme(choice);
    m?.addEventListener("change", on);
    return () => m?.removeEventListener("change", on);
  }, [choice]);
  const next: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };
  const Icon = choice === "dark" ? Moon : choice === "light" ? Sun : Monitor;
  return (
    <button type="button" className="btn sm theme-toggle" onClick={() => setChoice(next[choice])} aria-label={`Theme: ${labels[choice]}. Change theme`} title={labels[choice]}>
      <Icon size={16} aria-hidden="true" /> <span>{labels[choice]}</span>
    </button>
  );
}

export function Logo({ light }: { light?: boolean }) {
  return (
    <a href="#/" className="logo" style={light ? { color: "#fff" } : undefined} aria-label="FairShift home">
      <img src="/logo.svg" alt="" width={38} height={38} />
      FairShift
    </a>
  );
}

const COLORS = ["#161714", "#6d5bd0", "#8a6d3b", "#3a39b0", "#9b3d63", "#36606b", "#5b5f52"];
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  const color = COLORS[[...name].reduce((h, c) => h + c.charCodeAt(0), 0) % COLORS.length];
  return (
    <span className="avatar" style={{ background: color, width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">
      {initials}
    </span>
  );
}

/** Skip link that focuses the main region without touching the hash route. */
export function SkipLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <a className="skip" href={`#${to}`} onClick={(e) => (e.preventDefault(), document.getElementById(to)?.focus())}>
      {children}
    </a>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("button, input, select, textarea")?.focus();
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      // keep keyboard focus inside the dialog
      if (e.key !== "Tab" || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((el) => !el.hasAttribute("disabled"));
      if (!items.length) return;
      const first = items[0]!, last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
      else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
      else if (!ref.current.contains(document.activeElement)) (e.preventDefault(), first.focus());
    };
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
