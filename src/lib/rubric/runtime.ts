/**
 * rubric.txt at runtime (user decision 2026-10-10): RUBRIC_TXT_B64 holds the file base64-encoded, written by
 * `pnpm rubric:env`, because rubric.txt is gitignored and never deployed. There is deliberately no file
 * fallback here: reading a file path at runtime makes the bundler trace the whole project into the server
 * bundle. Returns null when the variable is missing or too short to be a rubric; the Gemini step is then
 * skipped (missing_config). The rubric contains the internal pricing section: never log it.
 */
export function loadRubric(b64: string | undefined): string | null {
  if (!b64) return null;
  const text = Buffer.from(b64, "base64").toString("utf8").trim();
  return text.length > 100 ? text : null;
}
