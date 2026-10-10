import type { InferInsertModel } from "drizzle-orm";
import type { bookings, calls, pipelineSteps, reviewActions } from "@/db/schema";
import { DEMO_PREFIX } from "@/lib/dashboard/demo";
import { contentA } from "@/lib/demo/content-a";
import { contentB } from "@/lib/demo/content-b";
import { contentC } from "@/lib/demo/content-c";
import type { ScenarioContentMap } from "@/lib/demo/content-types";
import { isWithinBusinessHours, istParts } from "@/lib/rules/time";

type CallInsert = InferInsertModel<typeof calls>;
type BookingInsert = Omit<InferInsertModel<typeof bookings>, "callId">;
type StepInsert = Pick<InferInsertModel<typeof pipelineSteps>, "step" | "status" | "attempts" | "lastError">;
type ActionInsert = Pick<InferInsertModel<typeof reviewActions>, "action" | "note"> & { minutesAfterCall: number };

export { DEMO_PREFIX };

/** What Vaani charges per minute, per .env.example (VAANI_COST_PER_MIN_INR). The seed uses it as a plain constant. */
export const DEMO_VAANI_COST_PER_MIN_INR = 5.6;

export interface DemoCall {
  call: CallInsert;
  booking?: BookingInsert;
  steps: StepInsert[];
  actions: ActionInsert[];
}

type Tier = "green" | "amber" | "red" | null;
type When = { daysAgo: number; at: string } | { hoursAgo: number };
interface Spec {
  name: string | null;
  tier: Tier;
  status: CallInsert["status"];
  when: When;
  minutes: number;
  place?: string;
  project?: string;
  detail?: string;
  bhk?: number;
  sqft?: number;
  source?: string;
  /** Design call: days from today (IST) and the IST clock time. */
  book?: { dayOffset: number; at: string };
  review?: "approved" | "rescued" | "discarded";
  high?: boolean;
  category?: CallInsert["callCategory"];
  leak?: boolean;
  tight?: boolean;
  slowAnswerSeconds?: number;
  value?: number;
  reasons?: string[];
  timeline?: string;
  unrated?: boolean;
  handoffSeconds?: number;
  flags?: string[];
  /** The caller was asked whether the date could move (rubric R3 gate). */
  moveAsked?: boolean;
}

/** Hand-written transcripts, summaries, hand-off notes and criteria, keyed by 1-based SPECS position. */
const CONTENT: ScenarioContentMap = { ...contentA, ...contentB, ...contentC };

/**
 * ~45 clearly fictional calls for the dashboards. Rows are NOT flagged is_test (so the dashboards show them and
 * the founder metrics count them) but every vaani_call_id starts with "demo-" so `pnpm demo:purge` removes them.
 * They are inserted directly, never through the pipeline, so nothing reaches HubSpot or Telegram; pipeline steps
 * are recorded as skipped for the same reason. Phone numbers are in a fake range; estimated values are neutral
 * numbers that match no studio figure. Times are relative to `now`, so the data always looks recent.
 */
