/** Paper-register import (read → review → confirm) and the statutory registers (CSV and print-ready). */
import express, { type Request } from "express";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readRegister } from "../ai.ts";
import type { Context } from "../context.ts";
import { DAY, IMAGE, b64, limit, round2, text } from "../http.ts";
import { receiptCode } from "../ledger.ts";
import { SITE_UTC_OFFSET_MS, fatigueFlags, localDay, payslip, shiftHours, splitHours } from "../rules.ts";
import { DEMO, MIN_HOURLY_WAGE } from "../seed.ts";
import { type Shift, type Worker } from "../types.ts";

export function registerRoutes(a: express.Router, ctx: Context) {
  const { store, data, now, worker, org, siteOf, shiftsOf, staffOf, since, addReceipt } = ctx;
  const myOrg = (req: Request) => org(req.session!.orgId);
  /**
   * Paper register → FairShift, in two steps so nothing unchecked reaches payroll.
   * 1. read: Gemini reads the photo; we validate each row and suggest a worker match. Nothing is saved.
   * 2. confirm: the employer sends back the rows they reviewed (with the worker chosen for each); every row
   *    is validated again and all of them are saved together with sealed receipts, or none are.
   */
  const norm = (n: string) => n.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
  const MAX_SHIFT_MS = 16 * 3_600_000;
  /** Turns a register row (IST date and times) into a checked shift span, or the reasons it can't be used. */
  function checkRow(r: { date?: unknown; in?: unknown; out?: unknown }) {
    const problems: string[] = [];
    const date = text(r.date, 10) ?? "";
    const tin = text(r.in, 5) ?? "";
    const tout = text(r.out, 5) ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push("date unreadable");
    if (!/^\d{1,2}:\d{2}$/.test(tin) || !/^\d{1,2}:\d{2}$/.test(tout)) problems.push("time unreadable");
    let start = new Date(`${date}T${tin.padStart(5, "0")}:00+05:30`);
    let end = new Date(`${date}T${tout.padStart(5, "0")}:00+05:30`);
    if (!problems.length && (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))) problems.push("not a real date or time");
    if (!problems.length) {
      if (end <= start) end = new Date(end.getTime() + DAY); // ends after midnight
      if (end.getTime() - start.getTime() > MAX_SHIFT_MS) problems.push("longer than 16 hours: check the times");
      if (start > now()) problems.push("in the future");
      if (start.getTime() < now().getTime() - 400 * DAY) problems.push("more than a year old");
    }
    return { problems, start: problems.length ? null : start.toISOString(), end: problems.length ? null : end.toISOString() };
  }
  function suggest(orgId: string, name: string) {
    const staff = staffOf(orgId);
    const exact = staff.filter((p) => norm(p.name) === norm(name));
    if (exact.length === 1) return { workerId: exact[0]!.id, confidence: "exact" as const, candidates: exact.map(({ id, name }) => ({ id, name })) };
    const first = staff.filter((p) => norm(p.name).split(" ")[0] === norm(name).split(" ")[0]);
    if (first.length === 1) return { workerId: first[0]!.id, confidence: "likely" as const, candidates: first.map(({ id, name }) => ({ id, name })) };
    if (first.length > 1) return { workerId: null, confidence: "ambiguous" as const, candidates: first.map(({ id, name }) => ({ id, name })) };
    return { workerId: null, confidence: "new" as const, candidates: [] };
  }

  a.post("/register/read", limit(6), async (req, res) => {
    const o = myOrg(req);
    const photo = b64(req.body?.photo, 6_000_000);
    const mimeType = text(req.body?.photoType, 30) ?? "";
    if (!photo || !IMAGE.test(mimeType)) return void res.status(400).json({ error: "Send a clear JPEG or PNG photo of the register page." });
    const rows = await readRegister({ data: photo, mimeType }, now().getUTCFullYear());
    if (!rows) return void res.status(503).json({ error: "Couldn't read the register right now. Try a sharper, well-lit photo." });
    const photoHash = createHash("sha256").update(photo).digest("hex");
    res.json({
      photoHash,
      staff: staffOf(o.id).map(({ id, name, job }) => ({ id, name, job })),
      rows: rows.map((r, i) => {
        const c = checkRow(r);
        return { i, ...r, ...c, hours: c.start ? round2((Date.parse(c.end!) - Date.parse(c.start)) / 3_600_000) : null, match: suggest(o.id, r.name) };
      }),
    });
  });

  a.post("/register/confirm", limit(10), (req, res) => {
    const o = myOrg(req);
    const site = siteOf(o.id);
    const photoHash = /^[0-9a-f]{64}$/.test(String(req.body?.photoHash)) ? String(req.body.photoHash) : "";
    const input: unknown[] = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 300) : [];
    if (!photoHash || !input.length) return void res.status(400).json({ error: "Nothing to import." });
    // validate every row before writing anything
    const errors: { i: number; problems: string[] }[] = [];
    const planned = input.map((raw, i) => {
      const r = raw as { name?: unknown; date?: unknown; in?: unknown; out?: unknown; workerId?: unknown };
      const c = checkRow(r);
      const name = text(r.name, 60);
      const workerId = r.workerId === "new" ? "new" : data.workers.find((p) => p.id === r.workerId && p.orgId === o.id)?.id;
      if (!workerId) c.problems.push("choose who this is");
      if (workerId === "new" && !name) c.problems.push("a new worker needs a name");
      if (workerId && workerId !== "new" && c.start && shiftsOf(workerId).some((s) => s.start === c.start)) c.problems.push("this shift is already recorded");
      if (c.problems.length) errors.push({ i, problems: c.problems });
      return { name: name ?? "", workerId, start: c.start, end: c.end, date: text(r.date, 10) ?? "" };
    });
    if (errors.length) return void res.status(422).json({ error: "Some rows need fixing. Nothing was saved.", errors });

    const added: string[] = [];
    const newIds = new Map<string, string>();
    const imported: Shift[] = [];
    for (const p of planned) {
      let id = p.workerId!;
      if (id === "new") {
        id = newIds.get(norm(p.name)) ?? "";
        if (!id) {
          const w: Worker = { id: `w${randomBytes(3).toString("hex")}`, orgId: o.id, siteId: site.id, name: p.name, phone: `9${String(randomBytes(4).readUInt32BE() % 1e9).padStart(9, "0")}`, pin: DEMO.workerPin, job: "Worker", lang: "hi", hourlyRate: MIN_HOURLY_WAGE, joinedOn: p.date };
          data.workers.push(w);
          newIds.set(norm(p.name), w.id);
          added.push(w.name);
          id = w.id;
        }
      }
      const shift: Shift = { id: randomUUID(), workerId: id, siteId: site.id, start: p.start!, end: p.end!, method: "manual" };
      data.shifts.push(shift);
      // the receipt names the photo it came from, so every imported hour traces back to the page
      addReceipt(shift, "register-import", "shift", `register photo ${photoHash.slice(0, 12)}`);
      imported.push(shift);
    }
    const byWorker = new Map<string, Shift[]>();
    for (const s of imported) byWorker.set(s.workerId, [...(byWorker.get(s.workerId) ?? []), s]);
    const findings = [...byWorker].map(([id, ss]) => {
      const x = worker(id);
      const h = splitHours(ss, o.policy, now());
      return { name: x.name, shifts: ss.length, hours: round2(h.regular + h.overtime), overtime: h.overtime, overtimePay: Math.round(h.overtime * x.hourlyRate * o.policy.overtimeRate), fatigue: fatigueFlags(ss, o.policy, now()).map((f) => f.detail) };
    });
    store.changed({ type: "register", orgId: o.id, rows: imported.length });
    res.json({ imported: imported.length, added, findings });
  });

  /** Statutory registers (attendance/muster roll, overtime, wages) for the last 30 days, ready for a labour inspection. */
  const REGISTER_TITLE: Record<string, string> = { attendance: "Attendance register (muster roll)", overtime: "Overtime register", wages: "Wage register" };
  function register(kind: string, orgId: string): { header: string[]; rows: (string | number)[][]; money: number[] } | null {
    const o = org(orgId);
    const from = since(30);
    const to = now().toISOString();
    if (kind === "attendance") {
      const ist = (iso: string) => new Date(new Date(iso).getTime() + SITE_UTC_OFFSET_MS).toISOString().slice(11, 16);
      const rows = data.shifts
        .filter((x) => x.start >= from && worker(x.workerId).orgId === orgId)
        .sort((p, q) => p.start.localeCompare(q.start))
        .map((s) => {
          const r = data.receipts.findLast((x) => x.shiftId === s.id);
          return [worker(s.workerId).name, worker(s.workerId).job, localDay(s.start), ist(s.start), s.end ? ist(s.end) : "on shift", round2(shiftHours(s, now())), s.method, r ? receiptCode(r.hash) : ""];
        });
      return { header: ["Worker", "Job", "Date", "In (IST)", "Out (IST)", "Hours", "Method", "Receipt"], rows, money: [] };
    }
    if (kind === "overtime" || kind === "wages") {
      const rows = staffOf(orgId).map((x) => {
        const p = payslip(x, data.shifts, o.policy, from, to, now());
        const [reg, ot, pf, esi] = p.lines;
        return kind === "overtime" ? [x.name, x.job, p.hours.regular, p.hours.overtime, ot!.rate!, ot!.amount] : [x.name, x.job, x.hourlyRate, reg!.amount, ot!.amount, p.gross, -pf!.amount, -esi!.amount, p.net];
      });
      return kind === "overtime"
        ? { header: ["Worker", "Job", "Regular hours", "Overtime hours", "Overtime rate (₹/h)", "Overtime pay (₹)"], rows, money: [4, 5] }
        : { header: ["Worker", "Job", "Rate (₹/h)", "Regular pay", "Overtime pay", "Gross", "PF", "ESI", "Net"], rows, money: [2, 3, 4, 5, 6, 7, 8] };
    }
    return null;
  }

  a.get("/registers/:kind", (req, res) => {
    const o = myOrg(req);
    const kind = String(req.params.kind);
    const reg = register(kind, o.id);
    if (!reg) return void res.status(404).json({ error: "Registers: attendance, overtime, wages." });
    if (req.query.format === "html") {
      // a print-ready page: landscape for wide registers, header repeated on every page, money with two decimals
      const esc = (v: unknown) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
      const fmt = (v: string | number, j: number) => (reg.money.includes(j) && typeof v === "number" ? `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : esc(v));
      const landscape = reg.header.length > 6;
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(o.name)} · ${REGISTER_TITLE[kind]}</title><style>
@page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 14mm; }
body { font: 11pt/1.4 system-ui, sans-serif; color: #111; margin: 0; }
h1 { font-size: 16pt; margin: 0 0 2mm; } p { margin: 0 0 5mm; color: #444; }
table { width: 100%; border-collapse: collapse; } thead { display: table-header-group; }
th, td { border: 1px solid #999; padding: 3px 6px; text-align: left; } th { background: #eee; }
td.n { text-align: right; font-variant-numeric: tabular-nums; } tr { page-break-inside: avoid; }
</style></head><body><h1>${esc(o.name)}: ${REGISTER_TITLE[kind]}</h1><p>${esc(siteOf(o.id).name)} · last 30 days to ${localDay(now().toISOString())} · generated by FairShift from sealed shift receipts</p>
<table><thead><tr>${reg.header.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${reg.rows.map((r) => `<tr>${r.map((v, j) => `<td${typeof v === "number" ? ' class="n"' : ""}>${fmt(v, j)}</td>`).join("")}</tr>`).join("")}</tbody></table>
<script>window.onload = () => window.print()</script></body></html>`;
      return void res.type("html").set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'").send(html);
    }
    const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
    // the byte-order mark makes Excel read the rupee sign and Indian names as UTF-8
    res.type("text/csv").attachment(`${o.id}-${kind}-register.csv`).send(`\uFEFF${[reg.header, ...reg.rows].map((r) => r.map(esc).join(",")).join("\n")}\n`);
  });
}
