/** The employer dashboard's API: overview, live events, safety queue, roster guard, crew and corrections. */
import express, { type Request } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { feedbackThemes } from "../ai.ts";
import { requireRole } from "../auth.ts";
import type { Context } from "../context.ts";
import { DAY, STATUSES, TOPICS, limit, num, round2, stream, text } from "../http.ts";
import { firstBroken, receiptCode } from "../ledger.ts";
import { ANONYMITY_MIN, fatigueFlags, localDay, quitRisk, restProblems, shiftHours, splitHours } from "../rules.ts";
import { MIN_HOURLY_WAGE } from "../seed.ts";
import { type Worker } from "../types.ts";
import { registerRoutes } from "./registers.ts";

export function adminRoutes(ctx: Context) {
  const { store, data, now, worker, org, siteOf, shiftsOf, staffOf, since, receiptView, addReceipt } = ctx;
  const a = express.Router();
  a.use(requireRole("admin"));
  const myOrg = (req: Request) => org(req.session!.orgId);

  function personView(x: Worker) {
    const o = org(x.orgId);
    const recent = shiftsOf(x.id).filter((s) => s.start >= since(14));
    const hours = splitHours(
      recent.filter((s) => s.end),
      o.policy,
      now(),
    );
    const flags = fatigueFlags(recent, o.policy, now());
    const worked = new Set(recent.map((s) => localDay(s.start))).size;
    const tenure = Math.floor((now().getTime() - new Date(x.joinedOn).getTime()) / DAY);
    const risk = quitRisk({
      overtimeHours14d: hours.overtime,
      fatigueFlags14d: flags.length,
      missedDays14d: Math.max(0, Math.min(12, tenure) - worked),
      openHazardsReported: data.hazards.filter((h) => h.reporterId === x.id && h.status !== "fixed").length,
      tenureDays: tenure,
      payBelowMinimum: x.hourlyRate < MIN_HOURLY_WAGE,
    });
    const open = shiftsOf(x.id).find((s) => !s.end);
    return {
      id: x.id,
      name: x.name,
      job: x.job,
      lang: x.lang,
      hourlyRate: x.hourlyRate,
      onShift: !!open,
      onShiftHours: open ? round2(shiftHours(open, now())) : 0,
      daysWorked: worked,
      hours,
      fatigue: flags.slice(-3),
      fatigueCount: flags.length,
      risk,
      skills: data.skills.filter((k) => k.workerId === x.id).map((k) => k.title),
    };
  }

  a.get("/overview", (req, res) => {
    const o = myOrg(req);
    const site = siteOf(o.id);
    const staff = staffOf(o.id);
    const ids = new Set(staff.map((x) => x.id));
    const days = Array.from({ length: 14 }, (_, i) => localDay(now().getTime() - (13 - i) * DAY));
    const attendance = days.map((d) => ({
      day: d,
      present: new Set(data.shifts.filter((s) => localDay(s.start) === d && ids.has(s.workerId)).map((s) => s.workerId)).size,
    }));
    const people = staff.map(personView).sort((p, q) => q.risk.score - p.risk.score);
    const fb = data.feedback.filter((f) => f.orgId === o.id);
    const receipts = data.receipts.filter((r) => r.orgId === o.id);
    res.json({
      org: { id: o.id, name: o.name, sector: o.sector, policy: o.policy },
      site: { name: site.name, checkInCode: site.checkInCode },
      headcount: staff.length,
      onShiftNow: people.filter((p) => p.onShift).length,
      overtimeHours14d: round2(people.reduce((h, p) => h + p.hours.overtime, 0)),
      overtimeCost14d: Math.round(people.reduce((c, p) => c + p.hours.overtime * p.hourlyRate * o.policy.overtimeRate, 0)),
      attendance,
      people,
      planned: data.planned.filter((p) => ids.has(p.workerId) && p.end > now().toISOString()).map((p) => ({ ...p, name: worker(p.workerId).name })),
      hazards: data.hazards
        .filter((h) => h.orgId === o.id)
        .sort((p, q) => Number(p.status === "fixed") - Number(q.status === "fixed") || q.severity - p.severity || q.createdAt.localeCompare(p.createdAt))
        .map(({ reporterId, trackCode: _t, ...h }) => ({ ...h, reporter: reporterId ? worker(reporterId).name : "Anonymous" })),
      feedback: TOPICS.map((t) => {
        const xs = fb.filter((f) => f.topic === t);
        // averages of tiny groups would expose individuals, so they stay hidden
        return {
          topic: t,
          count: xs.length,
          avg: xs.length >= ANONYMITY_MIN ? Math.round((xs.reduce((s, f) => s + f.rating, 0) / xs.length) * 10) / 10 : null,
        };
      }),
      ledger: {
        receipts: receipts.length,
        corrections: receipts.filter((r) => r.kind === "correction").length,
        intact: firstBroken(data.receipts) === -1,
        latest: receipts
          .slice(-6)
          .reverse()
          .map((r) => ({ ...receiptView(r), name: worker(r.workerId).name })),
      },
      belowMinimumWage: staff.filter((x) => x.hourlyRate < MIN_HOURLY_WAGE).map((x) => x.name),
    });
  });

  a.get("/events", (req, res) => stream(store, req, res, (c) => c.orgId === req.session!.orgId));

  a.patch("/hazards/:id", (req, res) => {
    const h = data.hazards.find((x) => x.id === req.params.id && x.orgId === req.session!.orgId);
    const status = STATUSES.find((s) => s === req.body?.status);
    if (!h) return void res.status(404).json({ error: "Report not found." });
    if (!status) return void res.status(400).json({ error: "Unknown status." });
    h.status = status;
    h.updates.push({ at: now().toISOString(), status, note: text(req.body?.note, 300) ?? "" });
    store.changed({ type: "hazard", orgId: h.orgId, id: h.id, action: "status", workerId: h.reporterId });
    res.json({ ok: true });
  });

  a.get("/feedback/themes", limit(10), async (req, res) => {
    // only topics with enough responses are released, to the model and to the screen alike
    const all = data.feedback.filter((f) => f.orgId === req.session!.orgId);
    const fb = all.filter((f) => all.filter((g) => g.topic === f.topic).length >= ANONYMITY_MIN);
    if (!fb.length) return void res.json({ themes: [], action: "Not enough feedback on any topic yet to show without identifying anyone.", source: "rules" });
    res.json(await feedbackThemes(fb));
  });

  a.post("/site/rotate-code", (req, res) => {
    const site = siteOf(req.session!.orgId);
    site.checkInCode = `${site.checkInCode.split("-")[0]}-${randomBytes(2).toString("hex").toUpperCase()}`;
    store.changed({ type: "register", orgId: site.orgId, rows: 0 });
    res.json({ checkInCode: site.checkInCode });
  });

  a.get("/site/qr", async (req, res) => {
    const site = siteOf(req.session!.orgId);
    res
      .type("image/svg+xml")
      .send(await QRCode.toString(site.checkInCode, { type: "svg", margin: 1, width: 240, color: { dark: "#0b3d2e", light: "#ffffff" } }));
  });

  a.post("/skills", (req, res) => {
    const x = data.workers.find((p) => p.id === text(req.body?.workerId, 40) && p.orgId === req.session!.orgId);
    const title = text(req.body?.title, 120);
    if (!x || !title) return void res.status(400).json({ error: "Pick a worker and a skill." });
    const skill = { id: randomUUID(), workerId: x.id, title, issuer: myOrg(req).name, date: now().toISOString().slice(0, 10), verified: true };
    data.skills.push(skill);
    store.changed({ type: "skill", orgId: x.orgId, workerId: x.id });
    res.status(201).json({ skill });
  });

  /** Plans a shift, refusing (unless overridden with a reason) when the worker hasn't rested, and suggests rested colleagues. */
  a.post("/roster", (req, res) => {
    const o = myOrg(req);
    const x = data.workers.find((p) => p.id === text(req.body?.workerId, 40) && p.orgId === o.id);
    const start = text(req.body?.start, 40);
    const hours = num(req.body?.hours);
    if (!x || !start || Number.isNaN(Date.parse(start)) || !hours || hours <= 0 || hours > 16)
      return void res.status(400).json({ error: "Pick a worker, a start time and 1-16 hours." });
    const s = new Date(start).toISOString();
    const e = new Date(Date.parse(start) + hours * 3_600_000).toISOString();
    const busy = (id: string) => [...shiftsOf(id), ...data.planned.filter((p) => p.workerId === id)];
    const problems = restProblems(busy(x.id), s, e, o.policy, now());
    const override = text(req.body?.override, 200);
    if (problems.length && !override) {
      const mySkills = new Set(data.skills.filter((k) => k.workerId === x.id).map((k) => k.title));
      const alternatives = staffOf(o.id)
        .filter((p) => p.id !== x.id && restProblems(busy(p.id), s, e, o.policy, now()).length === 0)
        .map((p) => ({
          id: p.id,
          name: p.name,
          job: p.job,
          sameJob: p.job === x.job,
          sharedSkills: data.skills.filter((k) => k.workerId === p.id && mySkills.has(k.title)).length,
          risk: personView(p).risk.score,
        }))
        .sort((p, q) => Number(q.sameJob) - Number(p.sameJob) || q.sharedSkills - p.sharedSkills || p.risk - q.risk)
        .slice(0, 3);
      return void res.status(409).json({ error: `${x.name} needs rest.`, problems, alternatives });
    }
    const planned = { id: randomUUID(), workerId: x.id, start: s, end: e, ...(override ? { override: `${override} (rules: ${problems.join("; ")})` } : {}) };
    data.planned.push(planned);
    store.changed({ type: "shift", orgId: o.id, workerId: x.id, action: "assigned" });
    res.status(201).json({ planned });
  });

  /** A supervisor checks a whole crew in or out from one phone: for workers without smartphones. */
  a.post("/crew", (req, res) => {
    const o = myOrg(req);
    const ids: unknown[] = Array.isArray(req.body?.workerIds) ? req.body.workerIds.slice(0, 100) : [];
    const action = req.body?.action === "out" ? "out" : "in";
    const done: { name: string; receipt?: string }[] = [];
    for (const id of ids) {
      const x = data.workers.find((p) => p.id === id && p.orgId === o.id);
      if (!x) continue;
      const open = shiftsOf(x.id).find((s) => !s.end);
      if (action === "in" && !open) {
        data.shifts.push({ id: randomUUID(), workerId: x.id, siteId: x.siteId, start: now().toISOString(), method: "manual" });
        done.push({ name: x.name });
      } else if (action === "out" && open) {
        open.end = now().toISOString();
        done.push({ name: x.name, receipt: receiptCode(addReceipt(open, "supervisor").hash) });
      } else continue;
      store.changed({ type: "shift", orgId: o.id, workerId: x.id, action });
    }
    res.json({ action, done });
  });

  /** Corrects a recorded shift. The original receipt stays; the correction is a new one the worker sees with the reason. */
  a.patch("/shifts/:id", (req, res) => {
    const s = data.shifts.find((x) => x.id === req.params.id && worker(x.workerId).orgId === req.session!.orgId);
    const reason = text(req.body?.reason, 200);
    const start = text(req.body?.start, 40);
    const end = text(req.body?.end, 40);
    if (!s || !s.end) return void res.status(404).json({ error: "Completed shift not found." });
    // validate everything before touching the shift, so a rejected correction changes nothing
    const ns = start ? Date.parse(start) : NaN;
    const ne = end ? Date.parse(end) : NaN;
    if (!reason || !Number.isFinite(ns) || !Number.isFinite(ne) || ne <= ns || ne - ns > 24 * 3_600_000)
      return void res.status(400).json({ error: "Give valid corrected times (end after start, under 24 hours) and a reason." });
    s.start = new Date(ns).toISOString();
    s.end = new Date(ne).toISOString();
    const r = addReceipt(s, "admin", "correction", reason);
    store.changed({ type: "shift", orgId: req.session!.orgId, workerId: s.workerId, action: "amended" });
    res.json({ receipt: receiptView(r) });
  });
  registerRoutes(a, ctx);
  return a;
}
