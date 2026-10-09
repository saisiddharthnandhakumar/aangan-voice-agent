# Aangan voice agent

An inbound phone enquiry agent for Aangan Studio (interior design, Pune).

- Vaani answers every call within five minutes, day or night.
- Backend rules qualify each caller as Green, Amber or Red.
- Green leads are booked into Cal.com during the call.
- After each call, Gemini Flash summarises it.
- Every call is stored in Neon and logged in HubSpot, and designers get Telegram alerts.
- A dashboard shows designers and the founder what came in and what it cost.

> Status: **Phase 3 of 8**: Vaani tool endpoints. The full README (architecture, runbook, extending to WhatsApp and the web form) lands in Phase 7.

## This repository is public: what is deliberately not in it

The following stay on the developer's machine (see `.gitignore`):

- **Nikhil's internal pricing guide** (`docs/source/pricing.md`), and the PRD (`docs/PRD.md`, `docs/PRD.pdf`), which quotes its figures.
- **`rubric.txt`**, because it includes the pricing section.
- **The 40 September enquiries** (`enquiries/`), which are anonymised but are still the studio's data.

At runtime the pricing figures come from the `PRICING_CONFIG_JSON` environment variable, never from the code.

## Stack

Next.js 16 (App Router, TypeScript strict) · Tailwind · Drizzle ORM + Neon serverless driver (Postgres, Singapore) · zod · Vitest · Recharts · pnpm · Vercel (`sin1`).

## Local setup

```bash
pnpm install
cp .env.example .env.local   # then fill in values; DATABASE_URL is the only required one
pnpm db:migrate              # applies drizzle/ migrations to the database in .env.local
pnpm db:seed                 # inserts six invented calls flagged is_test (safe to repeat)
pnpm dev                     # http://localhost:3000/api/health
```

| Command | What it does |
|---|---|
| `pnpm check` | Type check and unit tests |
| `pnpm db:generate` | New migration from `src/db/schema.ts` |
| `ENV_FILE=.env.main-branch.local pnpm db:migrate` | Migrate the production (main) Neon branch |
| `pnpm db:seed --reset` | Remove and re-insert the seed calls |
| `pnpm pricing:config` | Read the local `pricing.md` and write `PRICING_CONFIG_JSON` into `.env.local` |
| `pnpm rubric:build` / `rubric:check` | Build `rubric.txt` (gitignored) from `docs/source/` and the examples |
| `pnpm vaani:export` | Regenerate `docs/vaani/tools.json` and `docs/vaani/curl.md` from the endpoint schemas |
| `pnpm mock:cal` + `scripts/curl/*.sh` | Local Cal.com stand-in and curl walkthroughs of the three tools (`CAL_API_BASE_URL=http://localhost:4010 pnpm dev`) |
| `pnpm eval` | Replay the 40 local enquiries through extraction and the rules; prints a confusion matrix. `--source=fixtures` skips Gemini |

## Layout

- `src/env.ts`: zod validation of every environment variable, checked at server start (`src/instrumentation.ts`).
- `src/db/schema.ts`: the five tables from PRD section 5: `calls`, `bookings`, `tool_calls`, `pipeline_steps`, `review_actions`.
- `src/app/api/health`: database check and an integration-configured report (booleans only).
- `src/lib/rules`: the qualification rules (PRD section 3): criteria, budget check, flags, tier, estimate, priority, IST callback wording, price-leak check, repeat-caller linking. Thresholds live in `config.ts`; pricing figures come only from `PRICING_CONFIG_JSON`.
- `src/app/api/vaani/tools/*`: the three Vaani tools (T1–T3). Logic in `src/lib/tools/service.ts`; secret check, rate limit, 2.3 s deadline and `tool_calls` logging in `src/lib/tools/http.ts`; Cal.com client in `src/lib/cal/client.ts`.
- `docs/vaani/`: tool definitions, one cURL per tool for Vaani's form, and the prompt changes the tools need.
- `src/lib/gemini`: Gemini Flash client (strict JSON, timeouts, retries, token cost) and the criteria-extraction schema.
- `docs/PLATFORM_NOTES.md`: what each external platform's docs confirm, and what is still UNVERIFIED.
