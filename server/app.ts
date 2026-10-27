/** The FairShift API: one Express app serving the worker app, the admin dashboard and their JSON API. */
import express, { type Request, type Response } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import QRCode from "qrcode";
import { explainPayslip, feedbackThemes, triageHazard } from "./ai.ts";
import { issue, requireRole, samePin } from "./auth.ts";
import { ANONYMITY_MIN, distanceM, fatigueFlags, payslip, quitRisk, shiftHours, splitHours } from "./rules.ts";
import { DEMO, MIN_HOURLY_WAGE, seed, type Data } from "./seed.ts";
import { LANGS, type FeedbackTopic, type HazardStatus, type Lang } from "./types.ts";

const DAY = 86_400_000;
const TOPICS: FeedbackTopic[] = ["manager", "conditions", "pay", "safety"];
const STATUSES: HazardStatus[] = ["open", "acknowledged", "fixed"];

/** A trimmed string of at most `max` characters, or undefined. */
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const lang = (v: unknown): Lang | undefined => (LANGS.includes(v as Lang) ? (v as Lang) : undefined);

/** Small fixed-window limiter per IP and route group, enough to stop PIN guessing and AI abuse. */
function limit(perMinute: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, res: Response, next: () => void) => {
    const key = req.ip ?? "?";
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + 60_000 });
    else if (++h.n > perMinute) return void res.status(429).json({ error: "Too many tries. Wait a minute." });
    if (hits.size > 10_000) hits.clear();
    next();
  };
}

