# Setup and go-live checklist

Work top to bottom. Items marked **you** need your hands (an account, a secret, or a screen only you can use). Values never go into chat or into the repository: secrets live in `.env.local`, `.env.main-branch.local` (both gitignored) and Vercel's environment variables. `pnpm secrets:copy NAME` puts a value on the clipboard without printing it.

## 0. Where things stand (2026-10-10)

Built and tested: everything in the repository. Live and healthy on Vercel: the database, Cal.com, Gemini, Vaani API, pricing and rubric variables. **Not yet connected: Telegram, HubSpot.** **Not yet proven: Vaani's in-call tools** (no tool request has ever reached our server from Vaani's tester).

## 1. Environment variables

Set each in `.env.local` (dev branch) and in Vercel → Settings → Environment Variables → Production, then redeploy. "Set" is the state at the last check.

| Variable | Purpose / where to get it | Set |
|---|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Neon project `snowy-shape-28009767`: pooled URL for the app, direct URL for migrations. Prod uses the `main` branch, local uses `dev` | yes |
| `GEMINI_API_KEY` | Google AI Studio → API keys | yes |
| `GEMINI_MODEL` | Default `gemini-3.8-flash` | default |
| `GEMINI_PRICE_IN_PER_MTOK_INR`, `GEMINI_PRICE_OUT_PER_MTOK_INR` | Google's USD price per million tokens × your USD→INR rate (3.8 Flash: $0.75 in / $3.75 out until 2026-12-31, then double). **you**: without them Gemini cost shows as empty | **no** |
| `VAANI_API_KEY` | Vaani → Settings → API keys (call history) | yes |
| `VAANI_WEBHOOK_SECRET` | You generate (`pnpm secrets:rotate --names=VAANI_WEBHOOK_SECRET`); goes in the webhook URL | yes |
| `VAANI_TOOL_SECRET` | You generate; Vaani sends it as `X-Tool-Secret` | yes (rotate, see section 8) |
| `VAANI_COST_PER_MIN_INR` | Vaani's Overview tab shows the per-minute rate (5.6) | yes |
| `VAANI_TEST_AGENT_IDS` | Comma list of Vaani agent IDs whose calls are always tests. Optional: browser tests are detected from `call_mode` anyway | optional |
| `CAL_API_KEY` | Cal.com → Settings → Security → API keys | yes |
| `CAL_EVENT_TYPE_ID_CALL` | The "Aangan design call" event type ID | yes |
| `CAL_EVENT_TYPE_ID_SITE_VISIT` | **Unused** since 2026-10-10 (only the design call is booked) | leave |
| `CAL_API_VERSION_SLOTS`, `CAL_API_VERSION_BOOKINGS` | Defaults `2024-09-04` and `2026-02-25`; the bookings lookup uses `2026-05-01` internally | default |
| `HUBSPOT_ACCESS_TOKEN`, `HUBSPOT_PORTAL_ID` | **you**: `docs/HUBSPOT_SETUP.md` section 1. Create the private app **before 2026-10-26** | **no** |
| `HUBSPOT_PIPELINE_ID`, `HUBSPOT_STAGE_BOOKED`, `HUBSPOT_STAGE_AWAITING`, `HUBSPOT_STAGE_LOST` | Printed by `pnpm hubspot:setup --write` (IDs, not secrets) | **no** |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_ESCALATION_CHAT_ID` | **you**: `docs/TELEGRAM_SETUP.md` | **no** |
| `APP_BASE_URL` | `https://aangan-voice-agent-inky.vercel.app` (defaults from Vercel's production domain) | yes |
| `SESSION_SECRET`, `CRON_SECRET` | You generate; sign login cookies and authorise the cron | yes |
| `DASHBOARD_DESIGNER_PASSWORD`, `DASHBOARD_FOUNDER_PASSWORD` | You choose (at least 8 characters, and different) | yes |
| `PRICING_CONFIG_JSON` | `pnpm pricing:config` from the local pricing guide | yes |
| `RUBRIC_TXT_B64` | `pnpm rubric:build && pnpm rubric:env`. Rerun and update Vercel after any rubric change | yes |
| `STUDIO_PHONE_NUMBER` | The office number in +91 format, once linked | **no** |
| `ASSUMED_DEAL_VALUE_INR`, `BUSINESS_HOURS_START/END`, `BUSINESS_DAYS`, `PLACEHOLDER_EMAIL_DOMAIN` | Defaults: 11,00,000 / 10:00 / 19:00 / Mon-Sat / `example.com`. **you**: set `PLACEHOLDER_EMAIL_DOMAIN` to a domain you own so placeholder booking emails do not go to a stranger's domain | default |
| `AMBER_STALE_HOURS`, `RETENTION_DAYS`, `TOOL_RATE_LIMIT_PER_MIN` | Defaults 4 / 90 / 120 | default |

