# Founder metrics: exact definitions

Every number on the founder view is one plain SQL aggregate in `src/lib/dashboard/metrics.ts`, tested against a real Postgres in `tests/dashboard/metrics.test.ts` (each metric is compared with hand-computed values, with an independent JavaScript recomputation from the raw rows, and, for the headline numbers, with hand-written SQL). That is acceptance test 22.

Rules for all of them: **test calls are never counted**; a call's time is Vaani's start time, else when we first saw it; dates are chosen in IST (a day is `+05:30` midnight to midnight) and stored in UTC. "Range" metrics use the chosen date range; "now" metrics ignore it.

| Metric | Definition (calls table unless stated) |
|---|---|
| Live calls (now) | `status = 'in_call'` and created in the last 30 minutes (a call stuck in `in_call` after the webhook never came is not live) |
| Active leads (now) | Amber with `review_state = 'none'`, plus Green with an accepted booking whose `start_at` is still ahead |
| Waiting too long (now) | Amber with `review_state = 'none'` created more than `AMBER_STALE_HOURS` (default 4) ago; oldest = the largest age among them |
| Calls received | Calls in range |
| Answered | `answered_at` set, or the agent categorised the call, or a transcript exists |
| Missed or not connected | Received minus answered. **Seen by Vaani only**: a call that never reached Vaani is invisible |
| Missed in working hours | Not answered and `called_after_hours = false` |
| Dropped before assessment | `end_reason = 'dropped'`; with callback alert = also `telegram_sent_at` set |
| Repeat callers | `repeat_of_call_id` set |
| After-hours share | `called_after_hours = true` ÷ received |
| Tier mix | Counts of `tier` green / amber / red / none |
| Bookings | Calls with an accepted booking |
| Booking rate | Calls with a booking among Green + Amber ÷ (Green + Amber). Also shown for Green only |
| Escalations | `status = 'escalated'` or category `existing_client_complaint` |
| Time to first response (escalations) | Average of (first `review_actions` row for the call − call end), in minutes; unanswered = no action yet |
| Price leaks | `price_leak = true` |
| Time to answer | `answered_at − started_at`: average, 95th percentile, max, and how many took over 5 minutes. **UNVERIFIED** whether Vaani's inbound `call_started` is the ring time |
| Time to handoff | `telegram_sent_at − ended_at` for Green and Amber calls: average, 95th percentile, how many took over 2 minutes |
| Lead source | Count by `lower(trim(referral_source))`, top 10 |
| HubSpot: calls logged | `hubspot_call_id` set; completeness = logged ÷ received |
| HubSpot: failed | Calls with a `hubspot_log` or `hubspot_deal` pipeline step in `failed` |
| HubSpot: deals | `hubspot_deal_id` set, by tier; and by `review_state` approved / rescued |
| Cost | Sums of `vaani_cost_inr`, `gemini_cost_inr`, `total_cost_inr`; per call = total ÷ calls that have a cost; per booked design call = total ÷ bookings |
| Estimated pipeline | Sum of `estimated_value_inr` for qualified leads (Green, Amber, or Approved/Rescued, never Discarded). An **estimate**, shown beside total cost |
| Calls per day, cost per day | Grouped by the IST date of the call time |

What is deliberately **not** shown anywhere: the budget floor, any pricing figure, per-call estimated values (project size beside an estimate would reveal the rates), the caller's budget words, and transcripts in the CSV.
