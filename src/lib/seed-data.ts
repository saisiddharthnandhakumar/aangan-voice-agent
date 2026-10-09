import type { InferInsertModel } from "drizzle-orm";
import type { bookings, calls } from "@/db/schema";

type CallInsert = InferInsertModel<typeof calls>;
type BookingInsert = Omit<InferInsertModel<typeof bookings>, "callId">;

export const SEED_PREFIX = "seed-";

/**
 * Invented calls for local development and dashboard work. Every row is is_test.
 * None of this comes from the September enquiries (those are never stored as calls).
 * Names and numbers are fictional; +91 99999 0xxxx is not a real range we use.
 */
export function buildSeedCalls(now: Date = new Date()): Array<{ call: CallInsert; booking?: BookingInsert }> {
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000);
  const base = (n: number, hoursAgo: number, minutes: number): Partial<CallInsert> => ({
    vaaniCallId: `${SEED_PREFIX}${String(n).padStart(3, "0")}`,
    fromNumber: `+9199999${String(n).padStart(5, "0")}`,
    toNumber: "+910000000000",
    startedAt: at(hoursAgo),
    answeredAt: new Date(at(hoursAgo).getTime() + 4_000),
    endedAt: new Date(at(hoursAgo).getTime() + minutes * 60_000),
    durationSeconds: minutes * 60,
    isTest: true,
    endReason: "completed",
  });

  return [
    {
      call: {
        ...base(1, 2, 6),
        callerName: "Test Caller Asha",
        callCategory: "enquiry",
        status: "booked",
        tier: "green",
        priority: "normal",
        calledAfterHours: false,
        consultType: "site_visit",
        siteArea: "Testville, Pune",
        referralSource: "friend",
        estimatedValueInr: 2_000_000,
        summary: "Seed data: full-home redesign of a 3BHK, no deadline, owner deciding.",
        tierReasons: ["all five criteria pass"],
        vaaniCostInr: 18,
        geminiCostInr: 0.4,
        totalCostInr: 18.4,
      },
      booking: {
        consultType: "site_visit",
        startAt: new Date(now.getTime() + 2 * 86_400_000),
        endAt: new Date(now.getTime() + 2 * 86_400_000 + 3_600_000),
        attendeeEmail: "seed-001@example.test",
        emailIsPlaceholder: true,
        status: "accepted",
      },
    },
    {
      call: {
        ...base(2, 5, 5),
        callerName: "Test Caller Bhavin",
        callCategory: "enquiry",
        status: "awaiting_designer",
        tier: "amber",
        priority: "normal",
        calledAfterHours: true,
        summary: "Seed data: timeline unclear after one question.",
        tierReasons: ["timeline unclear"],
        vaaniCostInr: 15,
        geminiCostInr: 0.3,
        totalCostInr: 15.3,
      },
    },
    {
      call: {
        ...base(3, 26, 3),
        callerName: "Test Caller Chitra",
        callCategory: "enquiry",
        status: "unqualified_verified",
        tier: "red",
        priority: "normal",
        calledAfterHours: false,
        summary: "Seed data: site outside the service area.",
        tierReasons: ["service area fail"],
        vaaniCostInr: 9,
        geminiCostInr: 0.2,
        totalCostInr: 9.2,
      },
    },
    {
      call: {
        ...base(4, 30, 4),
        callerName: "Test Caller Dev",
        callCategory: "existing_client_complaint",
        status: "escalated",
        calledAfterHours: false,
        existingProjectDesigner: "Test Designer",
        summary: "Seed data: existing client asking for a senior person.",
        vaaniCostInr: 12,
        totalCostInr: 12,
      },
    },
    {
      call: {
        ...base(5, 50, 1),
        callCategory: "vendor_or_sales",
        status: "non_enquiry",
        calledAfterHours: false,
        summary: "Seed data: a vendor pitch, closed politely.",
        vaaniCostInr: 3,
        totalCostInr: 3,
      },
    },
    {
      call: {
        ...base(6, 1, 1),
        callerName: null,
        status: "dropped",
        endReason: "dropped",
        calledAfterHours: true,
        summary: "Seed data: dropped before the assessment.",
        vaaniCostInr: 2,
        totalCostInr: 2,
      },
    },
  ];
}
