#!/usr/bin/env bash
# E2E personnel-flow + authorization matrix (ADR 0011, spec §55-60).
# Each cookie jar simulates one browser: facility gate first, then staff login.
set -u
BASE="http://localhost:3000"
PASS=0; FAIL=0; J=/tmp/cv-jars; rm -rf "$J"; mkdir -p "$J"
PW='Demo1234!'
RUN=$(date +%s | tail -c 6)   # unique suffix so repeated runs never collide
ZEMAIL="zara.$RUN@curavilo.demo"
TEMAIL="temi.$RUN@curavilo.demo"

check() { # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ok    $1"; else FAIL=$((FAIL+1)); echo "  FAIL  $1 (expected $2, got $3)"; fi
}
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
jsonq() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1" 2>/dev/null; }
postcj() { curl -s -o /dev/null -b "$1" -c "$1" -H 'Content-Type: application/json' -d "$2" "$BASE$3"; }
# full two-stage login for one browser jar; prints the authenticated flag
staff_authed() { curl -s -b "$1" "$BASE/api/auth" | jsonq 'd["authenticated"]'; }
gate() { postcj "$1" "{\"action\":\"facility-login\",\"email\":\"eyeclinic@curavilo.demo\",\"password\":\"$PW\"}" /api/auth; }

echo "== 1. Facility gate =="
check "wrong facility password rejected" 401 "$(code -X POST $BASE/api/auth -H 'Content-Type: application/json' -d '{"action":"facility-login","email":"eyeclinic@curavilo.demo","password":"wrong"}')"
check "unknown facility email rejected" 401 "$(code -X POST $BASE/api/auth -H 'Content-Type: application/json' -d '{"action":"facility-login","email":"nobody@x.ng","password":"wrong"}')"
gate $J/eye
check "gate context visible in session" "Lagos Central Eye Clinic" "$(curl -s -b $J/eye $BASE/api/auth | jsonq 'd["gate"]["orgName"]')"
check "staff login without gate rejected" 401 "$(code -X POST $BASE/api/auth -H 'Content-Type: application/json' -d '{"action":"staff-login","email":"reception@curavilo.demo","password":"x"}')"

echo "== 2. Personnel gate =="
check "wrong staff password rejected" 401 "$(code -b $J/eye -X POST $BASE/api/auth -H 'Content-Type: application/json' -d '{"action":"staff-login","email":"reception@curavilo.demo","password":"wrong"}')"
check "suspended staff cannot authenticate" 403 "$(code -b $J/eye -X POST $BASE/api/auth -H 'Content-Type: application/json' -d '{"action":"staff-login","email":"intern@curavilo.demo","password":"'"$PW"'"}')"
check "other-org staff cannot enter this gate" 401 "$(code -b $J/eye -X POST $BASE/api/auth -H 'Content-Type: application/json' -d '{"action":"staff-login","email":"gracefield@curavilo.demo","password":"'"$PW"'"}')"

# Shared workstation: ONE gate pass, then each staff member signs in on the same
# browser (spec §32). The gate cookie is consumed by the same jar.
cp $J/eye $J/rec
postcj $J/rec '{"action":"staff-login","email":"reception@curavilo.demo","password":"'"$PW"'"}' /api/auth
RECJSON=$(curl -s -b $J/rec $BASE/api/auth)
check "receptionist signs in" "True" "$(echo "$RECJSON" | jsonq 'd["authenticated"]')"
check "receptionist role from session" "RECEPTIONIST" "$(echo "$RECJSON" | jsonq 'd["user"]["role"]')"
check "receptionist department resolved" "Front Desk" "$(echo "$RECJSON" | jsonq 'd["user"]["department"]')"
check "receptionist service line resolved" "Front Desk" "$(echo "$RECJSON" | jsonq 'd["user"]["serviceLine"]')"
for pair in "own eyeclinic@curavilo.demo" "pharm pharmacy@curavilo.demo" "oph ophthalmologist@curavilo.demo" "nur nurse@curavilo.demo" "bil billing@curavilo.demo" "opt optician@curavilo.demo"; do
  set -- $pair
  postcj $J/rec '{"action":"staff-login","email":"'"$2"'","password":"'"$PW"'"}' /api/auth
  check "$2 signs in (role dashboard session)" "True" "$(staff_authed $J/rec)"
  cp $J/rec "$J/$1" # snapshot this role's browser session
done
# Restore the receptionist session on the shared jar for matrix checks.
postcj $J/rec '{"action":"staff-login","email":"reception@curavilo.demo","password":"'"$PW"'"}' /api/auth

