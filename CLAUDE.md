# Aangan voice agent: working notes for Claude

Read `AGENTS.md` first (Next.js 16 differs from older versions: read `node_modules/next/dist/docs/` before using an API), then `docs/HANDOVER.md` (status, IDs, decisions), `README.md` (architecture and runbook) and `docs/PLATFORM_NOTES.md` (what the platforms' docs confirm).

## What this is
Inbound phone enquiry agent for Aangan Studio (Pune interior design). Vaani answers; **the agent decides Green, Amber or Red from rubric.txt**; Green and Amber book the Cal.com **design call**; Red is declined kindly; Gemini only summarises; Neon stores; HubSpot logs; Telegram alerts; a dashboard shows it. Decision of 2026-10-10 overrides the PRD where they differ (see `docs/HANDOVER.md` section 5).

## Rules that never bend
- The GitHub repo is **public**. No pricing figure from `docs/source/pricing.md` in code, tests, comments, docs, alerts, HubSpot, the dashboard, logs or URLs. Pricing and the rubric reach the server only through `PRICING_CONFIG_JSON` and `RUBRIC_TXT_B64`. Gitignored: `docs/source/pricing.md`, `docs/PRD.*`, `rubric.txt`, `docs/vaani/system_prompt.txt`, `enquiries/*`, every `.env*` except `.env.example`.
- Run `git add -A && pnpm leak:scan` before every commit. Example numbers in tests and comments must not coincide with a pricing figure (the scan will catch it; pick neutral numbers).
- Never print, log or commit a secret or connection string. Show env var names only. Never type a secret or password into a website: ask the user to paste it. Use `pnpm secrets:copy NAME` to put a value on the clipboard unprinted.
- Never speak a price; never ask about budget; Red leads are never deleted; test calls never reach HubSpot or Telegram; sample enquiries are never stored as calls; times in UTC, shown in IST; money is numeric INR.
- Every external call: a timeout, retries with backoff (`src/lib/http/retry.ts`), failures recorded in `pipeline_steps`. Never retry a create after a timeout unless an idempotency check makes it safe.
- Never invent API fields. Mark anything the docs do not confirm **UNVERIFIED** in a comment and in the report.
- Phase discipline: at the end of a phase run `pnpm check`, `pnpm lint`, the leak scan, commit, push, and report as Built / Tests / You do by hand / UNVERIFIED / Next. Ask rather than assume on open decisions.

## Conventions
- TypeScript strict; match the surrounding code's comment density and naming. Comments explain why, not what.
- zod validates every boundary; the Vaani tool inputs are deliberately lenient (a voice model may send strings for numbers).
- All Vaani payload parsing lives in `src/lib/vaani/events.ts`. All tier-to-status/action mapping lives in `src/lib/rules/outcome.ts`.
- External services are used through small clients with injectable `fetch`/`sleep` so tests need no network. Tests use in-memory doubles (`tests/pipeline/fakes.ts`, `tests/tools/fakes.ts`) and PGlite for SQL (`tests/dashboard/harness.ts`).
- Drizzle on Neon HTTP: no interactive transactions; use single statements, `onConflict`, or `db.batch`. In a single-table select, columns inside select-list SQL render unqualified: use `callIdRef` in correlated subqueries.
- Dashboard: server components and actions check the role themselves (`requireRole`); the proxy is only an early redirect. Never show the budget floor, any pricing figure, per-call estimated value, or the caller's budget words.

## Commands
`pnpm check` · `pnpm lint` · `pnpm leak:scan` · `pnpm eval:agent --runs=3` · `pnpm e2e:webhook` · `pnpm db:generate && pnpm db:migrate` · `pnpm rubric:build && pnpm vaani:prompt` (then paste the prompt into Vaani) · `pnpm rubric:env`. The full list is in `README.md`.

## Gotchas
- `pbcopy` needs `LANG=en_US.UTF-8` or ₹ and — are garbled.
- Vaani's dashboard: the description field has a hidden mirror textarea (set the visible one); "Paste cURL" would overwrite the saved secret header with the placeholder, so edit fields by hand.
- Vaani call history currently returns a 500 for our key (a Vaani-side bug); `enrich` tolerates it. Its `call_cost` is in credits, not INR.
- A zsh loop `for x in "--a --b"; do cmd $x` does not word-split: use arrays or call twice.
