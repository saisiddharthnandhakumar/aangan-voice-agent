# HubSpot setup (Free CRM)

Every non-test call is logged: a **contact** (matched by phone, or an "Unknown caller" contact when there is no number), a **call record**, and, for Green and Amber leads, a **deal**. Red leads get a deal only if a designer presses Rescue.

HubSpot Free limits that shape this build: **10 custom properties in total** (we use 8), **no custom deal pipeline** (we use the default one), and **1,000 contacts**. At roughly 200 calls a month, with repeat callers sharing a contact, the contact limit fills in about 5 months: plan to clean up or upgrade before then.

## 1. Create the credential: a service key

Newer HubSpot accounts no longer offer legacy private apps ("Legacy apps aren't available on this account"). Use a **service key** instead: it is a Bearer token with the same object scopes, limited to the REST API, which is exactly what this build needs. (Menu wording may differ slightly in your account.)

1. HubSpot → **Development** (left menu) → **Legacy Apps** page → click **Create a service key**. Or **Development → Keys → Service keys → Create**. You need to be a super admin or have developer tools access.
2. Name it "Aangan voice agent".
3. Tick these scopes: `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.objects.deals.read`, `crm.objects.deals.write`, `crm.schemas.contacts.read`, `crm.schemas.contacts.write`, `crm.schemas.deals.read`. (Call records are covered by the contacts write scope.)
4. Create it and **copy the key** (HubSpot may show it only once). Do not paste it into chat or a website. With the key still on your clipboard, add it to the local env file without displaying it:

   ```bash
   cd "/Users/saisiddharthnandhakumar/Documents/Mesa/Aangan Design Studio for Vaani Voice AI" && printf 'HUBSPOT_ACCESS_TOKEN=%s\n' "$(pbpaste)" >> .env.local && pbcopy < /dev/null && echo "added (not shown); clipboard cleared"
   ```

   Later, paste it into Vercel (Settings → Environment Variables → Production, name `HUBSPOT_ACCESS_TOKEN`) by copying it from HubSpot again, or with `pnpm secrets:copy HUBSPOT_ACCESS_TOKEN`.
5. Set `HUBSPOT_PORTAL_ID` to your account ID: the number in HubSpot page URLs (`app.hubspot.com/contacts/<this number>/…`). It is not a secret.

The key has a 7-day rotation grace period if you ever rotate it. Availability on the Free plan is shown by your screenshot: the button exists.

## 2. Create the properties and find the pipeline

```bash
pnpm hubspot:setup --write
```

It is safe to run twice. It:

- creates the property group "Aangan voice agent" and eight contact properties (`aangan_status`, `aangan_tier`, `aangan_priority`, `aangan_last_call_at`, `aangan_call_count`, `aangan_locality`, `aangan_consult_at`, `aangan_dashboard_url`), skipping any that exist;
- reads your default deal pipeline and maps our stages onto it, printing the mapping, for example "Consultation booked → Appointment Scheduled", "Awaiting designer → Qualified To Buy", "Lost → Closed Lost";
- with `--write`, writes `HUBSPOT_PIPELINE_ID`, `HUBSPOT_STAGE_BOOKED`, `HUBSPOT_STAGE_AWAITING`, `HUBSPOT_STAGE_LOST` into `.env.local`.

The stage IDs are not secrets. Copy those four lines and `HUBSPOT_ACCESS_TOKEN`, `HUBSPOT_PORTAL_ID` into Vercel (Production) and redeploy. If a mapping is wrong, edit the stage ID in the env file. On a paid plan, `--full` adds the six extra properties from the PRD.

## 3. Build the three views by hand

HubSpot cannot create saved views through the API we use, so do these once. Menu names may differ slightly.

**a. Contact view "Aangan voice leads"**
1. **CRM → Contacts**. Click **Add view** → **Create new view**, name it "Aangan voice leads", set it to private or team as you like.
2. **Advanced filters** → add a filter on **Aangan last call at** → **is known**. Apply.
3. **Edit columns**: Name, Phone, **Aangan tier**, **Aangan status**, **Aangan priority**, **Aangan locality**, **Aangan last call at**, **Aangan consultation at**, **Aangan call count**, **Aangan dashboard URL**.
4. Sort by **Aangan last call at**, newest first. **Save view**.

**b. The Calls list**
1. **CRM → Calls** (under Sales or the CRM menu). **Add view** → **Create new view**, name it "Aangan voice calls".
2. Filter **Call title** → **contains** → "Aangan voice enquiry". The title ends with the tier (Green, Amber or Red) and the call reference.
3. Columns: Call title, Contact, Call duration, Call from number, Created date. Open any call to see the summary, criteria and dashboard link in its notes. Save.

**c. The deals board**
1. **CRM → Deals**, switch to **Board** view, choose the default pipeline.
2. Columns are the stages: **Appointment Scheduled** holds booked consultations, **Qualified To Buy** holds leads awaiting a designer, **Closed Lost** holds discarded leads.
3. **Card properties**: Deal name, Amount (an estimate, see the deal description), Contact. Save as "Aangan enquiries board".

## What the CRM shows

- `aangan_tier` reads Green, Amber, Red or Not rated; `aangan_status` reads Booked, Awaiting designer, Unqualified verified, Dropped, Escalated, Not an enquiry, Approved, Rescued or Discarded. The latest call sets both.
- Deal amounts are **estimates** from the call, labelled so in the deal description (or " (estimate)" in the name if HubSpot rejects the description). No studio pricing is ever written to HubSpot, and the caller's budget words are left out of call notes.
- Full transcripts stay in the dashboard database; HubSpot gets the summary and a link.

## Demo data in HubSpot (optional)

`pnpm db:seed` never touches HubSpot. To fill the CRM for a demo, run the loader against the database that holds the demo calls (`--env-file=` picks the env file, default `.env.local`; it needs `DATABASE_URL`, `HUBSPOT_ACCESS_TOKEN` and the `HUBSPOT_STAGE_*` IDs):

```bash
pnpm demo:hubspot                 # dry run: lists what it would create, writes nothing
pnpm demo:hubspot --yes           # does it (default 45 contacts; --limit=N, never more than 50)
pnpm demo:purge --hubspot         # archives the HubSpot deals, call records and contacts, then removes the database rows
```

- It uses the normal pipeline functions, so Green and Amber calls (and calls a designer rescued) get a contact, a call record and a deal; Red calls get a contact and a call record only. It sleeps 1.5 s between calls to stay under the rate limits and skips any call that already has a HubSpot ID, so a second run creates nothing. If a call fails half way it keeps its IDs and is skipped next time; archive and re-seed to retry it.
- Demo records are recognisable: fictional names, an `@example.com` email (`demo-NNNNN@example.com`, standard `email` property), phone numbers in the fake `+9199999NNNNN` range, and deal names ending "(DEMO)". No custom property is invented.
- The HubSpot IDs are stored on the demo call rows. `pnpm demo:purge` without `--hubspot` removes only the database rows, leaving the HubSpot objects with no record of their IDs: it prints a reminder, so use `--hubspot` first. Archiving uses `DELETE /crm/v3/objects/{type}/{id}`.
- UNVERIFIED: the archive calls and the loader have only run against in-memory test doubles, not a live account.