echo "== 3. Authorization matrix (server-side enforcement) =="
check "receptionist can read staff list (staff:read)" 200 "$(code -b $J/rec $BASE/api/staff-accounts)"
check "receptionist cannot create staff" 403 "$(code -b $J/rec -X POST $BASE/api/staff-accounts -H 'Content-Type: application/json' -d '{"firstName":"A","lastName":"B","email":"a@b.ng","role":"STAFF","facilityIds":["x"],"access":{"mode":"INVITE"}}')"
check "receptionist cannot create custom roles" 403 "$(code -b $J/rec -X POST $BASE/api/roles -H 'Content-Type: application/json' -d '{"name":"X","permissions":[]}')"
check "pharmacist cannot read staff accounts" 403 "$(code -b $J/pharm $BASE/api/staff-accounts)"
check "pharmacist cannot read audit log" 403 "$(code -b $J/pharm $BASE/api/audit)"
check "billing cannot write inventory" 403 "$(code -b $J/bil -X PATCH $BASE/api/inventory -H 'Content-Type: application/json' -d '{"action":"RECEIVE","itemId":"x","quantity":1}')"
check "pharmacist can read inventory" 200 "$(code -b $J/pharm $BASE/api/inventory)"
check "optician has no ai access" 403 "$(code -b $J/opt -X POST $BASE/api/ai -H 'Content-Type: application/json' -d '{"message":"hi"}')"
check "facility credential API denied to non-owner" 403 "$(code -b $J/rec $BASE/api/facility-credential)"
check "owner reads facility credential" 200 "$(code -b $J/own $BASE/api/facility-credential)"
check "departments closed to pharmacist" 403 "$(code -b $J/pharm $BASE/api/departments)"
check "receptionist dashboard blocked from revenue trend data? (billing:read allowed)" 200 "$(code -b $J/rec $BASE/api/dashboard)"

echo "== 4. Owner-only role management + protected permissions =="
ROLE_JSON=$(curl -s -b $J/own -X POST $BASE/api/roles -H 'Content-Type: application/json' -d '{"name":"Optical Manager","permissions":["patients:read","pos:sell","inventory:read","roles:manage","org:manage"]}')
ROLE_ID=$(echo "$ROLE_JSON" | jsonq 'd["role"]["id"]')
check "custom role created by owner" "True" "$([ -n "$ROLE_ID" ] && echo True || echo False)"
PROT=$(curl -s -b $J/own $BASE/api/roles | ROLE_ID="$ROLE_ID" python3 -c 'import sys,json,os;d=json.load(sys.stdin);r=[c for c in d["custom"] if c["id"]==os.environ["ROLE_ID"]][0]["permissions"];print("roles:manage" in r or "org:manage" in r)')
check "protected permissions stripped from custom role" "False" "$PROT"
check "roles endpoint closed to pharmacist" 403 "$(code -b $J/pharm -X POST $BASE/api/roles -H 'Content-Type: application/json' -d '{"name":"X","permissions":[]}')"

