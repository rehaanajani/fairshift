/** The FairShift API: one Express app serving the worker app, the employer dashboard and their JSON API. */
import express, { type NextFunction, type Request, type Response } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import QRCode from "qrcode";
import { assistant, explainPayslip, feedbackThemes, readRegister, triageHazard } from "./ai.ts";
import { issue, passportId, requireRole, samePin, verify } from "./auth.ts";
import { firstBroken, receiptCode, seal, type Receipt } from "./ledger.ts";
import { ANONYMITY_MIN, distanceM, fatigueFlags, payslip, quitRisk, restProblems, shiftHours, splitHours } from "./rules.ts";
import { DEMO, MIN_HOURLY_WAGE, seed } from "./seed.ts";
import { speechStatus, synthesize, transcribe } from "./speech.ts";
import { Store, type Change } from "./store.ts";
import { LANG_NAME, LANGS, type FeedbackTopic, type HazardStatus, type Lang, type Shift, type Worker } from "./types.ts";

const DAY = 86_400_000;
const TOPICS: FeedbackTopic[] = ["manager", "conditions", "pay", "safety"];
const STATUSES: HazardStatus[] = ["open", "acknowledged", "fixed"];
const IMAGE = /^image\/(jpeg|png|webp|heic)$/;
const AUDIO = /^audio\/(webm|ogg|wav|mp4|mpeg|x-m4a|aac)(;.*)?$/;

/** A trimmed string of at most `max` characters, or undefined. */
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const lang = (v: unknown): Lang | undefined => (LANGS.includes(v as Lang) ? (v as Lang) : undefined);
const round2 = (n: number) => Math.round(n * 100) / 100;
/** base64 payload with a size cap (bytes after decoding) */
const b64 = (v: unknown, maxBytes: number) => (typeof v === "string" && v.length > 0 && v.length <= (maxBytes * 4) / 3 + 4 && /^[A-Za-z0-9+/=]+$/.test(v) ? v : undefined);

