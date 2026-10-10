# Aangan voice agent: handover for the next session

Written 2026-10-10 at the end of Phase 3; updated at the end of Phase 4 (see §4 and the 2026-10-10 decision at the top of §5). Read this first, then `docs/PRD.md` (local only, gitignored) and `docs/PLATFORM_NOTES.md`.

## 0. Paste this into the new chat to start

> You are the lead engineer continuing the Aangan Studio voice enquiry system in this folder. Read `docs/HANDOVER.md` completely, then `docs/PRD.md` (the source of truth), `docs/PLATFORM_NOTES.md` and `README.md`. Phases 0–3 are done. Continue with **Phase 4 (webhook and pipeline)** exactly as described in HANDOVER section 6, then Phases 5–8. Follow the working rules in HANDOVER section 2. At the end of each phase: run the type check, tests and lint, commit, push, report in the Stage 6 format (Built / Tests / You do by hand / UNVERIFIED / Next), then stop until I say continue.

## 1. What this is

An inbound phone enquiry agent for Aangan Studio, an interior design studio in Pune.
- **Vaani** (app.vaanivoice.ai) answers calls.
- Our backend qualifies callers as **Green, Amber or Red** with rules in code, and books Green leads into **Cal.com**.
- After the call it runs **Gemini Flash**, stores the call in **Neon**, logs it in **HubSpot**, alerts on **Telegram**, and serves a designer/founder **dashboard**.
- Stack: Next.js 16 (App Router, TypeScript strict), Tailwind, Drizzle + Neon serverless (HTTP), zod, Vitest, Recharts, pnpm 9, Vercel.

## 2. Working rules (from the user; never break)

- **The PRD in this folder is the only source of truth** (`docs/PRD.md`, transcribed from `docs/PRD.pdf`). Ignore the 50-page "build pack v2" PDF in ~/Downloads.
- **Phase discipline.** At the end of each phase: type check, tests, lint, commit, push, report in the Stage 6 format, then **stop until the user says continue**. Ask rather than assume on open decisions.
- **The GitHub repo is PUBLIC.** No pricing figure from pricing.md (e.g. per-sq-ft rates, room ranges) may appear in committed code, tests, comments or docs.
  - Gitignored: `docs/source/pricing.md`, `docs/PRD.md`, `docs/PRD.pdf`, `rubric.txt`, `enquiries/*` (except README), `docs/vaani/system_prompt.txt`, `.env*` (except `.env.example`).
  - Pricing reaches runtime only via `PRICING_CONFIG_JSON`.
  - Before each commit, run `pnpm leak:scan` (section 8).
- **Never print, log or commit secrets or connection strings.** Show env var names only. Never type secrets or passwords into websites: ask the user to paste them.
- Never invent API fields. Mark anything unconfirmed **UNVERIFIED** in code comments and reports.
- Every external call: a timeout, retries with backoff, and failures recorded in `pipeline_steps`.
- Product rules:
  - Never speak a price.
  - Never ask about budget.
  - Tier logic only in `src/lib/rules`.
  - `book_consult` refuses non-Green.
  - Every non-test call goes to HubSpot (deals only for Green, Approve and Rescue).
  - Red leads are never deleted.
  - Agent/Gemini disagreement → Amber.
  - No pricing in alerts, HubSpot, UI, logs or URLs.
  - `is_test` calls never reach HubSpot or Telegram.
  - Sample enquiries are never stored as calls.
  - Times are stored in UTC and shown in IST. Money is numeric INR.
- Git: the repo-local identity is already set (`user.name "Saisiddharth Nandhakumar"`). End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## 3. Accounts, IDs and where things live (no secrets here)

