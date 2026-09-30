#!/bin/bash
# Follow-up checks: SLEEPING node persistence + reportNumber + webhook delivery
set -u
J=/tmp/curavilo-cookies.txt
B=http://localhost:3000
curl -s -c $J -X POST $B/api/auth -H 'Content-Type: application/json' -d '{"action":"login","email":"eyeclinic@curavilo.demo","password":"Demo1234!"}' > /dev/null

echo "── parked run nodes (SLEEPING at DELAY n5):"
curl -s -b $J $B/api/workflows | python3 -c "
import sys, json
d = json.load(sys.stdin)
for r in d['runs']:
    if r['triggerType'] == 'MANUAL' and r['status'] == 'RUNNING':
        print('run', r['id'][:10], r['status'])
        for n in r.get('nodes', []):
            print('  node', n['nodeKey'], n['type'], n['status'], 'wakeAt=', n.get('wakeAt'))
        break
"

echo "── released lab report number:"
curl -s -b $J "$B/api/lab?kind=LAB" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for o in d['orders']:
    if o['status'] == 'RELEASED':
        print('order', o['testName'], '→ reportNumber:', o.get('reportNumber'), 'TAT:', o.get('turnaroundMin'))
"

echo "── webhook deliveries (scheduler should have delivered PAYMENT_RECEIVED if any):"
curl -s -b $J $B/api/webhooks | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('endpoints:', [(e['url'], e['active']) for e in d['endpoints']])
print('deliveries:', [(x['eventType'], x['status'], x['attempts']) for x in d['deliveries'][:5]])
"

echo "── comms log tail:"
curl -s -b $J $B/api/comms | python3 -c "
import sys, json
d = json.load(sys.stdin)
for m in d['messages'][:6]:
    print(m['channel'], m['type'], m['status'], '→', m.get('recipient'), '|', (m.get('bodyPreview') or '')[:50])
"

echo "── generated documents:"
curl -s -b $J $B/api/workflows | python3 -c "
import sys, json
d = json.load(sys.stdin)
runs = d['runs']
done = [r for r in runs if r['status'] == 'COMPLETED']
print('completed runs:', len(done))
for r in done[:2]:
    print(' run', r['id'][:10], r['triggerType'], [(n['nodeKey'], n['type'], n['status']) for n in r.get('nodes', [])])
"
