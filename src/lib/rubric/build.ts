import { createHash } from "node:crypto";

/**
 * rubric.txt (PRD section 3): qualified.md, services.md, pricing.md under the INTERNAL PRICING
 * header, then the examples, in that order, each under its own header. Deterministic: the same
 * inputs always give the same bytes (line endings and trailing spaces are normalised).
 */
export const RUBRIC_HEADERS = {
  qualified: "=== QUALIFICATION RULES (qualified.md, written by Nikhil Deshpande) ===",
  services: "=== SERVICES (services.md) ===",
  pricing: "=== INTERNAL PRICING: for qualification only, never to be spoken ===",
  examples: "=== EXAMPLES ===",
} as const;

export interface RubricParts {
  qualified: string;
  services: string;
  pricing: string;
  examples: string;
}

function normalise(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

export function buildRubric(parts: RubricParts): string {
  const order: Array<keyof RubricParts> = ["qualified", "services", "pricing", "examples"];
  return `${order.map((k) => `${RUBRIC_HEADERS[k]}\n\n${normalise(parts[k])}`).join("\n\n")}\n`;
}

export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
