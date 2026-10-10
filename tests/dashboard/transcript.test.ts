import { describe, expect, it } from "vitest";
import { parseTranscript } from "@/lib/dashboard/transcript";

describe("parseTranscript", () => {
  const t = "[10:00:01] AGENT: Hello, thank you for calling.\n\n[10:00:06] USER: Hi, I want my 3BHK redone.\nIt is in Kothrud.\n\n[10:00:12] AGENT: Roughly 2 lakh a room.";
  it("splits into turns, joins wrapped lines, and marks only the agent's price talk", () => {
    expect(parseTranscript(t)).toEqual([
      { speaker: "agent", time: "10:00:01", text: "Hello, thank you for calling.", leak: false },
      { speaker: "caller", time: "10:00:06", text: "Hi, I want my 3BHK redone. It is in Kothrud.", leak: false },
      { speaker: "agent", time: "10:00:12", text: "Roughly 2 lakh a room.", leak: true },
    ]);
  });
  it("never flags the caller's own figures", () => {
    expect(parseTranscript("USER: my budget is 20 lakh\nAGENT: noted").map((x) => x.leak)).toEqual([false, false]);
  });
  it("handles empty and unlabelled text", () => {
    expect(parseTranscript(null)).toEqual([]);
    expect(parseTranscript("just some words")).toEqual([]);
  });
});
