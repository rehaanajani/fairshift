/**
 * Demo data for three employers in three sectors, generated relative to today so the dashboards
 * always show the last few weeks. Deterministic (seeded random), so tests and demos match.
 */
import { DEFAULT_POLICY } from "./rules.ts";
import { seal, type Receipt } from "./ledger.ts";
import { shiftHours } from "./rules.ts";
import type { Feedback, Hazard, Org, Planned, Shift, Site, Skill, Worker } from "./types.ts";

export interface Data {
  orgs: Org[];
  sites: Site[];
  workers: Worker[];
  shifts: Shift[];
  hazards: Hazard[];
  feedback: Feedback[];
  skills: Skill[];
  receipts: Receipt[];
  planned: Planned[];
  /** server-only settings kept with the data, e.g. the key that signs logins */
  meta?: { sessionSecret?: string };
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const DEMO_PIN = "1234";
const ADMIN_PIN = "4321";

export function seed(now = new Date()): Data {
  const orgs: Org[] = [
    { id: "orion", name: "Orion Builders", sector: "construction", policy: { ...DEFAULT_POLICY }, adminPin: ADMIN_PIN },
    { id: "citycare", name: "CityCare Hospital", sector: "hospital", policy: { ...DEFAULT_POLICY, dailyHours: 8 }, adminPin: ADMIN_PIN },
    { id: "campus", name: "Campus Services, SRM", sector: "college", policy: { ...DEFAULT_POLICY, dailyHours: 8 }, adminPin: ADMIN_PIN },
  ];
  const sites: Site[] = [
    { id: "orion-towers", orgId: "orion", name: "Orion Towers site, Potheri", lat: 12.8236, lng: 80.0391, radiusM: 400, checkInCode: "ORION-7Q4K" },
    { id: "citycare-main", orgId: "citycare", name: "CityCare main block, Guduvanchery", lat: 12.8454, lng: 80.0601, radiusM: 300, checkInCode: "CARE-3M8P" },
    { id: "campus-ktr", orgId: "campus", name: "SRM campus, Kattankulathur", lat: 12.8231, lng: 80.0442, radiusM: 800, checkInCode: "SRM-5T2X" },
  ];

  type Profile = "overworked" | "steady" | "absent" | "nights" | "new";
  const people: [string, string, string, Worker["lang"], number, Profile, number][] = [
    // name, org, job, language, ₹/hour, work pattern, days since joining
    ["Murugan S", "orion", "Mason", "ta", 95, "overworked", 900],
    ["Ramesh Yadav", "orion", "Helper", "hi", 70, "overworked", 40],
    ["Lakshmi Patil", "orion", "Helper", "mr", 78, "absent", 300],
    ["Raju Naidu", "orion", "Bar bender", "te", 90, "steady", 700],
    ["Priya Nair", "citycare", "Nursing aide", "ml", 110, "nights", 500],
    ["Anita Das", "citycare", "Ward attendant", "bn", 85, "steady", 1200],
    ["Kavya Gowda", "citycare", "Housekeeping", "kn", 80, "new", 30],
    ["Harpreet Kaur", "campus", "Housekeeping", "pa", 80, "steady", 2000],
    ["Bhavesh Patel", "campus", "Security guard", "gu", 85, "nights", 400],
    ["Manjunath B", "campus", "Electrician", "kn", 120, "steady", 800],
    ["Imran Khan", "campus", "Gardener", "ur", 72, "absent", 150],
    ["Pranjal Bora", "campus", "Canteen staff", "as", 82, "overworked", 600],
  ];
  const workers: Worker[] = people.map(([name, orgId, job, lang, rate, , tenure], i) => ({
    id: `w${i + 1}`,
    orgId,
    siteId: sites.find((s) => s.orgId === orgId)!.id,
    name,
    phone: `90000000${String(i + 1).padStart(2, "0")}`,
    pin: DEMO_PIN,
    job,
    lang,
    hourlyRate: rate,
    joinedOn: new Date(now.getTime() - tenure * 86_400_000).toISOString().slice(0, 10),
  }));

  const rand = rng(8);
  const shifts: Shift[] = [];
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  workers.forEach((w, i) => {
    const profile = people[i]![5];
    for (let d = 27; d >= 1; d--) {
      const day = new Date(today.getTime() - d * 86_400_000);
      const off = profile === "overworked" ? rand() < 0.05 : profile === "absent" ? rand() < 0.4 : day.getUTCDay() === 0;
      if (off || (profile === "new" && d > 25)) continue;
      // start hours are UTC; +5:30 gives the local time (2:30 UTC = 8:00 IST)
      let startH = 2.5 + rand();
      let len = 8 + rand();
      if (profile === "overworked") len = 10.5 + rand() * 3;
      if (profile === "nights") {
        startH = d % 3 === 0 ? 2.5 : 14.5; // nights, then a morning shift the next day: short rest
        len = d % 3 === 0 ? 8 : 10;
      }
      const start = new Date(day.getTime() + startH * 3_600_000);
      const end = new Date(start.getTime() + len * 3_600_000);
      shifts.push({ id: `s${shifts.length + 1}`, workerId: w.id, siteId: w.siteId, start: start.toISOString(), end: end.toISOString(), method: rand() < 0.7 ? "qr" : "gps" });
    }
  });

  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const hazards: Hazard[] = [
    {
      id: "h1", orgId: "orion", siteId: "orion-towers", reporterId: "w1", lang: "ta",
      text: "நான்காவது மாடியில் பாதுகாப்பு வலை கிழிந்துள்ளது",
      category: "Fall from height", severity: 3, summary: "Safety net torn on the 4th floor; risk of falls.",
      status: "open", createdAt: ago(2), updates: [],
    },
    {
      id: "h2", orgId: "citycare", siteId: "citycare-main", lang: "hi",
      text: "वार्ड 3 में दस्ताने खत्म हो गए हैं, बिना दस्ताने के सफाई करनी पड़ रही है",
      category: "Missing protective equipment", severity: 2, summary: "Ward 3 has run out of gloves; staff cleaning without them.",
      status: "acknowledged", createdAt: ago(4), updates: [{ at: ago(3), status: "acknowledged", note: "Order placed with store" }],
    },
    {
      id: "h3", orgId: "campus", siteId: "campus-ktr", reporterId: "w10", lang: "kn",
      text: "ಹಾಸ್ಟೆಲ್ ಬ್ಲಾಕ್ ಬಿ ಯಲ್ಲಿ ತೆರೆದ ವಿದ್ಯುತ್ ತಂತಿ",
      category: "Electrical", severity: 3, summary: "Exposed live wire in hostel block B.",
      status: "fixed", createdAt: ago(9), updates: [{ at: ago(8), status: "fixed", note: "Wire insulated and box closed" }],
    },
  ];

  const fb = (orgId: string, topic: Feedback["topic"], rating: Feedback["rating"], text: string, days: number): Feedback => ({
    id: `f${orgId}${days}${topic}`, orgId, topic, rating, text, day: ago(days).slice(0, 10),
  });
  const feedback: Feedback[] = [
    fb("orion", "pay", 2, "Overtime is not shown anywhere, we don't know if we are paid for it", 1),
    fb("orion", "pay", 1, "Salary comes late every month", 3),
    fb("orion", "conditions", 2, "No drinking water on upper floors in afternoon heat", 2),
    fb("orion", "manager", 3, "Supervisor is fair but shouts when work is behind", 5),
    fb("orion", "safety", 2, "Harness is shared between three people", 6),
    fb("orion", "conditions", 1, "Working 7 days, no rest day for a month", 4),
    fb("orion", "pay", 2, "Advance deducted from salary without telling us how much", 8),
    fb("orion", "safety", 2, "Nobody fixes the broken ladder even after we told them", 9),
    fb("citycare", "manager", 4, "Ward sister listens to us", 2),
    fb("citycare", "conditions", 2, "Night shift then morning shift next day, very tired", 3),
    fb("citycare", "safety", 3, "Gloves run out often", 5),
    fb("citycare", "conditions", 2, "No place to rest during night duty", 7),
    fb("campus", "pay", 3, "Pay is on time", 2),
    fb("campus", "manager", 4, "Good supervisor", 4),
    fb("campus", "conditions", 3, "Canteen staff work long hours in exam season", 6),
  ];

  const skills: Skill[] = [
    { id: "k1", workerId: "w1", title: "Brick and block masonry, NSQF level 4", issuer: "Construction Skill Development Council", date: "2021-03-10", verified: true },
    { id: "k2", workerId: "w1", title: "Working at height safety", issuer: "Orion Builders", date: ago(60).slice(0, 10), verified: true },
    { id: "k3", workerId: "w4", title: "Bar bending and steel fixing", issuer: "Orion Builders", date: "2023-08-01", verified: true },
    { id: "k4", workerId: "w5", title: "Basic life support (BLS)", issuer: "CityCare Hospital", date: "2025-01-15", verified: true },
    { id: "k5", workerId: "w5", title: "Infection control", issuer: "CityCare Hospital", date: ago(120).slice(0, 10), verified: true },
    { id: "k6", workerId: "w10", title: "Licensed wireman, class B", issuer: "Tamil Nadu Electrical Licensing Board", date: "2019-06-20", verified: true },
    { id: "k7", workerId: "w8", title: "Housekeeping and hygiene", issuer: "Campus Services, SRM", date: "2022-02-01", verified: false },
  ];

  const receipts: Receipt[] = [];
  for (const s of [...shifts].sort((a, b) => a.end!.localeCompare(b.end!))) {
    const w = workers.find((x) => x.id === s.workerId)!;
    const policy = orgs.find((o) => o.id === w.orgId)!.policy;
    const hours = Math.round(shiftHours(s) * 100) / 100;
    receipts.push(seal(receipts, { orgId: w.orgId, workerId: w.id, shiftId: s.id, start: s.start, end: s.end!, hours, overtime: Math.max(0, Math.round((hours - policy.dailyHours) * 100) / 100), kind: "shift", by: "worker", at: s.end! }));
  }

  return { orgs, sites, workers, shifts, hazards, feedback, skills, receipts, planned: [] };
}

/** Hourly equivalent of the lowest state minimum wage that applies to these jobs (₹600 for an 8-hour day). */
export const MIN_HOURLY_WAGE = 75;
export const DEMO = { workerPin: DEMO_PIN, adminPin: ADMIN_PIN };
