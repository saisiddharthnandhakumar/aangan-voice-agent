"use client";

import { useActionState } from "react";
import { reviewAction, type ActionState } from "./actions";

/**
 * A Green or Amber lead is active from the start, so there is nothing to approve. A designer can log a
 * call-back, add a note, or cancel the lead (a reason is required). Rescue stays for Red leads, which the
 * agent declined and which are never deleted.
 */
export function ReviewForm({ callId, tier, reviewState }: { callId: string; tier: "green" | "amber" | "red" | null; reviewState: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(reviewAction, {});
  const open = reviewState === "none";
  const btn = "min-h-12 rounded-lg px-5 text-base font-semibold disabled:opacity-50";
  const quiet = `${btn} border border-line bg-surface hover:bg-surface-2`;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="callId" value={callId} />
      <p className="text-base text-ink-2">
        {reviewState === "discarded"
          ? "This lead is cancelled. The reason is in the history below."
          : tier === "red"
            ? "Declined kindly by the agent. Red leads are never deleted."
            : "This lead is active. Nothing needs approving."}
      </p>
      <label className="flex flex-col gap-1.5 text-base font-semibold" htmlFor="note">
        Note (required to cancel)
        <textarea id="note" name="note" rows={3} maxLength={2000} className="rounded-lg border border-line bg-bg px-3 py-2 text-base font-normal" placeholder="For example: visit set for Saturday" />
      </label>
      <div className="flex flex-wrap gap-2">
        <button name="action" value="callback" disabled={pending} className={quiet}>
          Log a call-back
        </button>
        <button name="action" value="note" disabled={pending} className={quiet}>
          Add note
        </button>
        {open && tier === "red" && (
          <button name="action" value="rescue" disabled={pending} className={`${btn} bg-accent text-accent-ink hover:opacity-90`}>
            Rescue
          </button>
        )}
      </div>
      {tier === "red" && open && <p className="text-[13px] text-ink-3">Rescue puts a Red lead back in play and creates its deal.</p>}
      {reviewState !== "discarded" && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <button name="action" value="discard" disabled={pending} className={`${btn} self-start border border-[var(--bad-ink)] bg-surface text-bad-ink hover:bg-bad-bg`}>
            Cancel this lead
          </button>
          <p className="text-[13px] text-ink-3">
            Write the reason in the note first. Cancelling moves the HubSpot deal to Lost and keeps all data. It does not cancel the design call in Cal.com: do that there if needed.
          </p>
        </div>
      )}
      <p className="text-[13px] text-ink-3">Every action is saved with who did it.</p>
      <div aria-live="polite">
        {state.error && <p role="alert" className="rounded-lg bg-bad-bg px-3 py-2 text-base text-bad-ink">{state.error}</p>}
        {state.message && <p className="rounded-lg bg-ok-bg px-3 py-2 text-base text-ok-ink">{state.message}</p>}
      </div>
    </form>
  );
}
