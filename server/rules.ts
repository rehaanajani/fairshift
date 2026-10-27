/**
 * The rules FairShift applies to shifts: hours, overtime, pay, fatigue and quit risk.
 * Pure functions with no I/O, so every number a worker or admin sees can be tested and explained.
 */
import type { Policy, Shift, Worker } from "./types.ts";

const HOUR = 3_600_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export const DEFAULT_POLICY: Policy = {
  dailyHours: 9,
  weeklyHours: 48,
  overtimeRate: 2,
  minRestHours: 10,
  maxShiftHours: 12,
  maxConsecutiveDays: 6,
  pfRate: 0.12,
  esiRate: 0.0075,
};

export function shiftHours(s: Shift, now = new Date()): number {
  const end = s.end ? new Date(s.end) : now;
  return Math.max(0, (end.getTime() - new Date(s.start).getTime()) / HOUR);
}

/**
 * Timestamps are stored in UTC, but a working day and week follow the site's local clock (India, UTC+5:30),
 * so a 1 am shift counts on the right local date.
 */
export const SITE_UTC_OFFSET_MS = 5.5 * HOUR;
export const localDay = (iso: string | number) => new Date(new Date(iso).getTime() + SITE_UTC_OFFSET_MS).toISOString().slice(0, 10);

/** Monday of the local week a timestamp falls in, as YYYY-MM-DD. */
export function weekOf(iso: string): string {
  const d = new Date(new Date(iso).getTime() + SITE_UTC_OFFSET_MS);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export interface HoursBreakdown {
  regular: number;
  overtime: number;
  /** overtime from long days, and from weeks over the limit after daily overtime is taken out */
  dailyOvertime: number;
  weeklyOvertime: number;
}

/**
 * Splits worked hours into regular and overtime. All hours in a local working day beyond the daily limit
 * are overtime (two short shifts on one day add up); then, in each week, regular hours beyond the weekly
 * limit become overtime too. Never counted twice.
 */
export function splitHours(shifts: Shift[], policy: Policy, now = new Date()): HoursBreakdown {
  const byDay = new Map<string, number>();
  for (const s of shifts) byDay.set(localDay(s.start), (byDay.get(localDay(s.start)) ?? 0) + shiftHours(s, now));
  let dailyOvertime = 0;
  const regularByWeek = new Map<string, number>();
  for (const [day, h] of byDay) {
    const ot = Math.max(0, h - policy.dailyHours);
    dailyOvertime += ot;
    const wk = weekOf(`${day}T12:00:00+05:30`);
    regularByWeek.set(wk, (regularByWeek.get(wk) ?? 0) + h - ot);
  }
  let regular = 0;
  let weeklyOvertime = 0;
  for (const r of regularByWeek.values()) {
    const extra = Math.max(0, r - policy.weeklyHours);
    weeklyOvertime += extra;
    regular += r - extra;
  }
  return {
    regular: round2(regular),
    overtime: round2(dailyOvertime + weeklyOvertime),
    dailyOvertime: round2(dailyOvertime),
    weeklyOvertime: round2(weeklyOvertime),
  };
}

export interface PayLine {
  key: "regular" | "overtime" | "pf" | "esi";
  label: string;
  hours?: number;
  rate?: number;
  amount: number;
  /** one line a worker can understand, in English; translated and read aloud on the phone */
  why: string;
}

export interface Payslip {
  workerId: string;
  from: string;
  to: string;
  shifts: number;
  lines: PayLine[];
  gross: number;
  deductions: number;
  net: number;
  hours: HoursBreakdown;
}

export function payslip(worker: Worker, shifts: Shift[], policy: Policy, from: string, to: string, now = new Date()): Payslip {
  const inRange = shifts.filter((s) => s.workerId === worker.id && s.start >= from && s.start < to && s.end);
  const hours = splitHours(inRange, policy, now);
  const regularPay = round2(hours.regular * worker.hourlyRate);
  const otRate = round2(worker.hourlyRate * policy.overtimeRate);
  const otPay = round2(hours.overtime * otRate);
  const gross = round2(regularPay + otPay);
  const pf = round2(regularPay * policy.pfRate);
  const esi = round2(gross * policy.esiRate);
  const lines: PayLine[] = [
    {
      key: "regular",
      label: "Regular hours",
      hours: hours.regular,
      rate: worker.hourlyRate,
      amount: regularPay,
      why: `${hours.regular} hours at ₹${worker.hourlyRate} an hour.`,
    },
    {
      key: "overtime",
      label: "Overtime",
      hours: hours.overtime,
      rate: otRate,
      amount: otPay,
      why: `${hours.overtime} extra hours at ${policy.overtimeRate}× pay, ₹${otRate} an hour. Overtime counts after ${policy.dailyHours} hours in a day or ${policy.weeklyHours} in a week.`,
    },
    {
      key: "pf",
      label: "Provident Fund (your savings)",
      amount: -pf,
      why: `${policy.pfRate * 100}% of regular pay is saved in your PF account. It is still your money.`,
    },
    {
      key: "esi",
      label: "ESI (health insurance)",
      amount: -esi,
      why: `${policy.esiRate * 100}% of pay covers free treatment at ESI hospitals for you and your family.`,
    },
  ];
  return {
    workerId: worker.id,
    from,
    to,
    shifts: inRange.length,
    lines,
    gross,
    deductions: round2(pf + esi),
    net: round2(gross - pf - esi),
    hours,
  };
}

export type FatigueKind = "long-shift" | "short-rest" | "no-day-off" | "week-over-limit";
export interface FatigueFlag {
  kind: FatigueKind;
  at: string;
  detail: string;
}

/** Flags shifts that are too long, too close together, or without a weekly day off. */
export function fatigueFlags(shifts: Shift[], policy: Policy, now = new Date()): FatigueFlag[] {
  const sorted = [...shifts].sort((a, b) => a.start.localeCompare(b.start));
  const flags: FatigueFlag[] = [];
  const weekly = new Map<string, number>();
  let streak = 0;
  let lastDay = "";
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]!;
    const h = shiftHours(s, now);
    if (h > policy.maxShiftHours) flags.push({ kind: "long-shift", at: s.start, detail: `${round2(h)} hour shift (limit ${policy.maxShiftHours})` });

    const prev = sorted[i - 1];
    if (prev?.end) {
      const rest = (new Date(s.start).getTime() - new Date(prev.end).getTime()) / HOUR;
      if (rest < policy.minRestHours) flags.push({ kind: "short-rest", at: s.start, detail: `only ${round2(rest)} hours rest between shifts (need ${policy.minRestHours})` });
    }

    const day = localDay(s.start);
    if (day !== lastDay) {
      const gap = lastDay ? (new Date(day).getTime() - new Date(lastDay).getTime()) / (24 * HOUR) : 99;
      streak = gap === 1 ? streak + 1 : 1;
      lastDay = day;
      if (streak === policy.maxConsecutiveDays + 1) flags.push({ kind: "no-day-off", at: s.start, detail: `${streak} days in a row without a day off` });
    }

    const wk = weekOf(s.start);
    const before = weekly.get(wk) ?? 0;
    weekly.set(wk, before + h);
    const cap = policy.weeklyHours + 12;
    if (before <= cap && before + h > cap) flags.push({ kind: "week-over-limit", at: s.start, detail: `over ${cap} hours this week` });
  }
  return flags;
}

