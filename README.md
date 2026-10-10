# Aangan voice agent

An inbound phone enquiry agent for Aangan Studio (interior design, Pune).

- **Vaani** answers every call within five minutes, day or night, discloses that it is an AI and that the call is recorded, and asks one question at a time.
- **The agent decides** Green, Amber or Red from the studio's rubric during the call and records the caller's answers with evidence.
- **Green and Amber leads are booked** into a Cal.com **design call** during the call. Red leads get a kind, specific decline. Amber and Red are labelled as such everywhere.
- After the call, **Gemini Flash** writes a summary, a handoff note and open questions, and checks the agent never said a price.
- Every call is stored in **Neon**, logged in **HubSpot** (contact, call record, and a deal for Green and Amber), and Green and Amber leads alert the designers on **Telegram**.
- A **dashboard** shows designers their queue and the founder the numbers and cost.

> Status: all eight phases are built. Telegram and HubSpot are built and tested with test doubles but wait for their credentials, and Vaani's in-call tools have not yet been proven inside Vaani (see `docs/SETUP_CHECKLIST.md`, "Before the first real call").

## This repository is public: what is deliberately not in it

These stay on the developer's machine (see `.gitignore`):

- **Nikhil's internal pricing guide** (`docs/source/pricing.md`) and the PRD (`docs/PRD.md`, `docs/PRD.pdf`), which quotes its figures.
- **`rubric.txt`**, because it includes the pricing section, and **`docs/vaani/system_prompt.txt`**, which embeds it.
- **The 40 September enquiries** (`enquiries/`): anonymised, but still the studio's data.
- Every `.env*` file except `.env.example`.

At runtime the pricing figures and the rubric reach the server only through the `PRICING_CONFIG_JSON` and `RUBRIC_TXT_B64` environment variables. `pnpm leak:scan` checks staged files for any figure from the pricing guide; run it before every commit. No pricing figure may appear in code, tests, comments, docs, alerts, HubSpot, the dashboard, logs or URLs.

## How it works

```
 Caller ──► Vaani agent ──(tools, HTTPS + X-Tool-Secret)──► /api/vaani/tools/*
              │                                                │ submit_assessment: stores the agent's tier
              │ reads slots, books                             │ check_availability, book_consult ──► Cal.com
              ▼                                                ▼
        call ends ──► Vaani webhook ──► /api/webhooks/vaani/call-ended?token=…
                                          │ store raw event first, idempotent, answer 200 fast
                                          ▼ (after())
                                  pipeline: save → enrich → booking → gemini → tier → leak_check → cost
                                            → telegram → hubspot_log → hubspot_deal
                                          │ each step recorded in pipeline_steps, retryable
                                          ▼
                       Neon (source of truth) ──► dashboard (designer view, founder view, CSV)
```

1. **During the call.** The agent collects facts, decides the tier from `rubric.txt`, and calls `submit_assessment` with its tier (`src/lib/tools/service.ts`). The backend stores the tier as given and returns an action: `offer_booking` (Green and Amber), `decline` (Red), `callback`, `escalate` or `close_non_enquiry`. For Green and Amber the agent calls `check_consult_availability` and `book_consult`, which reach Cal.com and book the **Aangan design call** only. Red and unrated calls cannot be booked. Vaani has no call-ID variable, so the first `submit_assessment` returns a short `call_ref` the agent passes back.
2. **After the call.** Vaani posts `call_started`, `user_picked_up_at`, `call_ended` and `call_postprocessing` to the webhook. The route checks the URL token in constant time (Vaani signs nothing), stores the raw event first, ignores a repeat of the same event, answers 200 and does the work in `after()`. The webhook row is merged into the row the tool calls created, matched by time window and phone; an ambiguous match is flagged for manual linking.
3. **The pipeline** (`src/lib/pipeline`). `save` fills derived fields; `enrich` reads Vaani call history (tolerating its current 500); `booking` settles a booking whose Cal.com create timed out; `gemini` writes the summary, handoff note and open questions (**Gemini never changes the tier**); `tier` sets the final status, marks dropped calls and links repeat callers; `leak_check` scans the agent's own words for prices; `cost` is duration × the Vaani rate plus Gemini token cost; `telegram` sends the alerts; `hubspot_log` and `hubspot_deal` log to HubSpot. Telegram runs before HubSpot so a HubSpot outage never delays an alert. A failed step does not stop the others and can be retried from the dashboard.
4. **Who gets what.** Green and Amber → designers' Telegram group, labelled with the tier. Existing-client callbacks, dropped calls with a number and unrated calls → designers. Complaints and price leaks → founder chat. Red, vendors, wrong numbers and every test call → no message. A redial edits the first alert so one lead has one alert. HubSpot gets every non-test call; Green and Amber get a deal automatically, Red only on Rescue.
5. **The dashboard** (`/dashboard`, `/dashboard/founder`). **No login by default** (user decision 2026-10-10): anyone with the web address sees callers' names, phone numbers and transcripts and can log a call-back, add notes or cancel leads. Set `DASHBOARD_LOGIN=on` in Vercel to bring back the two-role password login (`DASHBOARD_DESIGNER_PASSWORD`, `DASHBOARD_FOUNDER_PASSWORD`, `SESSION_SECRET` are then required). Every Green and Amber lead is active by default (there is no Approve). Designers work the queue: each lead row has a Call back button (a tel: link), and the lead page can log a call-back, add a Note, Rescue a Red lead, or Cancel the lead (a reason is required; stored as a discard, moves the HubSpot deal to Lost, never deletes data, and does not cancel the Cal.com booking). Rescue and Cancel are saved first and synced to HubSpot second. The founder sees every PRD metric (`docs/METRICS.md`), charts, a date range and a CSV.

