/** IST helpers. Times are stored in UTC; business hours and wording are in Asia/Kolkata. */

export const IST_TIMEZONE = "Asia/Kolkata";
const IST_OFFSET_MINUTES = 330; // India has no daylight saving.
const DAY_MS = 86_400_000;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface IstParts {
  /** YYYY-MM-DD in IST */
  date: string;
  weekday: Weekday;
  /** Minutes since IST midnight */
  minutes: number;
}

export function istParts(instant: Date): IstParts {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MINUTES * 60_000);
  return {
    date: shifted.toISOString().slice(0, 10),
    weekday: WEEKDAYS[shifted.getUTCDay()],
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** "10:00" → 600 */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Whole days from the IST calendar date of `now` to `isoDate` (YYYY-MM-DD). */
export function daysUntil(isoDate: string, now: Date): number {
  const today = Date.parse(`${istParts(now).date}T00:00:00Z`);
  return Math.round((Date.parse(`${isoDate}T00:00:00Z`) - today) / DAY_MS);
}

export interface BusinessHours {
  start: string; // HH:MM IST
  end: string; // HH:MM IST
  days: readonly string[]; // mon..sun
}

export function isWithinBusinessHours(now: Date, hours: BusinessHours): boolean {
  const p = istParts(now);
  return hours.days.includes(p.weekday) && p.minutes >= hhmmToMinutes(hours.start) && p.minutes < hhmmToMinutes(hours.end);
}

const DAY_NAMES: Record<Weekday, string> = {
  sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday",
};

/**
 * Speakable callback promise (PRD section 3, step 7): "within the hour" in working hours when at
 * least an hour remains, otherwise the next working morning ("later this morning", "tomorrow
 * morning", "on Monday morning").
 */
export function callbackWhen(now: Date, hours: BusinessHours): { withinHour: boolean; when: string } {
  const p = istParts(now);
  const start = hhmmToMinutes(hours.start);
  const end = hhmmToMinutes(hours.end);
  const workingDay = hours.days.includes(p.weekday);
  if (workingDay && p.minutes >= start && p.minutes + 60 <= end) return { withinHour: true, when: "within the hour" };
  if (workingDay && p.minutes < start) return { withinHour: false, when: "later this morning" };
  for (let i = 1; i <= 7; i++) {
    const day = istParts(new Date(now.getTime() + i * DAY_MS)).weekday;
    if (hours.days.includes(day)) return { withinHour: false, when: i === 1 ? "tomorrow morning" : `on ${DAY_NAMES[day]} morning` };
  }
  return { withinHour: false, when: "as soon as we can" };
}
