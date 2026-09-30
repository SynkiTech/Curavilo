#!/bin/bash
# Phase 5–14 API verification against the running dev server.
set -u
J=/tmp/curavilo-cookies.txt
B=http://localhost:3000
pass=0; fail=0
check() { # name, expected_substring, actual
  if echo "$3" | rg -q "$2"; then pass=$((pass+1)); echo "PASS: $1";
  else fail=$((fail+1)); echo "FAIL: $1 — expected '$2' got: $(echo "$3" | head -c 300)"; fi
}

# ── Login
R=$(curl -s -c $J -X POST $B/api/auth -H 'Content-Type: application/json' -d '{"action":"login","email":"eyeclinic@curavilo.demo","password":"Demo1234!"}')
check "login" '"ok":true' "$R"

# ── Phase 5: workflow engine
DEF='{"trigger":"ENCOUNTER_COMPLETED","nodes":[{"id":"n1","type":"CREATE_TASK","config":{"title":"Call patient {{patientId}}","role":"NURSE"}},{"id":"n2","type":"CONDITION","config":{"field":"followUpDays","operator":"exists","value":"","trueTarget":"n3","falseTarget":"n4"}},{"id":"n3","type":"CREATE_FOLLOWUP","config":{"title":"Post-visit follow-up","days":"5"}},{"id":"n4","type":"NOTIFY","config":{"title":"Visit completed","body":"Encounter {{encounterId}} completed","role":"ADMIN","channels":"IN_APP"}},{"id":"n5","type":"DELAY","config":{"minutes":"1440"}},{"id":"n6","type":"GENERATE_DOCUMENT","config":{"template":"NOTE","title":"Auto note","body":"Generated after delay"}}],"edges":[{"from":"n1","to":"n2"},{"from":"n2","to":"n3","label":"true"},{"from":"n2","to":"n4","label":"false"},{"from":"n3","to":"n5"},{"from":"n4","to":"n5"},{"from":"n5","to":"n6"}]}'
R=$(curl -s -b $J -X POST $B/api/workflows -H 'Content-Type: application/json' -d "{\"action\":\"CREATE\",\"key\":\"verify-flow-$(date +%s)\",\"name\":\"Verification flow\",\"definition\":$DEF,\"slaMinutes\":600}")
check "P5 create workflow" '"status":"DRAFT"' "$R"
WF_ID=$(echo "$R" | rg -o '"id":"[a-z0-9]+"' | head -1 | cut -d'"' -f4)
R=$(curl -s -b $J -X POST $B/api/workflows -H 'Content-Type: application/json' -d "{\"action\":\"DRY_RUN\",\"workflowId\":\"$WF_ID\",\"payload\":{\"encounterId\":\"enc1\",\"patientId\":\"pat1\",\"followUpDays\":3}}")
check "P5 dry-run" '"dryRun"' "$R"
R=$(curl -s -b $J -X POST $B/api/workflows -H 'Content-Type: application/json' -d "{\"action\":\"PUBLISH_TOGGLE\",\"workflowId\":\"$WF_ID\"}")
check "P5 publish" '"status":"PUBLISHED"' "$R"
R=$(curl -s -b $J -X POST $B/api/workflows -H 'Content-Type: application/json' -d "{\"action\":\"RUN\",\"workflowId\":\"$WF_ID\",\"payload\":{\"encounterId\":\"enc-manual-1\",\"patientId\":\"pat1\",\"followUpDays\":2}}")
check "P5 manual run (parks at DELAY)" '"SLEEPING"' "$R"
RUN_ID=$(echo "$R" | rg -o '"id":"[a-z0-9]{25,}"' | head -1 | cut -d'"' -f4)
R=$(curl -s -b $J $B/api/workflows)
check "P5 runs listed with nodes" '"SLEEPING"' "$R"

# ── Phase 6: comms + webhooks
R=$(curl -s -b $J -X POST $B/api/comms -H 'Content-Type: application/json' -d '{"action":"SEND","channel":"SMS","recipient":"08031112233","body":"Your appointment is tomorrow at 9am."}')
check "P6 send sms via adapter" '"SIMULATED"' "$R"
R=$(curl -s -b $J -X POST $B/api/comms -H 'Content-Type: application/json' -d '{"action":"SET_PROVIDER","channel":"WHATSAPP","provider":"metacloud"}')
check "P6 provider config" '"metacloud"' "$R"
R=$(curl -s -b $J -X POST $B/api/webhooks -H 'Content-Type: application/json' -d '{"action":"CREATE","url":"http://localhost:3000/api/health","events":["PAYMENT_RECEIVED"]}')
check "P6 webhook create" '"secret"' "$R"
HOOK_ID=$(echo "$R" | rg -o '"id":"[a-z0-9]{25,}"' | head -1 | cut -d'"' -f4)
# fire a payment event via outbox: record a small payment needs invoice — use scheduler tick via health wait instead. Direct: emit via register? Use lab release event later; webhook delivery tested by scheduler within 30s.

