# Changes to make in Vaani (updated 2026-10-10, Phase 4)

The user decided on 2026-10-10 that **the voice agent decides Green, Amber or Red itself from the
rubric**, that **Green and Amber are both booked into the "Aangan design call"** (the site visit is
no longer used), and that **Red is declined kindly with a fuller reason**. The backend stores the
agent's tier as given; Gemini only summarises after the call.

## 1. Re-paste the system prompt
Run `pnpm rubric:build && pnpm vaani:prompt` and paste `docs/vaani/system_prompt.txt` (gitignored,
it contains the internal pricing section) into the agent. The template is
`docs/vaani/system_prompt.template.txt`. New sections: "YOUR DECISION: GREEN, AMBER OR RED", the
budget judgement against the internal pricing (silent), the design-call booking flow for Green and
Amber, and the fuller Red decline.

## 2. Tool `submit_assessment`: add two parameters
- `tier` (string, enum green / amber / red): "Your decision from the rubric. Required for an
  enquiry; leave out for other call categories."
- `tier_reason` (string): "One line: why you chose this tier. Never read aloud."

## 3. Tools `check_consult_availability` and `book_consult`: remove `consult_type`
It is ignored now (only the design call is booked), so it can be deleted from both tools, and from
their required lists. Leaving it in does no harm.

Edit the fields by hand in each tool's edit dialog; do not use "Paste cURL" there (it would replace
the saved X-Tool-Secret header with the placeholder). The current definitions are in
`docs/vaani/tools.json` and `docs/vaani/curl.md`.

## Still true from Phase 3
- `call_id`: empty on the first submit_assessment, then the returned 6-character value in every
  later tool call. `call_mode` is always `{{call_mode}}`.
- Never read `agent_note`, `reasons` or `tier` aloud.
- Tool names: `submit_assessment`, `check_consult_availability` (endpoint
  `/api/vaani/tools/check_availability`), `book_consult`.
- Actions: `offer_booking` (Green and Amber), `decline` (Red), `callback`, `escalate`,
  `close_non_enquiry`.