/** Small fixed-window limiter per IP, enough to stop PIN guessing and AI abuse. */
function limit(perMinute: number) {
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
function stream(store: Store, req: Request, res: Response, keep: (c: Change) => boolean) {
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

export function createApp(store: Store = new Store(seed()), opts: { now?: () => Date } = {}) {
  const now = opts.now ?? (() => new Date());
  const data = store.data;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  // photos and voice notes are big; everything else is tiny
  const big = express.json({ limit: "8mb" });
  const small = express.json({ limit: "16kb" });
  app.use((req, res, next) => (/\/(voice|hazards|register\/import)$/.test(req.path) ? big : small)(req, res, next));
  app.use((_req, res, next) => {
    res.set({
      "Content-Security-Policy":
        "default-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
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

  // ---------- public ----------
  app.get("/api/health", (_req, res) => void res.json({ ok: true, speech: speechStatus(), receipts: data.receipts.length, chainIntact: firstBroken(data.receipts) === -1 }));

  app.get("/api/orgs", (_req, res) =>
    void res.json({
      orgs: data.orgs.map((o) => ({ id: o.id, name: o.name, sector: o.sector })),
      languages: LANGS.map((code) => ({ code, name: LANG_NAME[code] })),
      // a prototype for judges: the demo logins are shown on the login screen
      demo: { workers: data.workers.map((w) => ({ name: w.name, phone: w.phone, org: org(w.orgId).name, orgId: w.orgId, job: w.job, lang: w.lang })), workerPin: DEMO.workerPin, adminPin: DEMO.adminPin },
    }),
  );

  app.post("/api/login/worker", limit(15), (req, res) => {
    const w = data.workers.find((x) => x.phone === text(req.body?.phone, 15));
    if (!w || !samePin(String(req.body?.pin ?? ""), w.pin)) return void res.status(401).json({ error: "Phone number or PIN is wrong." });
    res.json({ token: issue({ role: "worker", workerId: w.id, orgId: w.orgId }), lang: w.lang });
  });

  app.post("/api/login/admin", limit(15), (req, res) => {
    const o = data.orgs.find((x) => x.id === text(req.body?.orgId, 40));
    if (!o || !samePin(String(req.body?.pin ?? ""), o.adminPin)) return void res.status(401).json({ error: "Employer or PIN is wrong." });
    res.json({ token: issue({ role: "admin", orgId: o.id }) });
  });

  /** Anyone (a labour inspector, a new employer) can check a receipt code; it shows hours, never personal details. */
  app.get("/api/receipts/:code", limit(30), (req, res) => {
    const code = String(req.params.code).toUpperCase();
    const i = data.receipts.findIndex((r) => receiptCode(r.hash) === code);
    if (i < 0) return void res.status(404).json({ valid: false, error: "No receipt with this code." });
    const r = data.receipts[i]!;
    const broken = firstBroken(data.receipts);
    const corrected = data.receipts.some((x) => x.kind === "correction" && x.shiftId === r.shiftId && x.at > r.at);
    res.json({ valid: broken === -1 || broken > i, corrected, receipt: { ...receiptView(r), employer: org(r.orgId).name, worker: worker(r.workerId).name.split(" ")[0] } });
  });

  /** A worker's portable skill passport: verified skills and work record, shareable with any future employer. */
  app.get("/api/passport/:id", limit(30), (req, res) => {
    const w = data.workers.find((x) => passportId(x.id) === req.params.id);
    if (!w) return void res.status(404).json({ error: "Passport not found." });
    const done = shiftsOf(w.id).filter((s) => s.end);
    const hours = Math.round(done.reduce((h, s) => h + shiftHours(s), 0));
    res.json({
      name: w.name,
      job: w.job,
      employer: org(w.orgId).name,
      sector: org(w.orgId).sector,
      since: w.joinedOn,
      shifts: done.length,
      hours,
      receipts: data.receipts.filter((r) => r.workerId === w.id).length,
      skills: data.skills.filter((k) => k.workerId === w.id).map(({ title, issuer, date, verified }) => ({ title, issuer, date, verified })),
    });
  });

  app.post("/api/speech", limit(40), async (req, res) => {
    if (!verify(req.get("authorization")?.replace(/^Bearer /, ""))) return void res.status(401).json({ error: "Please log in again." });
    const t = text(req.body?.text, 1400);
    const l = lang(req.body?.lang);
    if (!t || !l) return void res.status(400).json({ error: "Text and language are needed." });
    res.json((await synthesize(t, l)) ?? { audio: null });
  });

  // ---------- worker ----------
  const w = express.Router();
  w.use(requireRole("worker"));
  const me = (req: Request) => worker((req.session as { workerId: string }).workerId);

  function workerContext(m: Worker) {
    const o = org(m.orgId);
    const slip = payslip(m, data.shifts, o.policy, since(30), now().toISOString(), now());
    const recent = shiftsOf(m.id).filter((s) => s.start >= since(14));
    const flags = fatigueFlags(recent, o.policy, now());
    const next = data.planned.filter((p) => p.workerId === m.id && p.start > now().toISOString()).sort((a, b) => a.start.localeCompare(b.start))[0];
    return [
      `Name ${m.name}, ${m.job} at ${o.name} (${o.sector}). Pay ₹${m.hourlyRate} an hour; overtime ${o.policy.overtimeRate}× after ${o.policy.dailyHours} hours a day or ${o.policy.weeklyHours} a week.`,
      `Last 30 days: ${slip.shifts} shifts, ${slip.hours.regular} regular hours, ${slip.hours.overtime} overtime hours. Gross ₹${slip.gross}, PF ₹${-slip.lines[2]!.amount}, ESI ₹${-slip.lines[3]!.amount}, take-home ₹${slip.net}.`,
      `On shift now: ${shiftsOf(m.id).some((s) => !s.end) ? "yes" : "no"}. Next planned shift: ${next ? next.start : "none"}.`,
      `Fatigue warnings in 14 days: ${flags.length ? flags.map((f) => f.detail).join("; ") : "none"}.`,
      `Skills: ${data.skills.filter((k) => k.workerId === m.id).map((k) => k.title).join(", ") || "none recorded yet"}.`,
      `Helplines: labour grievances via the Samadhan portal or the state labour office; emergencies 112.`,
    ].join("\n");
  }

  w.get("/me", (req, res) => {
    const m = me(req);
    const o = org(m.orgId);
    const mine = shiftsOf(m.id);
    const recent = mine.filter((s) => s.start >= since(14));
    res.json({
      worker: { id: m.id, name: m.name, job: m.job, lang: m.lang, hourlyRate: m.hourlyRate, joinedOn: m.joinedOn },
      org: { name: o.name, sector: o.sector, policy: o.policy },
      site: { name: siteOf(m.orgId).name },
      onShift: mine.find((s) => !s.end) ?? null,
      hours14d: splitHours(recent.filter((s) => s.end), o.policy, now()),
      daysWorked14d: new Set(recent.map((s) => s.start.slice(0, 10))).size,
      fatigue: fatigueFlags(recent, o.policy, now()).slice(-5),
      planned: data.planned.filter((p) => p.workerId === m.id && p.end > now().toISOString()),
      receipts: data.receipts.filter((r) => r.workerId === m.id).slice(-12).reverse().map(receiptView),
      skills: data.skills.filter((k) => k.workerId === m.id),
      passport: passportId(m.id),
      hazards: data.hazards.filter((h) => h.reporterId === m.id).map(({ reporterId: _r, ...h }) => h),
    });
  });

  w.get("/events", (req, res) => {
    const m = me(req);
    stream(store, req, res, (c) => ("workerId" in c && c.workerId === m.id) || (c.type === "hazard" && c.orgId === m.orgId && c.action === "status"));
  });

  w.patch("/me", (req, res) => {
    const l = lang(req.body?.lang);
    if (!l) return void res.status(400).json({ error: "Unknown language." });
    me(req).lang = l;
    store.changed({ type: "skill", orgId: me(req).orgId, workerId: me(req).id });
    res.json({ lang: l });
  });

  w.post("/shift/check-in", (req, res) => {
    const m = me(req);
    if (shiftsOf(m.id).some((s) => !s.end)) return void res.status(409).json({ error: "You are already checked in." });
    const site = data.sites.find((s) => s.id === m.siteId)!;
    const code = text(req.body?.code, 40);
    const lat = num(req.body?.lat);
    const lng = num(req.body?.lng);
    let method: Shift["method"];
    if (code) {
      if (code.toUpperCase() !== site.checkInCode) return void res.status(400).json({ error: "This QR code is not for your site." });
      method = "qr";
    } else if (lat !== undefined && lng !== undefined) {
      const d = distanceM({ lat, lng }, site);
      if (d > site.radiusM) return void res.status(400).json({ error: `You are ${Math.round(d)} m from ${site.name}. Check in at the site.` });
      method = "gps";
    } else return void res.status(400).json({ error: "Scan the site QR code or share your location." });
    const shift: Shift = { id: randomUUID(), workerId: m.id, siteId: site.id, start: now().toISOString(), method };
    data.shifts.push(shift);
    store.changed({ type: "shift", orgId: m.orgId, workerId: m.id, action: "in" });
    res.status(201).json({ shift });
  });

  w.post("/shift/check-out", (req, res) => {
    const m = me(req);
    const open = shiftsOf(m.id).find((s) => !s.end);
    if (!open) return void res.status(409).json({ error: "You are not checked in." });
    open.end = now().toISOString();
    const r = addReceipt(open, "worker");
    store.changed({ type: "shift", orgId: m.orgId, workerId: m.id, action: "out" });
    res.json({ shift: open, receipt: receiptView(r) });
  });

  const slipFor = (req: Request) => {
    const m = me(req);
    const days = req.query.period === "week" ? 7 : 30;
    return payslip(m, data.shifts, org(m.orgId).policy, since(days), now().toISOString(), now());
  };
  w.get("/payslip", (req, res) => void res.json(slipFor(req)));

  w.post("/payslip/explain", limit(20), async (req, res) => {
    const slip = slipFor(req);
    res.json(await explainPayslip(slip.lines, slip.net, lang(req.body?.lang) ?? me(req).lang, text(req.body?.question, 300)));
  });

  /** The one-button assistant: voice (or typed text) in any of 16 languages → grounded spoken answer + next action. */
  w.post("/voice", limit(20), async (req, res) => {
    const m = me(req);
    const l = lang(req.body?.lang) ?? m.lang;
    let said = text(req.body?.text, 600);
    let heardLang = l;
    let engine: string | undefined;
    if (!said) {
      const audio = b64(req.body?.audio, 4_000_000);
      const mime = text(req.body?.mime, 60) ?? "";
      if (!audio || !AUDIO.test(mime)) return void res.status(400).json({ error: "Hold the button and speak." });
      const heard = await transcribe(Buffer.from(audio, "base64"), mime, l);
      if (!heard) return void res.status(422).json({ error: "Couldn't hear that. Try again a little closer." });
      ({ text: said, lang: heardLang, engine } = heard);
    }
    const reply = await assistant(said, heardLang, workerContext(m));
    const speech = await synthesize(reply.answer, heardLang);
    res.json({ heard: said, lang: heardLang, engine, reply, speech });
  });

  w.post("/hazards", limit(10), async (req, res) => {
    const m = me(req);
    const body = text(req.body?.text, 1000) ?? "";
    const photo = b64(req.body?.photo, 5_000_000);
    const mimeType = text(req.body?.photoType, 30) ?? "";
    if (!body && !photo) return void res.status(400).json({ error: "Tell us or show us what the danger is." });
    if (photo && !IMAGE.test(mimeType)) return void res.status(400).json({ error: "Send a JPEG or PNG photo." });
    const l = lang(req.body?.lang) ?? m.lang;
    const t = await triageHazard(body, l, org(m.orgId).sector, photo ? { data: photo, mimeType } : undefined);
    const anonymous = !!req.body?.anonymous;
    const trackCode = `SV-${randomBytes(3).toString("hex").toUpperCase()}`;
    const hazard = {
      id: randomUUID(),
      orgId: m.orgId,
      siteId: m.siteId,
      ...(anonymous ? {} : { reporterId: m.id }),
      text: body || "(photo report)",
      lang: l,
      category: t.category,
      severity: t.severity,
      summary: t.summary,
      status: "open" as const,
      createdAt: now().toISOString(),
      updates: [],
      trackCode,
      hasPhoto: !!photo,
    };
    data.hazards.push(hazard);
    store.changed({ type: "hazard", orgId: m.orgId, id: hazard.id, action: "new", severity: t.severity });
    const spoken = await synthesize(t.advice, l);
    res.status(201).json({ trackCode, category: t.category, severity: t.severity, advice: t.advice, speech: spoken, source: t.source });
  });

  /** Anonymous reporters follow their report with the tracking code alone. */
  w.get("/hazards/track/:code", (req, res) => {
    const h = data.hazards.find((x) => x.trackCode === String(req.params.code).toUpperCase() && x.orgId === me(req).orgId);
    if (!h) return void res.status(404).json({ error: "No report with this code." });
    res.json({ status: h.status, category: h.category, updates: h.updates, createdAt: h.createdAt });
  });

  w.post("/feedback", limit(10), (req, res) => {
    const topic = TOPICS.find((t) => t === req.body?.topic);
    const rating = num(req.body?.rating);
    if (!topic || !rating || rating < 1 || rating > 5) return void res.status(400).json({ error: "Pick a topic and a rating." });
    const orgId = me(req).orgId;
    // stored without the worker's id, and with the day only, so it cannot be traced back
    data.feedback.push({ id: randomUUID(), orgId, topic, rating: Math.round(rating) as 1, text: text(req.body?.text, 500) ?? "", day: now().toISOString().slice(0, 10) });
    store.changed({ type: "feedback", orgId });
    res.status(201).json({ ok: true });
  });

  app.use("/api/w", w);

  // ---------- employer ----------
  const a = express.Router();
  a.use(requireRole("admin"));
  const myOrg = (req: Request) => org(req.session!.orgId);
  const staffOf = (orgId: string) => data.workers.filter((x) => x.orgId === orgId);

  function personView(x: Worker) {
    const o = org(x.orgId);
    const recent = shiftsOf(x.id).filter((s) => s.start >= since(14));
    const hours = splitHours(recent.filter((s) => s.end), o.policy, now());
    const flags = fatigueFlags(recent, o.policy, now());
    const worked = new Set(recent.map((s) => s.start.slice(0, 10))).size;
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
      id: x.id, name: x.name, job: x.job, lang: x.lang, hourlyRate: x.hourlyRate,
      onShift: !!open, onShiftHours: open ? round2(shiftHours(open, now())) : 0,
      daysWorked: worked, hours, fatigue: flags.slice(-3), fatigueCount: flags.length, risk,
      skills: data.skills.filter((k) => k.workerId === x.id).map((k) => k.title),
    };
  }

  a.get("/overview", (req, res) => {
    const o = myOrg(req);
    const site = siteOf(o.id);
    const staff = staffOf(o.id);
    const ids = new Set(staff.map((x) => x.id));
    const days = Array.from({ length: 14 }, (_, i) => new Date(now().getTime() - (13 - i) * DAY).toISOString().slice(0, 10));
    const attendance = days.map((d) => ({ day: d, present: new Set(data.shifts.filter((s) => s.start.slice(0, 10) === d && ids.has(s.workerId)).map((s) => s.workerId)).size }));
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
        return { topic: t, count: xs.length, avg: xs.length >= ANONYMITY_MIN ? Math.round((xs.reduce((s, f) => s + f.rating, 0) / xs.length) * 10) / 10 : null };
      }),
      ledger: {
        receipts: receipts.length,
        corrections: receipts.filter((r) => r.kind === "correction").length,
        intact: firstBroken(data.receipts) === -1,
        latest: receipts.slice(-6).reverse().map((r) => ({ ...receiptView(r), name: worker(r.workerId).name })),
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
    const fb = data.feedback.filter((f) => f.orgId === req.session!.orgId);
    if (fb.length < ANONYMITY_MIN) return void res.json({ themes: [], action: "Not enough feedback yet to show without identifying anyone.", source: "rules" });
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
    res.type("image/svg+xml").send(await QRCode.toString(site.checkInCode, { type: "svg", margin: 1, width: 240, color: { dark: "#0b3d2e", light: "#ffffff" } }));
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
    if (!x || !start || Number.isNaN(Date.parse(start)) || !hours || hours <= 0 || hours > 16) return void res.status(400).json({ error: "Pick a worker, a start time and 1-16 hours." });
    const s = new Date(start).toISOString();
    const e = new Date(Date.parse(start) + hours * 3_600_000).toISOString();
    const busy = (id: string) => [...shiftsOf(id), ...data.planned.filter((p) => p.workerId === id)];
    const problems = restProblems(busy(x.id), s, e, o.policy, now());
    const override = text(req.body?.override, 200);
    if (problems.length && !override) {
      const mySkills = new Set(data.skills.filter((k) => k.workerId === x.id).map((k) => k.title));
      const alternatives = staffOf(o.id)
        .filter((p) => p.id !== x.id && restProblems(busy(p.id), s, e, o.policy, now()).length === 0)
        .map((p) => ({ id: p.id, name: p.name, job: p.job, sameJob: p.job === x.job, sharedSkills: data.skills.filter((k) => k.workerId === p.id && mySkills.has(k.title)).length, risk: personView(p).risk.score }))
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
    if (!reason || !start || !end || Number.isNaN(Date.parse(start)) || Date.parse(end) <= Date.parse(start)) return void res.status(400).json({ error: "Give the corrected times and a reason." });
    s.start = new Date(start).toISOString();
    s.end = new Date(end).toISOString();
    const r = addReceipt(s, "admin", "correction", reason);
    store.changed({ type: "shift", orgId: req.session!.orgId, workerId: s.workerId, action: "amended" });
    res.json({ receipt: receiptView(r) });
  });

  /**
   * Paper register → FairShift: Gemini reads a photo of the handwritten book, we match names to staff
   * (adding new ones), record every shift with a receipt, and point out overtime the paper never counted.
   */
  a.post("/register/import", limit(6), async (req, res) => {
    const o = myOrg(req);
    const photo = b64(req.body?.photo, 6_000_000);
    const mimeType = text(req.body?.photoType, 30) ?? "";
    if (!photo || !IMAGE.test(mimeType)) return void res.status(400).json({ error: "Send a clear JPEG or PNG photo of the register page." });
    const rows = await readRegister({ data: photo, mimeType }, now().getUTCFullYear());
    if (!rows) return void res.status(503).json({ error: "Couldn't read the register right now. Try a sharper, well-lit photo." });
    const site = siteOf(o.id);
    const norm = (n: string) => n.toLowerCase().replace(/[^a-z ]/g, "").trim();
    const added: string[] = [];
    const imported: Shift[] = [];
    for (const r of rows) {
      let x = data.workers.find((p) => p.orgId === o.id && (norm(p.name) === norm(r.name) || norm(p.name).split(" ")[0] === norm(r.name).split(" ")[0]));
      if (!x) {
        x = { id: `w${randomBytes(3).toString("hex")}`, orgId: o.id, siteId: site.id, name: r.name.slice(0, 60), phone: `9${randomBytes(4).readUInt32BE() % 1e9}`.padEnd(10, "0"), pin: DEMO.workerPin, job: "Worker", lang: "hi", hourlyRate: MIN_HOURLY_WAGE, joinedOn: r.date };
        data.workers.push(x);
        added.push(x.name);
      }
      // register times are local (IST); stored as UTC
      const start = new Date(`${r.date}T${r.in.padStart(5, "0")}:00+05:30`);
      let end = new Date(`${r.date}T${r.out.padStart(5, "0")}:00+05:30`);
      if (end <= start) end = new Date(end.getTime() + DAY);
      if (Number.isNaN(start.getTime()) || shiftsOf(x.id).some((s) => s.start === start.toISOString())) continue;
      const shift: Shift = { id: randomUUID(), workerId: x.id, siteId: site.id, start: start.toISOString(), end: end.toISOString(), method: "manual" };
      data.shifts.push(shift);
      addReceipt(shift, "register-import");
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
    res.json({ rowsRead: rows.length, imported: imported.length, added, findings });
  });

  /** Statutory registers (attendance/muster roll, overtime, wages) for the last 30 days, ready for a labour inspection. */
  a.get("/registers/:kind", (req, res) => {
    const o = myOrg(req);
    const kind = String(req.params.kind);
    const from = since(30);
    const to = now().toISOString();
    const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
    const rows: unknown[][] = [];
    if (kind === "attendance") {
      rows.push(["Worker", "Job", "Date", "In (UTC)", "Out (UTC)", "Hours", "Method", "Receipt"]);
      for (const s of data.shifts.filter((x) => x.start >= from && worker(x.workerId).orgId === o.id).sort((p, q) => p.start.localeCompare(q.start))) {
        const r = data.receipts.findLast((x) => x.shiftId === s.id);
        rows.push([worker(s.workerId).name, worker(s.workerId).job, s.start.slice(0, 10), s.start.slice(11, 16), s.end?.slice(11, 16) ?? "on shift", round2(shiftHours(s, now())), s.method, r ? receiptCode(r.hash) : ""]);
      }
    } else if (kind === "overtime" || kind === "wages") {
      rows.push(kind === "overtime" ? ["Worker", "Job", "Regular hours", "Overtime hours", "Overtime rate (₹/h)", "Overtime pay (₹)"] : ["Worker", "Job", "Rate (₹/h)", "Regular pay", "Overtime pay", "Gross", "PF", "ESI", "Net"]);
      for (const x of staffOf(o.id)) {
        const p = payslip(x, data.shifts, o.policy, from, to, now());
        const [reg, ot, pf, esi] = p.lines;
        rows.push(kind === "overtime" ? [x.name, x.job, p.hours.regular, p.hours.overtime, ot!.rate, ot!.amount] : [x.name, x.job, x.hourlyRate, reg!.amount, ot!.amount, p.gross, -pf!.amount, -esi!.amount, p.net]);
      }
    } else return void res.status(404).json({ error: "Registers: attendance, overtime, wages." });
    res.type("text/csv").attachment(`${o.id}-${kind}-register.csv`).send(`${rows.map((r) => r.map(esc).join(",")).join("\n")}\n`);
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