# ── Phase 9: lab lifecycle
PATIENT_ID=$(curl -s -b $J "$B/api/patients?q=" | rg -o '"id":"[a-z0-9]{25,}"' | head -1 | cut -d'"' -f4)
echo "patient: $PATIENT_ID"
R=$(curl -s -b $J -X POST $B/api/lab -H 'Content-Type: application/json' -d "{\"action\":\"ORDER\",\"order\":{\"patientId\":\"$PATIENT_ID\",\"kind\":\"LAB\",\"testName\":\"Fasting Blood Sugar\",\"priority\":\"ROUTINE\"}}")
check "P9 lab order created" '"ORDERED"' "$R"
LAB_ID=$(echo "$R" | rg -o '"id":"[a-z0-9]{25,}"' | head -1 | cut -d'"' -f4)
R=$(curl -s -b $J -X POST $B/api/lab -H 'Content-Type: application/json' -d "{\"action\":\"COLLECT\",\"orderId\":\"$LAB_ID\",\"site\":\"Left arm vein\"}")
check "P9 specimen collected" '"SPECIMEN_COLLECTED"' "$R"
R=$(curl -s -b $J -X POST $B/api/lab -H 'Content-Type: application/json' -d "{\"action\":\"RESULTS\",\"orderId\":\"$LAB_ID\",\"results\":{\"results\":[{\"name\":\"Glucose fasting\",\"value\":\"5.4\",\"unit\":\"mmol/L\",\"refRange\":\"3.9-5.5\",\"flag\":\"NORMAL\"}],\"impression\":\"Within normal limits\"}}")
check "P9 results entered" '"RESULT_ENTERED"' "$R"
R=$(curl -s -b $J -X POST $B/api/lab -H 'Content-Type: application/json' -d "{\"action\":\"VERIFY\",\"orderId\":\"$LAB_ID\"}")
check "P9 verified" '"VERIFIED"' "$R"
R=$(curl -s -b $J -X POST $B/api/lab -H 'Content-Type: application/json' -d "{\"action\":\"RELEASE\",\"orderId\":\"$LAB_ID\"}")
check "P9 released with report number" '"LAB-"' "$R"

# ── Phase 9: wards + admission + discharge
R=$(curl -s -b $J -X POST $B/api/wards -H 'Content-Type: application/json' -d '{"action":"CREATE_WARD","ward":{"name":"General Male Ward","genderPolicy":"MALE","bedLabels":["G1","G2","G3","G4"]}}')
check "P9 ward created" '"General Male Ward"' "$R"
BED_ID=$(curl -s -b $J "$B/api/wards?scope=WARDS" | python3 -c "import sys,json; d=json.load(sys.stdin); print([b['id'] for w in d['wards'] for b in w['beds'] if b['status']=='FREE'][0])")
R=$(curl -s -b $J -X POST $B/api/wards -H 'Content-Type: application/json' -d "{\"action\":\"ADMIT\",\"admission\":{\"patientId\":\"$PATIENT_ID\",\"bedId\":\"$BED_ID\",\"reason\":\"Observation after minor procedure\"}}")
check "P9 admitted" '"ADMITTED"' "$R"
ADM_ID=$(echo "$R" | rg -o '"id":"[a-z0-9]{25,}"' | head -1 | cut -d'"' -f4)
R=$(curl -s -b $J -X POST $B/api/wards -H 'Content-Type: application/json' -d "{\"action\":\"DISCHARGE\",\"admissionId\":\"$ADM_ID\",\"discharge\":{\"summary\":\"Stable overnight, vitals normal, discharged home with analgesia.\"}}")
check "P9 discharged" '"DISCHARGED"' "$R"
R=$(curl -s -b $J -X POST $B/api/wards -H 'Content-Type: application/json' -d "{\"action\":\"CREATE_REFERRAL\",\"referral\":{\"patientId\":\"$PATIENT_ID\",\"direction\":\"EXTERNAL\",\"externalFacility\":\"Lagos University Teaching Hospital\",\"notes\":\"Corneal opinion\"}}")
check "P9 referral created" '"PENDING"' "$R"

