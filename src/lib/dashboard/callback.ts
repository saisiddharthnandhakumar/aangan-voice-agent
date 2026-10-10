/**
 * A logged call-back is stored as an ordinary review note starting with this text, so it shows in the
 * review history and needs no schema change. Queries match on the prefix to stop a dropped or escalated
 * lead from asking for attention once someone has phoned back.
 */
export const CALLBACK_PREFIX = "Called back";

export const callbackNote = (extra?: string): string => {
  const t = (extra ?? "").trim();
  return t ? `${CALLBACK_PREFIX}: ${t}` : CALLBACK_PREFIX;
};

export const isCallbackNote = (note: string | null | undefined): boolean => !!note && note.startsWith(CALLBACK_PREFIX);

/** Digits and a leading plus only, for a tel: link. Null when there is nothing dialable. */
export function dialable(n: string | null | undefined): string | null {
  const d = (n ?? "").replace(/[^\d+]/g, "");
  return d.replace(/\D/g, "").length >= 6 ? d : null;
}
