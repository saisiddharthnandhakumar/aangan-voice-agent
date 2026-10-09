#!/usr/bin/env bash
# A Green caller (T01-like): submit_assessment → check_availability → book_consult → book again (idempotent).
source "$(dirname "$0")/_common.sh"
CALL_MODE="${CALL_MODE:-webrtc}"   # webrtc marks the call is_test
R=$(post submit_assessment '{"call_id":"","call_mode":"'"$CALL_MODE"'","call_category":"enquiry","caller_name":"Curl Test","phone":null,"project_type":"home","scope_type":"full_home","bhk":3,"size_sqft":1400,"locality":"Kothrud","scope_summary":"Full redo of a 3BHK","completion_needed_by":"2027-03-01","timeline_text":"by March, no rush","criteria":{"real_project":{"status":"pass","evidence":"redo the whole thing"},"service_area":{"status":"pass","evidence":"Kothrud"},"timeline":{"status":"pass","evidence":"by March"},"budget":{"status":"pass","evidence":"not mentioned"},"decision_maker":{"status":"pass","evidence":"husband agrees"}},"flags":[]}')
echo "submit_assessment → $R"
REF=$(echo "$R" | sed -E 's/.*"call_id":"([A-Z0-9]+)".*/\1/')
S=$(post check_availability '{"call_id":"'"$REF"'","preferred_date":"'"$(date -v+1d +%F 2>/dev/null || date -d tomorrow +%F)"'","preferred_time_text":"morning","consult_type":"site_visit","days_to_search":3}')
echo "check_availability → $S"
SLOT=$(echo "$S" | sed -E 's/.*"start_iso":"([^"]+)".*/\1/' )
SLOT=$(echo "$S" | grep -o '"start_iso":"[^"]*"' | head -1 | cut -d'"' -f4)
B=$(post book_consult '{"call_id":"'"$REF"'","slot_start_iso":"'"$SLOT"'","consult_type":"site_visit","site_area":"Kothrud","caller_name":"Curl Test","phone":null,"email":null,"project_summary":"3BHK full redo"}')
echo "book_consult → $B"
echo "book_consult again → $(post book_consult '{"call_id":"'"$REF"'","slot_start_iso":"'"$SLOT"'","consult_type":"site_visit"}')"
