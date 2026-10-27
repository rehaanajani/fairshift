/** Request helpers shared by every route: input validation, rate limiting and live-update streaming. */
import type { NextFunction, Request, Response } from "express";
import type { Change, Store } from "./store.ts";
import { LANGS, type FeedbackTopic, type HazardStatus, type Lang } from "./types.ts";

export const DAY = 86_400_000;
export const TOPICS: FeedbackTopic[] = ["manager", "conditions", "pay", "safety"];
export const STATUSES: HazardStatus[] = ["open", "acknowledged", "fixed"];
export const IMAGE = /^image\/(jpeg|png|webp|heic)$/;
export const AUDIO = /^audio\/(webm|ogg|wav|mp4|mpeg|x-m4a|aac)(;.*)?$/;

/** A trimmed string of at most `max` characters, or undefined. */
export const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
export const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
export const lang = (v: unknown): Lang | undefined => (LANGS.includes(v as Lang) ? (v as Lang) : undefined);
export const round2 = (n: number) => Math.round(n * 100) / 100;
/** base64 payload with a size cap (bytes after decoding) */
export const b64 = (v: unknown, maxBytes: number) =>
  typeof v === "string" && v.length > 0 && v.length <= (maxBytes * 4) / 3 + 4 && /^[A-Za-z0-9+/=]+$/.test(v) ? v : undefined;

/** Small fixed-window limiter per IP, enough to stop PIN guessing and AI abuse. */
export function limit(perMinute: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "?";
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + 60_000 });
    else if (++h.n > perMinute) return void res.status(429).json({ error: "Too many tries. Wait a minute." });
    if (hits.size > 10_000) hits.clear();
    next();
  };
}

/** Streams store changes to a signed-in screen (Server-Sent Events over fetch, so the token stays in a header). */
export function stream(store: Store, req: Request, res: Response, keep: (c: Change) => boolean) {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  res.write(": connected\n\n");
  const on = (c: Change) => keep(c) && res.write(`data: ${JSON.stringify(c)}\n\n`);
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  store.events.on("change", on);
  req.on("close", () => {
    clearInterval(ping);
    store.events.off("change", on);
  });
}