const SPECS: Spec[] = [
  // Green, design call booked: today, tomorrow, this week, past
  { name: "Tara Velankar", tier: "green", status: "booked", when: { daysAgo: 2, at: "14:10" }, minutes: 6.2, place: "Baner", project: "home", detail: "3BHK apartment", bhk: 3, sqft: 1450, source: "friend", book: { dayOffset: 0, at: "11:30" }, high: true, value: 1_873_000, timeline: "Possession in January, wants to start in November" },
  { name: "Rohan Pendse", tier: "green", status: "booked", when: { daysAgo: 1, at: "11:05" }, minutes: 5.4, place: "Wakad", project: "home", detail: "2BHK apartment", bhk: 2, sqft: 980, source: "instagram", book: { dayOffset: 0, at: "16:30" }, value: 1_246_000, timeline: "Moving in within three months" },
  { name: "Nisha Gadgil", tier: "green", status: "booked", when: { daysAgo: 3, at: "21:15" }, minutes: 7.1, place: "Hinjewadi", project: "home", detail: "2BHK apartment", bhk: 2, sqft: 1020, source: "google", book: { dayOffset: 0, at: "17:30" }, value: 1_318_000, timeline: "Handover next month" },
  { name: "Kabir Athalye", tier: "green", status: "booked", when: { daysAgo: 1, at: "17:30" }, minutes: 8.3, place: "Kothrud", project: "home", detail: "Independent villa", sqft: 2600, source: "friend", book: { dayOffset: 1, at: "11:00" }, high: true, value: 2_284_000, timeline: "Ready before the January function" },
  { name: "Mrinal Sathe", tier: "green", status: "booked", when: { hoursAgo: 5 }, minutes: 4.9, place: "Aundh", project: "home", detail: "3BHK apartment", bhk: 3, sqft: 1380, source: "google", book: { dayOffset: 1, at: "15:30" }, value: 1_652_000, timeline: "Wants to begin within six weeks" },
  { name: "Isha Bhoite", tier: "green", status: "booked", when: { daysAgo: 2, at: "09:50" }, minutes: 5.8, place: "Hinjewadi", project: "home", detail: "2BHK apartment", bhk: 2, sqft: 1050, source: "builder referral", book: { dayOffset: 2, at: "10:30" }, value: 1_187_000, timeline: "Possession in two months" },
  { name: "Vikram Joglekar", tier: "green", status: "booked", when: { daysAgo: 2, at: "12:40" }, minutes: 6.6, place: "Kharadi", project: "office", detail: "Small office fit-out", sqft: 1700, source: "linkedin", book: { dayOffset: 3, at: "12:00" }, value: 1_491_000, timeline: "Lease starts in six weeks" },
  { name: "Devika Ranade", tier: "green", status: "booked", when: { daysAgo: 2, at: "22:05" }, minutes: 7.7, place: "Viman Nagar", project: "home", detail: "4BHK apartment", bhk: 4, sqft: 2150, source: "friend", book: { dayOffset: 4, at: "16:00" }, value: 2_047_000, timeline: "Early next year" },
  { name: "Sameer Kanitkar", tier: "green", status: "booked", when: { daysAgo: 5, at: "11:20" }, minutes: 5.2, place: "Baner", project: "home", detail: "3BHK apartment", bhk: 3, sqft: 1500, source: "instagram", book: { dayOffset: -1, at: "11:00" }, value: 1_735_000, timeline: "Within three months" },
  { name: "Ananya Phadke", tier: "green", status: "booked", when: { daysAgo: 7, at: "15:45" }, minutes: 6.0, place: "Aundh", project: "home", detail: "2BHK apartment", bhk: 2, sqft: 1010, source: "google", book: { dayOffset: -2, at: "15:00" }, value: 1_209_000, timeline: "Move in by the end of January" },
  { name: "Harsh Bapat", tier: "green", status: "booked", when: { daysAgo: 8, at: "19:40" }, minutes: 9.4, place: "Balewadi", project: "home", detail: "3BHK apartment", bhk: 3, sqft: 1560, source: "friend", book: { dayOffset: -4, at: "12:30" }, value: 1_904_000, timeline: "Handover in six weeks" },
  { name: "Pooja Deodhar", tier: "green", status: "booked", when: { daysAgo: 11, at: "10:25" }, minutes: 5.5, place: "Pimple Saudagar", project: "home", detail: "2BHK apartment", bhk: 2, sqft: 960, source: "instagram", book: { dayOffset: -6, at: "10:00" }, value: 1_153_000, timeline: "Within two months" },
  { name: "Aditya Sabnis", tier: "green", status: "booked", when: { daysAgo: 15, at: "16:10" }, minutes: 6.8, place: "Koregaon Park", project: "home", detail: "3BHK apartment", bhk: 3, sqft: 1620, source: "google", book: { dayOffset: -9, at: "17:00" }, value: 1_968_000, timeline: "Before my sister's wedding, second week of February" },
  { name: "Lata Gokhale", tier: "green", status: "booked", when: { daysAgo: 18, at: "13:35" }, minutes: 4.6, place: "Sinhagad Road", project: "home", detail: "2BHK apartment", bhk: 2, sqft: 930, source: "builder referral", book: { dayOffset: -12, at: "11:30" }, value: 1_112_000, timeline: "Moving in within a quarter" },
  { name: "Omkar Tilak", tier: "green", status: "booked", when: { daysAgo: 6, at: "14:15" }, minutes: 7.4, place: "Wakad", project: "home", detail: "3BHK apartment", bhk: 3, sqft: 1410, source: "friend", book: { dayOffset: -3, at: "14:00" }, value: 1_689_000, leak: true, timeline: "Wants to start soon" },
  // Green, but no design call booked yet: needs a designer now
  { name: "Gauri Oak", tier: "green", status: "awaiting_designer", when: { hoursAgo: 1.5 }, minutes: 6.3, place: "Baner", project: "home", detail: "3BHK apartment", bhk: 3, sqft: 1400, source: "instagram", high: true, value: 1_781_000, timeline: "Possession in a month", reasons: ["all five criteria pass", "no slot was free that day"] },
  { name: "Neel Chitale", tier: "green", status: "awaiting_designer", when: { hoursAgo: 26 }, minutes: 5.0, place: "Aundh", project: "home", detail: "2BHK apartment", bhk: 2, sqft: 1000, source: "google", value: 1_267_000, timeline: "Within two months", reasons: ["all five criteria pass", "the caller wanted to choose a time later"] },
  // Amber
  { name: "Mitali Wagh", tier: "amber", status: "awaiting_designer", when: { hoursAgo: 0.4 }, minutes: 5.6, place: "Balewadi", project: "home", detail: "3BHK apartment", bhk: 3, sqft: 1330, source: "google", value: 1_521_000, timeline: "Not decided yet", reasons: ["timeline unclear after one question"] },
  { name: "Sandeep Limaye", tier: "amber", status: "awaiting_designer", when: { hoursAgo: 6 }, minutes: 6.9, place: "Pimple Saudagar", project: "home", detail: "2BHK apartment", bhk: 2, sqft: 940, source: "friend", value: 1_074_000, flags: ["structural_changes"], timeline: "No fixed date, within the year", reasons: ["structural changes wanted, a designer should speak first"] },
  { name: "Rutuja Mhatre", tier: "amber", status: "booked", when: { hoursAgo: 3 }, minutes: 5.7, place: "Bavdhan", project: "home", detail: "3BHK apartment", bhk: 3, sqft: 1290, source: "instagram", book: { dayOffset: 1, at: "17:00" }, value: 1_437_000, timeline: "Maybe by March", reasons: ["timeline unclear"] },
  { name: "Yash Kelkar", tier: "amber", status: "booked", when: { daysAgo: 1, at: "18:20" }, minutes: 6.1, place: "Hadapsar", project: "home", detail: "2BHK apartment", bhk: 2, sqft: 1010, source: "google", book: { dayOffset: 2, at: "11:30" }, value: 1_136_000, timeline: "Possession date not fixed", reasons: ["decision maker is the caller's father"] },
  { name: "Shreya Dandekar", tier: "amber", status: "booked", when: { daysAgo: 9, at: "12:05" }, minutes: 6.5, place: "Kothrud", project: "home", detail: "3BHK apartment", bhk: 3, sqft: 1340, source: "friend", book: { dayOffset: -5, at: "11:00" }, review: "approved", value: 1_566_000, timeline: "Not sure yet", reasons: ["timeline unclear"] },
  { name: "Tejas Ghate", tier: "amber", status: "awaiting_designer", when: { daysAgo: 12, at: "20:10" }, minutes: 5.3, place: "Wakad", project: "home", detail: "2BHK apartment", bhk: 2, sqft: 990, source: "instagram", review: "approved", value: 1_098_000, timeline: "Later this year", reasons: ["timeline unclear"] },
  { name: "Charu Paranjape", tier: "amber", status: "awaiting_designer", when: { daysAgo: 17, at: "15:30" }, minutes: 4.8, place: "Kharadi", project: "home", detail: "2BHK apartment", bhk: 2, sqft: 1005, source: "google", review: "discarded", value: 1_059_000, timeline: "Undecided", reasons: ["timeline unclear"] },
  { name: "Atul Rege", tier: "amber", status: "booked", when: { daysAgo: 20, at: "10:45" }, minutes: 6.4, place: "Viman Nagar", project: "home", detail: "3BHK apartment", bhk: 3, sqft: 1470, source: "linkedin", book: { dayOffset: -15, at: "14:30" }, review: "approved", value: 1_612_000, timeline: "Not fixed", reasons: ["timeline unclear"] },
  // Red: declined kindly
  { name: "Sunita Lele", tier: "red", status: "unqualified_verified", when: { daysAgo: 1, at: "13:10" }, minutes: 3.1, place: "Nashik", project: "home", detail: "Flat outside Pune", source: "google", reasons: ["service area fail"] },
  { name: "Manoj Barve", tier: "red", status: "unqualified_verified", when: { daysAgo: 3, at: "20:30" }, minutes: 2.6, place: "Kothrud", project: "other", detail: "Just browsing ideas", source: "instagram", reasons: ["no real project yet"] },
  { name: "Reshma Inamdar", tier: "red", status: "unqualified_verified", when: { daysAgo: 5, at: "11:50" }, minutes: 3.4, place: "Hadapsar", project: "home", detail: "Single room touch-up", source: "friend", reasons: ["scope too small for a design call"] },
  { name: "Prasad Naik", tier: "red", status: "unqualified_verified", when: { daysAgo: 9, at: "17:25" }, minutes: 2.9, place: "Mumbai", project: "home", detail: "Flat in Mumbai", source: "google", reasons: ["service area fail"] },
  { name: "Divya Kamat", tier: "red", status: "unqualified_verified", when: { daysAgo: 13, at: "08:40" }, minutes: 3.0, place: "Baner", project: "home", detail: "Plot, building not started", source: "instagram", reasons: ["timeline beyond two years"] },
  { name: "Girish Apte", tier: "red", status: "unqualified_verified", when: { daysAgo: 27, at: "15:00" }, minutes: 2.7, place: "Wakad", project: "other", detail: "Wants a free quote only", source: "google", reasons: ["no real project yet"] },
  { name: "Ketaki Marathe", tier: "red", status: "unqualified_verified", when: { daysAgo: 10, at: "14:20" }, minutes: 4.9, place: "Bavdhan", project: "home", detail: "2BHK apartment", bhk: 2, sqft: 900, source: "friend", book: { dayOffset: 3, at: "15:00" }, review: "rescued", value: 1_024_000, timeline: "By mid-November, the function date is fixed", moveAsked: true, reasons: ["timeline under six weeks and the date cannot move", "rescued by a designer after the call"] },
  // Not rated (the agent's tools did not reach us): a designer decides
  { name: "Anil Sohoni", tier: null, status: "awaiting_designer", when: { hoursAgo: 0.9 }, minutes: 4.4, place: "Aundh", project: "home", detail: "Apartment", source: "google", unrated: true },
  { name: null, tier: null, status: "awaiting_designer", when: { daysAgo: 2, at: "19:45" }, minutes: 3.8, source: "instagram", unrated: true },
  { name: "Seema Bhide", tier: null, status: "awaiting_designer", when: { daysAgo: 7, at: "12:15" }, minutes: 4.1, place: "Pimple Saudagar", project: "home", detail: "Apartment", review: "discarded", unrated: true },
  // Dropped before the assessment
  { name: null, tier: null, status: "dropped", when: { hoursAgo: 0.25 }, minutes: 0.6, category: null },
  { name: "Hemant Vaidya", tier: null, status: "dropped", when: { hoursAgo: 3.5 }, minutes: 1.1, place: "Kothrud", category: "enquiry" },
  { name: null, tier: null, status: "dropped", when: { daysAgo: 5, at: "21:00" }, minutes: 0.4, review: "discarded", category: null },
  { name: null, tier: null, status: "dropped", when: { daysAgo: 25, at: "10:10" }, minutes: 0.5, review: "discarded", category: null },
  // Existing clients with a complaint: escalated
  { name: "Mandar Kale", tier: null, status: "escalated", when: { hoursAgo: 2 }, minutes: 4.2, category: "existing_client_complaint", place: "Baner" },
  { name: "Rekha Joshi", tier: null, status: "escalated", when: { daysAgo: 1, at: "12:30" }, minutes: 3.6, category: "existing_client_complaint", place: "Wakad" },
  // Not enquiries
  { name: "Sagar Mehendale", tier: null, status: "non_enquiry", when: { daysAgo: 2, at: "11:15" }, minutes: 1.2, category: "vendor_or_sales" },
  { name: null, tier: null, status: "non_enquiry", when: { daysAgo: 6, at: "16:35" }, minutes: 1.5, category: "job_seeker" },
  { name: null, tier: null, status: "non_enquiry", when: { daysAgo: 28, at: "09:20" }, minutes: 0.5, category: "wrong_number" },
  { name: "Leena Purandare", tier: null, status: "non_enquiry", when: { daysAgo: 4, at: "15:40" }, minutes: 2.3, category: "existing_client", place: "Aundh" },
];

