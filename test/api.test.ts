import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.ts";
import { firstBroken, receiptCode } from "../server/ledger.ts";
import { seed, type Data } from "../server/seed.ts";

process.env.FAIRSHIFT_AI = "off";

const fixed = new Date("2026-10-27T12:00:00.000Z");
let data: Data;
let server: Server;
let base: string;
let currentTime: Date;

beforeEach(async () => {
  process.env.FAIRSHIFT_AI = "off";
  // Speech synthesis checks this key independently of FAIRSHIFT_AI.
  vi.stubEnv("SARVAM_API_KEY", "");
  currentTime = new Date(fixed);
  data = seed(fixed);
  server = createApp(data, { now: () => currentTime }).listen(0);
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  try {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  } finally {
    vi.unstubAllEnvs();
  }
});

function request(path: string, options: { token?: string; method?: string; body?: unknown } = {}) {
  return fetch(`${base}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

async function workerLogin() {
  const response = await request("/api/login/worker", { method: "POST", body: { phone: "9000000001", pin: "1234" } });
  expect(response.status).toBe(200);
  const { token } = await response.json();
  expect(token).toEqual(expect.any(String));
  expect(token.length).toBeGreaterThan(0);
  return token as string;
}

async function adminLogin(orgId = "orion") {
  const response = await request("/api/login/admin", { method: "POST", body: { orgId, pin: "4321" } });
  expect(response.status).toBe(200);
  const { token } = await response.json();
  expect(token).toEqual(expect.any(String));
  return token as string;
}

type Overview = {
  org: { id: string };
  hazards: { id: string; reporter: string; reporterId?: string; status: string }[];
  feedback: { topic: string; count: number; avg: number | null }[];
};

async function overview(token: string): Promise<Overview> {
  const response = await request("/api/admin/overview", { token });
  expect(response.status).toBe(200);
  return response.json();
}

describe("login and role boundaries", () => {
  it("logs in the demo worker and requires a token for /api/w/me", async () => {
    expect((await request("/api/w/me")).status).toBe(401);
    const token = await workerLogin();
    const response = await request("/api/w/me", { token });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ worker: { id: "w1", name: "Murugan S" }, onShift: null });
  });

  it("rejects a wrong worker PIN", async () => {
    const response = await request("/api/login/worker", { method: "POST", body: { phone: "9000000001", pin: "0000" } });
    expect(response.status).toBe(401);
    expect(await response.json()).not.toHaveProperty("token");
  });

  it("rejects a worker token on the admin overview", async () => {
    const token = await workerLogin();
    expect((await request("/api/admin/overview", { token })).status).toBe(401);
  });

  it("logs in the Orion admin and rejects its token on worker routes", async () => {
    const token = await adminLogin();
    expect((await overview(token)).org.id).toBe("orion");
    expect((await request("/api/w/me", { token })).status).toBe(401);
  });
});

describe("attendance", () => {
  it("accepts the site code, prevents a second check-in, and checks out the same shift", async () => {
    const token = await workerLogin();
    const checkIn = () => request("/api/w/shift/check-in", { token, method: "POST", body: { code: "ORION-7Q4K" } });
    const response = await checkIn();
    expect(response.status).toBe(201);
    const { shift } = await response.json();
    expect(shift).toMatchObject({ workerId: "w1", siteId: "orion-towers", method: "qr", start: fixed.toISOString() });
    expect(shift).not.toHaveProperty("end");
    expect((await checkIn()).status).toBe(409);

    const me = await request("/api/w/me", { token });
    expect(await me.json()).toMatchObject({ onShift: { id: shift.id } });
    const checkedOut = await request("/api/w/shift/check-out", { token, method: "POST" });
    expect(checkedOut.status).toBe(200);
    const completed = await checkedOut.json();
    expect(completed).toMatchObject({ shift: { id: shift.id, end: fixed.toISOString() }, hours: 0, overtime: 0,
      receipt: { kind: "shift", by: "worker", hours: 0, at: fixed.toISOString() } });
    expect(completed.receipt.code).toMatch(/^FS-[0-9A-F]{4}-[0-9A-F]{4}$/);
    const verified = await request(`/api/receipts/${completed.receipt.code}`);
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ valid: true, corrected: false, receipt: completed.receipt });
    const after = await request("/api/w/me", { token });
    expect(await after.json()).toMatchObject({ onShift: null });
    expect(data.shifts.filter((s) => s.id === shift.id)).toHaveLength(1);
    expect((await request("/api/w/shift/check-out", { token, method: "POST" })).status).toBe(409);
  });

  it.each([
    { label: "wrong site code", body: { code: "CARE-3M8P" } },
    { label: "far-away GPS coordinates", body: { lat: 0, lng: 0 } },
  ])("rejects $label without creating a shift", async ({ body }) => {
    const token = await workerLogin();
    const before = data.shifts.length;
    const response = await request("/api/w/shift/check-in", { token, method: "POST", body });
    expect(response.status).toBe(400);
    expect(data.shifts).toHaveLength(before);
  });
});

describe("receipts and corrections", () => {
  it("returns 404 for an unknown public receipt code", async () => {
    const response = await request("/api/receipts/FS-UNKNOWN-CODE");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ valid: false });
  });

  it("preserves an original receipt and marks it corrected after an admin correction", async () => {
    const token = await workerLogin();
    expect((await request("/api/w/shift/check-in", { token, method: "POST", body: { code: "ORION-7Q4K" } })).status).toBe(201);
    currentTime = new Date(fixed.getTime() + 8 * 3_600_000);
    const checkout = await request("/api/w/shift/check-out", { token, method: "POST" });
    expect(checkout.status).toBe(200);
    const original = await checkout.json();
    const sealedOriginal = structuredClone(data.receipts.at(-1)!);
    const receiptCount = data.receipts.length;

    // Corrections happen later than the receipt they replace.
    currentTime = new Date(currentTime.getTime() + 60_000);
    const admin = await adminLogin();
    const reason = "Missed the first hour on the attendance record";
    const correction = await request(`/api/admin/shifts/${original.shift.id}`, {
      token: admin, method: "PATCH", body: {
        start: new Date(fixed.getTime() - 3_600_000).toISOString(), end: original.shift.end, reason,
      },
    });
    expect(correction.status).toBe(200);
    const { receipt } = await correction.json();
    expect(receipt).toMatchObject({ kind: "correction", by: "admin", reason, hours: 9, at: currentTime.toISOString() });
    expect(receipt.code).not.toBe(original.receipt.code);
    expect(data.receipts).toHaveLength(receiptCount + 1);
    expect(data.receipts[receiptCount - 1]).toEqual(sealedOriginal);
    expect(data.receipts.at(-1)).toMatchObject({ prev: sealedOriginal.hash, shiftId: original.shift.id });
    expect(firstBroken(data.receipts)).toBe(-1);

    const verified = await request(`/api/receipts/${original.receipt.code}`);
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ valid: true, corrected: true, receipt: { code: original.receipt.code, hours: 8 } });
    const latest = await request(`/api/receipts/${receipt.code}`);
    expect(latest.status).toBe(200);
    expect(await latest.json()).toMatchObject({ valid: true, corrected: false, receipt: { kind: "correction", reason, hours: 9 } });
  });
});

describe("roster rest guard", () => {
  const proposed = { workerId: "w1", start: fixed.toISOString(), hours: 8 };
  const scenarios = [
    { label: "still on shift", start: "2026-10-27T10:00:00.000Z", end: undefined, rest: 0 },
    { label: "only six hours rested", start: "2026-10-26T22:00:00.000Z", end: "2026-10-27T06:00:00.000Z", rest: 6 },
  ];

  function controlledHistory(start: string, end?: string) {
    // Isolate the decision from the seed's changing weekly workload and day streaks.
    const staff = new Set(data.workers.filter((w) => w.orgId === "orion").map((w) => w.id));
    data.shifts = data.shifts.filter((s) => !staff.has(s.workerId));
    data.planned = [];
    data.shifts.push({ id: "tired-shift", workerId: "w1", siteId: "orion-towers", start, ...(end ? { end } : {}), method: "qr" });
  }

  it.each(scenarios)("refuses a worker $label and suggests rested colleagues", async ({ start, end, rest }) => {
    controlledHistory(start, end);
    const token = await adminLogin();
    const response = await request("/api/admin/roster", { token, method: "POST", body: proposed });
    expect(response.status).toBe(409);
    const result = await response.json();
    // an open shift has no known end, so it blocks planning outright; a closed one is judged by rest hours
    expect(result.problems).toEqual(end ? [`only ${rest} hours of rest next to another shift (needs 10)`] : expect.arrayContaining(["still on a shift that hasn't been closed"]));
    expect(result.alternatives).toEqual(expect.arrayContaining([expect.objectContaining({ id: "w4", name: "Raju Naidu" })]));
    const alternatives = result.alternatives as { id: string }[];
    expect(alternatives.length).toBeGreaterThan(0);
    expect(alternatives.every((p) => p.id !== "w1" && data.workers.some((w) => w.id === p.id && w.orgId === "orion"))).toBe(true);
    expect(data.planned).toEqual([]);
    const replacement = await request("/api/admin/roster", {
      token, method: "POST", body: { ...proposed, workerId: "w4" },
    });
    expect(replacement.status).toBe(201);
    expect(await replacement.json()).toMatchObject({ planned: { workerId: "w4" } });
  });

  it.each(scenarios)("accepts an explicit override for a worker $label and records the reason", async ({ start, end, rest }) => {
    controlledHistory(start, end);
    const token = await adminLogin();
    const override = "Emergency cover approved by supervisor";
    const response = await request("/api/admin/roster", { token, method: "POST", body: { ...proposed, override } });
    expect(response.status).toBe(201);
    const { planned } = await response.json();
    expect(planned).toMatchObject({ workerId: "w1", start: fixed.toISOString(), end: "2026-10-27T20:00:00.000Z" });
    expect(planned.override).toContain(override);
    expect(planned.override).toContain(end ? `only ${rest} hours of rest` : "still on a shift");
    expect(data.planned).toEqual([planned]);
  });

  it("accepts a worker with exactly ten hours of rest without an override", async () => {
    controlledHistory("2026-10-26T18:00:00.000Z", "2026-10-27T02:00:00.000Z");
    const token = await adminLogin();
    const response = await request("/api/admin/roster", { token, method: "POST", body: proposed });
    expect(response.status).toBe(201);
    const { planned } = await response.json();
    expect(planned).toMatchObject({ workerId: "w1", start: fixed.toISOString(), end: "2026-10-27T20:00:00.000Z" });
    expect(planned).not.toHaveProperty("override");
    expect(data.planned).toEqual([planned]);
  });
});

describe("crew attendance", () => {
  it("checks a crew in and out and issues one verifiable receipt per completed shift", async () => {
    const token = await adminLogin();
    const workerIds = ["w1", "w4"];
    const before = data.receipts.length;
    const checkedIn = await request("/api/admin/crew", { token, method: "POST", body: { workerIds, action: "in" } });
    expect(checkedIn.status).toBe(200);
    expect(await checkedIn.json()).toEqual({ action: "in", done: [{ name: "Murugan S" }, { name: "Raju Naidu" }] });
    expect(data.shifts.filter((s) => workerIds.includes(s.workerId) && !s.end)).toHaveLength(2);
    currentTime = new Date(fixed.getTime() + 8 * 3_600_000);
    const checkedOut = await request("/api/admin/crew", { token, method: "POST", body: { workerIds, action: "out" } });
    expect(checkedOut.status).toBe(200);
    const result = await checkedOut.json();
    expect(result.action).toBe("out");
    expect(result.done).toHaveLength(2);
    const codes = (result.done as { receipt: string }[]).map((entry) => entry.receipt);
    expect(new Set(codes).size).toBe(2);
    expect(data.receipts).toHaveLength(before + 2);
    expect(data.shifts.filter((s) => workerIds.includes(s.workerId) && !s.end)).toHaveLength(0);
    for (const code of codes) {
      expect(code).toMatch(/^FS-[0-9A-F]{4}-[0-9A-F]{4}$/);
      const response = await request(`/api/receipts/${code}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ valid: true, receipt: { code, by: "supervisor", kind: "shift", hours: 8 } });
    }
    expect(firstBroken(data.receipts)).toBe(-1);
  });
});

