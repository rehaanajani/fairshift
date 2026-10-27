/** Signed, expiring login tokens (HMAC-SHA256). No passwords or tokens are ever stored in the browser's URL. */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export type Session = { role: "worker"; workerId: string; orgId: string } | { role: "admin"; orgId: string };

let fallback: string | undefined;
/** SESSION_SECRET, or (on Cloud Run) the random key stored with the app's data on first start. */
const secret = () => process.env.SESSION_SECRET || (fallback ??= randomBytes(32).toString("hex"));
const TTL_MS = 12 * 3_600_000;

const sign = (body: string) => createHmac("sha256", secret()).update(body).digest("base64url");

export function issue(session: Session, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...session, exp: now + TTL_MS })).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verify(token: string | undefined, now = Date.now()): Session | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { exp, ...session } = JSON.parse(Buffer.from(body, "base64url").toString());
    return typeof exp === "number" && exp > now ? (session as Session) : null;
  } catch {
    return null;
  }
}

/** Constant-time comparison for PINs. */
export function samePin(a: string, b: string): boolean {
  const x = Buffer.from(a.padEnd(16));
  const y = Buffer.from(b.padEnd(16));
  return x.length === y.length && timingSafeEqual(x, y) && a.length === b.length;
}

declare module "express-serve-static-core" {
  interface Request {
    session?: Session;
  }
}

/**
 * The login token travels in X-Session: Cloud Run treats an Authorization header as a Google identity
 * token and rejects ours before it reaches the app. Authorization is still accepted for local tools.
 */
export const tokenOf = (req: Request) => req.get("x-session") ?? req.get("authorization")?.replace(/^Bearer /, "");

export function requireRole(role: Session["role"]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const s = verify(tokenOf(req));
    if (!s || s.role !== role) return void res.status(401).json({ error: "Please log in again." });
    req.session = s;
    next();
  };
}

/** Public, unguessable id for a worker's skill passport (safe to put in a QR code). */
export const passportId = (workerId: string) => createHmac("sha256", secret()).update(`passport:${workerId}`).digest("base64url").slice(0, 16);
