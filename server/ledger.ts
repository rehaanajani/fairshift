/**
 * Shift receipts: every completed shift (and every later correction) becomes a link in a hash chain.
 * A worker's receipt code proves their hours as recorded at the time; if anyone edits a shift, the
 * correction is a new receipt the worker sees, with the reason. Hours can't quietly disappear.
 */
import { createHash } from "node:crypto";

export interface Receipt {
  hash: string;
  prev: string;
  orgId: string;
  workerId: string;
  shiftId: string;
  start: string;
  end: string;
  hours: number;
  overtime: number;
  kind: "shift" | "correction";
  reason?: string;
  by: "worker" | "supervisor" | "admin" | "register-import";
  at: string;
}

export const GENESIS = "0".repeat(64);

const body = (r: Omit<Receipt, "hash">) =>
  JSON.stringify([r.prev, r.orgId, r.workerId, r.shiftId, r.start, r.end, r.hours, r.overtime, r.kind, r.reason ?? "", r.by, r.at]);

export function seal(chain: Receipt[], r: Omit<Receipt, "hash" | "prev">): Receipt {
  const prev = chain.at(-1)?.hash ?? GENESIS;
  const unsigned = { ...r, prev };
  return { ...unsigned, hash: createHash("sha256").update(body(unsigned)).digest("hex") };
}

/** Recomputes the whole chain; returns the index of the first tampered receipt, or -1 if intact. */
export function firstBroken(chain: Receipt[]): number {
  let prev = GENESIS;
  for (let i = 0; i < chain.length; i++) {
    const r = chain[i]!;
    if (r.prev !== prev || createHash("sha256").update(body(r)).digest("hex") !== r.hash) return i;
    prev = r.hash;
  }
  return -1;
}

/** Short code printed on the receipt: easy to read out or write down, still checked against the full hash. */
export const receiptCode = (hash: string) => `FS-${hash.slice(0, 4)}-${hash.slice(4, 8)}`.toUpperCase();