describe("inspection register exports", () => {
  it.each([
    { kind: "attendance", header: '"Worker","Job","Date","In (IST)","Out (IST)","Hours","Method","Receipt"' },
    { kind: "overtime", header: '"Worker","Job","Regular hours","Overtime hours","Overtime rate (₹/h)","Overtime pay (₹)"' },
    { kind: "wages", header: '"Worker","Job","Rate (₹/h)","Regular pay","Overtime pay","Gross","PF","ESI","Net"' },
  ])("exports $kind as CSV with the expected header and organisation's rows", async ({ kind, header }) => {
    const token = await adminLogin();
    const response = await request(`/api/admin/registers/${kind}`, { token });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain(`orion-${kind}-register.csv`);
    const rows = (await response.text()).trimEnd().split("\n");
    expect(rows[0]).toBe(header);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.join("\n")).toContain('"Murugan S"');
    expect(rows.join("\n")).not.toContain('"Priya M"');
  });

  it("returns 404 for an unknown register kind", async () => {
    const token = await adminLogin();
    expect((await request("/api/admin/registers/unknown", { token })).status).toBe(404);
  });
});

describe("public skill passport", () => {
  it("uses the passport ID from /me to share skills without a phone or PIN", async () => {
    const token = await workerLogin();
    const me = await request("/api/w/me", { token });
    expect(me.status).toBe(200);
    const { passport } = await me.json();
    expect(passport).toEqual(expect.any(String));
    const response = await request(`/api/passport/${passport}`);
    expect(response.status).toBe(200);
    const publicProfile = await response.json();
    expect(publicProfile).toMatchObject({ name: "Murugan S", job: "Mason", employer: "Orion Builders" });
    expect(publicProfile.skills).toEqual(data.skills.filter((k) => k.workerId === "w1")
      .map(({ title, issuer, date, verified }) => ({ title, issuer, date, verified })));
    expect(publicProfile.skills.length).toBeGreaterThan(0);
    expect(JSON.stringify(publicProfile)).not.toMatch(/"(?:phone|pin)"\s*:/i);
    expect(JSON.stringify(publicProfile)).not.toContain("9000000001");
  });
});

