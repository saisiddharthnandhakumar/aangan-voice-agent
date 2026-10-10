import { randomInt } from "node:crypto";
import { z } from "zod";
import { CalError, createBooking, getSlots, type CalConfig, type CalSlot } from "@/lib/cal/client";
import { normalisePhone } from "@/lib/phone";
import { actionForAgentTier, assess, assessmentInputSchema, canBook, callbackWhen, normaliseBudget, WORDING, type AssessContext, type AssessmentInput } from "@/lib/rules";
import { istParts } from "@/lib/rules/time";
import type { CallRow, ToolsRepo } from "./repo";
import { matchesPreference, parseTimePreference, pickSlots, slotLabel, speakList } from "./speak";

/**
 * The three Vaani tools (PRD section 4, T1–T3). Pure of HTTP: route handlers wrap these.
 * Every response is safe to speak or follow; nothing here ever contains a pricing figure.
 */

export interface ToolDeps {
  repo: ToolsRepo;
  now: () => Date;
  rules: Omit<AssessContext, "now">;
  /** Only the "Aangan design call" event type is booked (decision 2026-10-10). */
  cal: (CalConfig & { eventTypeId?: number }) | null;
  placeholderEmailDomain: string;
  testAgentIds?: string[];
}

export interface ToolResult<B> {
  body: B;
  /** calls.id for tool_calls logging, when known */
  callId: string | null;
}

const REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newCallRef(): string {
  return Array.from({ length: 6 }, () => REF_ALPHABET[randomInt(REF_ALPHABET.length)]).join("");
}
export function normaliseRef(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const r = raw.trim().toUpperCase().replace(/[\s-]/g, "");
  return /^[A-Z2-9]{6}$/.test(r) ? r : null;
}

/** call_mode from Vaani's {{call_mode}} variable. Values are UNVERIFIED; anything web-like is a test. */
export function isTestMode(mode: string | null | undefined): boolean {
  return !!mode && /web|rtc|browser|test|chat|sandbox|preview/i.test(mode);
}

const OPEN_CALL_REUSE_MS = 20 * 60_000;

// ---------------------------------------------------------------- T1 submit_assessment

export interface SubmitResponse {
  call_id: string | null;
  tier: "green" | "amber" | "red" | null;
  action: string;
  callback_phrase: string | null;
  say_reason: string | null;
  reasons: string[];
  /** Instruction for the agent, never read aloud. */
  agent_note?: string;
}

export async function submitAssessment(raw: Record<string, unknown>, deps: ToolDeps): Promise<ToolResult<SubmitResponse>> {
  const now = deps.now();
  // T4: malformed or empty input gets a speakable answer and creates no call row; the
  // call-ended webhook will still record the call.
  if (!("criteria" in raw) && !("call_category" in raw)) {
    return { callId: null, body: { ...submitFallback(now, deps.rules.hours), reasons: ["malformed input: no call_category or criteria"] } };
  }
  const input = assessmentInputSchema.parse(raw);
  const callMode = typeof raw.call_mode === "string" ? raw.call_mode.trim().slice(0, 40) : null;
  const phone = normalisePhone(input.phone);

  let call = await findCall(raw.call_id, phone, now, deps.repo);
  if (!call) call = await createCallRow(deps.repo, { phone, callMode, now });

  // The agent decides the tier (decision 2026-10-10); the backend stores it as given. assess() runs
  // only for the facts the agent does not judge: after-hours, estimated value, priority, the
  // budget_tight note and descriptive flags. Its own tier is discarded.
  const result = assess(input, { ...deps.rules, now });
  const tier = input.call_category === "enquiry" ? input.tier : null;
  const action = actionForAgentTier(input.call_category, tier);
  await deps.repo.updateCall(call.id, {
    callCategory: input.call_category,
    callerName: input.caller_name ?? call.callerName,
    fromNumber: call.fromNumber ?? phone,
    calledAfterHours: result.called_after_hours,
    tier,
    tierReasons: input.tier_reason ? [input.tier_reason] : [],
    priority: result.priority,
    estimatedValueInr: result.estimated_value_inr,
    budgetLowInr: normaliseBudget(input.volunteered_budget_low_inr),
    budgetHighInr: normaliseBudget(input.volunteered_budget_high_inr),
    budgetFloorInr: result.budget.floorInr, // internal; never displayed
    budgetTight: result.budget.tight,
    criteriaAgent: { recorded: input.criteria, final: result.criteria },
    facts: factsOf(input, callMode, phone),
    flags: result.flags,
    completionNeededBy: input.completion_needed_by,
    siteReadyText: input.site_ready_text,
    referralSource: input.referral_source,
    existingProjectDesigner: input.existing_project_designer,
    isTest: call.isTest || isTestMode(callMode),
  });

  const cb = callbackWhen(now, deps.rules.hours);
  const callbackPhrase = cb.withinHour ? WORDING.callbackWithinHour : WORDING.callbackLater(cb.when);
  const phrase: Record<string, string | null> = {
    offer_booking: null,
    decline: WORDING.declineLine,
    callback: input.call_category === "existing_client" ? WORDING.existingClientCallback : callbackPhrase,
    escalate: WORDING.escalate,
    close_non_enquiry: WORDING.closeNonEnquiry,
  };
  const missingTier = input.call_category === "enquiry" && tier === null;
  return {
    callId: call.id,
    body: {
      call_id: call.callRef,
      tier,
      action,
      callback_phrase: phrase[action] ?? null,
      say_reason: null,
      reasons: tier && input.tier_reason ? [input.tier_reason] : [],
      ...(missingTier ? { agent_note: "No tier was sent. Decide green, amber or red from the rubric and call submit_assessment again with the same call_id." } : {}),
    },
  };
}