| Thing | Value |
|---|---|
| GitHub | https://github.com/saisiddharthnandhakumar/aangan-voice-agent (public, branch `main`). `gh` CLI is logged in |
| Vercel prod | https://aangan-voice-agent-inky.vercel.app. **`aangan-voice-agent.vercel.app` belongs to someone else.** Deploys on push to main. Region `sin1` (vercel.json). Deployment URLs are behind Vercel Auth; the prod domain is public |
| Neon | project `snowy-shape-28009767` (aws-ap-southeast-1), database `aangan`. Branches: `main` = `br-empty-math-b3zgfmqp` (prod), `dev` = `br-mute-bird-b3d3mjfw` (local). Use the Neon MCP `run_sql` with these ids |
| Env files (local, gitignored) | `.env.local` → dev branch plus all keys. `.env.main-branch.local` → prod values the user pasted into Vercel |
| Keys present | DATABASE_URL(_UNPOOLED), SESSION_SECRET, CRON_SECRET, VAANI_TOOL_SECRET, VAANI_WEBHOOK_SECRET, DASHBOARD_*_PASSWORD, PRICING_CONFIG_JSON, VAANI_COST_PER_MIN_INR=5.6, GEMINI_API_KEY, CAL_API_KEY, CAL_EVENT_TYPE_ID_SITE_VISIT, CAL_EVENT_TYPE_ID_CALL, VAANI_API_KEY |
| Keys missing | HUBSPOT_ACCESS_TOKEN, HUBSPOT_PORTAL_ID (private app must be created **before 2026-10-26**), TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_ESCALATION_CHAT_ID, GEMINI_PRICE_IN/OUT_PER_MTOK_INR, PLACEHOLDER_EMAIL_DOMAIN (defaults to example.com), STUDIO_PHONE_NUMBER |
| Vaani agent | "Vaani Voice Agent", id `07144cab-f8c8-4a44-b69f-fd6880d4b0e8`. Model `gemini-3.5-flash`, language English, 10-minute max call, greeting set |
| Vaani tools (Tools & Actions, enabled on the agent) | `submit_assessment` → /api/vaani/tools/submit_assessment; `check_consult_availability` → /api/vaani/tools/check_availability (Vaani rejected the name `check_availability` as "already exists"); `book_consult` → /api/vaani/tools/book_consult. Header `X-Tool-Secret` holds the prod secret (64 chars). Timeout 8000 ms. submit_assessment uses **flat** criteria fields and text flags |
| Vaani system prompt | Generated by `pnpm vaani:prompt` into `docs/vaani/system_prompt.txt` (gitignored) from `docs/vaani/system_prompt.template.txt` plus rubric.txt; pasted into the agent (20,624 chars) |
| Cal.com | Event types "Aangan site visit" (60 min, Cal Video + attendeeAddress, 240 min notice) and "Aangan design call" (20 min, Google Meet). Both require name and email |

## 4. Status by phase

- **Phase 0, done:** `docs/PLATFORM_NOTES.md` covers every platform, with sources and UNVERIFIED marks. Vaani findings are in §1.11.
- **Phase 1, done:**
  - Repo, Neon project with 5 tables (+ migration `0001` adding `calls.call_ref`), env validation (`src/env.ts`), `/api/health`, seed script (`pnpm db:seed`), `vercel.json`.
  - Vercel is live and healthy: database ok, cal/gemini/vaani/pricing configured.
- **Phase 2, done:**
  - `scripts/build-rubric.ts` (`pnpm rubric:build`/`rubric:check`), `pnpm pricing:config`, and `src/lib/rules/*`: criteria, budget floor, flags, tier, reconcile, canBook, estimate, priority, IST wording, price-leak, repeat linking.
  - `src/lib/gemini/{client,extraction}.ts`; `pnpm eval`.
  - Eval with Gemini: **95% (38/40), no Green→Red**. Fixtures eval: 92.5%. Remaining misses are label questions (T11, T13, W03: no timeline stated → Amber).
- **Phase 3, done in code, blocked inside Vaani:**
  - Three tool routes with secret check (rejected attempts are logged too), rate limit, 2.3 s deadline with speakable fallback, logging to `tool_calls`, and a Cal.com client (`src/lib/cal/client.ts`).
  - Speakable IST slots (`src/lib/tools/speak.ts`), booking idempotency, a mock Cal.com (`pnpm mock:cal`), curl scripts (`scripts/curl/`).
  - `docs/vaani/{tools.json,curl.md,prompt-changes.md}` via `pnpm vaani:export`.
  - Verified locally against the dev DB and against the real Cal.com (slots only; no real booking made yet).
  - **234 tests pass.**
- **Blocker found at the end of Phase 3:**
  - In Vaani's **chat** test, every custom tool call fails with "I am sorry, I encountered an error" and **no request reaches our server**. Nothing appears in `tool_calls`, including the logged rejected-request path.
  - Tried: flattening criteria, text flags, "never send null", removing the empty query row, switching to `gemini-2.5-flash` (worse, so reverted).
  - Next steps: ask Vaani support; get one **voice** test (Start Test → Audio) from the user. Phase 4 must therefore work without in-call tools (see §6, Mode B fallback).
