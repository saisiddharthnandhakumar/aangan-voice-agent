/** Demo rows are tagged by this vaani_call_id prefix so they can be found and removed (pnpm demo:purge). */
export const DEMO_PREFIX = "demo-";

export const isDemoCallId = (vaaniCallId: string | null | undefined): boolean => Boolean(vaaniCallId?.startsWith(DEMO_PREFIX));