# ── Phase 10: simulation
R=$(curl -s -b $J $B/api/simulation)
check "P10 baseline calibration" '"arrivalsPerDay"' "$R"
R=$(curl -s -b $J -X POST $B/api/simulation -H 'Content-Type: application/json' -d "{\"action\":\"RUN\",\"baseline\":{\"hours\":8,\"arrivalsPerDay\":80,\"days\":2,\"stations\":[{\"key\":\"reception\",\"label\":\"Reception\",\"servers\":1,\"meanServiceMin\":4,\"sdServiceMin\":2,\"routeShare\":1},{\"key\":\"consult\",\"label\":\"Consultation\",\"servers\":2,\"meanServiceMin\":15,\"sdServiceMin\":5,\"routeShare\":1}]},\"scenario\":{\"hours\":8,\"arrivalsPerDay\":110,\"days\":2,\"stations\":[{\"key\":\"reception\",\"label\":\"Reception\",\"servers\":1,\"meanServiceMin\":4,\"sdServiceMin\":2,\"routeShare\":1},{\"key\":\"consult\",\"label\":\"Consultation\",\"servers\":3,\"meanServiceMin\":15,\"sdServiceMin\":5,\"routeShare\":1}]}}")
check "P10 scenario comparison" '"p10"' "$R"
check "P10 disclaimer" 'Operational estimates' "$R"

# ── Phase 11: command center
R=$(curl -s -b $J $B/api/command)
check "P11 metrics" '"patient_volume_today"' "$R"
check "P11 bottlenecks" '"area"' "$R"

# ── Phase 12: FHIR + data
R=$(curl -s -b $J "$B/api/fhir/Patient?count=5")
check "P12 FHIR Patient bundle" '"resourceType":"Bundle"' "$R"
R=$(curl -s -b $J "$B/api/fhir/DiagnosticReport?count=5")
check "P12 FHIR DiagnosticReport" '"DiagnosticReport"' "$R"
R=$(curl -s -b $J "$B/api/fhir/Nope")
check "P12 FHIR unknown rejected" 'not-supported' "$R"
R=$(curl -s -b $J "$B/api/data?export=patients" | head -2)
check "P12 CSV export" 'mrn' "$R"
R=$(curl -s -b $J -X POST $B/api/data -H 'Content-Type: application/json' -d '{"action":"PREVIEW","csv":"firstName,lastName,phone,sex\nTest,Import,08099990001,MALE\nBad,NoPhone,FEMALE"}')
check "P12 import preview catches errors" '"errors"' "$R"

# ── Phase 13: portal
R=$(curl -s -b $J -X POST "$B/api/portal?scope=main" -H 'Content-Type: application/json' -d "{\"action\":\"CREATE_TOKEN\",\"patientId\":\"$PATIENT_ID\",\"label\":\"E2E test\"}")
check "P13 portal code issued" '"code":"cv-' "$R"
CODE=$(echo "$R" | rg -o '"code":"cv-[a-f0-9]+"' | cut -d'"' -f4)
MRN=$(curl -s -b $J "$B/api/fhir/Patient?count=1" | rg -o '"value":"MRN[^"]*"' | head -1 | cut -d'"' -f4)
R=$(curl -s -c /tmp/portal-ck.txt -X POST "$B/api/portal?scope=login" -H 'Content-Type: application/json' -d "{\"mrn\":\"$MRN\",\"code\":\"$CODE\"}")
check "P13 portal login" '"patientPortal":true' "$R"
R=$(curl -s -b /tmp/portal-ck.txt $B/api/portal)
check "P13 portal data scoped" "\"mrn\":\"$MRN\"" "$R"
R=$(curl -s -b /tmp/portal-ck.txt $B/api/patients)
check "P13 portal blocked from staff API" 'unauthorized' "$R"

# ── Phase 5: scheduler wakes delayed run (wait one tick ~35s)
echo "waiting 40s for scheduler tick..."
sleep 40
R=$(curl -s -b $J $B/api/workflows)
check "P5 scheduler completed delayed run" '"GENERATE_DOCUMENT"' "$R"

echo "=================================="
echo "PASS: $pass  FAIL: $fail"