- **Vaani call-history API:** the key works (no 401), but `GET /api/call-history` returns **500 "Invalid client_id format"**, which is a Vaani-side bug. Enrichment must tolerate this.
- **Secret exposure:** the prod `VAANI_TOOL_SECRET` value appeared in a tool output once. The user was told to rotate it at go-live (env files, Vercel, the 3 Vaani tools).

- **Phase 4, done (2026-10-10):**
  - Tool contract changed to the 2026-10-10 decision (below): `submit_assessment` takes the agent's `tier` and `tier_reason`; `canBook` = Green or Amber; only the design-call event type; prompt template rewritten.
  - Webhook `POST /api/webhooks/vaani/call-ended?token=` (atomic per-event-type idempotency in `calls.raw_webhook`), adapter `src/lib/vaani/events.ts`, merge with the tool row (`src/lib/pipeline/correlate.ts`), steps `save, enrich, booking, gemini, tier, leak_check, cost, hubspot_log, hubspot_deal, telegram` (last three skipped until Phase 5), `POST /api/pipeline/retry` (CRON_SECRET bearer), `pnpm e2e:webhook`, `pnpm rubric:env`.
  - Verified locally against the dev branch with the real Gemini: Mode A (merged, agent tier kept, duplicate ignored) and Mode B (unclassified). 283 tests.
  - Vaani history `call_cost` is in **credits**, so Vaani cost = duration × rate. Cal.com list-bookings needs version `2026-05-01`.

- **Phase 5, done in code (2026-10-10), waiting for credentials:**
  - Telegram: client, alert builder and routing, `telegram` pipeline step, daily digest cron. Designers' group gets Green, Amber, existing-client callbacks, dropped calls with a number, unrated calls; founder chat gets complaints and price leaks; Red and test calls get nothing; a redial edits the first alert.
  - HubSpot: client, contact upsert by phone (own DB first, then HubSpot search), call record for every non-test call, deals for Green and Amber automatically, Red only on Rescue, `syncReviewDecision` for the dashboard (Phase 6), `pnpm hubspot:setup`, `docs/HUBSPOT_SETUP.md`, `docs/TELEGRAM_SETUP.md`.
  - Step order is now `save, enrich, booking, gemini, tier, leak_check, cost, telegram, hubspot_log, hubspot_deal` (Telegram before HubSpot so an outage never delays an alert).
  - Nothing has run against real Telegram or HubSpot yet: UNVERIFIED are the phone search property names, the v4 default-association path, the deal `description` property, and the exact HubSpot UI wording in the view instructions.
  - 376 tests.

## 5. Key design decisions already made (don't re-ask)

- **2026-10-10, overrides the PRD (user decision at the start of Phase 4):**
  - The Vaani agent decides Green/Amber/Red itself from rubric.txt in the call; the backend stores it as given. No rules-engine tier, no Gemini tier, no `tier_conflict`. The user was told an LLM's budget/timeline arithmetic goes unchecked and accepted it.
  - Green **and Amber** are offered slots and booked; only the "Aangan design call" event type is used, never the site visit. `book_consult` refuses only Red/untiered.
  - Amber differs from Green only by its label (dashboards, HubSpot deal, Telegram). Red: kind, fuller decline in the call; still stored with summary and transcript, in HubSpot (contact + call; deal only on Rescue) and on the dashboard; no Telegram.
  - Gemini writes summary, handoff note, open questions and a price-leak verdict only. A call no tool call reached is `awaiting_designer` with flag `unclassified`.
  - Rubric at runtime: `RUBRIC_TXT_B64`.

- **Rules defaults approved by the user** ("go with what you feel is best"):
  - Budget: under 70% of floor fails; 70–100% passes with budget_tight. BHK carpet areas 550/900/1,150/2,000.
  - Timeline: under 6 weeks fails; 6–10 weeks unclear (Amber); measured from the call date in IST; a month alone means the 1st.
  - 1BHK full home, commercial under 500 sq ft, and an unauthorised decision maker are all Amber.
  - Mon–Sat 10:00–19:00 IST; Amber callback says "within the hour", otherwise "tomorrow morning" or "on Monday morning".
  - Retail, hospitality and gym fail criterion 1 in code.
  - Widened Pune/PCMC locality list plus 411xxx pincodes; unknown names flag `unlisted_locality`.
  - Budget numbers under 1,000 are read as lakh.
  - Example 9 is reworded (T14 → callback, not a booking).
