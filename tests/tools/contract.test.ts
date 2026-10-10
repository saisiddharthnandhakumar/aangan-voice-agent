import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessmentInputObject, FLAT_CRITERIA_FIELDS } from "@/lib/rules";
import { availabilitySchema, bookingSchema } from "@/lib/tools/service";

/** docs/vaani/tools.json must only send fields the endpoints accept, so the Vaani entries match the code. */
const tools = JSON.parse(readFileSync("docs/vaani/tools.json", "utf8")).tools as Array<{ name: string; parameters: { properties: Record<string, unknown> } }>;
const accepted: Record<string, Set<string>> = {
  submit_assessment: new Set([...Object.keys(assessmentInputObject.shape), ...FLAT_CRITERIA_FIELDS, "call_mode"]),
  check_consult_availability: new Set([...Object.keys(availabilitySchema.shape), "call_mode"]),
  book_consult: new Set([...Object.keys(bookingSchema.shape), "call_mode"]),
};

describe("docs/vaani/tools.json matches the endpoints", () => {
  it("defines exactly the three PRD tools", () => {
    expect(tools.map((t) => t.name)).toEqual(["submit_assessment", "check_consult_availability", "book_consult"]);
  });
  it.each(["submit_assessment", "check_consult_availability", "book_consult"])("%s sends only accepted fields", (name) => {
    const tool = tools.find((t) => t.name === name)!;
    expect(Object.keys(tool.parameters.properties).filter((k) => !accepted[name].has(k))).toEqual([]);
  });
  it("submit_assessment covers every PRD field (criteria sent flat)", () => {
    const sent = new Set(Object.keys(tools[0].parameters.properties));
    const expected = [...accepted.submit_assessment].filter((k) => k !== "criteria");
    expect(expected.filter((k) => !sent.has(k))).toEqual([]);
  });
  it("never contains a real secret or URL", () => {
    const raw = readFileSync("docs/vaani/tools.json", "utf8");
    expect(raw).toContain("YOUR_VAANI_TOOL_SECRET");
    expect(raw).not.toMatch(/[0-9a-f]{64}/);
  });
});
