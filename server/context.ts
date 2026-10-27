/** What every route needs: the data, the clock, lookups and the receipt chain. */
import { receiptCode, seal, type Receipt } from "./ledger.ts";
import { shiftHours } from "./rules.ts";
import { DAY, round2 } from "./http.ts";
import type { Store } from "./store.ts";
import type { Shift } from "./types.ts";

export function makeContext(store: Store, now: () => Date) {
  const data = store.data;
  const worker = (id: string) => data.workers.find((w) => w.id === id)!;
  const org = (id: string) => data.orgs.find((o) => o.id === id)!;
  const siteOf = (orgId: string) => data.sites.find((s) => s.orgId === orgId)!;
  const shiftsOf = (workerId: string) => data.shifts.filter((s) => s.workerId === workerId);
  const since = (days: number) => new Date(now().getTime() - days * DAY).toISOString();
  const receiptView = (r: Receipt) => ({ code: receiptCode(r.hash), kind: r.kind, start: r.start, end: r.end, hours: r.hours, overtime: r.overtime, reason: r.reason, by: r.by, at: r.at });

  /** Seals a completed (or corrected) shift into the receipt chain. */
  function addReceipt(s: Shift, by: Receipt["by"], kind: Receipt["kind"] = "shift", reason?: string) {
    const w = worker(s.workerId);
    const hours = round2(shiftHours(s, now()));
    const r = seal(data.receipts, {
      orgId: w.orgId, workerId: w.id, shiftId: s.id, start: s.start, end: s.end!, hours,
      overtime: Math.max(0, round2(hours - org(w.orgId).policy.dailyHours)), kind, reason, by, at: now().toISOString(),
    });
    data.receipts.push(r);
    return r;
  }
  const staffOf = (orgId: string) => data.workers.filter((x) => x.orgId === orgId);

  return { store, data, now, worker, org, siteOf, shiftsOf, staffOf, since, receiptView, addReceipt };
}

export type Context = ReturnType<typeof makeContext>;
