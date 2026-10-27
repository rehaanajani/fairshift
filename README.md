# FairShift

**Every hour gets a receipt. Every worker gets a voice.**
A decent-work platform for employee-intensive workplaces (UN SDG 8), running on Google Cloud.

**Live app:** https://fairshift-85398896185.asia-south1.run.app · **Live demo (worker phone + employer dashboard side by side):** https://fairshift-85398896185.asia-south1.run.app/#/demo

Construction sites, hospitals and college campuses still run their workforce on paper registers and WhatsApp groups. Workers can't see how their pay or overtime was worked out, fear naming themselves when they complain, and report hazards only after someone is hurt. Employers can't see who is overworked or about to quit until it's too late.

FairShift fixes both sides, for people who may not read well, speak one of many Indian languages, and own a basic smartphone:

- **Workers never have to type.** They hold one button and speak in any of **16 Indian languages**. Gemini understands them, answers from their own records (pay, shifts, rest), and Google Cloud Text-to-Speech reads the answer aloud.
- **Hours can't quietly disappear.** Every completed shift is sealed into a **hash-chained receipt**. If an employer edits hours later, that becomes a new receipt the worker sees, with the reason, and any edit inside the chain breaks verification. Workers keep their receipt codes, so a wholesale rewrite would no longer match the codes they hold. Anyone can check a code.
- **Fatigue is stopped before it starts.** The roster refuses a shift that breaks rest rules and suggests a **rested colleague with the same skills**.
- **Moving off paper takes one photo.** The employer photographs the old handwritten register. Gemini reads every row, the employer **reviews and confirms** who each row belongs to, and FairShift saves the shifts (all or nothing, each receipt naming the photo) and flags **overtime the paper never counted**.

## Chosen vertical

**FairShift: Decent Work Platform (UN SDG 8, Decent Work and Economic Growth).** Persona: daily-wage and shift workers in employee-intensive workplaces (construction sites, hospitals, college campus services) who may read little, speak one of many Indian languages and own a basic smartphone, and the supervisors and employers who manage them.

## Approach and logic

FairShift is a **smart, context-aware assistant** wrapped around a ledger of facts that can't be argued with:

