#!/bin/bash
# Task 8 API verification: AI-mediated intra-facility staff messaging.
# Flow: optometrist asks AI to notify the receptionist -> proposal -> confirm
# -> receptionist inbox (GET /api/notifications) shows the message -> mark read.
set -e
BASE=http://localhost:3000
OPT=/tmp/cv-opt.txt
REC=/tmp/cv-rec.txt
rm -f "$OPT" "$REC"

echo "== 1. Facility gate (eye clinic) =="
curl -s -c "$OPT" -b "$OPT" -X POST "$BASE/api/auth" -H 'Content-Type: application/json' \
  -d '{"action":"facility-login","email":"eyeclinic@curavilo.demo","password":"Demo1234!"}' | head -c 120; echo

echo "== 2. Staff login: optometrist =="
curl -s -c "$OPT" -b "$OPT" -X POST "$BASE/api/auth" -H 'Content-Type: application/json' \
  -d '{"action":"staff-login","email":"optometrist@curavilo.demo","password":"Demo1234!"}' | head -c 80; echo
curl -s -b "$OPT" "$BASE/api/auth" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('user:', d['user']['name'], '| role:', d['user']['role'])
"

echo "== 3. AI: notify the receptionist (expect staff.directory + send_staff_message proposal) =="
AIRES=$(curl -s -b "$OPT" -X POST "$BASE/api/ai" -H 'Content-Type: application/json' \
  -d '{"conversationId":null,"message":"Notify the receptionist that I am ready to take up patients now"}')
echo "$AIRES" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('toolName:', d.get('toolName'))
print('usedTool:', d.get('usedTool'))
pa=d.get('pendingAction')
print('pendingAction:', json.dumps(pa) if pa else None)
print('answer:', (d.get('answer') or '')[:400])
"

echo "== 4. Confirm the send_staff_message action =="
PARAMS=$(echo "$AIRES" | python3 -c "
import json,sys
d=json.load(sys.stdin)
pa=d.get('pendingAction') or {}
print(json.dumps({'action':pa.get('name','send_staff_message'),'params':pa.get('params',{})}))
")
curl -s -b "$OPT" -X POST "$BASE/api/ai/act" -H 'Content-Type: application/json' -d "$PARAMS" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('act result:', d.get('message') or d)
"

echo "== 5. Receptionist session (separate jar) =="
curl -s -c "$REC" -b "$REC" -X POST "$BASE/api/auth" -H 'Content-Type: application/json' \
  -d '{"action":"facility-login","email":"eyeclinic@curavilo.demo","password":"Demo1234!"}' > /dev/null
curl -s -c "$REC" -b "$REC" -X POST "$BASE/api/auth" -H 'Content-Type: application/json' \
  -d '{"action":"staff-login","email":"reception@curavilo.demo","password":"Demo1234!"}' | head -c 80; echo
curl -s -b "$REC" "$BASE/api/auth" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('user:', d['user']['name'], '| role:', d['user']['role'])
"

echo "== 6. Receptionist inbox (expect the message, unread) =="
INBOX=$(curl -s -b "$REC" "$BASE/api/notifications")
echo "$INBOX" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('unread:', d['unread'])
for n in d['notifications'][:3]:
    print('-', n['type'], '|', n['title'], '|', (n['body'] or '')[:90], '| read:', bool(n['readAt']))
import sys as s
first=d['notifications'][0]['id'] if d['notifications'] else ''
print(first)
" | tee /tmp/inbox_info.txt
NID=$(tail -1 /tmp/inbox_info.txt)

echo "== 7. Optometrist inbox should NOT contain the receptionist's message =="
curl -s -b "$OPT" "$BASE/api/notifications" | python3 -c "
import json,sys
d=json.load(sys.stdin)
ids=[n['id'] for n in d['notifications']]
target='$NID'
print('leak:' , target in ids, '| unread:', d['unread'])
"

echo "== 8. Mark read + MARK_ALL_READ =="
curl -s -b "$REC" -X POST "$BASE/api/notifications" -H 'Content-Type: application/json' \
  -d "{\"action\":\"MARK_READ\",\"id\":\"$NID\"}" | head -c 80; echo
curl -s -b "$REC" "$BASE/api/notifications" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('unread after MARK_READ:', d['unread'])
"

echo "== 9. AI directory question (staff.directory as data tool) =="
curl -s -b "$OPT" -X POST "$BASE/api/ai" -H 'Content-Type: application/json' \
  -d '{"conversationId":null,"message":"Who is on the front desk team?"}' | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('toolName:', d.get('toolName'))
print('answer:', (d.get('answer') or '')[:300])
"

echo "== 10. Communications log (source AI) - owner check =="
curl -s -c /tmp/cv-owner.txt -b /tmp/cv-owner.txt -X POST "$BASE/api/auth" -H 'Content-Type: application/json' \
  -d '{"action":"facility-login","email":"eyeclinic@curavilo.demo","password":"Demo1234!"}' > /dev/null
curl -s -c /tmp/cv-owner.txt -b /tmp/cv-owner.txt -X POST "$BASE/api/auth" -H 'Content-Type: application/json' \
  -d '{"action":"staff-login","email":"eyeclinic@curavilo.demo","password":"Demo1234!"}' > /dev/null
curl -s -b /tmp/cv-owner.txt "$BASE/api/comms" | python3 -c "
import json,sys
d=json.load(sys.stdin)
msgs=[m for m in d['messages'] if m.get('type')=='STAFF_MESSAGE']
print('STAFF_MESSAGE log rows:', len(msgs))
for m in msgs[:2]:
    print('-', m['channel'], m['source'], '|', m['recipient'], '|', (m.get('bodyPreview') or '')[:70])
"
echo "== DONE =="
