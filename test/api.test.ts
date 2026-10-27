import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { seed, type Data } from "../server/seed.ts";

process.env.FAIRSHIFT_AI = "off";

const fixed = new Date("2026-10-27T12:00:00.000Z");
let data: Data;
let server: Server;
let base: string;

beforeEach(async () => {
  process.env.FAIRSHIFT_AI = "off";
  data = seed(fixed);
  server = createApp(data, { now: () => fixed }).listen(0);
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
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
    expect(await checkedOut.json()).toMatchObject({ shift: { id: shift.id, end: fixed.toISOString() }, hours: 0, overtime: 0 });
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
