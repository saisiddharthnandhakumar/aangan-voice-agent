import { istParts } from "@/lib/rules/time";

/** Speakable IST wording for slots (T2). Never contains a price. */

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_NAMES: Record<string, string> = {
  sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday",
};

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

function clock(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "today at 4 PM", "tomorrow at 11:30 AM", "Tuesday the 14th of October at 11 AM" */
export function slotLabel(startIso: string, now: Date): string {
  const slot = istParts(new Date(startIso));
  const today = istParts(now).date;
  const tomorrow = istParts(new Date(now.getTime() + 86_400_000)).date;
  const time = clock(slot.minutes);
  if (slot.date === today) return `today at ${time}`;
  if (slot.date === tomorrow) return `tomorrow at ${time}`;
  const [, mm, dd] = slot.date.split("-").map(Number);
  return `${DAY_NAMES[slot.weekday]} the ${ordinal(dd)} of ${MONTH_NAMES[mm - 1]} at ${time}`;
}

/** Join labels the way people speak: "A, B or C". */
export function speakList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

export interface TimePreference {
  part?: "morning" | "afternoon" | "evening";
  weekend?: boolean;
  weekday?: string; // mon..sun
}

/** Read "evening", "weekend", "Saturday morning", "shaam ko" into a filter. */
export function parseTimePreference(text: string | null | undefined): TimePreference {
  if (!text) return {};
  const t = text.toLowerCase();
  const pref: TimePreference = {};
  if (/\b(morning|subah|sakali)\b/.test(t)) pref.part = "morning";
  else if (/\b(afternoon|dopahar|lunch)\b/.test(t)) pref.part = "afternoon";
  else if (/\b(evening|after work|shaam|sham|sandhyakali|after \d ?pm)\b/.test(t)) pref.part = "evening";
  if (/\b(weekends?|shanivar|ravivar)\b/.test(t)) pref.weekend = true;
  const day = Object.entries(DAY_NAMES).find(([, name]) => t.includes(name.toLowerCase()));
  if (day) pref.weekday = day[0];
  return pref;
}

export function matchesPreference(startIso: string, pref: TimePreference): boolean {
  const p = istParts(new Date(startIso));
  if (pref.weekday && p.weekday !== pref.weekday) return false;
  if (pref.weekend && !["sat", "sun"].includes(p.weekday)) return false;
  if (pref.part === "morning" && p.minutes >= 12 * 60) return false;
  if (pref.part === "afternoon" && (p.minutes < 12 * 60 || p.minutes >= 16 * 60)) return false;
  if (pref.part === "evening" && p.minutes < 16 * 60) return false;
  return true;
}

/** Up to `n` slots, spread across days first (the first slot of each day), then filled in time order. */
export function pickSlots<T extends { start: string }>(slots: T[], n: number): T[] {
  const byDay = new Map<string, T[]>();
  for (const s of slots) {
    const d = istParts(new Date(s.start)).date;
    byDay.set(d, [...(byDay.get(d) ?? []), s]);
  }
  const picked: T[] = [];
  for (const daySlots of byDay.values()) if (picked.length < n) picked.push(daySlots[0]);
  for (const s of slots) if (picked.length < n && !picked.includes(s)) picked.push(s);
  return picked.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}
