"use client";

import { useActionState } from "react";
import { reviewAction, retryStep, type ActionState } from "./actions";

export function ReviewForm({ callId, tier, reviewState }: { callId: string; tier: "green" | "amber" | "red" | null; reviewState: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(reviewAction, {});
  const open = reviewState === "none";
  const btn = "min-h-12 rounded-lg px-5 text-base font-semibold disabled:opacity-50";
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="callId" value={callId} />
      <label className="flex flex-col gap-1.5 text-base font-semibold" htmlFor="note">
        Note, or the reason when you discard
        <textarea id="note" name="note" rows={3} maxLength={2000} className="rounded-lg border border-line bg-bg px-3 py-2 text-base font-normal" placeholder="For example: called back, visit set for Saturday" />
      </label>
      <div className="flex flex-wrap gap-2">
        {open && tier !== "red" && (
          <button name="action" value="approve" disabled={pending} className={`${btn} bg-accent text-accent-ink hover:opacity-90`}>
            Approve
          </button>
        )}
        {open && tier === "red" && (
          <button name="action" value="rescue" disabled={pending} className={`${btn} bg-accent text-accent-ink hover:opacity-90`}>
            Rescue
          </button>
        )}
        {reviewState !== "discarded" && (
          <button name="action" value="discard" disabled={pending} className={`${btn} border border-line bg-surface hover:bg-surface-2`}>
            Discard (reason required)
          </button>
        )}
        <button name="action" value="note" disabled={pending} className={`${btn} border border-line bg-surface hover:bg-surface-2`}>
          Add note
        </button>
      </div>
      <p className="text-[13px] text-ink-3">
        {tier === "red" ? "Red leads are never deleted. Rescue puts one back in play and creates its deal." : "Approve confirms the lead and makes sure it has a deal in HubSpot."} Every action is saved with who did it.
      </p>
      <div aria-live="polite">
        {state.error && <p role="alert" className="rounded-lg bg-bad-bg px-3 py-2 text-base text-bad-ink">{state.error}</p>}
        {state.message && <p className="rounded-lg bg-ok-bg px-3 py-2 text-base text-ok-ink">{state.message}</p>}
      </div>
    </form>
  );
}

export function RetryButton({ callId, step }: { callId: string; step: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(retryStep, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="callId" value={callId} />
      <input type="hidden" name="step" value={step} />
      <button disabled={pending} className="min-h-12 rounded-lg border border-line px-4 text-base font-semibold hover:bg-surface-2 disabled:opacity-50">
        {pending ? "Retrying…" : "Retry"}
      </button>
      <span aria-live="polite" className={`text-[13px] ${state.error ? "text-bad-ink" : "text-ok-ink"}`}>
        {state.error ?? state.message}
      </span>
    </form>
  );
}
