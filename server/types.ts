export type Sector = "construction" | "hospital" | "college" | "factory";
/** 16 languages: understood by Gemini, spoken by Cloud Text-to-Speech. */
export const LANGS = ["en", "hi", "bn", "ta", "te", "kn", "ml", "mr", "gu", "pa", "or", "as", "ur", "ne", "kok", "mai"] as const;
export type Lang = (typeof LANGS)[number];
export const LANG_NAME: Record<Lang, string> = {
  en: "English", hi: "Hindi", bn: "Bengali", ta: "Tamil", te: "Telugu", kn: "Kannada", ml: "Malayalam", mr: "Marathi",
  gu: "Gujarati", pa: "Punjabi", or: "Odia", as: "Assamese", ur: "Urdu", ne: "Nepali", kok: "Konkani", mai: "Maithili",
};

/** Working-hour rules an employer follows. Defaults mirror India's Factories Act / OSH Code limits. */
export interface Policy {
  dailyHours: number; // overtime starts after this many hours in a shift
  weeklyHours: number; // and after this many in a Monday-Sunday week
  overtimeRate: number; // multiple of the hourly rate
  minRestHours: number; // between two shifts
  maxShiftHours: number; // longer than this is a fatigue risk
  maxConsecutiveDays: number;
  pfRate: number; // Provident Fund, share of regular pay
  esiRate: number; // Employees' State Insurance, share of gross
}

export interface Org {
  id: string;
  name: string;
  sector: Sector;
  policy: Policy;
  adminPin: string;
}

export interface Site {
  id: string;
  orgId: string;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
  /** printed on the QR poster at the gate; rotated by the admin */
  checkInCode: string;
}

export interface Worker {
  id: string;
  orgId: string;
  siteId: string;
  name: string;
  phone: string;
  pin: string;
  job: string;
  lang: Lang;
  hourlyRate: number; // rupees
  joinedOn: string; // ISO date
}

export interface Shift {
  id: string;
  workerId: string;
  siteId: string;
  start: string; // ISO
  end?: string; // ISO; open while the worker is on shift
  method: "qr" | "gps" | "manual";
}

export type HazardStatus = "open" | "acknowledged" | "fixed";
export interface Hazard {
  id: string;
  orgId: string;
  siteId: string;
  /** absent when the worker chose to report anonymously */
  reporterId?: string;
  text: string;
  lang: Lang;
  category: string;
  severity: 1 | 2 | 3;
  summary: string;
  status: HazardStatus;
  createdAt: string;
  updates: { at: string; status: HazardStatus; note: string }[];
  /** lets an anonymous reporter follow the report without revealing who they are */
  trackCode?: string;
  hasPhoto?: boolean;
}

export type FeedbackTopic = "manager" | "conditions" | "pay" | "safety";
/** Deliberately has no worker id and only a day-level date, so it can't be traced back. */
export interface Feedback {
  id: string;
  orgId: string;
  topic: FeedbackTopic;
  rating: 1 | 2 | 3 | 4 | 5;
  text: string;
  day: string;
}

/** A shift the manager has planned, checked against rest rules before it is saved. */
export interface Planned {
  id: string;
  workerId: string;
  start: string;
  end: string;
  /** set when a manager overrode a fatigue warning, so the override is on record */
  override?: string;
}

export interface Skill {
  id: string;
  workerId: string;
  title: string;
  issuer: string;
  date: string;
  verified: boolean;
}