- **Tool contract additions:**
  - `call_mode` on every tool.
  - `timeline_move_asked` (bool) plus action **`ask_date_move`**.
  - Flag `frustrated_repeat` (priority only).
  - Flat `*_status`/`*_evidence` fields.
  - `call_id` = our 6-char `call_ref` returned by the first submit_assessment (Vaani has no call-ID variable). The first submit sends `""`.
  - Replies may include `agent_note` (never read aloud).
- **is_test:** `call_mode` matching web/rtc/chat/test, or `VAANI_TEST_AGENT_IDS`. The user tests via WebRTC/chat.
- **HubSpot is the Free CRM:**
  - 10 custom properties in total, so use the PRD's 8-property fallback.
  - No custom pipeline, so `hubspot:setup` must detect this and fall back to the default pipeline.
  - 1,000-contact cap.
  - v3 endpoints (semantic versions end Sept 2027).
- **Telegram:** a dropped call followed by a redial edits the first alert (editMessageText) into the lead alert, so there is one alert (AT15). Store `telegram_chat_id` and `telegram_message_id`.
- **Phone:** the studio office number gets linked later. Missed calls that never reach Vaani are invisible (the founder metric is labelled accordingly).
- **Booking without email:** placeholder `<call_ref>@PLACEHOLDER_EMAIL_DOMAIN`. Site visit location = attendeeAddress(site_area); call = no location (Meet). A Cal.com create is never retried after a timeout; the booking is left `pending` for reconciliation.

## 6. Phase 4 spec (DONE; kept for reference, tiering superseded by §5's 2026-10-10 decision)

Vaani webhook facts (`docs/PLATFORM_NOTES.md` §1.4):
- Set **per org** in Settings → Webhooks. It's a URL only, with **no signature**.
- Events:
  - `call_started` {room_name, status, phone_number?}
  - `user_picked_up_at`
  - `call_ended` {room_name, call_duration **seconds**, end_reason}
  - `call_postprocessing` {call_id, timestamp, data{room_name, call_id, call_duration **ms**, end_reason, summary, entities, dispositions, recording_url, transcript "[hh:mm:ss] AGENT: …\n\nUSER: …"}}
- No cost or numbers in the payloads. Treat every payload shape as UNVERIFIED: put all parsing in one adapter file and accept unknown fields.

Build:
1. **Route** `POST /api/webhooks/vaani/call-ended?token=<VAANI_WEBHOOK_SECRET>`. Compare the token in constant time (also accept an `x-webhook-token` header).
   - Store the raw event first: append to `calls.raw_webhook` as `{events:[...]}`, upserting the row on `vaani_call_id = room_name/call_id`.
   - Idempotent per (vaani_call_id, event type).
   - Return 200 within 2 s, then `after()` for processing.
2. **Event handling:**
   - `call_started` → `status in_call`, `started_at`.
   - `user_picked_up_at` → `answered_at`.
   - `call_ended` → `ended_at`, `duration_seconds`, `end_reason`.
   - `call_postprocessing` → `transcript`, `recording_url`, then run the pipeline.
