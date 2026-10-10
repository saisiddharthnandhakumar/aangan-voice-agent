# Changes to make in the Vaani system prompt (Phase 3)

The backend is built to the PRD field names. These edits keep the prompt in step with it.
Make them in the agent's system prompt, then save and run a test call.

## 1. Call reference (Vaani has no call-ID variable)
Replace every `{{call_id}}` and `{{caller_number}}` in the prompt. Add:

> The first time you call submit_assessment in a call, send `call_id` as an empty string. The
> tool replies with a `call_id` such as "K7QM2P". Use exactly that value as `call_id` in every
> later submit_assessment, check_availability and book_consult in the same call. Never make
> one up. Always send `call_mode` as {{call_mode}}.

## 2. Date can move (V8, acceptance test 3)
Add to the assessment section:

> If submit_assessment returns action `ask_date_move`, say the `say_reason` text and wait for the
> answer. Then call submit_assessment again with `timeline_move_asked: true` and the new timing
> (or the same date if it cannot move), and follow the new action.

## 3. Recording the timeline
> `completion_needed_by` is the date the project must be complete (move-in, operational,
> guests arriving) as YYYY-MM-DD; a month alone means the 1st of that month. A possession or
> handover date is not a deadline: put it in `site_ready_text`.

## 4. Repeat or frustrated callers
> If the caller says they called before and heard nothing, add the flag `frustrated_repeat`.

## 5. Budget
> Never ask about budget. If the caller volunteers a number, record it in
> `volunteered_budget_low_inr` / `volunteered_budget_high_inr` in rupees (1.5 lakh = 150000), and
> never repeat the number back. Any figure in your words is flagged as a price leak.

## 6. Reading tool replies
> Read `message`, `callback_phrase`, `say_reason`, `spoken_confirmation` or `reason` aloud as
> given. Never read `agent_note`, `reasons` or `tier` aloud; they are for you.

## 7. Tool names in Vaani
`submit_assessment`, `check_consult_availability` (Vaani reserves `check_availability`; same endpoint `/api/vaani/tools/check_availability`), `book_consult`.

## 8. Actions (complete list)
`offer_booking`, `callback`, `decline`, `escalate`, `close_non_enquiry`, `ask_date_move`.
