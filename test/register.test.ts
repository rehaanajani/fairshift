import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../server/app.ts";
import { seed } from "../server/seed.ts";

process.env.FAIRSHIFT_AI = "off";
const fixed = new Date("2026-10-27T06:30:00.000Z");
const data = seed(fixed);
let server: Server;
let base = "";
let token = "";
const hash = "a".repeat(64);
const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-session": token }, body: JSON.stringify(body) });

beforeAll(async () => {
  server = createApp(data, { now: () => fixed }).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  token = (await (await post("/api/login/admin", { orgId: "orion", pin: "4321" })).json()).token;
});
afterAll(() => server.close());

describe("paper register confirm step", () => {
  it("saves nothing when any row is invalid", async () => {
    const before = data.shifts.length;
    const res = await post("/api/admin/register/confirm", {
      photoHash: hash,
      rows: [
        { name: "Murugan S", workerId: "w1", date: "2026-10-20", in: "07:30", out: "18:00" },
        { name: "Murugan S", workerId: "w1", date: "2026-10-21", in: "07:30", out: "garbage" },
      ],
    });
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toEqual([{ i: 1, problems: ["time unreadable"] }]);
    expect(data.shifts.length).toBe(before);
  });

  it("requires a chosen worker and refuses another organisation's worker", async () => {
    const res = await post("/api/admin/register/confirm", { photoHash: hash, rows: [{ name: "Anita Das", workerId: "w6", date: "2026-10-20", in: "08:00", out: "16:00" }] });
    expect(res.status).toBe(422);
  });

  it("saves a valid batch with receipts that name the photo, including overnight shifts and new workers", async () => {
    const before = data.receipts.length;
    const res = await post("/api/admin/register/confirm", {
      photoHash: hash,
      rows: [
        { name: "Murugan S", workerId: "w1", date: "2026-10-20", in: "20:00", out: "05:00" },
        { name: "Selvam K", workerId: "new", date: "2026-10-21", in: "07:00", out: "19:00" },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ imported: 2, added: ["Selvam K"] });
    const added = data.receipts.slice(before);
    expect(added).toHaveLength(2);
    expect(added.every((r) => r.reason === `register photo ${hash.slice(0, 12)}` && r.by === "register-import")).toBe(true);
    expect(added[0]!.hours).toBe(9);
  });

  it("serves a print-ready register page", async () => {
    const res = await fetch(`${base}/api/admin/registers/wages?format=html`, { headers: { "x-session": token } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("size: A4 landscape");
    expect(html).toContain("<thead>");
  });
});

describe("large uploads", () => {
  it("accepts a register photo bigger than the small-request limit (reaches validation, not a 413)", async () => {
    const res = await post("/api/admin/register/read", { photo: "A".repeat(200_000), photoType: "image/gif" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("JPEG or PNG");
  });
});