3. **Correlate tool rows** (created by submit_assessment with `call_ref`, `vaani_call_id` null): adopt the single `in_call` row created between started_at−2 min and ended_at+2 min (matching phone when known), merge it into one row, and keep `call_ref`, tool_calls and bookings. If ambiguous, don't merge; flag it for manual linking.
4. **Pipeline steps** (each upserts `pipeline_steps` (call_id, step) with status, attempts and last_error, using `withRetry` from `src/lib/http/retry.ts`): `save`, `enrich`, `gemini`, `tier`, `leak_check`, `cost`, then `hubspot_log`, `hubspot_deal`, `telegram`. The last three are recorded as `skipped` (missing_config) until Phase 5.
   - **enrich:** call history for from/to numbers, pickup time, agent_id and cost. It tolerates the current Vaani 500 and falls back to the phone stated in tools.
   - **gemini:** one call with rubric.txt plus the transcript.
     - Strict JSON: summary (≤600 chars), handoff_note, open_questions[], the same extraction fields as `src/lib/gemini/extraction.ts`, and price_leak {leaked, evidence}.
     - Record tokens in and out (out includes thinking).
     - Failure is not fatal: alerts later use a transcript excerpt (P3).
     - **Rubric at runtime:** rubric.txt isn't deployed (gitignored). Use a `RUBRIC_PRICING_MD` env var or build the rubric from the committed parts plus a pricing section rendered from `PRICING_CONFIG_JSON`. Ask the user which; the recommended choice is a base64 env var `RUBRIC_TXT_B64` written by a script.
   - **tier:** agent tier = the stored tier from submit_assessment, if any. Gemini tier = `assess()` on Gemini's extraction. Use `reconcileTiers` (disagreement → Amber plus the `tier_conflict` flag).
     - **Mode B:** if no tool assessment exists, the Gemini tier is used alone (no conflict) and the lead is marked "booking by designer".
     - Final status: Green+booking → `booked`; Green without booking or Amber → `awaiting_designer`; Red → `unqualified_verified`; complaint → `escalated`; other categories → `non_enquiry`.
   - **leak_check:** `detectPriceLeak(agentTurns(transcript), pricing)` OR Gemini's verdict → set `price_leak`. The founder alert comes in Phase 5.
   - **dropped:** ended with no assessment and no Gemini enquiry content (or under ~20 s) → `status dropped`, `end_reason dropped`; a callback alert comes in Phase 5 if a number exists.
   - **repeat:** `findRepeatOf` over calls from the same number in 24 h → `repeat_of_call_id`.
   - **cost:** vaani_cost from history, else duration × `VAANI_COST_PER_MIN_INR`; gemini_cost via `geminiCostInr`; total.
5. **Retry endpoint** `POST /api/pipeline/retry {call_id, step}`: `CRON_SECRET` bearer for now; the dashboard session in Phase 6.
6. **Booking reconcile:** pending bookings older than 2 min → look up Cal.com bookings by the placeholder or attendee email (UNVERIFIED endpoint: check the docs first) → accepted or failed.
7. **Tests:** event parsing for both duration units, idempotency, merge logic, Mode B tiering, conflict, leak, dropped, repeat, cost, and step retry. Plus `scripts/e2e-webhook.ts`, which posts a realistic event sequence (marked test) to local or prod.
8. **Then give the user the webhook setup steps:** Vaani Settings → Webhooks → URL `https://aangan-voice-agent-inky.vercel.app/api/webhooks/vaani/call-ended?token=<VAANI_WEBHOOK_SECRET from .env.main-branch.local>`, all events.

## 7. Phases 5–8 (from the user's original brief)

- **Phase 5, Telegram and HubSpot:**
  - Alerts and routing: Green, Amber and existing_client go to the designers group within 2 min; escalations and price leaks go to the founder chat.
  - Each alert carries: summary ≤600 chars, tier and priority, name, phone, project, locality, size, timeline, consult slot, lead source, budget_tight/uncertainty, and a dashboard button. HTML-escaped, with 3 retries.
  - The daily 09:00 IST digest as a Vercel cron (once a day on Hobby).
  - `pnpm hubspot:setup` (idempotent, prints IDs, Free-plan fallbacks).
  - Contact upsert by phone (+91, search by the 10-digit number), a call record for every non-test call, deal rules, status sync on designer actions, idempotency via stored HubSpot IDs.
  - Click-by-click steps for the 3 HubSpot views.
  - API details are in PLATFORM_NOTES §3 and §4.
- **Phase 6, dashboard:**
  - Two-role password login.
  - Designer view: tabs Needs review, Booked, Unqualified but verified, Escalations, Dropped calls, Non-enquiries, All; filters; high priority first.
  - Call detail: summary, criteria with evidence, flags, transcript, booking, HubSpot link, pipeline steps with retry, Approve/Rescue/Discard (reason required)/Note.
  - Founder view: every metric in PRD §4, charts (calls per day, tier mix, cost per day), date range, CSV export. Mobile-friendly. Every number comes from a checkable query, and the queries are tested.
  - **Never show the budget floor or any pricing figure.**
