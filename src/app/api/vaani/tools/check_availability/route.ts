import { checkAvailability } from "@/lib/tools/service";
import { toolRoute } from "@/lib/tools/http";

export const runtime = "nodejs";

/** T2: up to three open Cal.com slots with speakable IST labels. */
export const POST = toolRoute({
  tool: "check_availability",
  run: checkAvailability,
  fallback: () => ({
    slots: [],
    message: "I'm having trouble reaching the calendar right now. A designer will call you to fix a time that suits you.",
  }),
});
