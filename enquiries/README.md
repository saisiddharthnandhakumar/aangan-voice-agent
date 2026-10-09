# September 2026 enquiries (test data only)

40 anonymised enquiries from `_source/Aangan_Sep 2026_Enquiries.pdf`, one file each:
T01–T20 phone calls (the build scope), W01–W10 WhatsApp threads, F01–F10 web forms.

- `expected_tiers.csv` holds the draft labels from PRD section 5. Nikhil corrects them.
- Each file's header gives the enquiry date. `pnpm eval` treats that date as "today" for the timeline rules.
- **Never insert these into the database as real calls** (PRD section 5, Testing).
