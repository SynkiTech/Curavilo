#!/bin/bash
# Quick API verification for Task 9 (accountant + HR roles)
BASE=http://localhost:3000
JAR=/tmp/curavilo-verify-$1.txt
rm -f "$JAR"

echo "== stage 1: facility gate ($1) =="
curl -s -c "$JAR" -X POST "$BASE/api/auth" -H "Content-Type: application/json" \
  -d "{\"action\":\"facility-login\",\"email\":\"$2\",\"password\":\"Demo1234!\"}" | head -c 200
echo; echo "== stage 2: staff login $3 =="
curl -s -b "$JAR" -c "$JAR" -X POST "$BASE/api/auth" -H "Content-Type: application/json" \
  -d "{\"action\":\"staff-login\",\"email\":\"$3\",\"password\":\"Demo1234!\"}" | python3 -c "import json,sys; d=json.load(sys.stdin); u=d.get('user',{}); print('role:',u.get('role'),'| perms:',len(u.get('permissions',[])),'| ai:', 'ai:ask' in u.get('permissions',[]))" 2>/dev/null || echo LOGIN-FAILED

echo "== dashboard =="
curl -s -b "$JAR" "$BASE/api/dashboard" | python3 -c "import json,sys; d=json.load(sys.stdin); print('keys:', sorted(d.keys())[:14])"

echo "== accounting summary =="
curl -s -b "$JAR" "$BASE/api/accounting?view=summary" | python3 -c "import json,sys; d=json.load(sys.stdin); print('revenue:',d.get('revenueMinor'),'expenses:',d.get('expensesMinor'),'net:',d.get('netMinor'),'pending:',d.get('pendingExpenseCount'),'aging:',d.get('aging'))" 2>/dev/null || echo ACCOUNTING-FAILED

echo "== accounting expenses =="
curl -s -b "$JAR" "$BASE/api/accounting?view=expenses" | python3 -c "import json,sys; d=json.load(sys.stdin); print('rows:',len(d.get('expenses',[])),'totals:',d.get('totals'))" 2>/dev/null || echo EXPENSES-FAILED

echo "== hr overview =="
curl -s -b "$JAR" "$BASE/api/hr" | python3 -c "import json,sys; d=json.load(sys.stdin); print('headcount:',d.get('headcount'),'| pendingLeave:',len(d.get('pendingLeave',[])),'| attendance:',len(d.get('todayAttendance',[])),'| certs expiring:',len(d.get('expiringCertifications',[])),'| reviews:',len(d.get('recentReviews',[])))" 2>/dev/null || echo HR-FAILED

echo "== reports (revenue) =="
curl -s -b "$JAR" "$BASE/api/reports?type=revenue&from=2026-09-01&to=2026-10-09" | head -c 120
echo
