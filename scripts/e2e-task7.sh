#!/bin/bash
# Task 7 browser E2E v2: ref-based navigation + scoped dialog interaction
cd /home/z/my-project
( setsid nohup bun run dev > dev.log 2>&1 < /dev/null & disown ) >/dev/null 2>&1
for i in $(seq 1 40); do sleep 1; CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 4 http://localhost:3000/ 2>/dev/null); [ "$CODE" = "200" ] && { echo "server up in ${i}s"; break; }; done

FAILED=0
step() { echo; echo "== $1 =="; }
ok() { echo "  OK: $1"; }
fail() { echo "  FAIL: $1"; FAILED=1; }

ref_for() { # ref_for "Settings" -> e94 (from full snapshot; matches buttons and comboboxes)
  agent-browser snapshot -i 2>/dev/null | rg "(button|combobox) \"${1}" | head -1 | rg -o 'ref=[^]]+' | sed 's/ref=//;s/\]//'
}
click_named() {
  local r; r=$(ref_for "$1")
  [ -n "$r" ] && agent-browser click "@$r" >/dev/null 2>&1
}
ref_in_dialog() { # ref_in_dialog "Add service" -> first matching element inside role=dialog (prefix match)
  agent-browser snapshot -i -s "[role=dialog]" 2>/dev/null | rg "(button|textbox) \"${1}" | head -1 | rg -o 'ref=[^]]+' | sed 's/ref=//;s/\]//'
}
fill_in_dialog() { # fill_in_dialog "Code" "VALUE"  (prefix match on accessible name)
  local r; r=$(agent-browser snapshot -i -s "[role=dialog]" 2>/dev/null | rg "textbox \"${1}" | head -1 | rg -o 'ref=[^]]+' | sed 's/ref=//;s/\]//')
  [ -n "$r" ] && agent-browser fill "@$r" "$2" >/dev/null 2>&1
}
click_in_dialog() {
  local r; r=$(ref_in_dialog "$1")
  [ -n "$r" ] && agent-browser click "@$r" >/dev/null 2>&1
}

step "login flow (skip if session persisted)"
agent-browser open http://localhost:3000/ >/dev/null 2>&1; sleep 3
if agent-browser wait --text "Good day" --timeout 6000 >/dev/null 2>&1; then
  ok "already authenticated"
else
  agent-browser find label "Facility email" fill "eyeclinic@curavilo.demo" >/dev/null 2>&1 || fail "gate email"
  agent-browser find label "Password" fill "Demo1234!" >/dev/null 2>&1 || fail "gate password"
  agent-browser find role button click --name "Continue" >/dev/null 2>&1 || fail "gate continue"
  agent-browser wait --text "Access your staff account" --timeout 20000 >/dev/null 2>&1 || fail "staff screen"
  agent-browser find label "Email" fill "eyeclinic@curavilo.demo" >/dev/null 2>&1 || fail "staff email"
  agent-browser find label "Password" fill "Demo1234!" >/dev/null 2>&1 || fail "staff password"
  agent-browser find role button click --name "Sign in" >/dev/null 2>&1 || fail "staff sign in"
  sleep 4
  agent-browser wait --text "Lagos Central Eye Clinic" --timeout 20000 >/dev/null 2>&1 && ok "dashboard loaded" || fail "dashboard"
fi

step "navigate Settings (ref-based)"
click_named "Settings" && ok "clicked nav" || fail "nav settings"
agent-browser wait --text "Service profile & terminology" --timeout 15000 >/dev/null 2>&1 && ok "settings page" || { fail "settings page"; agent-browser snapshot -i 2>/dev/null | head -25; }

step "terminology edit: patient.plural -> Clients"
TP=$(agent-browser snapshot -i 2>/dev/null | rg "textbox \"patient.plural\"" | head -1 | rg -o 'ref=[^]]+' | sed 's/ref=//;s/\]//')
[ -n "$TP" ] && agent-browser fill "@$TP" "Clients" >/dev/null 2>&1 && ok "filled override" || fail "fill patient.plural"
click_named "Save terminology" && ok "clicked save" || fail "save terminology click"
agent-browser wait --text "labels now apply facility-wide" --timeout 15000 >/dev/null 2>&1 && ok "terminology saved" || fail "terminology toast"