## Rules that never bend

Never speak a price. Never ask about budget. Red leads are never deleted. Test calls never reach HubSpot or Telegram, and the sample enquiries are never stored as calls. Times are stored in UTC and shown in IST. Money is numeric INR. Every external call has a timeout, retries with backoff, and records failures in `pipeline_steps`.

> The decision to let the agent (not code or Gemini) decide the tier was made on 2026-10-10 and overrides the PRD where they differ. The deterministic rules engine in `src/lib/rules` remains for the budget-tight note, estimated value, priority, flags and wording, but no longer sets the tier. Because an LLM does the budget and timeline arithmetic with no second check, watch the Needs review tab and the daily digest in the first weeks.

## Stack

Next.js 16 (App Router, TypeScript strict) · Tailwind 4 · Drizzle ORM + Neon serverless driver (Postgres, Singapore) · zod · Vitest (+ PGlite for the dashboard queries) · Recharts · pnpm · Vercel (`sin1`).

## Local setup

```bash
pnpm install
cp .env.example .env.local   # fill in values; DATABASE_URL is the only one required to start
pnpm db:migrate              # applies drizzle/ migrations to the database in .env.local
pnpm db:seed                 # loads ~45 fictional demo- calls (not is_test; idempotent)
pnpm demo:purge              # removes every demo- call (add --hubspot to archive their HubSpot objects too)
pnpm demo:hubspot            # dry run: lists what a HubSpot demo load would create (add --yes to do it)
pnpm dev                     # http://localhost:3000
```

Every variable, where to get it and where it goes is in `docs/SETUP_CHECKLIST.md`.

## Commands

| Command | What it does |
|---|---|
| `pnpm check` | Type check and all tests |
| `pnpm lint` | ESLint |
| `pnpm leak:scan` | Fails if a staged file holds a pricing figure or a database password marker (run `git add -A` first) |
| `pnpm db:generate` / `pnpm db:migrate` | New migration from `src/db/schema.ts` / apply it (`ENV_FILE=.env.main-branch.local pnpm db:migrate` for production) |
| `pnpm db:seed` / `pnpm demo:purge` | Load / remove ~45 fictional demo calls (`demo-` IDs); the transcripts, summaries and criteria are hand-written in `src/lib/demo/content-*.ts` |
| `pnpm demo:hubspot [--yes] [--limit=45]` | Log the demo calls to HubSpot (dry run unless `--yes`; max 50 contacts; skips calls that already have HubSpot IDs). See `docs/HUBSPOT_SETUP.md` |
| `pnpm rubric:build` / `rubric:check` | Build `rubric.txt` from `docs/source/` and the examples |
| `pnpm rubric:env` | Write `rubric.txt` base64-encoded into `RUBRIC_TXT_B64` (copy it to Vercel) |
| `pnpm pricing:config` | Write `PRICING_CONFIG_JSON` from the local pricing guide |
| `pnpm vaani:prompt` / `vaani:export` | Build the Vaani system prompt; regenerate the tool definitions and cURLs in `docs/vaani/` |
| `pnpm eval` | Replay the 40 enquiries through Gemini extraction and the rules engine (`--source=fixtures` skips Gemini) |
| `pnpm eval:agent [--runs=3]` | Replay them through Gemini playing the agent with the real system prompt: acceptance test 23 |
| `pnpm e2e:webhook` | Post a test call's events through the real routes and print the result (`--base=`, `--env-file=`, `--mode=a\|b`, `--tier=`, `--real`) |
| `pnpm hubspot:setup` | Create the HubSpot properties, map the pipeline stages, print the env lines (`--write`, `--full`) |
| `pnpm telegram:chats` | List chats the bot has seen; `--send-test` posts a test message |
| `pnpm secrets:rotate` / `secrets:copy NAME` | New random secrets into an env file; copy one to the clipboard, never printing it |
| `pnpm mock:cal` | A local Cal.com stand-in for the tool endpoints |

## Runbook

