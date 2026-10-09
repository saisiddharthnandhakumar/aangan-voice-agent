import { describe, expect, it } from "vitest";
import { agentTurns, detectPriceLeak } from "@/lib/rules";
import { FAKE_PRICING } from "../helpers";

const transcript = `[13:33:14] AGENT: Hello, thank you for calling Aangan Studio.

[13:33:19] USER: How much for a 2BHK? Is it 1,000 per square foot?

[13:33:31] AGENT: Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation.
That is the best way.

[13:33:40] USER: ok`;

describe("agentTurns", () => {
  it("keeps only agent turns and joins wrapped lines", () => {
    const turns = agentTurns(transcript);
    expect(turns).toHaveLength(2);
    expect(turns[1]).toMatch(/consultation\. That is the best way\.$/);
  });
  it("handles the no-timestamp format", () => {
    expect(agentTurns("AGENT: Hi\n\n USER: hello\n\n AGENT: Bye")).toEqual(["Hi", "Bye"]);
  });
  it("handles an empty transcript", () => {
    expect(agentTurns(null)).toEqual([]);
  });
});

describe("detectPriceLeak (AT6)", () => {
  it("the pricing line alone is not a leak, and the caller's figures are ignored", () => {
    expect(detectPriceLeak(agentTurns(transcript), FAKE_PRICING).leak).toBe(false);
  });

  it.each([
    ["It usually costs around 15 lakh for that.", "lakh_crore"],
    ["Our rates start at ₹1,500.", "currency"],
    ["That is roughly 1500 rupees.", "currency"],
    ["We charge per square foot for that.", "per_area_rate"],
    ["About 2,000 per sq ft.", "per_area_rate"],
    ["It'll cost around what you said.", "price_phrase"],
    ["For a 2BHK it's typically 2,000 for the basic.", "pricing_figure"],
    ["Yes, 1.5 lakh is fine.", "lakh_crore"],
    ["लगभग 15 लाख", "lakh_crore"],
  ])("flags %j as %s", (turn, kind) => {
    const r = detectPriceLeak([turn], FAKE_PRICING);
    expect(r.leak).toBe(true);
    expect(r.kinds).toContain(kind);
  });

  it.each([
    "So that's a 1,000 sq ft flat in Baner?",
    "I have Tuesday at 2:30 PM or Wednesday at 11 AM.",
    "Design takes a few weeks and execution 8 weeks or more.",
    "Your 1500 square feet villa sounds lovely.",
    "We can do a site visit for your 3BHK.",
    "Could I have your number? It is 98200 1000 1?",
  ])("does not flag %j", (turn) => {
    expect(detectPriceLeak([turn], FAKE_PRICING).leak).toBe(false);
  });

  it("reports which turns leaked, without the figures", () => {
    const r = detectPriceLeak(["Hello", "It is 10 lakh"], FAKE_PRICING);
    expect(r.turns).toEqual([1]);
    expect(JSON.stringify(r)).not.toMatch(/10/);
  });
});