async function findCall(rawRef: unknown, phone: string | null, now: Date, repo: ToolsRepo): Promise<CallRow | null> {
  const ref = normaliseRef(rawRef);
  if (ref) {
    const byRef = await repo.findCallByRef(ref);
    if (byRef) return byRef;
  }
  if (phone) return repo.findRecentOpenCallByPhone(phone, new Date(now.getTime() - OPEN_CALL_REUSE_MS));
  return null;
}

async function createCallRow(
  repo: ToolsRepo,
  o: { phone: string | null; callMode: string | null; now: Date },
): Promise<CallRow> {
  for (let i = 0; i < 5; i++) {
    const row = await repo.createCall({
      callRef: newCallRef(),
      status: "in_call",
      fromNumber: o.phone,
      startedAt: o.now, // provisional; the webhook sets the real start time
      isTest: isTestMode(o.callMode),
    });
    if (row) return row;
  }
  throw new Error("could not allocate a call reference");
}

function factsOf(input: AssessmentInput, callMode: string | null, phone: string | null) {
  const facts: Record<string, unknown> = { ...input, phone_stated: phone, call_mode: callMode };
  delete facts.criteria;
  return facts;
}

/** Fail-safe when the backend itself fails: the agent promises a callback and books nothing. */
export function submitFallback(now: Date, hours: AssessContext["hours"]): SubmitResponse {
  const cb = callbackWhen(now, hours);
  return {
    call_id: null,
    tier: null,
    action: "callback",
    callback_phrase: cb.withinHour ? WORDING.callbackWithinHour : WORDING.callbackLater(cb.when),
    say_reason: null,
    reasons: ["backend unavailable; callback promised"],
  };
}

// ---------------------------------------------------------------- T2 check_availability