step "terminology reflects on Patients page"
click_named "Patients" || fail "nav patients"
sleep 2
HEADING=$(agent-browser eval "document.querySelector('h1,h2')?.textContent ?? ''" 2>/dev/null | tail -1)
echo "  page heading: $HEADING"
echo "$HEADING" | rg -q "Clients" && ok "heading reflects override" || fail "heading override"

step "reset override back to Patients"
click_named "Settings" || fail "nav settings back"
agent-browser wait --text "Service profile & terminology" --timeout 15000 >/dev/null 2>&1
TP=$(agent-browser snapshot -i 2>/dev/null | rg "textbox \"patient.plural\"" | head -1 | rg -o 'ref=[^]]+' | sed 's/ref=//;s/\]//')
[ -n "$TP" ] && agent-browser fill "@$TP" "Patients" >/dev/null 2>&1 && ok "filled reset" || fail "fill reset"
click_named "Save terminology" && sleep 2 && ok "reset saved" || fail "reset save"

step "profile switch dialog (to General Practice and back)"
click_named "Service profile" && ok "opened select" || fail "open profile select"
sleep 1
agent-browser snapshot -i 2>/dev/null | rg "option \"General Practice\"" | head -1 | rg -o 'ref=[^]]+' | sed 's/ref=//;s/\]//' | xargs -I{} agent-browser click "@{}" >/dev/null 2>&1 || fail "pick option"
agent-browser wait --text "Switch service profile?" --timeout 10000 >/dev/null 2>&1 && ok "confirm dialog shown" || fail "confirm dialog"
click_named "Switch profile" || fail "confirm click"
agent-browser wait --text "Service profile switched" --timeout 15000 >/dev/null 2>&1 && ok "switched" || fail "switch toast"
sleep 1
click_named "Service profile" || true
sleep 1
agent-browser snapshot -i 2>/dev/null | rg "option \"Eye Clinic" | head -1 | rg -o 'ref=[^]]+' | sed 's/ref=//;s/\]//' | xargs -I{} agent-browser click "@{}" >/dev/null 2>&1 || fail "pick eye clinic"
sleep 1
click_named "Switch profile" || fail "confirm back click"
agent-browser wait --text "Service profile switched" --timeout 15000 >/dev/null 2>&1 && ok "switched back" || fail "switch back"

step "service catalogue: add service"
agent-browser press Escape >/dev/null 2>&1; sleep 1
click_named "Add service" && ok "clicked add" || fail "add service click"
agent-browser wait --text "New services become available" --timeout 10000 >/dev/null 2>&1 && ok "dialog open" || fail "add dialog"
fill_in_dialog "Code" "GLAUC-CARE" && ok "code" || fail "code fill"
fill_in_dialog "Service name" "Glaucoma Care Package" && ok "name" || fail "name fill"
fill_in_dialog "Price" "4500" && ok "price" || fail "price fill"
click_in_dialog "Add service" && ok "submitted" || fail "submit add"
agent-browser wait --text "added to the catalogue" --timeout 15000 >/dev/null 2>&1 && ok "service added" || fail "add toast"
agent-browser press Escape >/dev/null 2>&1; sleep 1

step "service catalogue: edit price via UI"
click_named "Edit Eye Consultation" && ok "clicked edit" || fail "edit click"
agent-browser wait --text "Price and detail changes apply" --timeout 10000 >/dev/null 2>&1 && ok "edit dialog" || fail "edit dialog"
fill_in_dialog "Price" "21000" && ok "price filled" || fail "edit price fill"
click_in_dialog "Save changes" && ok "saved" || fail "save changes click"
agent-browser wait --text "applies facility-wide" --timeout 15000 >/dev/null 2>&1 && ok "price updated" || fail "update toast"
agent-browser press Escape >/dev/null 2>&1; sleep 1

