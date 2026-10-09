import type { PricingConfig } from "./pricing";

/**
 * P5 price-leak check on the agent's own turns. Any money word, per-area rate, or a pricing.md
 * figure used as money sets price_leak. Hits name the KIND of leak only, never the figure, so
 * they can be stored and shown safely. Gemini adds a second, semantic check after the call.
 */

export type LeakKind = "currency" | "lakh_crore" | "per_area_rate" | "price_phrase" | "pricing_figure";

export interface LeakResult {
  leak: boolean;
  kinds: LeakKind[];
  /** 0-based indexes of the agent turns that leaked. */
  turns: number[];
}

/** Agent turns from a Vaani transcript ("[13:33:14] AGENT: ..." / "AGENT: ...", turns separated by blank lines). */
export function agentTurns(transcript: string | null | undefined): string[] {
  if (!transcript) return [];
  const turns: { speaker: string; text: string }[] = [];
  for (const line of transcript.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:\[[^\]]*\]\s*)?(AGENT|USER|ASSISTANT|BOT|CALLER|HUMAN)\s*:\s*(.*)$/i);
    if (m) turns.push({ speaker: m[1].toUpperCase(), text: m[2] });
    else if (turns.length && line.trim()) turns[turns.length - 1].text += ` ${line.trim()}`;
  }
  return turns.filter((t) => ["AGENT", "ASSISTANT", "BOT"].includes(t.speaker)).map((t) => t.text);
}

const PATTERNS: Array<[LeakKind, RegExp]> = [
  ["currency", /₹|\brs\.?\s*\d|\brupees?\b|\binr\b|\brupaye\b|रुपये|रुपए|रुपया/i],
  ["lakh_crore", /\blakhs?\b|\blacs?\b|\bcrores?\b|\b\d+(\.\d+)?\s*(l|cr)\b|लाख|करोड/i],
  ["per_area_rate", /\bper\s*(sq(uare)?\.?\s*(ft|feet|foot)|sqft|square)\b|\/\s*sq\.?\s*ft|\ba\s+square\s+(foot|feet)\b|प्रति\s*वर्ग/i],
  ["price_phrase", /\b(it('ll| will)? cost(s)? (around|about)|rates? (start|begin)|starting (from|at)|typically costs?|ballpark of)\b/i],
];

function figureAsMoney(text: string, figures: readonly number[]): boolean {
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)/g)) {
    const n = Number(m[1].replace(/,/g, ""));
    // Small figures ("2", "6") only leak with a money word, which the patterns already catch.
    if (n < 100 || !figures.includes(n)) continue;
    const start = m.index ?? 0;
    const after = text.slice(start + m[0].length, start + m[0].length + 20).toLowerCase();
    const before = text.slice(Math.max(0, start - 3), start);
    // Part of a phone number or ID read back in groups ("98200 1000 1").
    if (/\d[\s-]$/.test(before) || /^[\s-]\d/.test(after)) continue;
    // An echoed area such as "1,000 sq ft" is not a price.
    if (/^\s*(sq\.?\s*(ft|feet)|sqft|square\s*(feet|foot)|carpet)/.test(after)) continue;
    // A time ("at 2:30") or date is not a price.
    if (/^\s*(am|pm|:|hrs?\b|hours?|minutes?|days?|weeks?|months?|bhk|rooms?|people)/.test(after)) continue;
    return true;
  }
  return false;
}

export function detectPriceLeak(turns: readonly string[], pricing: Pick<PricingConfig, "leakFigures"> | null): LeakResult {
  const kinds = new Set<LeakKind>();
  const leakedTurns: number[] = [];
  turns.forEach((turn, i) => {
    let hit = false;
    for (const [kind, re] of PATTERNS) {
      if (re.test(turn)) {
        kinds.add(kind);
        hit = true;
      }
    }
    if (pricing?.leakFigures.length && figureAsMoney(turn, pricing.leakFigures)) {
      kinds.add("pricing_figure");
      hit = true;
    }
    if (hit) leakedTurns.push(i);
  });
  return { leak: leakedTurns.length > 0, kinds: [...kinds], turns: leakedTurns };
}
