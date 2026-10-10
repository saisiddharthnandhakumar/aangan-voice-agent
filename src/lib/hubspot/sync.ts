import { nationalNumber } from "@/lib/phone";
import type { PipelineRepo } from "@/lib/pipeline/repo";
import type { CallRow } from "@/lib/tools/repo";
import { HubspotError, type HubspotApi } from "./client";
import { callRecordProperties, contactProperties, dealName, dealStage, newContactProperties, wantsDeal, type HubspotIds } from "./mapping";

/**
 * Logging a call to HubSpot (PRD "HubSpot logging"). Every non-test call gets a contact and a call
 * record; Green and Amber calls get a deal (Red only on Rescue; see wantsDeal). IDs are stored on the
 * call row and checked before any create, so a retry never duplicates (AT9). A repeat caller shares one
 * contact (matched through our own database first, then HubSpot search) and one deal (AT15); an
 * unknown caller always gets a fresh "Unknown caller" contact and is never merged (AT20).
 *
 * UNVERIFIED against a live account: the phone search property names, the v4 default-association path
 * and the deal `description` property (see client.ts). Until a token exists these run only in tests.
 */

export interface HubspotCtx {
  api: HubspotApi;
  ids: HubspotIds;
  repo: Pick<
    PipelineRepo,
    "getCall" | "updateCall" | "getBookingForCall" | "findContactIdByNumber" | "findDealIdByContact" | "countCallsFromNumber"
  >;
  appBaseUrl?: string;
}

async function ensureContact(call: CallRow, ctx: HubspotCtx): Promise<{ id: string; created: boolean }> {
  if (call.hubspotContactId) return { id: call.hubspotContactId, created: false };
  let id: string | null = null;
  if (call.repeatOfCallId) id = (await ctx.repo.getCall(call.repeatOfCallId))?.hubspotContactId ?? null;
  if (!id && call.fromNumber) id = await ctx.repo.findContactIdByNumber(call.fromNumber, call.id);
  if (!id && call.fromNumber) id = await ctx.api.findContactByPhone(nationalNumber(call.fromNumber), call.fromNumber);
  let created = false;
  if (!id) {
    id = await ctx.api.createContact(newContactProperties(call));
    created = true;
  }
  await ctx.repo.updateCall(call.id, { hubspotContactId: id });
  return { id, created };
}

async function updateContactStatus(call: CallRow, contactId: string, ctx: HubspotCtx): Promise<void> {
  const booking = await ctx.repo.getBookingForCall(call.id);
  const callCount = call.fromNumber ? await ctx.repo.countCallsFromNumber(call.fromNumber) : 1;
  await ctx.api.updateContact(contactId, contactProperties(call, booking, { callCount: Math.max(1, callCount) }, ctx.appBaseUrl));
}

/** Step hubspot_log: contact (find or create), its status properties, and the call record. */
export async function logCallToHubspot(callId: string, ctx: HubspotCtx): Promise<{ contactId: string; callRecordId: string; contactCreated: boolean; callRecordCreated: boolean }> {
  let call = (await ctx.repo.getCall(callId)) as CallRow;
  const { id: contactId, created } = await ensureContact(call, ctx);
  call = (await ctx.repo.getCall(callId)) as CallRow;
  await updateContactStatus(call, contactId, ctx);

  if (call.hubspotCallId) return { contactId, callRecordId: call.hubspotCallId, contactCreated: created, callRecordCreated: false };
  const booking = await ctx.repo.getBookingForCall(call.id);
  const recordId = await ctx.api.createCall(callRecordProperties(call, booking, ctx.appBaseUrl), contactId);
  await ctx.repo.updateCall(call.id, { hubspotCallId: recordId });
  return { contactId, callRecordId: recordId, contactCreated: created, callRecordCreated: true };
}

export type DealResult = "created" | "updated" | "none";

/** Step hubspot_deal: apply the deal rules for this call (create, move stage, or leave alone). */
export async function syncDeal(callId: string, ctx: HubspotCtx): Promise<DealResult> {
  const call = (await ctx.repo.getCall(callId)) as CallRow;
  if (!call.hubspotContactId) throw new Error("no HubSpot contact yet: run hubspot_log first");
  const booking = await ctx.repo.getBookingForCall(call.id);

  let dealId = call.hubspotDealId;
  if (!dealId && call.repeatOfCallId) dealId = (await ctx.repo.getCall(call.repeatOfCallId))?.hubspotDealId ?? null;
  if (!dealId) dealId = await ctx.repo.findDealIdByContact(call.hubspotContactId, call.id);

  const stage = dealStage(call, booking, ctx.ids);
  let result: DealResult = "none";

  if (dealId) {
    // One lead, one deal: later calls from the same contact move the existing deal, never add one.
    // A later call on a shared deal may move it forward (booked) or to Lost (discard), never back to "awaiting".
    const own = call.hubspotDealId === dealId;
    if (stage && (own || stage === ctx.ids.stageLost || booking?.status === "accepted")) {
      await ctx.api.updateDeal(dealId, { dealstage: stage, pipeline: ctx.ids.pipelineId });
    }
    result = "updated";
  } else if (wantsDeal(call)) {
    if (!stage) throw new Error("HubSpot stage IDs are not set: run pnpm hubspot:setup and add them to the environment");
    dealId = await createDealWithFallback(call, stage, ctx);
    await ctx.api.associate("deals", dealId, "contacts", call.hubspotContactId);
    result = "created";
  }
  if (!dealId) return "none";
  if (call.hubspotDealId !== dealId) await ctx.repo.updateCall(call.id, { hubspotDealId: dealId });
  if (call.hubspotCallId) await ctx.api.associate("calls", call.hubspotCallId, "deals", dealId);
  return result;
}

/** The deal's description labels the amount an estimate; if HubSpot rejects the property, the name carries the label. */
async function createDealWithFallback(call: CallRow, stage: string, ctx: HubspotCtx): Promise<string> {
  const base = { dealname: dealName(call), dealstage: stage, pipeline: ctx.ids.pipelineId, ...(call.estimatedValueInr != null ? { amount: call.estimatedValueInr } : {}) };
  try {
    return await ctx.api.createDeal({ ...base, description: "Amount is an estimate from the voice call, not a quote." });
  } catch (err) {
    if (!(err instanceof HubspotError) || err.status !== 400) throw err;
    return ctx.api.createDeal({ ...base, dealname: `${base.dealname} (estimate)` });
  }
}

/**
 * A designer's Approve, Rescue or Discard (dashboard, Phase 6) synced to HubSpot: the contact's status
 * follows the decision; Approve and Rescue make sure a deal exists; Discard moves an existing deal to
 * Lost and never creates one. Expects the call row to already carry the new review_state.
 */
export async function syncReviewDecision(callId: string, ctx: HubspotCtx): Promise<{ deal: DealResult }> {
  const call = (await ctx.repo.getCall(callId)) as CallRow;
  if (call.isTest) return { deal: "none" };
  const { id } = await ensureContact(call, ctx);
  await updateContactStatus((await ctx.repo.getCall(callId)) as CallRow, id, ctx);
  return { deal: await syncDeal(callId, ctx) };
}
