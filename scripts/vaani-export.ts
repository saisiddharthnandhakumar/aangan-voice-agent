/**
 * pnpm vaani:export — writes docs/vaani/tools.json and docs/vaani/curl.md from the schemas the
 * endpoints actually accept, so the Vaani tool entries match the code. The real URL and secret
 * are never written: the files use YOUR-APP and YOUR_VAANI_TOOL_SECRET placeholders.
 */
import { writeFileSync } from "node:fs";
import { CALL_CATEGORIES, CRITERION_STATUSES, PROJECT_TYPES, SCOPE_TYPES } from "../src/lib/rules/types";

const BASE = "https://YOUR-APP.vercel.app/api/vaani/tools";
const str = (description: string) => ({ type: ["string", "null"], description });
const num = (description: string) => ({ type: ["number", "null"], description });
const callId = {
  type: "string",
  description: "The call_id returned by your first submit_assessment in this call. Empty on the very first submit_assessment.",
};
const callMode = { type: "string", description: "Always the value of {{call_mode}}." };

const tools = [
  {
    name: "submit_assessment",
    description:
      "Record what the caller has told you against the five criteria. Call it before offering a booking or ending the call, and again if the caller changes something important. It returns the call_id to reuse and the action you must follow.",
    method: "POST",
    url: `${BASE}/submit_assessment`,
    headers: { "Content-Type": "application/json", "X-Tool-Secret": "YOUR_VAANI_TOOL_SECRET" },
    parameters: {
      type: "object",
      properties: {
        call_id: callId,
        call_mode: callMode,
        call_category: { type: "string", enum: [...CALL_CATEGORIES] },
        caller_name: str("Caller's name"),
        phone: str("Best number to reach them, digits as said"),
        project_type: { type: "string", enum: [...PROJECT_TYPES] },
        scope_type: { type: "string", enum: [...SCOPE_TYPES] },
        rooms_in_scope: num("Number of rooms if specific rooms; a kitchen counts as a room"),
        property_detail: str("For example 3BHK apartment"),
        bhk: num("BHK of the flat"),
        size_sqft: num("Carpet area in sq ft if stated"),
        locality: str("Area or pincode of the site"),
        scope_summary: str("One or two sentences"),
        completion_needed_by: str("YYYY-MM-DD when the project must be COMPLETE. A month alone means the 1st. Never a possession date."),
        timeline_text: str("Caller's own words about timing"),
        site_ready_text: str("When the site is available, e.g. possession date, in the caller's words"),
        volunteered_budget_low_inr: num("Only if the caller volunteered a number, in rupees (1.5 lakh = 150000). Never ask."),
        volunteered_budget_high_inr: num("Top of the volunteered range, in rupees. Same as low for a single number."),
        referral_source: str("How they heard about the studio"),
        existing_project_designer: str("Existing clients only"),
        issue_summary: str("Existing clients only, one line"),
        real_project_status: { type: "string", enum: ["pass", "fail", "unclear"], description: "Pass = design AND execution wanted" },
        real_project_evidence: { type: "string", description: "The caller's own words, briefly" },
        service_area_status: { type: "string", enum: ["pass", "fail", "unclear"], description: "Pass = site in Pune city or PCMC" },
        service_area_evidence: { type: "string", description: "The caller's own words, briefly" },
        timeline_status: { type: "string", enum: ["pass", "fail", "unclear"], description: "When the project must be complete" },
        timeline_evidence: { type: "string", description: "The caller's own words, briefly" },
        budget_status: { type: "string", enum: ["pass", "fail", "unclear"], description: "pass unless the caller volunteered a number; never ask" },
        budget_evidence: { type: "string", description: "The caller's own words, briefly" },
        decision_maker_status: { type: "string", enum: ["pass", "fail", "unclear"], description: "fail only if clearly researching for someone else" },
        decision_maker_evidence: { type: "string", description: "The caller's own words, and who decides if someone else" },
        flags: { type: "string", description: "Comma-separated, any of: structural_changes, wants_human, frustrated_repeat. Empty if none." },
        timeline_move_asked: { type: "boolean", description: "True once you have asked whether the date can move" },
      },
      required: [
        "call_id", "call_mode", "call_category",
        "real_project_status", "service_area_status", "timeline_status", "budget_status", "decision_maker_status",
      ],
    },
    returns: "{ call_id, tier, action: offer_booking | callback | decline | escalate | close_non_enquiry | ask_date_move, callback_phrase, say_reason, reasons }",
    example: {
      call_id: "",
      call_mode: "{{call_mode}}",
      call_category: "enquiry",
      caller_name: "Priya",
      phone: "9876543210",
      project_type: "home",
      scope_type: "full_home",
      rooms_in_scope: null,
      property_detail: "3BHK apartment",
      bhk: 3,
      size_sqft: 1400,
      locality: "Kothrud",
      scope_summary: "Full redesign of a 3BHK",
      completion_needed_by: "2027-03-01",
      timeline_text: "by March, no rush",
      site_ready_text: null,
      volunteered_budget_low_inr: null,
      volunteered_budget_high_inr: null,
      referral_source: "friend",
      existing_project_designer: null,
      issue_summary: null,
      real_project_status: "pass",
      real_project_evidence: "redo the whole thing",
      service_area_status: "pass",
      service_area_evidence: "Kothrud",
      timeline_status: "pass",
      timeline_evidence: "by March, no rush",
      budget_status: "pass",
      budget_evidence: "not mentioned",
      decision_maker_status: "pass",
      decision_maker_evidence: "my husband and I decide",
      flags: "",
      timeline_move_asked: false,
    },
  },
  {
    // Vaani reserves the name "check_availability" (it reports "already exists"), so the
    // function is registered as check_consult_availability. The endpoint path is unchanged.
    name: "check_consult_availability",
    description: "Look up open consultation slots from a date the caller chose. Returns up to three slots with the wording to read aloud.",
    method: "POST",
    url: `${BASE}/check_availability`,
    headers: { "Content-Type": "application/json", "X-Tool-Secret": "YOUR_VAANI_TOOL_SECRET" },
    parameters: {
      type: "object",
      properties: {
        call_id: callId,
        call_mode: callMode,
        preferred_date: { type: "string", description: "YYYY-MM-DD the caller prefers" },
        preferred_time_text: str("For example morning, evening, weekend, Saturday"),
        consult_type: { type: "string", enum: ["site_visit", "call"] },
        days_to_search: { type: "integer", minimum: 1, maximum: 7, description: "Default 3" },
      },
      required: ["call_id", "preferred_date", "consult_type"],
    },
    returns: "{ slots: [{ start_iso, label }], message, agent_note? }  Read message aloud; never read agent_note.",
    example: { call_id: "ABC234", call_mode: "{{call_mode}}", preferred_date: "2026-10-14", preferred_time_text: "evening", consult_type: "site_visit", days_to_search: 3 },
  },
  {
    name: "book_consult",
    description: "Book the slot the caller chose. Only works for calls the assessment marked offer_booking. Pass start_iso exactly as check_availability returned it.",
    method: "POST",
    url: `${BASE}/book_consult`,
    headers: { "Content-Type": "application/json", "X-Tool-Secret": "YOUR_VAANI_TOOL_SECRET" },
    parameters: {
      type: "object",
      properties: {
        call_id: callId,
        call_mode: callMode,
        slot_start_iso: { type: "string", description: "start_iso of the chosen slot, unchanged" },
        consult_type: { type: "string", enum: ["site_visit", "call"] },
        site_area: str("Area or address for a site visit"),
        caller_name: str("Caller's name"),
        phone: str("Caller's number"),
        email: str("Only if the caller gave one; read it back first"),
        project_summary: str("One line"),
      },
      required: ["call_id", "slot_start_iso", "consult_type"],
    },
    returns: "{ booked: true, spoken_confirmation } or { booked: false, reason, slots? }  Say spoken_confirmation or reason.",
    example: {
      call_id: "ABC234",
      call_mode: "{{call_mode}}",
      slot_start_iso: "2026-10-14T10:30:00.000Z",
      consult_type: "site_visit",
      site_area: "Kothrud",
      caller_name: "Priya",
      phone: "9876543210",
      email: null,
      project_summary: "Full redesign of a 3BHK",
    },
  },
];

writeFileSync("docs/vaani/tools.json", `${JSON.stringify({ generated_by: "pnpm vaani:export", tools }, null, 2)}\n`);

const curl = tools
  .map(
    (t) => `## ${t.name}

${t.description}

\`\`\`bash
curl -X POST '${t.url}' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Tool-Secret: YOUR_VAANI_TOOL_SECRET' \\
  -d '${JSON.stringify(t.example)}'
\`\`\`

Returns: ${t.returns}
`,
  )
  .join("\n");
writeFileSync(
  "docs/vaani/curl.md",
  `# Vaani tools: one cURL per tool

Paste each block into Vaani's tool form ("Paste cURL"), then:
- replace \`YOUR-APP.vercel.app\` with the Vercel production domain;
- replace \`YOUR_VAANI_TOOL_SECRET\` with the value of \`VAANI_TOOL_SECRET\` from Vercel (never commit it);
- keep the field names exactly as below; the endpoints and the system prompt depend on them.

Generated by \`pnpm vaani:export\` from the schemas the endpoints accept.

${curl}`,
);
console.log("Wrote docs/vaani/tools.json and docs/vaani/curl.md");