const HOURS = { start: "10:00", end: "19:00", days: ["mon", "tue", "wed", "thu", "fri", "sat"] } as const;

const startOf = (s: Spec, now: Date): Date => {
  if ("hoursAgo" in s.when) return new Date(now.getTime() - s.when.hoursAgo * 3_600_000);
  const day = new Date(Date.parse(`${istParts(now).date}T00:00:00Z`) - s.when.daysAgo * 86_400_000).toISOString().slice(0, 10);
  return new Date(`${day}T${s.when.at}:00+05:30`);
};
const istAtOffset = (now: Date, dayOffset: number, at: string): Date => {
  const day = new Date(Date.parse(`${istParts(now).date}T00:00:00Z`) + dayOffset * 86_400_000).toISOString().slice(0, 10);
  return new Date(`${day}T${at}:00+05:30`);
};
const r2 = (n: number) => Math.round(n * 100) / 100;

export function buildDemoCalls(now: Date = new Date()): DemoCall[] {
  return SPECS.map((s, i): DemoCall => {
    const n = i + 1;
    const c = CONTENT[n];
    if (!c) throw new Error(`demo content missing for call ${n}`);
    const id = `${DEMO_PREFIX}${String(n).padStart(3, "0")}`;
    const started = startOf(s, now);
    const answerAfter = s.slowAnswerSeconds ?? (n === 11 ? 340 : n === 24 ? 520 : 2 + (n % 7));
    const durationSeconds = Math.round(s.minutes * 60);
    const ended = new Date(started.getTime() + answerAfter * 1000 + durationSeconds * 1000);
        const rated = s.tier === "green" || s.tier === "amber";
    const vaani = r2((durationSeconds / 60) * DEMO_VAANI_COST_PER_MIN_INR);
    const gemini = c.transcript ? r2(0.18 + ((n * 7) % 60) / 100) : null;
    const category = s.category !== undefined ? s.category : s.unrated ? null : "enquiry";
    const afterHours = !isWithinBusinessHours(started, HOURS);
    const phone = `+9199999${String(n).padStart(5, "0")}`;
    const handoff = n === 5 ? 190 : 25 + ((n * 13) % 110);
    const call: CallInsert = {
      vaaniCallId: id,
      callRef: `DM${String(n).padStart(4, "0")}`,
      fromNumber: phone,
      toNumber: "+910000000000",
      callerName: s.name,
      startedAt: started,
      answeredAt: new Date(started.getTime() + answerAfter * 1000),
      endedAt: ended,
      durationSeconds,
      calledAfterHours: afterHours,
      callCategory: category,
      status: s.status,
      reviewState: s.review ?? "none",
      endReason: s.status === "dropped" ? "dropped" : "completed",
      tier: s.tier,
      tierReasons: s.tier && c.tierReason ? [c.tierReason] : null,
      priority: s.tier || s.status === "escalated" ? (s.high ? "high" : "normal") : null,
      estimatedValueInr: rated || s.review === "rescued" ? (s.value ?? null) : null,
      budgetTight: Boolean(s.tight),
      priceLeak: Boolean(s.leak),
      criteriaAgent: c.criteria ? { recorded: c.criteria, ...(s.moveAsked ? { timeline_move_asked: true } : {}) } : null,
      facts: s.place || s.project
        ? { caller_name: s.name, locality: s.place ?? null, project_type: s.project ?? null, property_detail: s.detail ?? null, bhk: s.bhk ?? null, size_sqft: s.sqft ?? null, timeline_text: c.criteria?.timeline.evidence ?? s.timeline ?? null, referral_source: s.source ?? null }
        : null,
      flags: s.unrated ? ["unclassified"] : (s.flags ?? (s.tight ? ["budget_tight"] : [])),
      consultType: s.book ? "call" : null,
      referralSource: s.source ?? null,
      existingProjectDesigner: s.status === "escalated" || s.category === "existing_client" ? "Demo Designer" : null,
      transcript: c.transcript,
      summary: c.summary,
      handoffNote: c.handoffNote,
      openQuestions: c.openQuestions.length ? c.openQuestions : null,
      // Demo rows are never sent anywhere, but the time-to-handoff metric needs a value to show.
      telegramSentAt: rated ? new Date(ended.getTime() + handoff * 1000) : null,
      vaaniCostInr: vaani,
      geminiCostInr: gemini,
      totalCostInr: r2(vaani + (gemini ?? 0)),
      geminiTokensIn: gemini ? 2310 + n * 37 : null,
      geminiTokensOut: gemini ? 310 + n * 5 : null,
      isTest: false,
      createdAt: ended,
      updatedAt: ended,
    };
    const start = s.book ? istAtOffset(now, s.book.dayOffset, s.book.at) : null;
    const done = (step: string, lastError: string | null = null): StepInsert => ({ step, status: "succeeded", attempts: 1, lastError });
    const skipped = (step: string): StepInsert => ({ step, status: "skipped", attempts: 0, lastError: "demo data, never sent" });
    const steps: StepInsert[] = [
      done("save"),
      ...(s.status === "dropped" ? [skipped("enrich")] : [done("enrich"), done("booking"), done("gemini"), done("tier"), done("leak_check"), done("cost")]),
      skipped("telegram"),
      skipped("hubspot_log"),
      ...(rated || s.review === "rescued" ? [skipped("hubspot_deal")] : []),
    ];
    return {
      call,
      ...(start
        ? { booking: { consultType: "call" as const, startAt: start, endAt: new Date(start.getTime() + 30 * 60_000), attendeeEmail: `${id}@example.test`, emailIsPlaceholder: true, status: "accepted" as const } }
        : {}),
      steps,
      actions: s.review
        ? [{ action: s.review === "approved" ? "approve" : s.review === "rescued" ? "rescue" : "discard", note: s.review === "discarded" ? "Demo: not pursued" : null, minutesAfterCall: 90 }]
        : [],
    };
  });
}