export const availabilitySchema = z.object({
  call_id: z.unknown().optional(),
  preferred_date: z.preprocess((v) => (typeof v === "string" ? v.trim().slice(0, 10) : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional().catch(undefined),
  preferred_time_text: z.preprocess((v) => (typeof v === "string" ? v : null), z.string().nullable()).optional(),
  // Only the design call is booked (decision 2026-10-10). Any value the agent sends reads as "call".
  consult_type: z.unknown().optional().transform(() => "call" as const),
  days_to_search: z.preprocess((v) => Number(v), z.number().int().min(1).max(7)).catch(3),
});

export interface AvailabilityResponse {
  slots: Array<{ start_iso: string; label: string }>;
  message: string;
  /** Instruction for the agent, not to be read aloud. */
  agent_note?: string;
}

const CALENDAR_DOWN =
  "I'm having trouble reaching the calendar right now. A designer will call you to fix a time that suits you.";

export async function checkAvailability(raw: Record<string, unknown>, deps: ToolDeps): Promise<ToolResult<AvailabilityResponse>> {
  const now = deps.now();
  const body = availabilitySchema.parse(raw);
  const ref = normaliseRef(body.call_id);
  const call = ref ? await deps.repo.findCallByRef(ref) : null;
  if (!call || !canBook(call.tier)) {
    return {
      callId: call?.id ?? null,
      body: {
        slots: [],
        message: CALENDAR_DOWN,
        agent_note: call ? "This call is not eligible for booking (only Green and Amber are). Do not offer times." : "Unknown call_id. Call submit_assessment first and pass the call_id it returns.",
      },
    };
  }
  const eventTypeId = deps.cal?.eventTypeId;
  if (!deps.cal || !eventTypeId) {
    return { callId: call.id, body: { slots: [], message: CALENDAR_DOWN, agent_note: "Calendar not configured." } };
  }

  const fetched = await fetchSlots(deps, eventTypeId, body.preferred_date, body.days_to_search, now);
  if (!fetched.ok) return { callId: call.id, body: { slots: [], message: CALENDAR_DOWN } };

  const pref = parseTimePreference(body.preferred_time_text);
  const preferred = fetched.slots.filter((s) => matchesPreference(s.start, pref));
  const usePreferred = preferred.length > 0;
  const chosen = pickSlots(usePreferred ? preferred : fetched.slots, 3).map((s) => ({ start_iso: new Date(s.start).toISOString(), label: slotLabel(s.start, now) }));

  if (chosen.length === 0) {
    return {
      callId: call.id,
      body: { slots: [], message: "I couldn't find a free time in those days. Is there another day that would suit you?" },
    };
  }
  const lead = usePreferred || !Object.keys(pref).length ? "I have" : "I don't have a time exactly as you asked, but I have";
  return {
    callId: call.id,
    body: { slots: chosen, message: `${lead} ${speakList(chosen.map((s) => s.label))}. Which would you like?` },
  };
}

async function fetchSlots(
  deps: ToolDeps,
  eventTypeId: number,
  preferredDate: string | undefined,
  days: number,
  now: Date,
): Promise<{ ok: true; slots: CalSlot[] } | { ok: false }> {
  const today = istParts(now).date;
  const startDate = preferredDate && preferredDate >= today ? preferredDate : today;
  const start = new Date(`${startDate}T00:00:00+05:30`);
  const from = start < now ? now : start;
  const end = new Date(start.getTime() + days * 86_400_000);
  try {
    const slots = await getSlots(deps.cal as CalConfig, eventTypeId, from.toISOString(), end.toISOString());
    return { ok: true, slots: slots.filter((s) => Date.parse(s.start) > now.getTime()) };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------- T3 book_consult

export const bookingSchema = z.object({
  call_id: z.unknown().optional(),
  slot_start_iso: z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string()).catch(""),
  consult_type: availabilitySchema.shape.consult_type,
  site_area: z.preprocess((v) => (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim().slice(0, 200) : null), z.string().nullable()),
  caller_name: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 100) : null), z.string().nullable()),
  phone: z.preprocess((v) => (typeof v === "string" ? v : null), z.string().nullable()),
  email: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, "") : null), z.string().nullable()),
  project_summary: z.preprocess((v) => (typeof v === "string" ? v.trim().slice(0, 300) : null), z.string().nullable()),
});

export interface BookingResponse {
  booked: boolean;
  spoken_confirmation?: string;
  reason?: string;
  slots?: Array<{ start_iso: string; label: string }>;
  agent_note?: string;
}

const NOT_ELIGIBLE = "I'm not able to book that directly, but a designer will call you back to arrange a time.";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

function confirmation(startIso: string, now: Date, hasEmail: boolean): string {
  const when = slotLabel(startIso, now);
  return hasEmail
    ? `You're booked for a design call with one of our designers ${when}. The joining details will come to your email.`
    : `You're booked for a design call with one of our designers ${when}. The designer will call you on this number at that time.`;
}

