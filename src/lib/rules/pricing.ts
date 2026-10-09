import { z } from "zod";

/**
 * Internal pricing figures used ONLY for the budget check and the estimate (PRD section 3).
 * Never spoken, never shown, never logged. The values live in PRICING_CONFIG_JSON (built from
 * the local pricing.md by `pnpm pricing:config`), because this repository is public.
 */
export const pricingConfigSchema = z.object({
  /** Floors: the lowest rates in pricing.md. */
  residentialFloorPerSqft: z.number().positive(),
  commercialFloorPerSqft: z.number().positive(),
  roomFloorInr: z.number().positive(),
  /** Estimates: midpoints of the standard, basic and single-room ranges. */
  residentialEstimatePerSqft: z.number().positive(),
  commercialEstimatePerSqft: z.number().positive(),
  roomEstimateInr: z.number().positive(),
  /** Every figure that appears in pricing.md, for the price-leak check. */
  leakFigures: z.array(z.number().positive()).default([]),
});

export type PricingConfig = z.infer<typeof pricingConfigSchema>;

export function parsePricingConfig(json: string | undefined): PricingConfig | null {
  if (!json) return null;
  try {
    const result = pricingConfigSchema.safeParse(JSON.parse(json));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

const LAKH = 100_000;

/** "₹1,000 – ₹2,000" or "₹2 lakh – ₹6 lakh" → [low, high] in rupees (or per-sq-ft rupees). */
function parseRange(text: string): [number, number] | null {
  const nums = [...text.matchAll(/₹\s*([\d,]+(?:\.\d+)?)\s*(lakh)?/gi)].map((m) => {
    const n = Number(m[1].replace(/,/g, ""));
    return m[2] ? n * LAKH : n;
  });
  return nums.length >= 2 ? [nums[0], nums[1]] : null;
}

function rowRange(md: string, rowLabel: RegExp): [number, number] {
  const line = md.split("\n").find((l) => rowLabel.test(l));
  const range = line ? parseRange(line) : null;
  if (!range) throw new Error(`pricing.md: could not read the range for ${rowLabel}`);
  return range;
}

/**
 * Derive the config from pricing.md text. Floors are the lowest rates (standard residential,
 * basic commercial fitout, the single-room lower bound). Estimates are the midpoints of those
 * same ranges (PRD section 3, steps 3 and 6).
 */
export function derivePricingConfig(pricingMd: string): PricingConfig {
  const residential = rowRange(pricingMd, /^\|\s*Standard specification/i);
  const commercial = rowRange(pricingMd, /^\|\s*Basic fitout/i);
  const room = rowRange(pricingMd, /^Single room redesign/i);
  const leakFigures = [
    ...new Set(
      [...pricingMd.matchAll(/₹\s*([\d,]+(?:\.\d+)?)\s*(lakh)?/gi)].map((m) => Number(m[1].replace(/,/g, ""))),
    ),
  ].sort((a, b) => a - b);
  return pricingConfigSchema.parse({
    residentialFloorPerSqft: residential[0],
    commercialFloorPerSqft: commercial[0],
    roomFloorInr: room[0],
    residentialEstimatePerSqft: (residential[0] + residential[1]) / 2,
    commercialEstimatePerSqft: (commercial[0] + commercial[1]) / 2,
    roomEstimateInr: (room[0] + room[1]) / 2,
    leakFigures,
  });
}