Check what Vercel sees at any time: `GET https://aangan-voice-agent-inky.vercel.app/api/health` (booleans only).

## 2. Database

Prod is the Neon `main` branch. After any schema change: `ENV_FILE=.env.main-branch.local pnpm db:migrate`. Currently both migrations are applied.

## 3. Vaani (app.vaanivoice.ai)

**Agent:** "Vaani Voice Agent" (`07144cab-f8c8-4a44-b69f-fd6880d4b0e8`), English, 10-minute maximum call.

1. **System prompt** (you): run `pnpm rubric:build && pnpm vaani:prompt`, then paste `docs/vaani/system_prompt.txt` into the agent (Identity section) and press Cmd+S. Repaste after every change to the template or the rubric.
2. **Three tools** (Tools & Actions → custom tools). Names, descriptions and fields are in `docs/vaani/tools.json`; edit fields by hand, never with "Paste cURL" (it replaces the saved secret with a placeholder).

   | Tool name in Vaani | Method and URL | Header | Timeout |
   |---|---|---|---|
   | `submit_assessment` | POST `https://aangan-voice-agent-inky.vercel.app/api/vaani/tools/submit_assessment` | `X-Tool-Secret: <VAANI_TOOL_SECRET>` | 8000 ms |
   | `check_consult_availability` | POST `…/api/vaani/tools/check_availability` | same | 8000 ms |
   | `book_consult` | POST `…/api/vaani/tools/book_consult` | same | 8000 ms |

   `submit_assessment` includes `tier` (green, amber, red) and `tier_reason`. `check_consult_availability` and `book_consult` no longer take `consult_type`. Enable all three on the agent.
3. **Webhook** (Settings → Webhooks, organisation-wide): `pnpm secrets:copy VAANI_WEBHOOK_URL --env-file=.env.main-branch.local`, paste the URL, select all events, save.
4. **Phone number** (Settings → Telephony). Either **Provision a Number** (pick country and area; paid; Indian availability unconfirmed) or **Connect SIP Trunk** (Twilio, Telnyx, Vonage: host, user, password, port). Then assign it to the agent under its Deployment → inbound number. To use the studio's **existing office number**, there are two routes: (a) ask the telephone carrier to forward the office line to the Vaani number (conditional forwarding on busy, no answer or after hours is a carrier feature), or (b) if the office line's provider offers a SIP trunk, connect it. Forwarding the office number is **not** documented by Vaani. Calls that never reach Vaani are invisible to this system, which the dashboard says on the "Missed" metric. After linking, set `STUDIO_PHONE_NUMBER`.
5. **Language**: one language per agent (English today). Hindi, Marathi and mixed callers need a separate agent or a language setting: a decision for Nikhil (PRD V2 is a "Should").

## 4. Cal.com

- Event type **"Aangan design call"** (20 minutes, Google Meet) is the only one used. Its ID is `CAL_EVENT_TYPE_ID_CALL`. It requires the attendee's name and email; callers who give no email get a placeholder address at `PLACEHOLDER_EMAIL_DOMAIN`.
- "Aangan site visit" can stay as it is or be hidden; nothing books it.
- Set designer working hours (and evenings/weekends if wanted) in Cal.com; slots come from there and from the connected Google Calendar's busy times.

