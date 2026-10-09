import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildRubric, RUBRIC_HEADERS } from "@/lib/rubric/build";
import { derivePricingConfig } from "@/lib/rules";

const parts = {
  qualified: "# Q\r\nline one  \r\n",
  services: "\n\n# S\nline\n\n",
  pricing: readFileSync("tests/fixtures/pricing.sample.md", "utf8"),
  examples: readFileSync("src/lib/rubric/examples.txt", "utf8"),
};

describe("buildRubric (PRD section 3)", () => {
  it("puts the four parts in order under their headers", () => {
    const r = buildRubric(parts);
    const at = (h: string) => r.indexOf(h);
    expect(at(RUBRIC_HEADERS.qualified)).toBe(0);
    expect(at(RUBRIC_HEADERS.services)).toBeGreaterThan(at(RUBRIC_HEADERS.qualified));
    expect(at(RUBRIC_HEADERS.pricing)).toBeGreaterThan(at(RUBRIC_HEADERS.services));
    expect(at(RUBRIC_HEADERS.examples)).toBeGreaterThan(at(RUBRIC_HEADERS.pricing));
    expect(RUBRIC_HEADERS.pricing).toContain("INTERNAL PRICING: for qualification only, never to be spoken");
  });
  it("is deterministic and normalises line endings and trailing spaces", () => {
    const a = buildRubric(parts);
    expect(buildRubric({ ...parts })).toBe(a);
    expect(a).not.toMatch(/\r| \n/);
    expect(a.endsWith("\n") && !a.endsWith("\n\n")).toBe(true);
  });
  it("examples include all fifteen, with example 9 routed to a callback", () => {
    const ex = parts.examples;
    for (let i = 1; i <= 15; i++) expect(ex).toMatch(new RegExp(`^${i}\\. `, "m"));
    expect(ex).toMatch(/designer will\s+call back to arrange a consultation the parents can attend/);
  });
});

describe("derivePricingConfig", () => {
  it("takes floors from the lowest rates and estimates from midpoints", () => {
    const c = derivePricingConfig(parts.pricing);
    expect(c).toMatchObject({
      residentialFloorPerSqft: 1000,
      commercialFloorPerSqft: 800,
      roomFloorInr: 200_000,
      residentialEstimatePerSqft: 1500,
      commercialEstimatePerSqft: 1000,
      roomEstimateInr: 400_000,
    });
    expect(c.leakFigures).toEqual(expect.arrayContaining([800, 1000, 2000, 3000]));
  });
  it("throws if a row is missing", () => {
    expect(() => derivePricingConfig("# nothing here")).toThrow(/Standard specification/);
  });
});
