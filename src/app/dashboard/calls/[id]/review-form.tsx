"use client";

import { useActionState } from "react";
import { reviewAction, retryStep, type ActionState } from "./actions";

export function ReviewForm({ callId, tier, reviewState }: { callId: string; tier: "green" | "amber" | "red" | null; reviewState: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(reviewAction, {});
  const open = reviewState === "none";
  const btn = "h-10 rounded-lg px-4 text-sm font-medium disabled:opacity-50";
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="callId" value={callId} />
      <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="note">
        Note, or the reason when you discard
        <textarea id="note" name="note" rows={3} maxLength={2000} className="rounded-lg border border-line bg-surface px-3 py-2 text-base font-normal" placeholder="For example: called back, visit set for Saturday" />
      </label>
      <div className="flex flex-wrap gap-2">
        {open && tier !== "red" && (
          <button name="action" value="approve" disabled={pending} className={`${btn} bg-accent text-accent-ink`}>
            Approve
          </button>
        )}
        {open && tier === "red" && (
          <button name="action" value="rescue" disabled={pending} className={`${btn} bg-accent text-accent-ink`}>
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
      <p className="text-xs text-ink-3">
        {tier === "red" ? "Red leads are never deleted. Rescue puts one back in play and creates its deal." : "Approve confirms the lead and makes sure it has a deal in HubSpot."} Every action is saved with who did it.
      </p>
      <div aria-live="polite">
        {state.error && <p role="alert" className="rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad-ink">{state.error}</p>}
        {state.message && <p className="rounded-lg bg-ok-bg px-3 py-2 text-sm text-ok-ink">{state.message}</p>}
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
      <button disabled={pending} className="h-8 rounded-md border border-line px-3 text-xs font-medium hover:bg-surface-2 disabled:opacity-50">
        {pending ? "Retrying…" : "Retry"}
      </button>
      <span aria-live="polite" className={`text-xs ${state.error ? "text-bad-ink" : "text-ok-ink"}`}>
        {state.error ?? state.message}
      </span>
    </form>
  );
}
