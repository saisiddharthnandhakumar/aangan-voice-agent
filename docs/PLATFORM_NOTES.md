# Platform notes (Phase 0)

Checked on 2026-10-09 against each platform's official docs. Every claim cites its source.
**UNVERIFIED** means the docs don't confirm it; the code must not depend on it until a real test shows it.

| Platform | Verdict for the build |
|---|---|
| Vaani | **Mode A confirmed in the dashboard (2026-10-10):** custom tools exist ("Paste cURL" form). **No call-ID or caller-number variable**, so tool calls are correlated by our own reference (§1.11) |
| Cal.com | Slots verified live on 2026-10-10 (shape, version header, event types). Booking create and the slot-taken error still UNVERIFIED (no real booking made) (§2) |
| HubSpot (Free CRM) | **10 custom properties total, no custom pipeline, 1,000 contacts. Private-app creation ends 2026-10-26** (§3) |
| Telegram | Confirmed: sendMessage, editMessageText, URL buttons, HTML escaping (§4) |
| Gemini | `gemini-3.8-flash` (GA). Structured JSON via `@google/genai` 2.28, field names verified in typings (§5). Live call not yet run (no key) |
| Neon | Pooled/direct, neon-http driver, Singapore region, Free scale-to-zero can't be disabled (§6) |
| Vercel | Next 16, `after()`, region `sin1`, Hobby cron once a day, **Hobby non-commercial** (§7) |

---

## 1. Vaani (app.vaanivoice.ai)

Docs: <https://docs.vaanivoice.ai/llms.txt> (Mintlify). OpenAPI: <https://docs.vaanivoice.ai/api-reference/openapi.json>.
The OpenAPI file lists only five paths: `/api/trigger-call/`, `/api/call-history`, `/api/transcript/{call_id}`, `/api/stream/{call_id}`, `/api/call_details/{client}/{call_id}`.

