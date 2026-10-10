import { describe, expect, it } from "vitest";
import { buildAlertText, buildDigest, planAlerts, type AlertContext } from "@/lib/telegram/alerts";
import type { CallRow } from "@/lib/tools/repo";

const ctx = (over: Partial<AlertContext> = {}): AlertContext => ({ appBaseUrl: "https://aangan.example", booking: null, founderChatConfigured: true, ...over });
const BOOKED = { status: "accepted" as const, startAt: new Date("2026-10-13T10:00:00Z") }; // Tue 15:30 IST

function call(over: Partial<CallRow> = {}): CallRow {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    callRef: "ABC234",
    fromNumber: "+919876543210",
    callerName: "Priya Sharma",
    callCategory: "enquiry",
    status: "booked",
    reviewState: "none",
    tier: "green",
    priority: "normal",
    flags: [],
    isTest: false,
    priceLeak: false,
    budgetTight: false,
    tierReasons: ["all pass"],
    summary: "Wants her 3BHK in Kothrud redone by March.",
    handoffNote: "Confirm kitchen scope.",
    openQuestions: ["Carpet area?"],
    facts: { project_type: "home", property_detail: "3BHK apartment", size_sqft: 1400, locality: "Kothrud", timeline_text: "by March", referral_source: "a friend" },
    transcript: null,
    criteriaGemini: null,
    existingProjectDesigner: null,
    completionNeededBy: null,
    referralSource: null,
    durationSeconds: 120,
    ...over,
  } as unknown as CallRow;
}

const plan = (c: CallRow, x = ctx()) => planAlerts(c, x);

describe("who gets which alert", () => {
  it("Green → the designers' group", () => {
    expect(plan(call())).toMatchObject([{ key: "lead", kind: "lead_green", chat: "designers" }]);
  });
  it("Amber → the designers' group, labelled AMBER (user decision 2026-10-10)", () => {
    const [a] = plan(call({ tier: "amber", tierReasons: ["parents decide"] }));
    expect(a).toMatchObject({ kind: "lead_amber", chat: "designers" });
    expect(a.text).toContain("AMBER lead");
    expect(a.text.split("\n")[1]).toContain("Why Amber: parents decide"); // tier and reason are in the first two lines
  });
  it("Red → nobody", () => {
    expect(plan(call({ tier: "red", status: "unqualified_verified" }))).toEqual([]);
  });
  it("test calls → nobody (AT11)", () => {
    expect(plan(call({ isTest: true, priceLeak: true, callCategory: "existing_client_complaint" }))).toEqual([]);
  });
  it("existing client → a callback request to the designers", () => {
    expect(plan(call({ callCategory: "existing_client", tier: null }))).toMatchObject([{ kind: "existing_client", chat: "designers" }]);
  });
  it("a complaint → the founder chat only, no lead alert (AT16)", () => {
    expect(plan(call({ callCategory: "existing_client_complaint", tier: null, status: "escalated" }))).toMatchObject([{ key: "escalation", chat: "founder" }]);
  });
  it("a price leak adds a founder alert on top of the lead alert", () => {
    expect(plan(call({ priceLeak: true })).map((a) => [a.key, a.chat])).toEqual([["lead", "designers"], ["price_leak", "founder"]]);
  });
  it("a dropped call with a number asks designers to call back; without a number, nothing", () => {
    expect(plan(call({ status: "dropped", callCategory: null, tier: null }))).toMatchObject([{ kind: "dropped", chat: "designers" }]);
    expect(plan(call({ status: "dropped", callCategory: null, tier: null, fromNumber: null }))).toEqual([]);
  });
  it("a call no tool reached (unrated) goes to the designers as such", () => {
    expect(plan(call({ callCategory: null, tier: null, status: "awaiting_designer", flags: ["unclassified"] }))).toMatchObject([{ kind: "unclassified" }]);
  });
  it("vendors, job seekers and wrong numbers → nobody", () => {
    for (const c of ["vendor_or_sales", "job_seeker", "wrong_number", "other"] as const) expect(plan(call({ callCategory: c, tier: null, status: "non_enquiry" }))).toEqual([]);
  });
});

