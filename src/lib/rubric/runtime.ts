import { existsSync, readFileSync } from "node:fs";

/**
 * rubric.txt at runtime (user decision 2026-10-10): RUBRIC_TXT_B64 holds the file base64-encoded,
 * written by `pnpm rubric:env`, because rubric.txt is gitignored and never deployed. Locally, with
 * the variable empty, the file itself is read. Returns null when neither exists; the Gemini step
 * is then skipped (missing_config). The rubric contains the internal pricing section: never log it.
 */
export function loadRubric(b64: string | undefined, localPath = "rubric.txt"): string | null {
  if (b64) {
    const text = Buffer.from(b64, "base64").toString("utf8").trim();
    return text.length > 100 ? text : null;
  }
  if (process.env.NODE_ENV !== "production" && existsSync(localPath)) return readFileSync(localPath, "utf8");
  return null;
}
