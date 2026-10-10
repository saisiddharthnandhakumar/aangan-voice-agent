import { checkAvailability } from "@/lib/tools/service";
import { toolRoute } from "@/lib/tools/http";

export const runtime = "nodejs";

/** T2: up to three open Cal.com slots with speakable IST labels. */
const handler = toolRoute({
  tool: "check_availability",
  run: checkAvailability,
  fallback: () => ({
    slots: [],
    message: "I'm having trouble reaching the calendar right now. A designer will call you to fix a time that suits you.",
  }),
});

// POST is the contract; GET and PUT are accepted too because Vaani's request method is UNVERIFIED.
export const POST = handler;
export const GET = handler;
export const PUT = handler;
