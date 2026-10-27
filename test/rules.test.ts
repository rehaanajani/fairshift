import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, distanceM, fatigueFlags, payslip, quitRisk, restProblems, splitHours, type RiskInput } from "../server/rules.ts";
import type { Shift, Worker } from "../server/types.ts";

process.env.FAIRSHIFT_AI = "off";

const HOUR = 3_600_000;
const fixed = new Date("2026-10-27T12:00:00.000Z");
const worker: Worker = {
  id: "worker",
  orgId: "orion",
  siteId: "site",
  name: "Test worker",
  phone: "9000000001",
  pin: "1234",
  job: "Mason",
  lang: "en",
  hourlyRate: 100,
  joinedOn: "2025-01-01",
};
const shift = (start: string, hours: number): Shift => ({
  id: start,
  workerId: worker.id,
  siteId: worker.siteId,
  start,
  end: new Date(new Date(start).getTime() + hours * HOUR).toISOString(),
  method: "qr",
});
const days = (hours: number, count: number) => Array.from({ length: count }, (_, i) => shift(new Date(Date.UTC(2026, 9, 19 + i, 8)).toISOString(), hours));

describe("splitHours", () => {
  it("returns zero hours for no shifts", () => {
    expect(splitHours([], DEFAULT_POLICY, fixed)).toEqual({ regular: 0, overtime: 0, dailyOvertime: 0, weeklyOvertime: 0 });
  });

  it.each([
    { hours: 9, regular: 9, overtime: 0 },
    { hours: 11, regular: 9, overtime: 2 },
  ])("splits a $hours hour shift at the daily limit", ({ hours, regular, overtime }) => {
    expect(splitHours(days(hours, 1), DEFAULT_POLICY, fixed)).toEqual({ regular, overtime, dailyOvertime: overtime, weeklyOvertime: 0 });
  });

  it("counts weekly overtime when no day exceeds the daily limit", () => {
    expect(splitHours(days(8, 7), DEFAULT_POLICY, fixed)).toEqual({ regular: 48, overtime: 8, dailyOvertime: 0, weeklyOvertime: 8 });
  });

  it("keeps exactly 48 weekly hours regular", () => {
    expect(splitHours(days(8, 6), DEFAULT_POLICY, fixed)).toEqual({ regular: 48, overtime: 0, dailyOvertime: 0, weeklyOvertime: 0 });
  });

  it("never counts daily overtime again as weekly overtime", () => {
    const result = splitHours(days(11, 6), DEFAULT_POLICY, fixed);
    expect(result).toEqual({ regular: 48, overtime: 18, dailyOvertime: 12, weeklyOvertime: 6 });
    expect(result.regular + result.overtime).toBe(66);
  });

  it("starts a new weekly allowance on Monday", () => {
    // Oct 25 is Sunday; Oct 26 belongs to a new UTC week.
    expect(splitHours(days(8, 8), DEFAULT_POLICY, fixed)).toEqual({ regular: 56, overtime: 8, dailyOvertime: 0, weeklyOvertime: 8 });
  });

  it("uses the supplied time for an open shift", () => {
    const open = shift("2026-10-27T02:00:00.000Z", 0);
    delete open.end;
    expect(splitHours([open], DEFAULT_POLICY, fixed)).toEqual({ regular: 9, overtime: 1, dailyOvertime: 1, weeklyOvertime: 0 });
  });
});

describe("payslip", () => {
  const from = "2026-10-19T00:00:00.000Z";
  const to = "2026-10-26T00:00:00.000Z";

  it("deducts PF from regular pay and ESI from gross, including overtime", () => {
    const slip = payslip(worker, days(11, 6), DEFAULT_POLICY, from, to, fixed);
    expect(slip.hours).toEqual({ regular: 48, overtime: 18, dailyOvertime: 12, weeklyOvertime: 6 });
    expect(slip.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "regular", hours: 48, rate: 100, amount: 4800 }),
        expect.objectContaining({ key: "overtime", hours: 18, rate: 200, amount: 3600 }),
        expect.objectContaining({ key: "pf", amount: -576 }), // 12% of 4800
        expect.objectContaining({ key: "esi", amount: -63 }), // 0.75% of 8400
      ]),
    );
    expect(slip.gross).toBe(8400);
    expect(slip.deductions).toBe(639);
    expect(slip.net).toBe(7761);
    expect(slip.net).toBe(slip.gross - slip.deductions);
  });

  it("includes only this worker's completed shifts in [from, to)", () => {
    const included = shift(from, 8);
    const open = shift("2026-10-20T08:00:00.000Z", 8);
    delete open.end;
    const shifts = [included, open, shift("2026-10-18T08:00:00.000Z", 8), shift(to, 8), { ...shift("2026-10-21T08:00:00.000Z", 8), workerId: "someone-else" }];
    const slip = payslip(worker, shifts, DEFAULT_POLICY, from, to, fixed);
    expect(slip.shifts).toBe(1);
    expect(slip.hours.regular).toBe(8);
    expect(slip.gross).toBe(800);
  });

  it("rounds currency to paise and reconciles net with deductions", () => {
    const slip = payslip({ ...worker, hourlyRate: 95.33 }, days(9.5, 1), DEFAULT_POLICY, from, to, fixed);
    expect(slip.gross).toBe(953.3);
    expect(slip.deductions).toBe(110.11);
    expect(slip.net).toBe(843.19);
    expect(slip.net).toBeCloseTo(slip.gross - slip.deductions, 2);
  });
});

