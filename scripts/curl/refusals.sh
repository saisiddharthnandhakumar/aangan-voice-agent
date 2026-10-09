#!/usr/bin/env bash
# Red (Nashik), date-move, Amber booking refusal, bad secret and malformed input.
source "$(dirname "$0")/_common.sh"
echo "Red, Nashik → $(post submit_assessment '{"call_mode":"webrtc","call_category":"enquiry","project_type":"home","scope_type":"rooms","rooms_in_scope":2,"locality":"Nashik","criteria":{"real_project":{"status":"pass","evidence":"home office"},"service_area":{"status":"fail","evidence":"Nashik"}}}')"
echo "3-week deadline → $(post submit_assessment '{"call_mode":"webrtc","call_category":"enquiry","project_type":"home","scope_type":"rooms","rooms_in_scope":2,"locality":"Baner","completion_needed_by":"'"$(date -v+21d +%F 2>/dev/null || date -d '+21 days' +%F)"'","criteria":{"real_project":{"status":"pass","evidence":"x"},"service_area":{"status":"pass","evidence":"Baner"},"timeline":{"status":"fail","evidence":"before Diwali"}}}')"
A=$(post submit_assessment '{"call_mode":"webrtc","call_category":"enquiry","project_type":"home","scope_type":"full_home","bhk":2,"locality":"Wakad","criteria":{"real_project":{"status":"pass","evidence":"x"},"service_area":{"status":"pass","evidence":"Wakad"},"timeline":{"status":"unclear","evidence":"not sure"}}}')
echo "Amber → $A"
REF=$(echo "$A" | grep -o '"call_id":"[A-Z0-9]*"' | cut -d'"' -f4)
echo "book_consult on Amber → $(post book_consult '{"call_id":"'"$REF"'","slot_start_iso":"2030-01-07T04:30:00Z","consult_type":"site_visit"}')"
echo "Wrong secret → $(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/vaani/tools/submit_assessment" -H 'X-Tool-Secret: nope' -d '{}')"
echo "Malformed JSON → $(curl -sS -X POST "$BASE_URL/api/vaani/tools/submit_assessment" -H "X-Tool-Secret: $SECRET" -H 'Content-Type: application/json' -d '{not json')"
