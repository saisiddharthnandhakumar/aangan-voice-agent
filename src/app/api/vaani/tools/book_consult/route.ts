import { bookConsult } from "@/lib/tools/service";
import { toolRoute } from "@/lib/tools/http";

export const runtime = "nodejs";

/** T3: book the chosen slot. Refuses unless the stored tier is Green; one booking per call. */
export const POST = toolRoute({
  tool: "book_consult",
  run: bookConsult,
  fallback: () => ({
    booked: false,
    reason: "I'm just confirming that booking now. A designer will confirm the time with you shortly.",
  }),
});