describe("fatigueFlags", () => {
  it.each([
    { hours: 12, flagged: false },
    { hours: 12.01, flagged: true },
  ])("flags a $hours hour shift only above 12 hours", ({ hours, flagged }) => {
    const flags = fatigueFlags(days(hours, 1), DEFAULT_POLICY, fixed);
    expect(flags.some((f) => f.kind === "long-shift")).toBe(flagged);
  });

  it.each([
    { rest: 10, flagged: false },
    { rest: 9.5, flagged: true },
  ])("flags $rest hours of rest only below 10 hours", ({ rest, flagged }) => {
    const first = shift("2026-10-19T08:00:00.000Z", 8);
    const second = shift(new Date(new Date(first.end!).getTime() + rest * HOUR).toISOString(), 8);
    // Deliberately unsorted input: rest is measured in chronological order.
    const flags = fatigueFlags([second, first], DEFAULT_POLICY, fixed);
    expect(flags.filter((f) => f.kind === "short-rest")).toEqual(flagged ? [expect.objectContaining({ kind: "short-rest", at: second.start })] : []);
  });

  it("flags the seventh consecutive working day, but not the sixth", () => {
    expect(fatigueFlags(days(4, 6), DEFAULT_POLICY, fixed)).toEqual([]);
    const shifts = days(4, 8);
    expect(fatigueFlags(shifts, DEFAULT_POLICY, fixed)).toEqual([expect.objectContaining({ kind: "no-day-off", at: shifts[6]!.start })]);
  });

  it("resets consecutive days after a day off", () => {
    const shifts = days(4, 8).filter((_, i) => i !== 3);
    expect(fatigueFlags(shifts, DEFAULT_POLICY, fixed).some((f) => f.kind === "no-day-off")).toBe(false);
  });

  it("does not count two shifts on one day as two working days", () => {
    const shifts = [...days(1, 6), shift("2026-10-19T20:00:00.000Z", 1)];
    expect(fatigueFlags(shifts, DEFAULT_POLICY, fixed).some((f) => f.kind === "no-day-off")).toBe(false);
  });
});

describe("restProblems", () => {
  const check = (existing: { start: string; end?: string }[], planned: Shift) => restProblems(existing, planned.start, planned.end!, DEFAULT_POLICY, fixed);

  it("rejects overlapping shifts", () => {
    expect(check([shift("2026-10-19T08:00:00.000Z", 8)], shift("2026-10-19T12:00:00.000Z", 4))).toEqual(["overlaps another shift"]);
  });

  it("treats an open shift as unfinished: nothing can be planned after it", () => {
    expect(check([{ start: "2026-10-27T08:00:00.000Z" }], shift("2026-10-27T10:00:00.000Z", 4))).toContain("still on a shift that hasn't been closed");
    expect(check([{ start: "2026-10-27T08:00:00.000Z" }], shift("2026-10-28T00:00:00.000Z", 8))).toContain("still on a shift that hasn't been closed");
  });

  it("counts working days on both sides of a new shift", () => {
    const later = [1, 2, 3, 4, 5, 6].map((d) => shift(`2026-10-${String(19 + d).padStart(2, "0")}T03:00:00.000Z`, 8));
    expect(check(later, shift("2026-10-19T03:00:00.000Z", 8))).toContain("day 7 in a row without a day off");
  });

  it("adds two shifts on one local day together for daily overtime", () => {
    const h = splitHours([shift("2026-10-20T02:30:00.000Z", 6), shift("2026-10-20T10:00:00.000Z", 6)], DEFAULT_POLICY, fixed);
    expect(h).toMatchObject({ regular: 9, overtime: 3 });
  });

  it.each([
    { start: "2026-10-20T01:30:00.000Z", rest: 9.5 },
    { start: "2026-10-20T02:00:00.000Z", rest: 10 },
  ])("requires ten hours of rest before a planned shift ($rest hours)", ({ start, rest }) => {
    const problems = check([shift("2026-10-19T08:00:00.000Z", 8)], shift(start, 8));
    expect(problems).toEqual(rest < 10 ? ["only 9.5 hours of rest next to another shift (needs 10)"] : []);
  });

  it("also checks rest before an existing future shift", () => {
    expect(check([shift("2026-10-20T01:30:00.000Z", 8)], shift("2026-10-19T08:00:00.000Z", 8))).toEqual([
      "only 9.5 hours of rest next to another shift (needs 10)",
    ]);
  });

  it.each([12, 12.5])("rejects planned shifts only above the 12-hour maximum (%s hours)", (hours) => {
    expect(check([], shift("2026-10-19T08:00:00.000Z", hours))).toEqual(hours > 12 ? ["12.5 hour shift is over the 12 hour limit"] : []);
  });

  it.each([10, 11])("checks weekly hours against the 60-hour cap (%s hours added)", (hours) => {
    // Five ten-hour days plus Saturday: exactly 60 is allowed, 61 is refused.
    expect(check(days(10, 5), shift("2026-10-24T08:00:00.000Z", hours))).toEqual(hours === 11 ? ["would make 61 hours this week"] : []);
  });

  it("does not add last week's hours to a new Monday", () => {
    expect(check(days(10, 6), shift("2026-10-26T08:00:00.000Z", 8))).toEqual([]);
  });

  it("rejects the seventh consecutive working day", () => {
    expect(check(days(4, 6), shift("2026-10-25T08:00:00.000Z", 4))).toEqual(["day 7 in a row without a day off"]);
  });

  it("allows a shift after a day off resets the streak", () => {
    expect(check(days(4, 5), shift("2026-10-25T08:00:00.000Z", 4))).toEqual([]);
  });
});