export function createApp(data: Data = seed(), opts: { now?: () => Date } = {}) {
  const now = opts.now ?? (() => new Date());
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "16kb" }));
  app.use((_req, res, next) => {
    res.set({
      "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "camera=(self), microphone=(self), geolocation=(self)",
      "Strict-Transport-Security": "max-age=31536000",
    });
    next();
  });

  const worker = (id: string) => data.workers.find((w) => w.id === id)!;
  const org = (id: string) => data.orgs.find((o) => o.id === id)!;
  const siteOf = (orgId: string) => data.sites.find((s) => s.orgId === orgId)!;
  const shiftsOf = (workerId: string) => data.shifts.filter((s) => s.workerId === workerId);
  const since = (days: number) => new Date(now().getTime() - days * DAY).toISOString();

  // ---------- public ----------
  app.get("/api/health", (_req, res) => void res.json({ ok: true }));

  app.get("/api/orgs", (_req, res) =>
    void res.json({
      orgs: data.orgs.map((o) => ({ id: o.id, name: o.name, sector: o.sector })),
      // a prototype for judges: the demo logins are shown on the login screen
      demo: { workers: data.workers.map((w) => ({ name: w.name, phone: w.phone, org: org(w.orgId).name, lang: w.lang })), workerPin: DEMO.workerPin, adminPin: DEMO.adminPin },
    }),
  );

  app.post("/api/login/worker", limit(10), (req, res) => {
    const w = data.workers.find((x) => x.phone === text(req.body?.phone, 15));
    if (!w || !samePin(String(req.body?.pin ?? ""), w.pin)) return void res.status(401).json({ error: "Phone number or PIN is wrong." });
    res.json({ token: issue({ role: "worker", workerId: w.id, orgId: w.orgId }), lang: w.lang });
  });

  app.post("/api/login/admin", limit(10), (req, res) => {
    const o = data.orgs.find((x) => x.id === text(req.body?.orgId, 40));
    if (!o || !samePin(String(req.body?.pin ?? ""), o.adminPin)) return void res.status(401).json({ error: "Employer or PIN is wrong." });
    res.json({ token: issue({ role: "admin", orgId: o.id }) });
  });

  // ---------- worker ----------
  const w = express.Router();
  w.use(requireRole("worker"));
  const me = (req: Request) => worker((req.session as { workerId: string }).workerId);

  w.get("/me", (req, res) => {
    const m = me(req);
    const o = org(m.orgId);
    const mine = shiftsOf(m.id);
    const recent = mine.filter((s) => s.start >= since(14));
    res.json({
      worker: { id: m.id, name: m.name, job: m.job, lang: m.lang, hourlyRate: m.hourlyRate },
      org: { name: o.name, sector: o.sector, policy: o.policy },
      site: { name: siteOf(m.orgId).name },
      onShift: mine.find((s) => !s.end) ?? null,
      recent: recent.slice(-14).reverse().map((s) => ({ ...s, hours: Math.round(shiftHours(s, now()) * 10) / 10 })),
      hours14d: splitHours(recent.filter((s) => s.end), o.policy, now()),
      fatigue: fatigueFlags(recent, o.policy, now()).slice(-5),
      skills: data.skills.filter((k) => k.workerId === m.id),
      hazards: data.hazards.filter((h) => h.reporterId === m.id).map(({ reporterId: _r, ...h }) => h),
    });
  });

  w.patch("/me", (req, res) => {
    const l = lang(req.body?.lang);
    if (!l) return void res.status(400).json({ error: "Unknown language." });
    me(req).lang = l;
    res.json({ lang: l });
  });

  w.post("/shift/check-in", (req, res) => {
    const m = me(req);
    if (shiftsOf(m.id).some((s) => !s.end)) return void res.status(409).json({ error: "You are already checked in." });
    const site = data.sites.find((s) => s.id === m.siteId)!;
    const code = text(req.body?.code, 40);
    const lat = num(req.body?.lat);
    const lng = num(req.body?.lng);
    let method: "qr" | "gps";
    if (code) {
      if (code.toUpperCase() !== site.checkInCode) return void res.status(400).json({ error: "This QR code is not for your site." });
      method = "qr";
    } else if (lat !== undefined && lng !== undefined) {
      const d = distanceM({ lat, lng }, site);
      if (d > site.radiusM) return void res.status(400).json({ error: `You are ${Math.round(d)} m from ${site.name}. Check in at the site.` });
      method = "gps";
    } else return void res.status(400).json({ error: "Scan the site QR code or share your location." });
    const shift = { id: randomUUID(), workerId: m.id, siteId: site.id, start: now().toISOString(), method };
    data.shifts.push(shift);
    res.status(201).json({ shift });
  });

  w.post("/shift/check-out", (req, res) => {
    const open = shiftsOf(me(req).id).find((s) => !s.end);
    if (!open) return void res.status(409).json({ error: "You are not checked in." });
    open.end = now().toISOString();
    const o = org(me(req).orgId);
    const h = shiftHours(open, now());
    res.json({ shift: open, hours: Math.round(h * 100) / 100, overtime: Math.max(0, Math.round((h - o.policy.dailyHours) * 100) / 100) });
  });

  const slipFor = (req: Request) => {
    const m = me(req);
    const days = req.query.period === "week" ? 7 : 30;
    return payslip(m, data.shifts, org(m.orgId).policy, since(days), now().toISOString(), now());
  };
  w.get("/payslip", (req, res) => void res.json(slipFor(req)));

  w.post("/payslip/explain", limit(20), async (req, res) => {
    const slip = slipFor(req);
    const out = await explainPayslip(slip.lines, slip.net, lang(req.body?.lang) ?? me(req).lang, text(req.body?.question, 300));
    res.json(out);
  });

  w.post("/hazards", limit(10), async (req, res) => {
    const m = me(req);
    const body = text(req.body?.text, 1000);
    if (!body) return void res.status(400).json({ error: "Tell us what the danger is." });
    const l = lang(req.body?.lang) ?? m.lang;
    const t = await triageHazard(body, l, org(m.orgId).sector);
    const at = now().toISOString();
    const hazard = {
      id: randomUUID(),
      orgId: m.orgId,
      siteId: m.siteId,
      ...(req.body?.anonymous ? {} : { reporterId: m.id }),
      text: body,
      lang: l,
      category: t.category,
      severity: t.severity,
      summary: t.summary,
      status: "open" as const,
      createdAt: at,
      updates: [],
    };
    data.hazards.push(hazard);
    res.status(201).json({ hazard: { ...hazard, reporterId: undefined }, advice: t.advice, source: t.source });
  });

  w.post("/feedback", limit(10), (req, res) => {
    const topic = TOPICS.find((t) => t === req.body?.topic);
    const rating = num(req.body?.rating);
    if (!topic || !rating || rating < 1 || rating > 5) return void res.status(400).json({ error: "Pick a topic and a rating." });
    // stored without the worker's id, and with the day only, so it cannot be traced back
    data.feedback.push({ id: randomUUID(), orgId: me(req).orgId, topic, rating: Math.round(rating) as 1, text: text(req.body?.text, 500) ?? "", day: now().toISOString().slice(0, 10) });
    res.status(201).json({ ok: true });
  });

  app.use("/api/w", w);

  // ---------- admin ----------
  const a = express.Router();
  a.use(requireRole("admin"));
  const myOrg = (req: Request) => org(req.session!.orgId);

  a.get("/overview", (req, res) => {
    const o = myOrg(req);
    const site = siteOf(o.id);
    const staff = data.workers.filter((x) => x.orgId === o.id);
    const from = since(14);
    const days = Array.from({ length: 14 }, (_, i) => new Date(now().getTime() - (13 - i) * DAY).toISOString().slice(0, 10));
    const attendance = days.map((d) => ({ day: d, present: new Set(data.shifts.filter((s) => s.start.slice(0, 10) === d && staff.some((x) => x.id === s.workerId)).map((s) => s.workerId)).size }));
    const people = staff.map((x) => {
      const recent = shiftsOf(x.id).filter((s) => s.start >= from);
      const hours = splitHours(recent.filter((s) => s.end), o.policy, now());
      const flags = fatigueFlags(recent, o.policy, now());
      const worked = new Set(recent.map((s) => s.start.slice(0, 10))).size;
      const expected = Math.min(12, Math.floor((now().getTime() - new Date(x.joinedOn).getTime()) / DAY));
      const risk = quitRisk({
        overtimeHours14d: hours.overtime,
        fatigueFlags14d: flags.length,
        missedDays14d: Math.max(0, expected - worked),
        openHazardsReported: data.hazards.filter((h) => h.reporterId === x.id && h.status !== "fixed").length,
        tenureDays: Math.floor((now().getTime() - new Date(x.joinedOn).getTime()) / DAY),
        payBelowMinimum: x.hourlyRate < MIN_HOURLY_WAGE,
      });
      return {
        id: x.id,
        name: x.name,
        job: x.job,
        lang: x.lang,
        hourlyRate: x.hourlyRate,
        onShift: recent.some((s) => !s.end),
        daysWorked: worked,
        hours,
        fatigue: flags.slice(-3),
        fatigueCount: flags.length,
        risk,
      };
    });
    const fb = data.feedback.filter((f) => f.orgId === o.id);
    res.json({
      org: { id: o.id, name: o.name, sector: o.sector, policy: o.policy },
      site: { name: site.name, checkInCode: site.checkInCode },
      onShiftNow: people.filter((p) => p.onShift).length,
      attendance,
      people: people.sort((p, q) => q.risk.score - p.risk.score),
      hazards: data.hazards
        .filter((h) => h.orgId === o.id)
        .sort((p, q) => Number(p.status === "fixed") - Number(q.status === "fixed") || q.severity - p.severity || q.createdAt.localeCompare(p.createdAt))
        .map(({ reporterId, ...h }) => ({ ...h, reporter: reporterId ? worker(reporterId).name : "Anonymous" })),
      feedback: TOPICS.map((t) => {
        const xs = fb.filter((f) => f.topic === t);
        // averages for small groups would expose individuals, so hide them
        return xs.length >= ANONYMITY_MIN ? { topic: t, count: xs.length, avg: Math.round((xs.reduce((s, f) => s + f.rating, 0) / xs.length) * 10) / 10 } : { topic: t, count: xs.length, avg: null };
      }),
    });
  });

  a.patch("/hazards/:id", (req, res) => {
    const h = data.hazards.find((x) => x.id === req.params.id && x.orgId === req.session!.orgId);
    const status = STATUSES.find((s) => s === req.body?.status);
    if (!h) return void res.status(404).json({ error: "Report not found." });
    if (!status) return void res.status(400).json({ error: "Unknown status." });
    h.status = status;
    h.updates.push({ at: now().toISOString(), status, note: text(req.body?.note, 300) ?? "" });
    res.json({ ok: true });
  });

  a.get("/feedback/themes", limit(10), async (req, res) => {
    const fb = data.feedback.filter((f) => f.orgId === req.session!.orgId);
    if (fb.length < ANONYMITY_MIN) return void res.json({ themes: [], action: "Not enough feedback yet to show without identifying anyone.", source: "rules" });
    res.json(await feedbackThemes(fb));
  });

  a.post("/site/rotate-code", (req, res) => {
    const site = siteOf(req.session!.orgId);
    site.checkInCode = `${site.checkInCode.split("-")[0]}-${randomBytes(3).toString("hex").toUpperCase().slice(0, 4)}`;
    res.json({ checkInCode: site.checkInCode });
  });

  a.get("/site/qr", async (req, res) => {
    const site = siteOf(req.session!.orgId);
    res.type("image/svg+xml").send(await QRCode.toString(site.checkInCode, { type: "svg", margin: 1, width: 240 }));
  });

  a.post("/skills", (req, res) => {
    const x = data.workers.find((p) => p.id === text(req.body?.workerId, 20) && p.orgId === req.session!.orgId);
    const title = text(req.body?.title, 120);
    if (!x || !title) return void res.status(400).json({ error: "Pick a worker and a skill." });
    const skill = { id: randomUUID(), workerId: x.id, title, issuer: myOrg(req).name, date: now().toISOString().slice(0, 10), verified: true };
    data.skills.push(skill);
    res.status(201).json({ skill });
  });

  app.use("/api/admin", a);
  app.use("/api", (_req, res) => void res.status(404).json({ error: "Not found." }));

  // ---------- web app ----------
  const dist = join(import.meta.dirname, "..", "dist");
  if (existsSync(dist)) {
    app.use(express.static(dist, { maxAge: "1h", index: false }));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(join(dist, "index.html")));
  }
  return app;
}