- **Phase 7, hardening:**
  - E2E script; automated tests or a checklist for all 23 acceptance tests.
  - README (architecture, setup, runbook, extending to WhatsApp and the web form).
  - CLAUDE.md.
- **Phase 8, go-live:**
  - `docs/SETUP_CHECKLIST.md`: every variable, the Vaani tool and webhook entries, the Cal.com event types, the Telegram chats, the HubSpot views.
  - Secret rotation; link the office number (Vaani Telephony → SIP or provisioned number).

## 8. Commands

```bash
pnpm check                    # typecheck (next typegen && tsc) + vitest
pnpm lint
pnpm db:generate && pnpm db:migrate                       # dev branch
ENV_FILE=.env.main-branch.local pnpm db:migrate           # prod branch
pnpm rubric:build && pnpm pricing:config && pnpm vaani:export && pnpm vaani:prompt
pnpm eval [--source=fixtures|gemini] [--only=T01,T02]
pnpm mock:cal & CAL_API_BASE_URL=http://localhost:4010 pnpm dev ; bash scripts/curl/green-booking.sh
```

**Pre-commit leak scan:** reads the figures from the local pricing.md at run time, so no figure is ever written in the repo. Review any hit; a timeout constant can match.

```bash
git add -A && pnpm leak:scan
```

**Wait for a Vercel deploy after a push:**

```bash
SHA=$(git rev-parse HEAD); gh api "repos/saisiddharthnandhakumar/aangan-voice-agent/deployments?sha=$SHA" --jq '.[0].id'
# then poll: gh api repos/saisiddharthnandhakumar/aangan-voice-agent/deployments/<id>/statuses --jq '.[0].state'
```

## 9. Code map

- `src/env.ts`: zod env schema. `APP_BASE_URL` defaults from `VERCEL_PROJECT_PRODUCTION_URL`.
- `src/db/schema.ts`: tables calls (incl. `call_ref`, `vaani_agent_id`, `answered_at`, `telegram_chat_id`, `telegram_message_id`), bookings, tool_calls, pipeline_steps, review_actions.
- `src/lib/rules/`:
  - `config.ts` (thresholds, localities, wording)
  - `pricing.ts` (PRICING_CONFIG_JSON schema and parser)
  - `types.ts` (assessment input: lenient, flat or nested)
  - `criteria.ts`, `assess.ts` (computeTier, reconcileTiers, canBook, estimate, priority)
  - `time.ts` (IST), `price-leak.ts`, `repeat.ts`
- `src/lib/gemini/`: `client.ts` (generateJson, cost), `extraction.ts` (schema and prompt).
- `src/lib/tools/`: `service.ts` (T1–T3 logic), `http.ts` (route wrapper), `repo.ts` (Drizzle repo interface), `speak.ts`.
- `src/lib/cal/client.ts`, `src/lib/http/retry.ts`, `src/lib/phone.ts`, `src/lib/eval.ts`.
- `tests/`: unit tests incl. `rules/acceptance.test.ts` (AT 2–8, 12–17 at rules level) and `tools/*` (in-memory repo plus mocked Cal.com in `tests/tools/fakes.ts`).

## 10. Gotchas learned

- **Next 16:** `LayoutProps` is generated, so typecheck runs `next typegen` first. `cacheComponents` is turned off on purpose. Read `node_modules/next/dist/docs/` before using new APIs (AGENTS.md).
- **`pbcopy` needs `LANG=en_US.UTF-8`**, otherwise ₹ and — get garbled when pasting into the browser.
- **Vaani dashboard UI (Chrome):**
  - The text `find` tool sometimes returns refs for the wrong row; verify field values with JS before saving.
  - The description field has a **hidden mirror textarea**: set the visible one (placeholder "Enter the description…").
  - MUI selects: focus, then ArrowDown, then click the option ref.
  - The prompt textarea sits inside the collapsed "Identity" section.
  - Cmd+S saves the agent.
- **Vaani "Paste cURL" in the edit dialog would overwrite the saved secret header with the placeholder.** Edit fields by hand instead.
- The user's browser pane isn't logged in to anything; the user's Chrome is logged in to Vaani (not Vercel).
- Gemini SDK (`@google/genai` 2.28): `responseMimeType` + `responseJsonSchema`, `thinkingConfig.thinkingLevel: LOW`, `httpOptions.retryOptions {attempts:1}` (our own retries).