**A call produced no alert or no row.** Open `/api/health` (database, which integrations have keys). In the dashboard, find the call (All tab, show test calls) and check its `pipeline_steps` rows in the database (the call page no longer lists them); a failed step has its last error there and can be re-run with `POST /api/pipeline/retry`. No row at all means the webhook never arrived: check Vaani's webhook URL and token, and Vercel's function logs for `/api/webhooks/vaani/call-ended` (a 401 means the token differs from `VAANI_WEBHOOK_SECRET`).

**The agent did not book / said "a designer will call you back".** Look at the call's tool log: the `tool_calls` table holds every request and response, including rejected ones (a 401 with the secret length, which means a wrong `X-Tool-Secret` in Vaani). `book_consult` refuses Red and unrated calls on purpose.

**A pending booking.** If Cal.com timed out, the booking stays `pending` and the daily job (or a retry of the booking step through `/api/pipeline/retry`) looks it up at Cal.com and marks it accepted or failed.

**HubSpot or Telegram down.** Calls still land in Neon and on the dashboard. Retry the failed steps through `/api/pipeline/retry` once the service is back; retries never duplicate (HubSpot IDs and sent-alert markers are stored). A designer's Rescue or Cancel is saved even if HubSpot fails; the failed `hubspot_review` step is recorded in `pipeline_steps`, but the call page no longer has a Retry button and `/api/pipeline/retry` does not know that step, so fix HubSpot by hand or ask for a retry path to be added.

**Gemini down or over budget.** Alerts still go out with an excerpt of what the caller said; the summary fills in when the Gemini step is retried through `/api/pipeline/retry`. Update `GEMINI_PRICE_IN/OUT_PER_MTOK_INR` when Google's prices change (the current model's price steps up on 1 Jan 2027).

**Changing the prompt or the rubric.** Edit `docs/vaani/system_prompt.template.txt` or the files in `docs/source/`, run `pnpm rubric:build && pnpm vaani:prompt`, run `pnpm eval:agent --runs=3`, paste the new prompt into Vaani, and update `RUBRIC_TXT_B64` (`pnpm rubric:env`, then Vercel) so Gemini reads the same rubric.

**Retention.** The daily job clears transcripts and recording links older than `RETENTION_DAYS` (default 90). The call, summary, tier and costs stay.

## Extending to WhatsApp and the web form

Everything from the Gemini step onward is channel-agnostic: it works from a `calls` row with a transcript (or the text of a thread or form) and the agent's or Gemini's reading of the criteria.

1. Add an inbound route per channel (for example `/api/webhooks/whatsapp`, `/api/webhooks/form`) that verifies its own secret, stores the raw payload first and answers fast.
2. Create the `calls` row yourself: `status in_call` → `processing`, `from_number` (normalised with `normalisePhone`), `transcript` set to the thread or form text with `USER:` lines, and a `call_ref`. There is no voice agent to decide, so set `call_category` and `tier` from a Gemini extraction (`src/lib/gemini/extraction.ts` plus `assess()` in `src/lib/rules`, as `pnpm eval` does) or leave the tier null so a designer decides ("unrated").
3. Run the pipeline from the `gemini` step: `runPipeline(callId, deps, { from: "gemini" })`. Telegram, HubSpot, the dashboard and the metrics need no change.
4. Add the channel to `calls` (a `channel` column) if the founder wants metrics split by it, and mark the HubSpot call record differently (it is `INBOUND` phone today).

The scope in the PRD is inbound phone only; WhatsApp and the form were out of scope.

## Layout

- `src/env.ts`: zod validation of every environment variable.
- `src/db/schema.ts`: `calls`, `bookings`, `tool_calls`, `pipeline_steps`, `review_actions`.
- `src/lib/rules`: the rules engine (criteria, budget check, flags, estimate, priority, IST wording, price-leak check, repeat linking, final-status mapping). Thresholds in `config.ts`.
- `src/lib/tools` and `src/app/api/vaani/tools`: the three Vaani tools.
- `src/lib/vaani`, `src/app/api/webhooks/vaani`, `src/lib/pipeline`: the webhook adapter, history client, ingest, steps, runner, daily job.
- `src/lib/gemini`, `src/lib/telegram`, `src/lib/hubspot`, `src/lib/cal`: the four integrations.
- `src/lib/dashboard`, `src/lib/auth`, `src/app/dashboard`, `src/app/login`, `src/proxy.ts`: queries, metrics, review actions, login and the pages.
- `docs/`: `SETUP_CHECKLIST.md`, `ACCEPTANCE.md`, `METRICS.md`, `HUBSPOT_SETUP.md`, `TELEGRAM_SETUP.md`, `PLATFORM_NOTES.md` (what each platform's docs confirm and what is still UNVERIFIED), `HANDOVER.md`, and `vaani/` (prompt template, tool definitions).