echo "== 5. Invitation flow (spec §56) =="
INV=$(curl -s -b $J/own -X POST $BASE/api/staff-accounts -H 'Content-Type: application/json' -d '{"firstName":"Zara","lastName":"Test","email":"'"$ZEMAIL"'","role":"OPTOMETRIST","departmentId":null,"facilityIds":[],"access":{"mode":"INVITE"}}')
LINK=$(echo "$INV" | jsonq 'd["inviteLink"]')
check "invite link issued" "True" "$([ -n "$LINK" ] && echo True || echo False)"
TOKEN=${LINK#*invite=}
check "weak password rejected at accept" 400 "$(code -X POST $BASE/api/auth -H 'Content-Type: application/json' -d '{"action":"invite-accept","token":"'"$TOKEN"'","password":"short"}')"
check "invitation accepted" 200 "$(code -X POST $BASE/api/auth -H 'Content-Type: application/json' -d '{"action":"invite-accept","token":"'"$TOKEN"'","password":"ZaraPass123"}')"
check "token single-use" 400 "$(code -X POST $BASE/api/auth -H 'Content-Type: application/json' -d '{"action":"invite-accept","token":"'"$TOKEN"'","password":"ZaraPass123"}')"
gate $J/zara
postcj $J/zara '{"action":"staff-login","email":"'"$ZEMAIL"'","password":"ZaraPass123"}' /api/auth
check "invited staff now signs in" "True" "$(staff_authed $J/zara)"

echo "== 6. Temporary password + forced change (spec §7) =="
TP=$(curl -s -b $J/own -X POST $BASE/api/staff-accounts -H 'Content-Type: application/json' -d '{"firstName":"Temi","lastName":"Test","email":"'"$TEMAIL"'","role":"RECEPTIONIST","facilityIds":[],"access":{"mode":"TEMP_PASSWORD","tempPassword":"TempPass123"}}')
check "temp password issued once" "True" "$(echo "$TP" | jsonq 'd["tempPassword"] is not None')"
gate $J/temi
postcj $J/temi '{"action":"staff-login","email":"'"$TEMAIL"'","password":"TempPass123"}' /api/auth
TEMJSON=$(curl -s -b $J/temi $BASE/api/auth)
check "mustChangePassword flagged" "True" "$(echo "$TEMJSON" | jsonq 'd["user"]["mustChangePassword"]')"
check "APIs blocked until password changed" 403 "$(code -b $J/temi $BASE/api/patients)"
check "change-password works" 200 "$(code -b $J/temi -X POST $BASE/api/auth -H 'Content-Type: application/json' -d '{"action":"change-password","currentPassword":"TempPass123","newPassword":"NewPass1234"}')"
check "APIs unblocked after change" 200 "$(code -b $J/temi $BASE/api/patients)"

echo "== 7. Forgot / reset password flow (spec §30) =="
gate $J/eye2
FORGOT=$(curl -s -b $J/eye2 -H 'Content-Type: application/json' -d '{"action":"forgot-password","email":"'"$ZEMAIL"'"}' $BASE/api/auth)
RLINK=$(echo "$FORGOT" | jsonq 'd["resetLink"]')
RTOKEN=${RLINK#*reset=}
check "reset link generated (sandbox)" "True" "$([ -n "$RTOKEN" ] && echo True || echo False)"
check "reset completes" 200 "$(code -X POST $BASE/api/auth -H 'Content-Type: application/json' -d '{"action":"reset-password","token":"'"$RTOKEN"'","password":"ZaraNew1234"}')"
check "old session invalidated after reset" "False" "$(curl -s -b $J/zara $BASE/api/auth | jsonq 'd["authenticated"]')"
gate $J/zara2
postcj $J/zara2 '{"action":"staff-login","email":"'"$ZEMAIL"'","password":"ZaraNew1234"}' /api/auth
check "new password signs in" "True" "$(staff_authed $J/zara2)"
check "forgot-password never enumerates" 200 "$(code -b $J/eye2 -X POST $BASE/api/auth -H 'Content-Type: application/json' -d '{"action":"forgot-password","email":"ghost@nowhere.ng"}')"

echo "== 8. Account lockout (spec §29) =="
for i in 1 2 3 4; do curl -s -o /dev/null -b $J/eye2 -X POST $BASE/api/auth -H 'Content-Type: application/json' -d '{"action":"staff-login","email":"'"$ZEMAIL"'","password":"badpass1"}'; done
check "5th failure returns invalid credentials" 401 "$(code -b $J/eye2 -X POST $BASE/api/auth -H 'Content-Type: application/json' -d '{"action":"staff-login","email":"'"$ZEMAIL"'","password":"badpass1"}')"
check "correct password blocked while locked" 423 "$(code -b $J/eye2 -X POST $BASE/api/auth -H 'Content-Type: application/json' -d '{"action":"staff-login","email":"'"$ZEMAIL"'","password":"ZaraNew1234"}')"
ZID=$(curl -s -b $J/own $BASE/api/staff-accounts | ZEMAIL="$ZEMAIL" python3 -c 'import sys,json,os;print([s["id"] for s in json.load(sys.stdin)["staff"] if s["email"]==os.environ["ZEMAIL"]][0])')
RESETRES=$(curl -s -b $J/own -X PATCH $BASE/api/staff-accounts -H 'Content-Type: application/json' -d '{"action":"RESET_PASSWORD","userId":"'"$ZID"'"}')
ZTEMP=$(echo "$RESETRES" | jsonq 'd["tempPassword"]')
check "owner reset unlocks account with temp password" "True" "$([ -n "$ZTEMP" ] && echo True || echo False)"

echo "== 9. Deactivation invalidates live sessions (spec §57) =="
gate $J/zara3
ZLOGIN=$(curl -s -b $J/zara3 -c $J/zara3 -X POST $BASE/api/auth -H 'Content-Type: application/json' -d '{"action":"staff-login","email":"'"$ZEMAIL"'","password":"'"$ZTEMP"'"}')
echo "    [debug] login=$ZLOGIN cookies=$(rg -c curavilo $J/zara3 2>/dev/null || echo 0) temp=$ZTEMP email=$ZEMAIL" >&2
check "temp password signs in but stays must-change" "True" "$(curl -s -b $J/zara3 $BASE/api/auth | jsonq 'd["user"]["mustChangePassword"]')"
check "APIs blocked until password changed" 403 "$(code -b $J/zara3 $BASE/api/patients)"
check "owner sets a permission override" 200 "$(code -b $J/own -X PATCH $BASE/api/staff-accounts -H 'Content-Type: application/json' -d '{"action":"SET_PERMISSIONS","userId":"'"$ZID"'","overrides":[{"permission":"reports:read","effect":"GRANT"}]}')"
check "deactivate zara" 200 "$(code -b $J/own -X PATCH $BASE/api/staff-accounts -H 'Content-Type: application/json' -d '{"action":"SET_STATUS","userId":"'"$ZID"'","value":"DEACTIVATE"}')"
check "old session now rejected" "False" "$(curl -s -b $J/zara3 $BASE/api/auth | jsonq 'd["authenticated"]')"
check "deactivated staff cannot sign in" 403 "$(code -b $J/eye2 -X POST $BASE/api/auth -H 'Content-Type: application/json' -d '{"action":"staff-login","email":"'"$ZEMAIL"'","password":"'"$ZTEMP"'"}')"
OID=$(curl -s -b $J/own $BASE/api/staff-accounts | python3 -c 'import sys,json;print([s["id"] for s in json.load(sys.stdin)["staff"] if s["role"]=="OWNER"][0])')
check "cannot deactivate the owner" 403 "$(code -b $J/own -X PATCH $BASE/api/staff-accounts -H 'Content-Type: application/json' -d '{"action":"SET_STATUS","userId":"'"$OID"'","value":"DEACTIVATE"}')"

echo "== 10. Shared computer flow (spec §58) =="
check "staff logout keeps gate" 200 "$(postcj $J/rec '{"action":"logout"}' /api/auth; code -b $J/rec $BASE/api/auth)"
GATE2=$(curl -s -b $J/rec $BASE/api/auth)
check "gate context survives staff logout" "Lagos Central Eye Clinic" "$(echo "$GATE2" | jsonq 'd["gate"]["orgName"]')"
postcj $J/rec '{"action":"staff-login","email":"billing@curavilo.demo","password":"'"$PW"'"}' /api/auth
check "staff B inherits nothing of staff A" "True" "$(staff_authed $J/rec)"
check "staff B has billing role" "BILLING" "$(curl -s -b $J/rec $BASE/api/auth | jsonq 'd["user"]["role"]')"
check "exit-facility clears everything" 200 "$(postcj $J/rec '{"action":"exit-facility"}' /api/auth; code -b $J/rec $BASE/api/auth)"
check "gate gone after exit" "False" "$(curl -s -b $J/rec $BASE/api/auth | jsonq '"gate" in d')"
check "staff login after exit rejected" 401 "$(code -b $J/rec -X POST $BASE/api/auth -H 'Content-Type: application/json' -d '{"action":"staff-login","email":"billing@curavilo.demo","password":"x"}')"

echo "== 11. Cross-tenant isolation (spec §43) =="
postcj $J/gp '{"action":"facility-login","email":"gracefield@curavilo.demo","password":"'"$PW"'"}' /api/auth
postcj $J/gp '{"action":"staff-login","email":"gracefield@curavilo.demo","password":"'"$PW"'"}' /api/auth
GP_PATIENTS=$(curl -s -b $J/gp $BASE/api/patients | jsonq 'len(d["patients"])')
check "gp owner sees only gp patients (3)" "3" "$GP_PATIENTS"
EYE_MRNS=$(curl -s -b $J/own $BASE/api/patients | jsonq 'len(d["patients"])')
check "eye owner sees only eye patients (8)" "8" "$EYE_MRNS"

echo "== 12. Audit trail (spec §60) =="
AUDIT=$(curl -s -b $J/own $BASE/api/audit)
for ev in staff.created staff.login staff.logout staff.deactivated staff.role_created staff.permission_changed staff.password_reset_by_owner facility.gate_login facility.exit; do
  FOUND=$(echo "$AUDIT" | EV="$ev" python3 -c 'import sys,json,os;ev=os.environ["EV"];print(any(e["action"]==ev for e in json.load(sys.stdin).get("events",[])))')
  check "audit records $ev" "True" "$FOUND"
done
PWLEAK=$(echo "$AUDIT" | rg -qi "ZaraPass|TempPass123|NewPass1234" && echo False || echo True)
check "audit never contains passwords" "True" "$PWLEAK"

echo
echo "RESULTS: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
