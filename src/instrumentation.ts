import { env } from "@/env";

/** Validates the environment once when a server instance starts (Next.js calls this first). */
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") env();
}
