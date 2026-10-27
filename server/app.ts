/** The FairShift API: one Express app serving the worker app, the employer dashboard and their JSON API. */
import express from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { makeContext } from "./context.ts";
import { adminRoutes } from "./routes/admin.ts";
import { publicRoutes } from "./routes/public.ts";
import { workerRoutes } from "./routes/worker.ts";
import { seed, type Data } from "./seed.ts";
import { Store } from "./store.ts";

/** Takes a Store (Firestore-backed in production) or plain data (tests, offline). */
export function createApp(input: Store | Data = seed(), opts: { now?: () => Date } = {}) {
  const store = input instanceof Store ? input : new Store(input);
  const now = opts.now ?? (() => new Date());
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  // photos and voice notes are big; everything else is tiny
  const big = express.json({ limit: "8mb" });
  const small = express.json({ limit: "16kb" });
  app.use((req, res, next) => (/\/(voice|hazards|register\/(read|confirm))$/.test(req.path) ? big : small)(req, res, next));
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
  const ctx = makeContext(store, now);
  publicRoutes(app, ctx);
  app.use("/api/w", workerRoutes(ctx));
  app.use("/api/admin", adminRoutes(ctx));
  app.use("/api", (_req, res) => void res.status(404).json({ error: "Not found." }));

  // ---------- web app ----------
  const dist = join(import.meta.dirname, "..", "dist");
  if (existsSync(dist)) {
    app.use(express.static(dist, { maxAge: "1h", index: false }));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(join(dist, "index.html")));
  }
  return app;
}
