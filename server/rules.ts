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

/** Monday of the week a date falls in, as YYYY-MM-DD (UTC, like every stored timestamp). */
export function weekOf(iso: string): string {
  const d = new Date(iso);
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
 * Splits worked hours into regular and overtime. A shift's hours beyond the daily limit are overtime;
 * then, in each week, regular hours beyond the weekly limit become overtime too. Never counted twice.
 */
export function splitHours(shifts: Shift[], policy: Policy, now = new Date()): HoursBreakdown {
  let dailyOvertime = 0;
  const regularByWeek = new Map<string, number>();
  for (const s of shifts) {
    const h = shiftHours(s, now);
    const ot = Math.max(0, h - policy.dailyHours);
    dailyOvertime += ot;
    const wk = weekOf(s.start);
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

    const day = s.start.slice(0, 10);
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