describe("anonymous hazard tracking", () => {
  it("tracks an anonymous report and its updates in the same org while hiding it from another org", async () => {
    const token = await workerLogin();
    const created = await request("/api/w/hazards", { token, method: "POST", body: { text: "Exposed wire at the gate", anonymous: true } });
    expect(created.status).toBe(201);
    const { hazard, trackCode } = await created.json();
    expect(trackCode).toMatch(/^SV-[0-9A-F]{6}$/);
    expect(hazard).not.toHaveProperty("reporterId");
    const response = await request(`/api/w/hazards/track/${trackCode}`, { token });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "open", category: hazard.category, updates: [], createdAt: fixed.toISOString() });

    const admin = await adminLogin();
    expect((await request(`/api/admin/hazards/${hazard.id}`, {
      token: admin, method: "PATCH", body: { status: "acknowledged", note: "Electrician called" },
    })).status).toBe(200);
    // Another worker in Orion can use the code; the original identity is unnecessary.
    const colleague = await request("/api/login/worker", { method: "POST", body: { phone: "9000000004", pin: "1234" } });
    expect(colleague.status).toBe(200);
    const sameOrg = await request(`/api/w/hazards/track/${trackCode}`, { token: (await colleague.json()).token });
    expect(sameOrg.status).toBe(200);
    expect(await sameOrg.json()).toMatchObject({ status: "acknowledged", updates: [{ status: "acknowledged", note: "Electrician called" }] });
    const foreign = await request("/api/login/worker", { method: "POST", body: { phone: "9000000005", pin: "1234" } });
    expect(foreign.status).toBe(200);
    expect((await request(`/api/w/hazards/track/${trackCode}`, { token: (await foreign.json()).token })).status).toBe(404);
  });
});

