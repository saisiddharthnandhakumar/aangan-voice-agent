# HubSpot setup (Free CRM)

Every non-test call is logged: a **contact** (matched by phone, or an "Unknown caller" contact when there is no number), a **call record**, and, for Green and Amber leads, a **deal**. Red leads get a deal only if a designer presses Rescue.

HubSpot Free limits that shape this build: **10 custom properties in total** (we use 8), **no custom deal pipeline** (we use the default one), and **1,000 contacts**. At roughly 200 calls a month, with repeat callers sharing a contact, the contact limit fills in about 5 months: plan to clean up or upgrade before then.

## 1. Create the credential, **before 2026-10-26**

New "legacy private apps" can no longer be created after 2026-10-26 on accounts older than 2026-09-28. Do this first.

1. HubSpot → **Development** → **Legacy apps** → **Create legacy app** → **Private**. (Super admin only. The menu wording may differ in your account.)
2. Name it "Aangan voice agent".
3. **Scopes** tab, tick: `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.objects.deals.read`, `crm.objects.deals.write`, `crm.schemas.contacts.read`, `crm.schemas.contacts.write`, `crm.schemas.deals.read`. (Call records are covered by the contacts write scope.)
4. Create the app and copy the **access token**. Put it only in `.env.local` as `HUBSPOT_ACCESS_TOKEN=…`, and later in Vercel. Never paste it into a chat or website.
5. Also set `HUBSPOT_PORTAL_ID` to your account ID (the number in HubSpot URLs, `app.hubspot.com/contacts/<this number>/…`).

If you prefer the newer **Service key** (Development → Keys → Service keys), it works the same way with the same scopes; its availability on Free is unconfirmed.

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
