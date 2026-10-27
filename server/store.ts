/**
 * Holds FairShift's data in memory for fast reads, saves it to Firestore after every change, and
 * broadcasts each change so open dashboards update live. Without a Google Cloud project (tests,
 * offline demos) it simply runs in memory.
 */
import { EventEmitter } from "node:events";
import type { Data } from "./seed.ts";

export type Change =
  | { type: "shift"; orgId: string; workerId: string; action: "in" | "out" | "assigned" | "amended" }
  | { type: "hazard"; orgId: string; id: string; action: "new" | "status"; severity?: number; workerId?: string }
  | { type: "feedback"; orgId: string }
  | { type: "register"; orgId: string; rows: number }
  | { type: "skill"; orgId: string; workerId: string };

const SAVE_DELAY_MS = 800;
const DOC = "fairshift/state";

export class Store {
  readonly events = new EventEmitter();
  private timer?: NodeJS.Timeout;
  private saving: Promise<unknown> = Promise.resolve();

  constructor(
    public data: Data,
    private persist?: { save(data: Data): Promise<unknown> },
  ) {
    this.events.setMaxListeners(200);
  }

  /** Call after any mutation: tells live screens, and schedules one batched save. */
  changed(change: Change) {
    this.events.emit("change", change);
    if (!this.persist) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.saving = this.persist!.save(this.data).catch((e) => console.error("firestore save:", (e as Error).message));
    }, SAVE_DELAY_MS);
  }

  /** Saves now if a save is pending (used on shutdown). */
  async flush() {
    if (this.timer && this.persist) {
      clearTimeout(this.timer);
      this.timer = undefined;
      await this.persist.save(this.data).catch(() => {});
    }
    await this.saving;
  }
}

/** Loads the saved state from Firestore, or seeds it on first run. Falls back to memory if Firestore is unreachable. */
export async function openStore(seedData: () => Data): Promise<Store> {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (!project || process.env.FAIRSHIFT_STORE === "memory") return new Store(seedData());
  try {
    const { Firestore } = await import("@google-cloud/firestore");
    const db = new Firestore({ projectId: project, ignoreUndefinedProperties: true });
    const ref = db.doc(DOC);
    const snap = await ref.get();
    const data = snap.exists && process.env.FAIRSHIFT_RESEED !== "1" ? (JSON.parse(snap.get("json")) as Data) : seedData();
    const store = new Store(data, { save: (d) => ref.set({ json: JSON.stringify(d), savedAt: new Date().toISOString() }) });
    if (!snap.exists) store.changed({ type: "feedback", orgId: "" });
    console.log(`state from ${snap.exists ? "Firestore" : "seed"}`);
    return store;
  } catch (e) {
    console.warn("Firestore unavailable, using memory:", (e as Error).message);
    return new Store(seedData());
  }
}