## 5. Telegram

`docs/TELEGRAM_SETUP.md`: create the bot, two chats, find the IDs with `pnpm telegram:chats`, test with `--send-test`, then add three variables in Vercel.

## 6. HubSpot

`docs/HUBSPOT_SETUP.md`: private app (before 2026-10-26), `pnpm hubspot:setup --write`, copy the printed IDs to Vercel, build three views by hand. Free plan limits: 10 custom properties (8 used), no custom pipeline (the default one is used), 1,000 contacts (about five months at 200 calls a month).

## 7. Vercel

- Project deploys on every push to `main`; region `sin1`. The cron `30 3 * * *` UTC (09:00 IST) calls `/api/cron/digest` with `Authorization: Bearer $CRON_SECRET`; on Hobby it runs once a day and may be up to an hour late.
- **Vercel Hobby is for non-commercial use.** A deployment that earns the studio money needs the Pro plan. Decide before going live.
- Deployment URLs are behind Vercel Authentication; the production domain is public. The dashboard has its own password login.

## 8. Rotating secrets

Do this before go-live (the production `VAANI_TOOL_SECRET` has appeared in tool output twice during development; treat it, and anything pasted into a chat, as exposed).

1. `pnpm secrets:rotate --env-file=.env.main-branch.local --names=VAANI_TOOL_SECRET,VAANI_WEBHOOK_SECRET` (add `CRON_SECRET,SESSION_SECRET` too if you like; changing `SESSION_SECRET` logs everyone out).
2. For each name: `pnpm secrets:copy NAME --env-file=.env.main-branch.local`, then paste into Vercel (Production), replacing the old value.
3. Redeploy (push any commit, or "Redeploy" in Vercel).
4. **Vaani:** edit the `X-Tool-Secret` header on each of the three tools: copy `VAANI_TOOL_SECRET` and paste it by hand; save each. Update the webhook URL: `pnpm secrets:copy VAANI_WEBHOOK_URL --env-file=.env.main-branch.local`, paste, save.
5. Check: `pnpm e2e:webhook --base=https://aangan-voice-agent-inky.vercel.app --env-file=.env.main-branch.local` passes. A tool call with the old secret now returns 401 and appears in `tool_calls`.
6. Also rotate, if they were ever pasted anywhere: `VAANI_API_KEY`, `CAL_API_KEY`, `GEMINI_API_KEY`, the Telegram bot token (BotFather `/revoke`), the HubSpot token.

## 9. Before the first real call

1. `pnpm check`, `pnpm lint` clean; `GET /api/health` shows every integration `true`.
2. `pnpm e2e:webhook --base=https://aangan-voice-agent-inky.vercel.app --env-file=.env.main-branch.local` passes (test-marked: nothing reaches Telegram or HubSpot).
3. `pnpm e2e:webhook --real --base=… --env-file=…` once: a Telegram alert, a HubSpot contact, call record and deal appear. Delete that contact and deal in HubSpot.
4. **Prove the in-call tools** (the open blocker): Vaani agent → Start Test → Audio, say the Green script in `docs/ACCEPTANCE.md`. Afterwards, `tool_calls` must show `submit_assessment`, `check_availability`, `book_consult` rows, and Cal.com must show the booking. If nothing arrives, ask Vaani support why custom tool calls do not reach the endpoint; until then calls arrive unrated (the dashboard says so) and designers book by hand.
5. Run the rest of the voice script in `docs/ACCEPTANCE.md` (Amber, Red, timeline, budget, price pressure, redial, complaint).
6. `pnpm eval:agent --runs=5` after any prompt change; the last measured result is in `docs/ACCEPTANCE.md`.

## 10. First weeks

- Check **Needs review** and the 09:00 digest daily; rescue any Red lead that deserves a call.
- Watch the founder view's "Time to handoff", "Waiting too long" and price-leak count.
- HubSpot contact count (limit 1,000 on Free).
- Open decisions for Nikhil with their current defaults are in the PRD ("Open decisions for Nikhil").
