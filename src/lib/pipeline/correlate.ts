import type { CallRow } from "@/lib/tools/repo";

/**
 * Linking a Vaani call to the row its tool calls created (docs/PLATFORM_NOTES.md section 1.11).
 * Vaani has no call-ID variable, so submit_assessment creates its own row (call_ref, no
 * vaani_call_id). The webhook row is matched to it by time: the tool row must have been created
 * between the call's start − 2 min and its end + 2 min, and must not belong to a different
 * phone number when both numbers are known. Exactly one candidate → merge. More than one, and
 * no single phone match → ambiguous: nothing is merged and the call is flagged for manual linking.
 */

export const MERGE_SLACK_MS = 2 * 60_000;

export function callWindow(stub: Pick<CallRow, "startedAt" | "endedAt" | "durationSeconds">, now: Date): { from: Date; to: Date } {
  const end = stub.endedAt ?? now;
  const start = stub.startedAt ?? new Date(end.getTime() - (stub.durationSeconds ?? 15 * 60) * 1000);
  return { from: new Date(start.getTime() - MERGE_SLACK_MS), to: new Date(end.getTime() + MERGE_SLACK_MS) };
}

export type MergeDecision = { kind: "none" } | { kind: "merge"; toolRowId: string } | { kind: "ambiguous"; candidateIds: string[] };

export function pickMergeCandidate(
  stub: Pick<CallRow, "id" | "fromNumber" | "startedAt" | "endedAt" | "durationSeconds">,
  candidates: readonly CallRow[],
  now: Date,
): MergeDecision {
  const { from, to } = callWindow(stub, now);
  const eligible = candidates.filter(
    (c) =>
      c.id !== stub.id &&
      c.callRef !== null &&
      c.vaaniCallId === null &&
      c.status === "in_call" &&
      c.createdAt.getTime() >= from.getTime() &&
      c.createdAt.getTime() <= to.getTime() &&
      !(stub.fromNumber && c.fromNumber && c.fromNumber !== stub.fromNumber),
  );
  if (eligible.length === 0) return { kind: "none" };
  if (eligible.length === 1) return { kind: "merge", toolRowId: eligible[0].id };
  const samePhone = stub.fromNumber ? eligible.filter((c) => c.fromNumber === stub.fromNumber) : [];
  if (samePhone.length === 1) return { kind: "merge", toolRowId: samePhone[0].id };
  return { kind: "ambiguous", candidateIds: eligible.map((c) => c.id) };
}