step "restore catalogue via API"
JAR=/tmp/cv3.txt; rm -f "$JAR"
curl -s -c "$JAR" -b "$JAR" -X POST http://localhost:3000/api/auth -H 'Content-Type: application/json' -d '{"action":"facility-login","email":"eyeclinic@curavilo.demo","password":"Demo1234!"}' -o /dev/null
curl -s -c "$JAR" -b "$JAR" -X POST http://localhost:3000/api/auth -H 'Content-Type: application/json' -d '{"action":"staff-login","email":"eyeclinic@curavilo.demo","password":"Demo1234!"}' -o /dev/null
CONS_ID=$(curl -s -b "$JAR" "http://localhost:3000/api/services?includeInactive=1" | python3 -c "import json,sys; d=json.load(sys.stdin); print([s['id'] for s in d['services'] if s['code']=='CONS-EYE'][0])")
curl -s -b "$JAR" -X PATCH http://localhost:3000/api/services -H 'Content-Type: application/json' -d "{\"id\":\"$CONS_ID\",\"priceMinor\":2000000}" -o /dev/null -w "  restore CONS-EYE price: %{http_code}\n"
TEST_ID=$(curl -s -b "$JAR" "http://localhost:3000/api/services?includeInactive=1" | python3 -c "import json,sys; d=json.load(sys.stdin); m=[s['id'] for s in d['services'] if s['code']=='GLAUC-CARE']; print(m[0] if m else '')")
[ -n "$TEST_ID" ] && curl -s -b "$JAR" -X PATCH http://localhost:3000/api/services -H 'Content-Type: application/json' -d "{\"id\":\"$TEST_ID\",\"active\":false}" -o /dev/null -w "  park GLAUC-CARE: %{http_code}\n"

step "AI assistant page"
click_named "AI Assistant" && ok "nav ai" || fail "nav ai"
agent-browser wait --text "Ask Curavilo AI" --timeout 15000 >/dev/null 2>&1 && ok "ai page" || { fail "ai page"; agent-browser snapshot -i 2>/dev/null | head -30; }
ORB=$(agent-browser eval "document.querySelectorAll('.curvilo-orb-ring').length" 2>/dev/null | tail -1)
echo "  orb elements: $ORB"
INP=$(agent-browser snapshot -i 2>/dev/null | rg "textbox \"Ask the AI assistant\"" | head -1 | rg -o 'ref=[^]]+' | sed 's/ref=//;s/\]//')
[ -n "$INP" ] && agent-browser fill "@$INP" "What is the first-line treatment for primary open-angle glaucoma?" >/dev/null 2>&1 && ok "question filled" || fail "fill question"
click_named "Send question" && ok "sent" || fail "send click"
agent-browser wait --text "Clinical decision support" --timeout 120000 >/dev/null 2>&1 && ok "clinical badge shown" || fail "clinical badge"
agent-browser wait --text "Sources" --timeout 30000 >/dev/null 2>&1 && ok "research sources shown" || fail "sources card"
agent-browser screenshot download/curavilo-ai-clinical.png >/dev/null 2>&1 && ok "screenshot ai"

step "reports page: CSV export"
click_named "Reports" && ok "nav reports" || fail "nav reports"
agent-browser wait --text "Revenue collected" --timeout 20000 >/dev/null 2>&1 && ok "revenue report" || { fail "report body"; agent-browser snapshot -i 2>/dev/null | head -25; }
click_named "Export as CSV" && ok "clicked csv" || fail "csv click"
agent-browser wait --text "CSV exported" --timeout 15000 >/dev/null 2>&1 && ok "csv exported" || fail "csv toast"
agent-browser screenshot download/curavilo-reports-export.png >/dev/null 2>&1 && ok "screenshot reports"

step "console + errors"
ERRS=$(agent-browser errors 2>/dev/null | rg -v "launched browser" | head -5)
CONS=$(agent-browser console 2>/dev/null | rg -i "error|warn" | rg -v "Download the React DevTools" | head -8)
if [ -z "$ERRS" ]; then ok "zero page errors"; else echo "$ERRS"; fail "page errors"; fi
if [ -z "$CONS" ]; then ok "zero console errors/warnings"; else echo "$CONS"; fi

agent-browser close >/dev/null 2>&1
echo; [ "$FAILED" = "0" ] && echo "E2E RESULT: ALL PASS" || echo "E2E RESULT: HAD FAILURES"