export async function bookConsult(raw: Record<string, unknown>, deps: ToolDeps): Promise<ToolResult<BookingResponse>> {
  const now = deps.now();
  const body = bookingSchema.parse(raw);
  const ref = normaliseRef(body.call_id);
  const call = ref ? await deps.repo.findCallByRef(ref) : null;

  // Only Green and Amber calls are booked (decision 2026-10-10); Red and unknown calls never are.
  if (!call || !canBook(call.tier)) {
    return {
      callId: call?.id ?? null,
      body: { booked: false, reason: NOT_ELIGIBLE, agent_note: call ? "Only Green and Amber calls can be booked." : "Unknown call_id." },
    };
  }

  const startMs = Date.parse(body.slot_start_iso);
  const eventTypeId = deps.cal?.eventTypeId;
  if (!Number.isFinite(startMs) || startMs <= now.getTime()) {
    return { callId: call.id, body: { booked: false, reason: "Sorry, I didn't catch which time you'd like.", agent_note: "slot_start_iso must be a start_iso from check_availability." } };
  }
  if (!deps.cal || !eventTypeId) {
    return { callId: call.id, body: { booked: false, reason: CALENDAR_DOWN } };
  }

  const startIso = new Date(startMs).toISOString();
  const phone = normalisePhone(body.phone) ?? call.fromNumber;
  const realEmail = body.email && EMAIL_RE.test(body.email) ? body.email : null;
  const email = realEmail ?? `${(call.callRef ?? "caller").toLowerCase()}@${deps.placeholderEmailDomain}`;

  // Idempotent per call: one booking row per call, claimed before Cal.com is touched.
  const { booking, created } = await deps.repo.claimBooking({
    callId: call.id,
    consultType: body.consult_type,
    startAt: new Date(startMs),
    eventTypeId,
    attendeeEmail: email,
    emailIsPlaceholder: !realEmail,
    status: "pending",
  });
  if (!created) {
    if (booking.status === "accepted") {
      return {
        callId: call.id,
        body: { booked: true, spoken_confirmation: confirmation(booking.startAt.toISOString(), now, !booking.emailIsPlaceholder), agent_note: "Already booked for this call." },
      };
    }
    if (booking.status === "pending") {
      return { callId: call.id, body: { booked: false, reason: "I'm just confirming that booking now. A designer will confirm the time with you shortly.", agent_note: "A booking is already in progress for this call." } };
    }
    // failed or cancelled: try again with this slot
    await deps.repo.updateBooking(booking.id, { status: "pending", startAt: new Date(startMs), consultType: body.consult_type, eventTypeId, attendeeEmail: email, emailIsPlaceholder: !realEmail });
  }

  try {
    const cal = await createBooking(deps.cal, {
      eventTypeId,
      start: startIso,
      attendee: { name: body.caller_name ?? call.callerName ?? "Aangan caller", email, timeZone: "Asia/Kolkata", ...(phone ? { phoneNumber: phone } : {}) },
      // No location: the design-call event type uses its own Google Meet integration.
      metadata: { call_ref: call.callRef ?? "" },
      notes: [
        "Booked by the Aangan voice agent.",
        body.project_summary ? `Project: ${body.project_summary}` : null,
        phone ? `Phone: ${phone}` : null,
        !realEmail ? "No email given; this booking uses a placeholder address." : null,
      ]
        .filter(Boolean)
        .join("\n"),
    });
    await deps.repo.updateBooking(booking.id, {
      status: "accepted",
      calBookingUid: cal.uid,
      startAt: new Date(cal.start ?? startIso),
      endAt: cal.end ? new Date(cal.end) : null,
    });
    await deps.repo.updateCall(call.id, {
      consultType: body.consult_type,
      siteArea: body.site_area ?? call.siteArea,
      callerName: call.callerName ?? body.caller_name,
      fromNumber: call.fromNumber ?? phone,
    });
    return { callId: call.id, body: { booked: true, spoken_confirmation: confirmation(cal.start ?? startIso, now, Boolean(realEmail)) } };
  } catch (err) {
    const timedOut = err instanceof CalError && (err.kind === "timeout" || err.kind === "network");
    if (timedOut) {
      // Cal.com may have created it: keep the row pending so the pipeline can reconcile (Phase 4).
      return { callId: call.id, body: { booked: false, reason: "I'm just confirming that booking now. A designer will confirm the time with you shortly." } };
    }
    await deps.repo.updateBooking(booking.id, { status: "failed" });
    const fresh = await fetchSlots(deps, eventTypeId, istParts(new Date(startMs)).date, 3, now);
    const slots = fresh.ok
      ? pickSlots(fresh.slots.filter((s) => Date.parse(s.start) !== startMs), 3).map((s) => ({ start_iso: new Date(s.start).toISOString(), label: slotLabel(s.start, now) }))
      : [];
    return {
      callId: call.id,
      body: {
        booked: false,
        reason: slots.length
          ? `Sorry, that time was just taken. I have ${speakList(slots.map((s) => s.label))}. Would one of those work?`
          : "Sorry, that time was just taken and I couldn't find another one right now. A designer will call you to fix a time.",
        slots,
      },
    };
  }
}
