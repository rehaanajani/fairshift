/** Routes anyone can call: health, logins, receipt checks, skill passports and speech. */
import express from "express";
import { issue, passportId, samePin, tokenOf, verify } from "../auth.ts";
import type { Context } from "../context.ts";
import { lang, limit, text } from "../http.ts";
import { firstBroken, receiptCode } from "../ledger.ts";
import { shiftHours } from "../rules.ts";
import { DEMO } from "../seed.ts";
import { speechStatus, synthesize } from "../speech.ts";
import { LANG_NAME, LANGS } from "../types.ts";

export function publicRoutes(app: express.Express, ctx: Context) {
  const { data, worker, org, shiftsOf, receiptView } = ctx;
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
    // a correction is any later link in the chain for the same shift (chain order, not clock time)
    const corrected = data.receipts.some((x, j) => j > i && x.kind === "correction" && x.shiftId === r.shiftId);
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
    if (!verify(tokenOf(req))) return void res.status(401).json({ error: "Please log in again." });
    const t = text(req.body?.text, 1400);
    const l = lang(req.body?.lang);
    if (!t || !l) return void res.status(400).json({ error: "Text and language are needed." });
    res.json((await synthesize(t, l)) ?? { audio: null });
  });
}