export interface RiskInput {
  overtimeHours14d: number;
  fatigueFlags14d: number;
  missedDays14d: number;
  openHazardsReported: number;
  tenureDays: number;
  payBelowMinimum: boolean;
}
export interface Risk {
  score: number; // 0-100
  level: "low" | "medium" | "high";
  reasons: string[];
}

/**
 * Explainable quit-risk score. Each signal adds points with a reason the admin can act on;
 * no black box, so a manager can see why and fix the cause rather than blame the worker.
 */
export function quitRisk(r: RiskInput): Risk {
  const reasons: string[] = [];
  let score = 0;
  const add = (pts: number, why: string) => {
    score += pts;
    reasons.push(why);
  };
  if (r.overtimeHours14d > 20) add(Math.min(30, Math.round(r.overtimeHours14d)), `${Math.round(r.overtimeHours14d)} overtime hours in 2 weeks`);
  if (r.fatigueFlags14d > 0) add(Math.min(25, r.fatigueFlags14d * 8), `${r.fatigueFlags14d} fatigue warnings`);
  if (r.missedDays14d >= 3) add(Math.min(25, r.missedDays14d * 5), `missed ${r.missedDays14d} of the last 14 days`);
  if (r.openHazardsReported > 0) add(10 * r.openHazardsReported, `${r.openHazardsReported} safety report(s) still unresolved`);
  if (r.tenureDays < 90) add(10, "joined less than 3 months ago");
  if (r.payBelowMinimum) add(20, "hourly pay below the state minimum wage");
  score = Math.min(100, score);
  return { score, level: score >= 50 ? "high" : score >= 25 ? "medium" : "low", reasons };
}

/** Haversine distance in metres, for location check-in. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Only show feedback summaries for groups big enough that no one can be singled out. */
export const ANONYMITY_MIN = 3;

/**
 * Checks a planned shift against rest rules before it is saved: the reasons it would be unsafe,
 * or an empty list if it's fine. Uses worked and already-planned shifts together.
 */
export function restProblems(existing: { start: string; end?: string }[], start: string, end: string, policy: Policy, now = new Date()): string[] {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  const problems: string[] = [];
  const len = (e - s) / HOUR;
  if (len > policy.maxShiftHours) problems.push(`${round2(len)} hour shift is over the ${policy.maxShiftHours} hour limit`);
  // a shift still open has no known end: nothing can be planned after it until it is closed
  if (existing.some((x) => !x.end && new Date(x.start).getTime() <= e)) problems.push("still on a shift that hasn't been closed");
  const spans = existing.map((x) => ({ s: new Date(x.start).getTime(), e: x.end ? new Date(x.end).getTime() : Math.max(now.getTime(), e) }));
  for (const x of spans) {
    if (x.s < e && s < x.e) {
      problems.push("overlaps another shift");
      continue;
    }
    const gap = x.e <= s ? (s - x.e) / HOUR : x.s >= e ? (x.s - e) / HOUR : Infinity;
    if (gap < policy.minRestHours) problems.push(`only ${round2(gap)} hours of rest next to another shift (needs ${policy.minRestHours})`);
  }
  const weekStart = new Date(weekOf(start)).getTime() - SITE_UTC_OFFSET_MS;
  const weekHours = spans.filter((x) => x.s >= weekStart && x.s < weekStart + 7 * 24 * HOUR).reduce((h, x) => h + (x.e - x.s) / HOUR, 0) + len;
  if (weekHours > policy.weeklyHours + 12) problems.push(`would make ${round2(weekHours)} hours this week`);
  // count working days in a row on both sides of the new shift
  const days = new Set([...spans.map((x) => localDay(x.s)), localDay(s)]);
  let streak = 1;
  for (let d = s - 24 * HOUR; days.has(localDay(d)); d -= 24 * HOUR) streak++;
  for (let d = s + 24 * HOUR; days.has(localDay(d)); d += 24 * HOUR) streak++;
  if (streak > policy.maxConsecutiveDays) problems.push(`day ${streak} in a row without a day off`);
  return [...new Set(problems)];
}