describe("what an alert says", () => {
  it("carries tier, priority, name, phone, project, locality, timeline, slot, source, summary and a dashboard button (PRD)", () => {
    const [a] = plan(call({ priority: "high" }), ctx({ booking: BOOKED }));
    for (const part of ["GREEN lead", "High priority", "Priya Sharma", "+919876543210", "3BHK apartment", "1,400 sq ft", "Kothrud", "by March", "Tue, 13 Oct, 3:30 PM IST (booked)", "a friend", "Wants her 3BHK", "Handoff:"]) {
      expect(a.text).toContain(part);
    }
    expect(a.button).toEqual({ text: "Open in dashboard", url: "https://aangan.example/dashboard/calls/11111111-2222-3333-4444-555555555555" });
  });
  it("never puts a phone number or a figure in the button URL", () => {
    const [a] = plan(call());
    expect(a.button?.url).not.toMatch(/9876|\?|token/);
  });
  it("omits the button when the app URL is not public https (Telegram rejects it)", () => {
    expect(plan(call(), ctx({ appBaseUrl: "http://localhost:3000" }))[0].button).toBeUndefined();
    expect(plan(call(), ctx({ appBaseUrl: undefined }))[0].button).toBeUndefined();
  });
  it("says when nothing is booked, and mentions a lower budget without a figure", () => {
    const [a] = plan(call({ budgetTight: true, budgetLowInr: 400000, budgetHighInr: 500000 } as Partial<CallRow>));
    expect(a.text).toContain("Not booked");
    expect(a.text).toContain("budget is on the lower side");
    expect(a.text).not.toMatch(/4,?00,?000|5,?00,?000|lakh|₹/);
  });
  it("HTML-escapes everything the caller said", () => {
    const [a] = plan(call({ callerName: "<b>Eve</b> & co", summary: "wants <script>x</script> & more", facts: { locality: "A<B", project_type: "home" } }));
    expect(a.text).toContain("&lt;b&gt;Eve&lt;/b&gt; &amp; co");
    expect(a.text).toContain("wants &lt;script&gt;x&lt;/script&gt; &amp; more");
    expect(a.text).not.toContain("<script>");
    expect(a.text).toContain("<b>GREEN lead</b>"); // our own tags survive
  });
  it("keeps the summary within 600 characters", () => {
    const [a] = plan(call({ summary: "word ".repeat(400) }));
    const summary = a.text.split("\n").find((l) => l.startsWith("<b>Summary:</b>")) as string;
    expect(summary.length).toBeLessThanOrEqual(600 + "<b>Summary:</b> ".length);
  });
  it("falls back to the caller's own words when there is no summary (AT10), with money masked", () => {
    const transcript = "[10:00:01] AGENT: Hello, it will cost 2 lakh.\n\n[10:00:05] USER: I want my 3BHK done. I can spend ₹15 lakh.\n\n[10:00:09] AGENT: Noted.";
    const [a] = plan(call({ summary: null, handoffNote: null, openQuestions: null, transcript }));
    expect(a.text).toContain("Caller said (summary unavailable)");
    expect(a.text).toContain("I want my 3BHK done. I can spend [amount].");
    expect(a.text).not.toMatch(/lakh|₹|Hello, it will cost/);
  });
  it("flags unrated and unmatched calls in plain words", () => {
    const [a] = plan(call({ callCategory: null, tier: null, flags: ["unclassified", "needs_manual_link"] }));
    expect(a.text).toContain("did not record a tier");
    expect(a.text).toContain("overlapped");
  });
  it("a price-leak alert names the call but never repeats the figure", () => {
    const leak = plan(call({ priceLeak: true, criteriaGemini: { price_leak: { leaked: true, evidence: "about #### a square foot" } } as never })).find((a) => a.key === "price_leak")!;
    expect(leak.text).toContain("PRICE LEAK");
    expect(leak.text).toContain("ABC234");
    expect(leak.text.replace(/\+91\d{10}/, "").replace("ABC234", "")).not.toMatch(/\d{3,}/); // the caller's number is fine; no figure is
  });
  it("buildAlertText for a dropped call asks for a callback", () => {
    expect(buildAlertText("dropped", call({ status: "dropped", callCategory: null, tier: null, summary: null }), ctx())).toContain("please call back");
  });
});

describe("daily digest (P9)", () => {
  const now = new Date("2026-10-13T03:30:00Z");
  it("lists unreviewed Amber and recent Red with ages, and never a phone number", () => {
    const d = buildDigest(
      [
        { id: "a", tier: "amber", name: "Priya", locality: "Kothrud", createdAt: new Date("2026-10-12T05:30:00Z") },
        { id: "b", tier: "red", name: null, locality: "Nashik", createdAt: new Date("2026-10-12T20:30:00Z") },
      ],
      "https://aangan.example",
      now,
    );
    expect(d.text).toContain("Amber, not yet reviewed (1)");
    expect(d.text).toContain("Priya, Kothrud (22h ago)");
    expect(d.text).toContain("Red in the last day (1)");
    expect(d.text).toContain("Unknown caller, Nashik (7h ago)");
    expect(d.button?.url).toBe("https://aangan.example/dashboard");
  });
  it("caps long lists", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: String(i), tier: "amber" as const, name: `N${i}`, locality: null, createdAt: now }));
    expect(buildDigest(items, undefined, now).text).toContain("…and 5 more");
  });
});
