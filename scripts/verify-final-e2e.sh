#!/bin/bash
# Final E2E: workflow with real patient FKs + webhook delivery via payment event
set -u
J=/tmp/curavilo-cookies2.txt
B=http://localhost:3000
curl -s -c $J -X POST $B/api/auth -H 'Content-Type: application/json' -d '{"action":"login","email":"eyeclinic@curavilo.demo","password":"Demo1234!"}' > /dev/null

PATIENT_ID=$(curl -s -b $J "$B/api/patients?q=" | python3 -c "import sys,json; print(json.load(sys.stdin)['patients'][0]['id'])")
echo "real patient: $PATIENT_ID"

# ── Full outpatient flow with REAL patient id: task → follow-up → notify → delay 1min → document
DEF='{"trigger":"MANUAL","nodes":[{"id":"s1","type":"CREATE_TASK","config":{"title":"Prep chart for {{patientName}}","role":"NURSE"}},{"id":"s2","type":"CREATE_FOLLOWUP","config":{"title":"Post-visit check","days":"3"}},{"id":"s3","type":"NOTIFY","config":{"title":"Flow progressing","body":"Follow-up created","role":"ADMIN","channels":"IN_APP"}},{"id":"s4","type":"DELAY","config":{"minutes":"1"}},{"id":"s5","type":"GENERATE_DOCUMENT","config":{"template":"NOTE","title":"Delay completed note","body":"Automated doc"}}],"edges":[{"from":"s1","to":"s2"},{"from":"s2","to":"s3"},{"from":"s3","to":"s4"},{"from":"s4","to":"s5"}]}'
R=$(curl -s -b $J -X POST $B/api/workflows -H 'Content-Type: application/json' -d "{\"action\":\"CREATE\",\"key\":\"final-flow-$(date +%s)\",\"name\":\"Final E2E flow\",\"definition\":$DEF}")
WF_ID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['workflow']['id'])")
curl -s -b $J -X POST $B/api/workflows -H 'Content-Type: application/json' -d "{\"action\":\"PUBLISH_TOGGLE\",\"workflowId\":\"$WF_ID\"}" > /dev/null
R=$(curl -s -b $J -X POST $B/api/workflows -H 'Content-Type: application/json' -d "{\"action\":\"RUN\",\"workflowId\":\"$WF_ID\",\"payload\":{\"patientId\":\"$PATIENT_ID\",\"patientName\":\"Test\",\"encounterId\":null}}")
RUN_ID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['run']['id'])")
echo "started run $RUN_ID (should park at 1-minute DELAY s4)"
curl -s -b $J $B/api/workflows | python3 -c "
import sys, json
d = json.load(sys.stdin)
r = next(x for x in d['runs'] if x['id'] == '$RUN_ID')
print('parked run nodes:', [(n['nodeKey'], n['status']) for n in r['nodes']])
"

# ── Record a payment on an unpaid invoice to fire PAYMENT_RECEIVED
INVOICE=$(curl -s -b $J "$B/api/invoices?status=ISSUED" | python3 -c "
import sys, json
d = json.load(sys.stdin)
inv = next((i for i in d['invoices'] if i['status'] in ('ISSUED','PARTIALLY_PAID')), None)
print(inv['id'] if inv else '')")
echo "invoice: $INVOICE"
if [ -n "$INVOICE" ]; then
  R=$(curl -s -b $J -X POST "$B/api/invoices" -H 'Content-Type: application/json' -d "{\"action\":\"PAY\",\"invoiceId\":\"$INVOICE\",\"payment\":{\"method\":\"CASH\",\"amountMinor\":100,\"idempotencyKey\":\"e2e-pay-$(date +%s)\"}}")
  echo "payment: $(echo $R | head -c 120)"
fi

echo "waiting 45s for scheduler ticks (wake DELAY + deliver webhook)..."
sleep 45

echo "── final run state:"
curl -s -b $J $B/api/workflows | python3 -c "
import sys, json
d = json.load(sys.stdin)
r = next(x for x in d['runs'] if x['id'] == '$RUN_ID')
print('status:', r['status'])
for n in r['nodes']:
    print('  ', n['nodeKey'], n['type'], n['status'], (n.get('output') or '')[:60])
"
echo "── webhook deliveries:"
curl -s -b $J $B/api/webhooks | python3 -c "
import sys, json
d = json.load(sys.stdin)
for x in d['deliveries'][:4]:
    print(' ', x['eventType'], x['status'], 'attempts:', x['attempts'], 'response:', x.get('responseStatus'))
"