describe("worker voice fallback", () => {
  it("classifies a Tamil pay question using rules without external speech", async () => {
    const token = await workerLogin();
    const text = "என் சம்பளம் எவ்வளவு?";
    const response = await request("/api/w/voice", { token, method: "POST", body: { text, lang: "ta" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ heard: text, lang: "ta", speech: null,
      reply: { intent: "pay", source: "rules", action: "none", answer: expect.any(String) } });
  });
});

describe("ledger health", () => {
  it("reports an intact seeded chain and detects a tampered receipt", async () => {
    const response = await request("/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, chainIntact: true, receipts: data.receipts.length });
    expect(data.receipts.length).toBeGreaterThan(0);
    const tampered = data.receipts.at(-1)!;
    const code = receiptCode(tampered.hash);
    tampered.hours += 1;
    const health = await request("/api/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ chainIntact: false });
    const verified = await request(`/api/receipts/${code}`);
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ valid: false });
  });
});

describe("hazards and anonymity", () => {
  it("shows an anonymous hazard as Anonymous without exposing a reporter ID", async () => {
    const token = await workerLogin();
    const response = await request("/api/w/hazards", {
      token, method: "POST", body: { text: "Exposed electrical wire near the gate", lang: "en", anonymous: true },
    });
    expect(response.status).toBe(201);
    const report = await response.json();
    expect(report.source).toBe("rules");
    expect(report.hazard).not.toHaveProperty("reporterId");
    expect(report.hazard.createdAt).toBe(fixed.toISOString());
    expect(data.hazards.find((h) => h.id === report.hazard.id)).not.toHaveProperty("reporterId");
    const admin = await adminLogin();
    const hazard = (await overview(admin)).hazards.find((h) => h.id === report.hazard.id);
    expect(hazard).toMatchObject({ reporter: "Anonymous", status: "open" });
    expect(hazard).not.toHaveProperty("reporterId");
  });

  it("returns 404 when an admin tries to patch another organisation's hazard", async () => {
    const foreign = data.hazards.find((h) => h.orgId === "citycare")!;
    const before = structuredClone(foreign);
    const token = await adminLogin();
    expect((await overview(token)).hazards.some((h) => h.id === foreign.id)).toBe(false);
    const response = await request(`/api/admin/hazards/${foreign.id}`, { token, method: "PATCH", body: { status: "fixed", note: "Not our report" } });
    expect(response.status).toBe(404);
    expect(foreign).toEqual(before);
  });

  it("allows an admin to update its own hazard", async () => {
    const token = await adminLogin();
    const own = data.hazards.find((h) => h.orgId === "orion")!;
    const response = await request(`/api/admin/hazards/${own.id}`, { token, method: "PATCH", body: { status: "fixed", note: "Wire insulated" } });
    expect(response.status).toBe(200);
    expect((await overview(token)).hazards.find((h) => h.id === own.id)?.status).toBe("fixed");
    expect(own.updates.at(-1)).toEqual({ at: fixed.toISOString(), status: "fixed", note: "Wire insulated" });
  });
});

describe("feedback anonymity threshold", () => {
  it("hides averages for every topic with fewer than three entries, including zero", async () => {
    const token = await adminLogin();
    expect((await overview(token)).feedback).toEqual(expect.arrayContaining([
      { topic: "manager", count: 1, avg: null },
      { topic: "conditions", count: 2, avg: null },
      { topic: "safety", count: 2, avg: null },
      { topic: "pay", count: 3, avg: 1.7 },
    ]));
    const hospital = await adminLogin("citycare");
    const feedback = (await overview(hospital)).feedback;
    expect(feedback.find((f) => f.topic === "pay")).toEqual({ topic: "pay", count: 0, avg: null });
    expect(feedback.every((f) => f.count < 3 && f.avg === null)).toBe(true);
  });

  it("reveals the average at the third entry and stores no worker ID or exact timestamp", async () => {
    const worker = await workerLogin();
    const admin = await adminLogin();
    for (const rating of [4, 5]) {
      const response = await request("/api/w/feedback", { token: worker, method: "POST", body: { topic: "manager", rating, text: "Supervisor listens" } });
      expect(response.status).toBe(201);
      const stored = data.feedback.at(-1)!;
      expect(stored).toMatchObject({ orgId: "orion", topic: "manager", day: "2026-10-27" });
      expect(stored).not.toHaveProperty("workerId");
      expect(stored).not.toHaveProperty("createdAt");
      expect((await overview(admin)).feedback.find((f) => f.topic === "manager")).toEqual({
        topic: "manager", count: rating === 4 ? 2 : 3, avg: rating === 4 ? null : 4,
      });
    }
  });
});