describe("quitRisk", () => {
  const baseline: RiskInput = {
    overtimeHours14d: 0,
    fatigueFlags14d: 0,
    missedDays14d: 0,
    openHazardsReported: 0,
    tenureDays: 90,
    payBelowMinimum: false,
  };

  it("has low risk and no reasons without risk signals", () => {
    expect(quitRisk(baseline)).toEqual({ score: 0, level: "low", reasons: [] });
  });

  it.each([
    { input: { fatigueFlags14d: 3 }, score: 24, level: "low" },
    { input: { missedDays14d: 5 }, score: 25, level: "medium" },
    { input: { fatigueFlags14d: 3, missedDays14d: 5 }, score: 49, level: "medium" },
    { input: { missedDays14d: 5, fatigueFlags14d: 4 }, score: 50, level: "high" },
  ])("maps score $score to $level risk", ({ input, score, level }) => {
    expect(quitRisk({ ...baseline, ...input })).toMatchObject({ score, level });
  });

  it.each([
    { input: { overtimeHours14d: 21 }, score: 21, reason: "21 overtime hours in 2 weeks" },
    { input: { fatigueFlags14d: 1 }, score: 8, reason: "1 fatigue warnings" },
    { input: { missedDays14d: 3 }, score: 15, reason: "missed 3 of the last 14 days" },
    { input: { openHazardsReported: 1 }, score: 10, reason: "1 safety report(s) still unresolved" },
    { input: { tenureDays: 89 }, score: 10, reason: "joined less than 3 months ago" },
    { input: { payBelowMinimum: true }, score: 20, reason: "hourly pay below the state minimum wage" },
  ])("explains the signal: $reason", ({ input, score, reason }) => {
    expect(quitRisk({ ...baseline, ...input })).toEqual({ score, level: "low", reasons: [reason] });
  });

  it("does not flag overtime at 20 hours or fewer than three missed days", () => {
    expect(quitRisk({ ...baseline, overtimeHours14d: 20, missedDays14d: 2 })).toEqual({ score: 0, level: "low", reasons: [] });
  });

  it("caps combined risk at 100 and retains all explanations", () => {
    const result = quitRisk({ overtimeHours14d: 100, fatigueFlags14d: 20, missedDays14d: 14, openHazardsReported: 10, tenureDays: 1, payBelowMinimum: true });
    expect(result).toMatchObject({ score: 100, level: "high" });
    expect(result.reasons).toHaveLength(6);
  });
});

describe("distanceM", () => {
  it("returns zero at the same coordinates", () => {
    expect(distanceM({ lat: 12.8236, lng: 80.0391 }, { lat: 12.8236, lng: 80.0391 })).toBe(0);
  });

  it("matches a one-degree arc at the equator in metres", () => {
    expect(distanceM({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111_194.93, 1);
  });

  it("is symmetric for two site coordinates", () => {
    const a = { lat: 12.8236, lng: 80.0391 };
    const b = { lat: 12.8454, lng: 80.0601 };
    expect(distanceM(a, b)).toBeCloseTo(distanceM(b, a), 8);
    expect(distanceM(a, b)).toBeGreaterThan(3000);
    expect(distanceM(a, b)).toBeLessThan(3500);
  });
});