### 1.1 Auth and base URL
- REST base `https://api.vaanivoice.ai`. Header `X-API-Key: <key>`. Source: [Get Call Details](https://docs.vaanivoice.ai/api-reference/call-details.md), [Call Logs](https://docs.vaanivoice.ai/guides/call-logs.md).

### 1.2 Mid-call tool calling: **UNVERIFIED (the biggest risk)**
- The agent config returned by the API has `persona.actions: { functions: [], count: 0 }`, and trigger-call describes `actions` as "Agent functions". Source: [Update Training response](https://docs.vaanivoice.ai/api-reference/update-training.md), [Create Dispatch](https://docs.vaanivoice.ai/api-reference/trigger-call.md).
- **No page documents a function's schema, an HTTP URL, custom headers, a request body template, timeouts, or how the result is fed back to the model.**
- Only these are documented:
  - the built-in `transfer_call` tool ([Webhook Setup](https://docs.vaanivoice.ai/guides/webhook-setup.md), `human_transfer_initiated`)
  - a native Cal.com integration: Settings → Integrations → Cal.com, paste an API key, pick **one** event type, "book meetings directly during calls" ([Integrations](https://docs.vaanivoice.ai/guides/integrations.md))
- The native Cal.com integration **can't** enforce rule 4 (book only Green) or choose between site visit and call, so it doesn't meet the PRD.
- **To check in the dashboard:** Agent Config → Actions / Functions. Is there a "custom function / API request" type? Can it POST JSON to an HTTPS URL with an `X-Tool-Secret` header? Can the model fill the body from the conversation? Is the response read back to the model? What is the timeout?

### 1.3 Dynamic variables: **UNVERIFIED for inbound**
- Documented: **metadata variables** written as `{variable_name}` (single braces) in the prompt, with values passed in `metadata` when *triggering an outbound call*. Names must match exactly. Source: [Create an Agent](https://docs.vaanivoice.ai/getting-started/create-agent.md), [Concepts](https://docs.vaanivoice.ai/concepts.md).
- Not documented: system variables for an **inbound** call (call ID, caller number, current date). The PRD's `{{call_id}}`, `{{caller_number}}`, `{{current_date}}` are assumptions.
- Effect on the build: if no call-ID variable exists, the tool calls can't carry the Vaani call ID. The backend then creates its own `call_id` on the first `submit_assessment` and links it to the webhook later by **caller phone + time window** (see §1.5).

### 1.4 Webhooks
Configured **per organisation** in Settings → Webhooks (a URL only). Inbound and outbound both fire. Source: [Webhook Setup](https://docs.vaanivoice.ai/guides/webhook-setup.md).

| Event | Inbound | Documented fields |
|---|---|---|
| `call_started` | yes | `event`, `room_name`, `status`, `phone_number` (outbound example) |
| `user_picked_up_at` | yes | `event`, `room_name`, `status` |
| `call_ended` | yes | `event`, `room_name`, `call_duration` (**seconds**), `end_reason` (e.g. `AGENT_REQUESTED_DISCONNECT`) |
| `call_postprocessing` | yes | `event`, `call_id`, `timestamp`, `data{room_name, call_id, call_duration (**ms**), end_reason ("Call ended"), summary, entities, dispositions, recording_url, transcript}` |
| `call_rejected` / `call_no_answer` / `call_failed` | **outbound only** | n/a |

- **Signature: none documented.** No secret, no HMAC header. PRD P1 "verifies the signature" can't be met as written. **Plan:** put an unguessable token in the webhook URL (`/api/webhooks/vaani/call-ended?token=…`, compared in constant time to `VAANI_WEBHOOK_SECRET`). Optionally confirm the call exists with `GET /api/call-history` before acting.
- Transcript format: one string, turns like `[13:33:14] AGENT: …` / `[13:33:19] USER: …` separated by blank lines. The price-leak check parses `AGENT:` turns from this.
- **No cost field** in any webhook payload, and **no caller or studio number** in `call_ended`/`call_postprocessing`. UNVERIFIED whether inbound `call_started` carries the caller's `phone_number`.
- `room_name` = `call_id` (same value in the examples). The idempotency key is `call_id`.
- Trigger: **`call_postprocessing`** runs the pipeline (transcript ready). `call_ended` marks the row ended. `call_started` creates the row (`in_call`), which feeds the founder metric "Live calls".

### 1.5 Call history API: where numbers, cost and timings come from
`GET /api/call-history?page=&page_size=` (max 200, newest first; no filter by call ID documented). Each item has: `call_id`, `call_type`, `direction`, `call_status` (e.g. "User disconnected"), `from_number`, `to_number`, `Start_time`, `End_time`, `duration_ms`, **`call_cost`** (currency not stated, **UNVERIFIED**: probably INR), `call_dialing_at`, `call_ringing_at`, `user_picked_up_at`, `recording_api`, `call_metadata`, `post_processing_status`. Source: [Get Call History](https://docs.vaanivoice.ai/api-reference/call-history.md).
- Plan: after `call_postprocessing`, an **`enrich`** pipeline step pages the history (first page is usually enough) to fill `from_number`, `to_number`, `started_at`, pickup time (time to answer) and `vaani_cost_inr`. If it's missing, P7 falls back to `duration × VAANI_COST_PER_MIN_INR`.
- `GET /api/call_details/{call_id}` returns `transcription`, `entity`, `conversation_eval`, `summary`, `call_eval_tag`. Before post-processing, every field reads "Transcript is not available…". Source: [Get Call Details](https://docs.vaanivoice.ai/api-reference/call-details.md). Note: the OpenAPI path also has a `{client}` segment, so the path is **UNVERIFIED**.

### 1.6 Phone numbers and inbound routing
- Settings → Telephony: **Provision a Number** (Vaani-provisioned, pick country and area code) or **Connect SIP Trunk** (Twilio, Telnyx, Vonage: host, user, password, port). Numbers are E.164 (`+91XXXXXXXXXX`). Source: [Set Up Telephony](https://docs.vaanivoice.ai/getting-started/setup-telephony.md).
- Inbound routing: agent Deployment → `call_type.Inbound` = one E.164 number. Source: [Update Deployment](https://docs.vaanivoice.ai/api-reference/update-deployment.md).
- **Forwarding the studio's existing office number:** not documented. Two routes: (a) the telco forwards the office line to the Vaani number (conditional "busy / no answer / after hours" is a carrier feature), or (b) the office number's provider offers a SIP trunk. Indian provisioned-number availability is **UNVERIFIED** ("growing list of countries").
- **Missed calls** (never reached Vaani): invisible to Vaani. The `call_no_answer` / `call_rejected` events are outbound only. If the office line forwards on no-answer, only the carrier knows about calls that never connect. Founder metric "missed or not connected" = **UNVERIFIED source**. For now, show calls with `call_started` but no `user_picked_up_at`, and label the metric "seen by Vaani only".

### 1.7 WebRTC test calls (how you test)
- `POST /api/trigger-call/` with `medium: "webrtc"` starts an in-browser session and returns a LiveKit token and URL. The dashboard has a test-call button. Source: [Create Dispatch](https://docs.vaanivoice.ai/api-reference/trigger-call.md), [Python SDK](https://docs.vaanivoice.ai/sdk.md).
- `is_test` detection is **UNVERIFIED**: `call_type`/`direction` in call history may read "WebRTC"/"Web". Plan, in priority order:
  1. a separate **test agent** whose `agent_id` is in `VAANI_TEST_AGENT_IDS`
  2. `call_type` contains "web"
  3. a missing caller number on a call whose agent is the test agent
- Webhook events don't carry `agent_id`, so `enrich` reads it from call history.

### 1.8 Languages
- The agent has `identity.language` (e.g. `"en"`), and STT/TTS configs carry `language`. An `auto_detect` key exists in the config. Hindi/Marathi/Hinglish support is **UNVERIFIED** (pick in the dashboard). Source: [Update Experience response](https://docs.vaanivoice.ai/api-reference/update-experience.md).

### 1.9 Other relevant settings (all documented)
- Max call duration `call_settings.max_call_duration` (1–60 min); idle warning and hang-up timeouts (5–60 s); phrase-based end-call; noise hang-up. Source: [Update Experience](https://docs.vaanivoice.ai/api-reference/update-experience.md).
- Post-call extraction (`analysis.extraction.data_points`) and dispositions are available, but **off** for us: Gemini does this step (PRD).
- **BYOL:** every LLM turn can go to our own WebSocket server (`wss://…`, optional Bearer token, one connection per call, handshake frames `config` then `greeting`). Source: [BYOL](https://docs.vaanivoice.ai/guides/byol.md).

### 1.10 Mode decision (blocks Phase 3)
| Mode | When | Build change |
|---|---|---|
| **A** (PRD) | The dashboard has custom HTTP functions that can POST with a header, mid-call | As specified: T1–T3, `docs/vaani/tools.json` |
| **B** (fallback in the Stage-4 prompt) | No custom functions | No tools. The agent only converses. Gemini extracts the criteria after the call, rules compute the tier, Telegram asks a designer to book. Rules 4 and the "booked in call" metric become no-ops |
| **C** (BYOL) | No custom functions, but in-call booking is required | Our own WebSocket LLM server runs the rules and Cal.com. **Not on Vercel** (no long-lived WebSockets); needs Fly.io or Render. Large scope change |

**Recommendation:** build Phases 1–2 and the webhook pipeline now; they're the same in every mode. Keep T1–T3 behind one module so Mode B just doesn't mount them. Decide after the dashboard check.

---

## 2. Cal.com API v2

- **Auth:** `Authorization: Bearer cal_…`. Test keys start `cal_`, live keys `cal_live_`. Created under Settings → Security. Base `https://api.cal.com/v2`. Sources: [Introduction](https://cal.com/docs/api-reference/v2/introduction), [Atoms setup](https://cal.com/docs/atoms/setup.md).
- **Version headers** (`cal-api-version`, required per endpoint; a wrong value silently falls back to an older version):
  - `CAL_API_VERSION_SLOTS=2024-09-04`
  - `CAL_API_VERSION_BOOKINGS=2026-02-25`
  - event types `2026-06-12`

  Sources: [slots](https://cal.com/docs/api-reference/v2/slots/get-available-time-slots-for-an-event-type), [create booking](https://cal.com/docs/api-reference/v2/bookings/create-a-booking), [event types](https://cal.com/docs/api-reference/v2/event-types/list-event-types.md).
- **Slots:** `GET /v2/slots?eventTypeId=&start=&end=&timeZone=Asia/Kolkata&format=range`. `start` and `end` are UTC ISO (a bare date = whole day). The response `data` is `{ "YYYY-MM-DD": [ {start, end} ] }`, and empty availability gives `{}`. **UNVERIFIED:** the schema says slots are strings, the example shows objects, so the client accepts both. Source: [slots](https://cal.com/docs/api-reference/v2/slots/get-available-time-slots-for-an-event-type).
- **Create booking:** `POST /v2/bookings` with `{start (UTC ISO), eventTypeId, attendee{name, timeZone, email?, phoneNumber?, language}, location?, metadata?}`. Source: [create booking](https://cal.com/docs/api-reference/v2/bookings/create-a-booking).
  - **`attendee.email` is optional** in the request schema, but the response requires it. We still send a placeholder `<call_id>@PLACEHOLDER_EMAIL_DOMAIN` when the caller gives none, as the PRD says.
  - `location` is an object. Site visit: `{"type":"attendeeAddress","address":"<site_area>"}`. Call: `{"type":"attendeePhone","phone":"+91…"}`.
  - `metadata`: string values only, ≤50 keys, keys ≤40 chars, values ≤500 chars. We send `call_id` only, never phone or pricing.
  - Success returns 201 `data{id, uid, status, start, end, …}`.
- **Verified against the live account (2026-10-10, read-only):**
  - `GET /v2/slots` with version `2024-09-04` and `format=range` returns `data["YYYY-MM-DD"] = [{start, end}]` (objects, with `+05:30` offsets). It answered in 430–860 ms from here.
  - "Aangan site visit": 60 min, locations Cal Video + `attendeeAddress`, 240 min minimum notice.
  - "Aangan design call": 20 min, Google Meet only.
  - Both require `name` and `email`. `attendeePhoneNumber` is optional and hidden.
  - Consequences: we always send an email (a placeholder if the caller gave none), use `attendeeAddress` for site visits, and send no location for calls (Meet is used; the phone goes in the notes).
- **Slot already taken:** the error code and body are **UNVERIFIED** (not documented). The client treats any 4xx on create as "slot unavailable", re-fetches slots, and returns `{booked:false, reason, slots}`.
- **No idempotency key** on create booking. Idempotency comes from us: a unique `bookings.call_id` plus a "pending" row written before the Cal.com request. Source: [create booking](https://cal.com/docs/api-reference/v2/bookings/create-a-booking).
- **Reserve a slot** (about a 5-minute hold) exists but isn't needed. Source: [API v2 reference](https://cal.com/docs/_llms/api-v2-reference.md).
- **Cancel:** `POST /v2/bookings/{uid}/cancel` (version `2026-02-25`). Source: [cancel](https://cal.com/docs/api-reference/v2/bookings/cancel-a-booking).
- **Locations are per event type:**
  - "Aangan site visit" uses location `attendeeAddress`.
  - "Aangan design call" uses `attendeePhone`.

  Source: [create event type](https://cal.com/docs/api-reference/v2/event-types/create-an-event-type).
- **Round-robin** needs team event types (`/v2/teams/{teamId}/event-types`, `schedulingType: roundRobin`). The plan requirement (Teams, paid) is **UNVERIFIED**; it comes from marketing pages. The default "one calendar per event type" avoids it. Source: [team event types](https://cal.com/docs/api-reference/v2/team-event-types/create-a-team-event-type.md).
- **Rate limit:** 120 requests/min per API key. Source: [Introduction](https://cal.com/docs/api-reference/v2/introduction).
- **Latency budget:** each Cal.com call gets a 1.8 s timeout and one retry, inside T2/T3's 2.5 s p95. On failure the agent gets a speakable fallback ("I'll have a designer call you to fix a time").

## 3. HubSpot (Free CRM)

### 3.1 Credentials: ⚠️ time-sensitive
- **New legacy private apps can't be created after 2026-10-26** for accounts created before 2026-09-28 (it's already blocked for newer accounts). Existing apps keep working. Source: [changelog: legacy private app sunset](https://developers.hubspot.com/changelog/legacy-private-app-creation-sunset).
  - **Action for you:** if you want a private-app token, **create it before 2026-10-26**, even though the build is still running.
  - Path: Development → Legacy apps → Create legacy app → Private (super admin only). Source: [private apps](https://developers.hubspot.com/docs/apps/legacy-apps/private-apps/overview).
- **Replacement: Service Keys.** Development → Keys → Service keys → Create (super admin or "Developer tools access"). The key is sent as a Bearer token, uses the same object scopes, is limited to REST, and has a 7-day rotation grace period. Source: [service keys](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys).
  - Availability on Free and its beta status: **UNVERIFIED**.
  - Either credential works with our client. Both go into `HUBSPOT_ACCESS_TOKEN`.

### 3.2 Scopes
Source: [scopes](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/scopes).

| Purpose | Scopes |
|---|---|
| Contacts | `crm.objects.contacts.read`, `crm.objects.contacts.write` |
| **Calls** (no calls scope exists; gated by contacts write) | `crm.objects.contacts.write`. Source: [Calls API](https://developers.hubspot.com/docs/api-reference/crm-calls-v3/guide) |
| Deals + deal pipelines (Pipelines API accepts either) | `crm.objects.deals.read`, `crm.objects.deals.write`. Source: [Pipelines API](https://developers.hubspot.com/docs/api-reference/crm-pipelines-v3/guide) |
| Contact properties and groups | `crm.schemas.contacts.read`, `crm.schemas.contacts.write` |
| Deal pipeline read | `crm.schemas.deals.read` |

### 3.3 Free plan limits: these change the PRD design
Source: [HubSpot product & services catalog](https://legal.hubspot.com/hubspot-product-and-services-catalog), [pipelines KB](https://knowledge.hubspot.com/object-settings/set-up-and-customize-pipelines).

| Limit | Free | Effect |
|---|---|---|
| Custom properties | **10 in total** (reads as account-wide) | The PRD's 14 can't fit. Use the **8-property fallback** (status, tier, priority, last_call_at, call_count, locality, consult_at, dashboard_url) and put the rest in call notes. That leaves 2 spare. |
| Pipelines | **1 HubSpot-provided per object; 0 custom** | The "Aangan enquiries" pipeline **can't be created**. Use the default deal pipeline (`pipeline: "default"`). Adding or renaming its stages via the API is **UNVERIFIED**. `hubspot:setup` tries to add the six stages; if that fails, it maps them onto the existing default stages and prints the mapping. |
| **Contacts** | **Up to 1,000** | ⚠️ At ~200 calls/month (repeat callers share a contact), Free fills up in about **5 months**. Need Starter, or contact cleanup, before then. |
| Property groups | limit not stated | UNVERIFIED |
| API rate | 100 req / 10 s per app; 250,000/day per account. **Search: 5 req/s per account**, no rate headers | One call ≈ 4–6 requests, which is well within limits. |

Source for API rate: [usage guidelines](https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines), [search guide](https://developers.hubspot.com/docs/api-reference/search/guide).

### 3.4 API versions
- HubSpot moved to date versions (e.g. `/crm/objects/2026-09/contacts`). **The v1–v4 semantic versions stop working in September 2027.** We use v3 now (documented and stable), put the version in one constant, and note the migration in the README. Source: [migration guide](https://developers.hubspot.com/docs/api-reference/legacy/migration-guide).

### 3.5 Endpoints we use (v3)
- **Property group:** `POST /crm/v3/properties/contacts/groups {name, label, displayOrder}`. Source: [create group](https://developers.hubspot.com/docs/api-reference/legacy/crm/properties/groups/create-property).
- **Property:** `POST /crm/v3/properties/contacts {name, label, type, fieldType, groupName, options?}`. Valid pairs:
  - `enumeration`+`select`
  - `datetime`+`date`
  - `number`+`number`
  - `string`+`text`/`textarea`
  - There is **no URL type**, so `dashboard_url` is `string`/`text`.

  The duplicate-create status code isn't documented (UNVERIFIED), so setup does a **GET first and creates only what's missing**. Sources: [create property](https://developers.hubspot.com/docs/api-reference/legacy/crm/properties/create-property), [properties guide](https://developers.hubspot.com/docs/api-reference/crm-properties-v3/guide).
- **Pipelines:** `GET /crm/v3/pipelines/deals`. `POST /crm/v3/pipelines/deals/{id}/stages {label, displayOrder, metadata.probability}` (probability is required for deals). Source: [Pipelines API](https://developers.hubspot.com/docs/api-reference/crm-pipelines-v3/guide).
- **Contact search by phone:** `POST /crm/v3/objects/contacts/search`. HubSpot standardises phone numbers and recommends searching **without the country code**. We search the 10-digit national number with an OR on `phone` and `mobilephone`. The `hs_searchable_calculated_*` property names are UNVERIFIED. New contacts appear in search only after "a few moments". Source: [search guide](https://developers.hubspot.com/docs/api-reference/search/guide).
  - **Idempotency therefore comes from our stored `hubspot_contact_id`**, plus a Neon lookup of earlier calls from the same number, never from search alone.
  - `phone` can't be a batch-upsert `idProperty`, and a unique custom property would use up one of the 10. Source: [contacts guide](https://developers.hubspot.com/docs/api-reference/crm-contacts-v3/guide).
- **Contact create:** needs at least one of email, firstname or lastname. "Unknown caller" sets `firstname="Unknown caller"`, `lastname=<call id>`.
- **Call record:** `POST /crm/v3/objects/calls`. Source: [Calls API](https://developers.hubspot.com/docs/api-reference/crm-calls-v3/guide).
  - Required: `hs_timestamp`.
  - Other properties: `hs_call_title`, `hs_call_body` (notes), `hs_call_direction: INBOUND`, `hs_call_duration` (**ms**), `hs_call_from_number`, `hs_call_to_number`.
  - `hs_call_recording_url` must be HTTPS (.mp3/.wav to play inline). Vaani's `/api/stream/{id}` needs an API key, so **we link to the dashboard call page instead** and don't expose the recording.
  - `hs_call_status`: `COMPLETED` for answered/dropped, `NO_ANSWER` for missed, `FAILED` for failed.
  - `hs_call_disposition` GUIDs: Connected `f240bbac-87c9-4f6e-bf70-924b57d47db7`, No answer `73a0d17f-1163-4015-bdd5-ec830791da20`, Wrong number `17b47fee-58de-441e-a44c-c6300d46f273`.
  - Inline association call→contact type **194**, call→deal **206**. Source: [associations v4](https://developers.hubspot.com/docs/api-reference/crm-associations-v4/guide).
- **Deal:** `POST /crm/v3/objects/deals {dealname, dealstage (internal id), pipeline, amount, description?}`. Association deal→contact type **3**. Source: [deals guide](https://developers.hubspot.com/docs/api-reference/crm-deals-v3/guide). The `description` property name is UNVERIFIED, so if it's rejected the "estimate" label goes into the deal name instead.
- **429 and retries:** check `policyName` (DAILY vs secondly) in the body. Throttle on `X-HubSpot-RateLimit-Remaining`. Use exponential backoff and honour `Retry-After` if present. For 5xx, retry after a few seconds. Sources: [usage guidelines](https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines), [error handling](https://developers.hubspot.com/docs/api-reference/error-handling).

## 4. Telegram Bot API (Bot API 10.3, Aug 2026)

- **Endpoint:** `https://api.telegram.org/bot<token>/<method>`, JSON POST. Response `{ok, result}` or `{ok:false, error_code, description, parameters?}`. Source: [Making requests](https://core.telegram.org/bots/api#making-requests).
- **sendMessage:** `chat_id`, `text` (1–4096 chars after parsing), `parse_mode:"HTML"`, `link_preview_options:{is_disabled:true}` (`disable_web_page_preview` no longer appears in the docs), `reply_markup:{inline_keyboard:[[{text:"Open in dashboard", url:"https://…"}]]}`. Sources: [sendMessage](https://core.telegram.org/bots/api#sendmessage), [LinkPreviewOptions](https://core.telegram.org/bots/api#linkpreviewoptions), [InlineKeyboardButton](https://core.telegram.org/bots/api#inlinekeyboardbutton).
- **editMessageText:** `chat_id` + `message_id`, `text`, `parse_mode`, `reply_markup`. This supports the AT15 plan (edit the dropped-call alert into the lead alert), so we store `telegram_message_id` and `telegram_chat_id` on the call row. Source: [editMessageText](https://core.telegram.org/bots/api#editmessagetext).
- **HTML escaping:** escape `<` `>` `&` as `&lt;` `&gt;` `&amp;` (and `"` as `&quot;` inside attributes). Allowed tags: b/strong, i/em, u/ins, s/strike/del, tg-spoiler, a href, code, pre, blockquote. Every caller-supplied string is escaped. Source: [HTML style](https://core.telegram.org/bots/api#html-style).
- **Limits:** about 1 msg/s per chat, **20 msgs/min per group**. A 429 carries `parameters.retry_after` (seconds), which we honour, then retry up to 3 times with backoff. Sources: [Bots FAQ](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this), [ResponseParameters](https://core.telegram.org/bots/api#responseparameters).
- **Chat IDs:**
  - Basic groups are negative. Supergroups are `-100…`. Values can exceed 32 bits, so they're stored as text or bigint.
  - Group→supergroup migration returns `parameters.migrate_to_chat_id`, which we log.
  - Getting an ID: add the bot, send `/start@botname` in the group (privacy mode hides normal messages), then call `getUpdates` (only works with no webhook set; updates are kept 24 h).

  Sources: [bot IDs](https://core.telegram.org/api/bots/ids), [privacy mode](https://core.telegram.org/bots/features#privacy-mode), [getUpdates](https://core.telegram.org/bots/api#getupdates).

## 5. Gemini API

- **Model:** `GEMINI_MODEL=gemini-3.8-flash` (GA since 2026-09-02, 1M context, 64k max output). The cheaper fallback is `gemini-3.5-flash-lite` (GA). `gemini-2.0-flash` is shut down, and Google recommends against 2.5 Flash for new projects. Sources: [models](https://ai.google.dev/gemini-api/docs/models), [deprecations](https://ai.google.dev/gemini-api/docs/deprecations), [changelog](https://ai.google.dev/gemini-api/docs/changelog), [latest model](https://ai.google.dev/gemini-api/docs/generate-content/latest-model).
- **SDK:** `@google/genai`. `@google/generativeai` is deprecated. Source: [libraries](https://ai.google.dev/gemini-api/docs/libraries).
- **API surface:** Google now leads with the **Interactions API**. `generateContent` sits under "Legacy" but has no deprecation date, and both get the same configuration. We use `generateContent` and keep it behind one adapter. Sources: [structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output), [what's new in 3.5](https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.5).
- **Structured output:** the docs' JS example uses `config.responseFormat.text = {...}` (Interactions API). **Verified in Phase 2 against the installed `@google/genai` 2.28.0 typings:** `generateContent` takes `config.responseMimeType: "application/json"` + `config.responseJsonSchema`, `thinkingConfig.thinkingLevel` (`LOW`), `abortSignal`, and `httpOptions.timeout` / `httpOptions.retryOptions`. `usageMetadata` has `promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`. Used in `src/lib/gemini/client.ts`.
  - Supported schema keywords: type (including `["string","null"]` for nullable), properties, required, additionalProperties, enum, format date/date-time, minimum/maximum, items, min/maxItems, anyOf.
  - Unsupported keywords are ignored, so the output is **re-validated with zod**.

  Source: [structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output).
- **Parameters:**
  - `temperature`/`top_p`/`top_k` are **deprecated on 3.x**, so we don't send them.
  - `thinkingConfig.thinkingLevel` on 3.8 Flash is `low|medium|high` (default medium; `minimal` errors). We use **`low`** to keep cost and latency down.
  - Thinking tokens are billed at the output rate.
  - `maxOutputTokens` caps the output. Whether thinking counts against it in `generateContent` is UNVERIFIED, so the cap is set generously (4,096) and the zod-validated summary is truncated to 600 chars.

  Sources: [changelog](https://ai.google.dev/gemini-api/docs/changelog), [thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking).
- **Usage for cost:** `usageMetadata.promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`, `totalTokenCount`. Thinking is separate from candidates, so **`gemini_tokens_out = candidates + thoughts`**. Source: [API reference](https://ai.google.dev/api/generate-content).
- **Price** (Standard paid tier, per 1M tokens): `gemini-3.8-flash` costs **$0.75 in / $3.75 out until 2026-12-31**, then **$1.50 / $7.50** from 2027-01-01. Set `GEMINI_PRICE_IN_PER_MTOK_INR` / `GEMINI_PRICE_OUT_PER_MTOK_INR` from these × your USD→INR rate, and **update them on Jan 1**. Source: [pricing](https://ai.google.dev/gemini-api/docs/pricing).
- **Errors:** retry 429/503/timeouts with exponential backoff and jitter (1 s, 2 s, 4 s, capped); never retry 400/402/403. Source: [troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting). `httpOptions.timeout` and `abortSignal` exist (verified in the typings). We use both, turn off the SDK's own retries and apply ours.

## 6. Neon

- **Pooled vs direct:**
  - Pooled host has `-pooler` (PgBouncer, transaction mode: no `SET`, `LISTEN`, SQL `PREPARE` or session locks). `DATABASE_URL` is pooled and used by the app.
  - `DATABASE_URL_UNPOOLED` is direct and used by migrations (drizzle-kit).

  Source: [connection pooling](https://neon.com/docs/connect/connection-pooling).
- **Driver:** `@neondatabase/serverless`. HTTP `neon()` is fastest for single queries, and `sql.transaction([...])` gives non-interactive transactions. `Pool`/WebSocket is needed for interactive transactions. Node 22 has a native WebSocket. Source: [serverless driver](https://neon.com/docs/serverless/serverless-driver).
  - Drizzle: `drizzle-orm/neon-http` for the app. Where a multi-statement atomic write is needed (idempotent booking), use a single `INSERT … ON CONFLICT` or `sql.transaction`. Interactive `db.transaction()` on neon-http is UNVERIFIED, so we avoid it. Source: [Drizzle + Neon](https://orm.drizzle.team/docs/connect-neon).
- **Branching:** the root branch is called `main` for projects created by API (our case, via the Neon MCP) and `production` for console-created ones. A child `dev` branch gets its own `ep-` host and connection string. Source: [branches](https://neon.com/docs/manage/branches).
- **Free plan:**
  - 100 projects, 10 branches/project, 0.5–1 GB storage per project (the docs page is inconsistent), 100 CU-hours/project/month, 5 GB egress.
  - **Scale to zero after 5 min idle, which can't be turned off on Free.** Wake-up takes "a few hundred milliseconds".

  Sources: [plans](https://neon.com/docs/introduction/plans), [scale to zero](https://neon.com/docs/introduction/scale-to-zero).
- **Region:** no Mumbai. The nearest is **`aws-ap-southeast-1` (Singapore)**. Source: [regions](https://neon.com/docs/introduction/regions).

## 7. Vercel and Next.js

- **Next.js 16** is the current stable major (docs 16.4.0). Source: [route segment config](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config).
- **Background work:** `after()` from `next/server` (stable since 15.1) runs after the response, inside the function's max duration, and is built on `waitUntil`. This is how P1 returns 200 fast. Fluid compute: Hobby 300 s max, Pro 800 s. Sources: [after](https://nextjs.org/docs/app/api-reference/functions/after), [limits](https://vercel.com/docs/functions/limitations).
- **Cron:** Hobby allows **once per day max**, with timing only accurate **±59 min**. Requests are GET with `Authorization: Bearer $CRON_SECRET`, aren't retried, and may fire twice, so jobs are idempotent. The P9 digest at 09:00 IST = `30 3 * * *` UTC may arrive anywhere between 03:30 and 04:29 UTC on Hobby. Sources: [cron pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing), [manage cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
- **Regions:** `bom1` (Mumbai) and `sin1` exist. Hobby gets 1 function region, set via `vercel.json` `"regions"` (Next's `preferredRegion` is deprecated). Source: [function regions](https://vercel.com/docs/functions/configuring-functions/region).
  - **Recommendation: `sin1`**, next to Neon Singapore. A tool request runs several DB queries, so keeping DB round-trips local matters more than the single Vaani→Vercel hop.
- **Hobby is non-commercial only.** A deployment that earns anyone money needs **Pro**. Source: [fair use](https://vercel.com/docs/limits/fair-use-guidelines).

### 1.11 Dashboard findings (2026-10-10, checked in the Vaani dashboard by the user via a browser session)
- **Custom tools exist.** The tool form has a "Paste cURL" button, so mid-call HTTP tools are available. **Mode A stands** and §1.10 is resolved. Phase 3 supplies one cURL command per tool.
- **Built-in variables:** only date/time variables and `call_mode`. There is **no call ID and no caller-number variable**, so `{{call_id}}` and `{{caller_number}}` in the prompt resolve to nothing.
  - **Design consequence:**
    - The first `submit_assessment` creates the call row and returns a short `call_ref`, which the agent passes to `check_availability` and `book_consult`.
    - The post-call webhook links to that row by **time window** (the tool calls fall between the call's start and end) **plus the caller number** from call history when it exists.
    - An ambiguous match (two overlapping calls) is flagged for manual linking on the dashboard.
    - At ~200 calls a month, overlaps should be rare.
  - **`call_mode`:** the agent passes `{{call_mode}}` in every tool body, so a web/WebRTC test call can be marked `is_test` at the first tool call. Its exact values (e.g. "web" vs "phone") are **UNVERIFIED** until a test call is logged in `tool_calls`.
- **Language:** one language per agent, currently English. Hindi, Marathi and mixed callers need a separate agent or a language choice. V2 is a Should, so this is left open for Nikhil.
- **Cost:** the Overview tab estimates ₹5.60 per minute, so `VAANI_COST_PER_MIN_INR=5.6`.
- **Configured:** greeting (AI and recording disclosure), goodbye line, 10-minute maximum call. The system prompt is pasted. A text-chat test gave only the pricing line under pressure (claiming to be Nikhil); a voice test is still to do.
- **Not configured yet:** the three tools and the webhook (they need the Vercel URL), and the phone number (paid; the office number gets linked later).