1. **Facts first, AI second.** Every shift is recorded (QR, GPS or crew check-in) and sealed into a hash-chained receipt. Pay, overtime, fatigue and quit risk are computed by deterministic, tested rules in `server/rules.ts`; the AI never invents a number.
2. **Decisions use the user's own context.** When a worker speaks, the assistant receives *their* records (hours, overtime, deductions, rest, next shift, skills) and answers in their language; it classifies what they need (pay, hazard, grievance, shift, leave) and offers the right next action, e.g. "Report this danger" with their words already filled in.
3. **Rules decide before harm happens.** The roster refuses a shift that breaks rest rules for *that* worker (open shift, under 10 hours' rest, 7th day in a row, weekly overload) and ranks rested colleagues by job, shared skills and risk.
4. **Privacy by design.** Anonymous reports store no identity; feedback stores no worker id, and topics are only summarised once they have 3+ responses.
5. **Humans confirm what AI reads.** Paper registers go through read → review → confirm; nothing reaches payroll until the employer checks every row.

## How it works

1. A worker opens the app in their language and checks in by scanning the site QR (or by location, or the supervisor checks the crew in).
2. At check-out they get a receipt code; their pay screen shows regular hours, overtime, PF and ESI with a plain-language reason for each line, and "Explain my pay" reads it aloud.
3. They hold the mic and ask anything; Gemini answers from their records and Cloud Text-to-Speech speaks the answer.
4. They report a danger by photo, voice or text; Gemini rates severity and gives safety advice; the employer dashboard alerts live (Server-Sent Events) and the worker sees the status change.
5. The employer sees attendance, overtime cost, fatigue and explainable quit risk, plans shifts through the rest-rule guard, imports old paper registers, and downloads or prints inspection-ready registers.

## Assumptions

- Overtime starts after the employer's daily limit (8 or 9 hours) or 48 hours a week, paid at 2×, as under India's Factories Act / OSH Code; PF is 12% of regular pay and ESI 0.75% of gross. Each employer can change these in its policy.
- Working days and weeks follow Indian Standard Time; timestamps are stored in UTC.
- The minimum-wage check uses ₹75/hour (₹600 for an 8-hour day) as the lowest applicable state rate.
- Workers have at least a basic Android or iPhone with a browser; those who don't are checked in by their supervisor.
- This is a prototype with synthetic demo data and shared demo PINs (workers 1234, employers 4321); a real rollout would use individual enrolment, per-organisation storage and multiple instances (see *Scaling* below).
- The ₹2.5 lakh/month impact figure in the video is an illustrative estimate, not a measured result.

## Problem statement coverage

| Brief asks for | FairShift | Where |
|---|---|---|
| Shift tracking, QR / location check-in, automatic overtime | QR poster scan (phone's built-in reader), GPS geofence, typed code, **crew check-in** for workers without phones; overtime split by day and week | `server/rules.ts` `splitHours`, `server/app.ts` `/w/shift/*`, `/admin/crew` |
| Clear payslips in the worker's language | Visual pay breakdown with a one-line "why" per line; Gemini explains it aloud in their language; **tamper-evident shift receipts** | `rules.ts` `payslip`, `ai.ts` `explainPayslip`, `server/ledger.ts` |
| Safety reporting by voice or text, with status tracking | Report by **photo, voice or text**; Gemini rates severity and gives safe advice in the worker's language; live alert to the manager; status visible to the worker (anonymous reporters get a tracking code) | `ai.ts` `triageHazard`, `/w/hazards`, `/admin/hazards/:id` |
| Honest, anonymous feedback | No worker id stored, day-level dates only, averages hidden until a topic has **3+ responses**; Gemini summarises themes without quoting anyone | `/w/feedback`, `ai.ts` `feedbackThemes`, `rules.ts` `ANONYMITY_MIN` |
| Skill passport | Portable passport with an unguessable QR link; employers add verified skills; used to suggest replacement workers | `/api/passport/:id`, `/admin/skills`, `/admin/roster` |
| Fatigue alerts | Long shifts, short rest, no day off, weekly overload, plus a **roster guard** that blocks unsafe shifts | `rules.ts` `fatigueFlags`, `restProblems` |
| Admin dashboard: attendance, complaints, quit risk | Live KPIs, attendance chart, safety queue, **explainable quit-risk score** (reasons, not a black box), minimum-wage check | `web/Admin.tsx`, `rules.ts` `quitRisk` |
| Multilingual voice for low-end phones | 16 languages (en, hi, bn, ta, te, kn, ml, mr, gu, pa, or, as, ur, ne, kok, mai), voice in and out, icons on every control, ~116 KB gzipped app | `server/speech.ts`, `web/i18n.ts`, `web/locales.json` |
| Inspection-ready registers | Attendance (muster roll), overtime and wage registers from sealed receipts: Excel-safe CSV, or a print-ready A4 page to save as PDF | `/admin/registers/:kind`, `?format=html` |
| **3+ working features** | 12 (above, plus paper-register import with review, crew check-in, live demo) | |
| **2 interfaces** | Worker phone app (`/#/worker`) and employer dashboard (`/#/admin`) | `web/Worker.tsx`, `web/Admin.tsx` |
| **2+ industries** | Construction site, hospital and college campus: same engine, each with its own policy, roles and hazards; switch in the dashboard | `server/seed.ts` |

## How AI is used (Google Cloud only)

| Task | Model / service |
|---|---|
| Voice assistant: understands the worker, answers from their records, picks the next action (report a hazard, give feedback) | Gemini 3.8 Flash on Vertex AI (structured JSON output) |
| Speech to text in 16 languages, including code-mixed speech | Gemini (audio input) |
| Spoken answers | Cloud Text-to-Speech, Indian voices |
| Hazard photo and text triage: category, severity, advice in the worker's language | Gemini 3.8 Flash (vision) |
| Reading handwritten paper registers | Gemini 4 Argon (vision), falling back to 3.8 Flash |
| Anonymous feedback themes | Gemini 4 Argon |
| Interface translation into 16 languages | Gemini (`scripts/translate.ts`) |

Pay, overtime, fatigue and risk are **deterministic, tested rules**, never AI guesses. Every AI call has a rule-based fallback and a timeout, so the app keeps working if a model is slow.

## Architecture

```
Worker phone (React, 16 languages) ─┐                      ┌─ Gemini on Vertex AI (3.8 Flash, 4 Argon)
                                    ├─ Cloud Run (Express) ┼─ Cloud Text-to-Speech
Employer dashboard (live via SSE) ──┘   one container      └─ Firestore (state, batched saves)
```

One Node 22 container on **Cloud Run** serves the web app and the JSON API. **Firestore** keeps the data. Changes stream to open dashboards with Server-Sent Events. The service account authenticates every Google call (ADC): **there are no API keys anywhere**. More detail is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Evaluation criteria → evidence

| Criterion | What we did |
|---|---|
| **Code quality** | TypeScript strict mode across server and web; pure rule functions separate from I/O (`rules.ts`, `ledger.ts`); small focused modules; comments explain *why* |
| **Security** | No secrets in the repo; logins travel in an `X-Session` header (never the URL); a rejected correction changes nothing; GPS and every input range-checked (`.env` ignored, `.env.example` only); Google auth via service account; HMAC-signed expiring tokens checked in constant time; role checks on every route; per-IP rate limits on logins and AI; input validation and size caps; strict CSP, HSTS, `nosniff`, `no-referrer`; prompts treat user text as data; anonymous reports never store identity |
| **Efficiency** | One container; in-memory reads with debounced, batched Firestore writes; photos downscaled on the phone before upload; fast model first, heavier models only where they matter; ~116 KB gzipped app, no UI framework bloat |
| **Testing** | 88 Vitest unit and API tests (`test/`): overtime (incl. split shifts on one day), payslips, fatigue, rest rules (open shifts, 7-day streaks both ways), quit risk, receipt-chain tampering, atomic corrections, auth and roles, cross-organisation isolation, anonymity, register review (all-or-nothing writes), registers. CI runs typecheck, tests and build on every push (`.github/workflows/ci.yml`); `npm audit` reports 0 vulnerabilities |
| **Accessibility** | WCAG AA contrast in light and dark themes (Light / Dark / Auto toggle), visible focus rings, skip links that focus the content without leaving the page, focus trapped inside dialogs, labels on every control, `aria-live` updates, keyboard-operable talk button (Space/Enter), 44 px+ touch targets, reduced-motion support, right-to-left layout for Urdu, pay, fatigue and error messages in the worker's own language, voice in and out for low literacy |
| **Problem alignment** | Every example feature in the brief is built (table above), with two interfaces and three industries |

## Run it

```bash
npm install
cp .env.example .env    # set GOOGLE_CLOUD_PROJECT; sign in with: gcloud auth application-default login
npm run dev             # API on :8080, web on :5173
npm test
```

Without a Google Cloud project it runs fully offline: in-memory data and rule-based fallbacks instead of Gemini.

**Deploy to Cloud Run**

```bash
gcloud run deploy fairshift --source . --region asia-south1 \
  --service-account <sa>@<project>.iam.gserviceaccount.com --allow-unauthenticated \
  --min-instances 1 --max-instances 1 --timeout 3600 \
  --set-env-vars GOOGLE_CLOUD_PROJECT=<project>,GOOGLE_CLOUD_LOCATION=global
```

The service account needs `roles/aiplatform.user` and `roles/datastore.user`.

**Demo logins:** workers use PIN `1234` (tap a name), employers use PIN `4321`. The demo script is in [docs/DEMO.md](docs/DEMO.md).

## Scaling beyond the prototype

- **New sector:** a new organisation with its own policy (overtime threshold, rest hours), roles and site; no code changes. A factory or warehouse works the same way.
- **Many sites:** the prototype keeps one state document on a single instance. At scale: per-organisation Firestore collections (shifts, receipts, hazards), transactions for concurrent writes, Pub/Sub for live events across Cloud Run instances, and the receipt chain's latest hash anchored daily outside the employer's control.
- **Phones without data:** an SMS or IVR channel can use the same voice assistant endpoint.
- **Payroll and compliance:** registers export as CSV and print-ready PDF, and the receipt chain gives auditors tamper evidence. Working days and weeks follow the site's local time (IST).
