# Security

FairShift handles wages, safety reports and anonymous feedback, so it is built to fail closed.

| Area           | What FairShift does                                                                                                                                                                                        | Where                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Secrets        | No keys in the repo or the browser. Google services (Vertex AI, Firestore, Text-to-Speech) authenticate with the Cloud Run service account (ADC). `.env` is git-ignored; only `.env.example` is committed. | `server/ai.ts`, `server/speech.ts`, `.gitignore`    |
| Sessions       | HMAC-SHA256 signed tokens that expire after 12 hours, compared in constant time; sent in an `X-Session` header, never in a URL. The signing key lives with the app data, not in code.                      | `server/auth.ts`                                    |
| Access control | Every worker and employer route checks the role; employers only see and change their own organisation's records (tested).                                                                                  | `requireRole`, `test/api.test.ts`                   |
| Abuse          | Per-IP rate limits on logins, AI and uploads; body-size caps (16 KB normally, 8 MB only for photos and voice); every input is type-, length- and range-checked.                                            | `server/http.ts`                                    |
| Integrity      | Shifts are sealed in a hash chain; corrections are new receipts with a reason; a rejected correction changes nothing; register imports are validated in full before any write.                             | `server/ledger.ts`, `server/routes/registers.ts`    |
| Privacy        | Anonymous hazard reports store no identity; feedback stores no worker id and only the day; feedback summaries need 3+ responses per topic.                                                                 | `server/routes/worker.ts`, `server/routes/admin.ts` |
| AI safety      | Prompts treat worker text and photos as data, not instructions; answers may only use the worker's own facts; pay is never calculated by AI.                                                                | `server/ai.ts`                                      |
| Browser        | Strict Content-Security-Policy, HSTS, `nosniff`, `no-referrer`, permissions limited to camera, microphone and location.                                                                                    | `server/app.ts`                                     |
| Dependencies   | `npm audit` reports 0 vulnerabilities; CI runs typecheck, lint, tests and build on every push.                                                                                                             | `.github/workflows/ci.yml`                          |

**Prototype limits (by design for the demo):** shared demo PINs and synthetic data. A real rollout adds individual enrolment and per-organisation storage.

Report a vulnerability: open a private security advisory on this repository.
