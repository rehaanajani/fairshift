/** The worker phone app's API: shifts, pay, voice assistant, hazards and feedback. */
import express, { type Request } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { assistant, explainPayslip, triageHazard } from "../ai.ts";
import { passportId, requireRole } from "../auth.ts";
import type { Context } from "../context.ts";
import { AUDIO, IMAGE, TOPICS, b64, lang, limit, num, stream, text } from "../http.ts";
import { distanceM, fatigueFlags, localDay, payslip, splitHours } from "../rules.ts";
import { synthesize, transcribe } from "../speech.ts";
import { type Shift, type Worker } from "../types.ts";

export function workerRoutes(ctx: Context) {
  const { store, data, now, worker, org, siteOf, shiftsOf, since, receiptView, addReceipt } = ctx;
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
      daysWorked14d: new Set(recent.map((s) => localDay(s.start))).size,
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
    if (shiftsOf(m.id).some((s) => !s.end)) return void res.status(409).json({ error: "You are already checked in.", code: "already_in" });
    const site = data.sites.find((s) => s.id === m.siteId)!;
    const code = text(req.body?.code, 40);
    const lat = num(req.body?.lat);
    const lng = num(req.body?.lng);
    let method: Shift["method"];
    if (code) {
      if (code.toUpperCase() !== site.checkInCode) return void res.status(400).json({ error: "This QR code is not for your site.", code: "wrong_code" });
      method = "qr";
    } else if (lat !== undefined && lng !== undefined) {
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return void res.status(400).json({ error: "That location isn't valid. Turn on GPS and try again.", code: "bad_location" });
      const d = distanceM({ lat, lng }, site);
      if (d > site.radiusM) return void res.status(400).json({ error: `You are ${Math.round(d)} m from ${site.name}. Check in at the site.`, code: "too_far", meters: Math.round(d) });
      method = "gps";
    } else return void res.status(400).json({ error: "Scan the site QR code or share your location.", code: "need_code" });
    const shift: Shift = { id: randomUUID(), workerId: m.id, siteId: site.id, start: now().toISOString(), method };
    data.shifts.push(shift);
    store.changed({ type: "shift", orgId: m.orgId, workerId: m.id, action: "in" });
    res.status(201).json({ shift });
  });

  w.post("/shift/check-out", (req, res) => {
    const m = me(req);
    const open = shiftsOf(m.id).find((s) => !s.end);
    if (!open) return void res.status(409).json({ error: "You are not checked in.", code: "not_in" });
    open.end = now().toISOString();
    const r = addReceipt(open, "worker");
    store.changed({ type: "shift", orgId: m.orgId, workerId: m.id, action: "out" });
    res.json({ shift: open, hours: r.hours, overtime: r.overtime, receipt: receiptView(r) });
  });

  const slipFor = (req: Request) => {
    const m = me(req);
    const days = (req.body?.period ?? req.query.period) === "week" ? 7 : 30;
    return payslip(m, data.shifts, org(m.orgId).policy, since(days), now().toISOString(), now());
  };
  w.get("/payslip", (req, res) => void res.json(slipFor(req)));

  w.post("/payslip/explain", limit(20), async (req, res) => {
    const slip = slipFor(req);
    res.json({ ...(await explainPayslip(slip.lines, slip.net, lang(req.body?.lang) ?? me(req).lang, text(req.body?.question, 300))), from: slip.from, to: slip.to, net: slip.net });
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
    let body = text(req.body?.text, 1000) ?? "";
    const audio = b64(req.body?.audio, 4_000_000);
    const audioType = text(req.body?.audioType, 60) ?? "";
    if (!body && audio && AUDIO.test(audioType)) body = (await transcribe(Buffer.from(audio, "base64"), audioType, lang(req.body?.lang) ?? m.lang))?.text ?? "";
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
    const { reporterId: _r, trackCode: _t, ...publicHazard } = hazard as typeof hazard & { reporterId?: string };
    res.status(201).json({ hazard: publicHazard, trackCode, category: t.category, severity: t.severity, advice: t.advice, speech: spoken, source: t.source });
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
  return w;
}
