import { bookConsult } from "@/lib/tools/service";
import { toolRoute } from "@/lib/tools/http";

export const runtime = "nodejs";

/** T3: book the chosen slot. Refuses unless the stored tier is Green; one booking per call. */
const handler = toolRoute({
  tool: "book_consult",
  run: bookConsult,
  fallback: () => ({
    booked: false,
    reason: "I'm just confirming that booking now. A designer will confirm the time with you shortly.",
  }),
});

// POST is the contract; GET and PUT are accepted too because Vaani's request method is UNVERIFIED.
export const POST = handler;
export const GET = handler;
export const PUT = handler;
