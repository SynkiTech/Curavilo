#!/bin/bash
# E2E test for POS + Inventory enhancements (Task 5)
set -e
BASE="http://localhost:3000"
CJ=/tmp/e2e-cookies.txt
rm -f $CJ

echo "== login =="
curl -s -c $CJ -X POST $BASE/api/auth -H "Content-Type: application/json" \
  -d '{"action":"login","email":"eyeclinic@curavilo.demo","password":"Demo1234!"}' | head -c 60; echo

ITEM=$(curl -s -b $CJ "$BASE/api/inventory" | python3 -c "import json,sys; items=[i for i in json.load(sys.stdin)['items'] if (i.get('stockOnHand') or 0)>10]; print(items[0]['id'])")
ITEM2=$(curl -s -b $CJ "$BASE/api/inventory" | python3 -c "import json,sys; items=[i for i in json.load(sys.stdin)['items'] if (i.get('stockOnHand') or 0)>10]; print(items[1]['id'])")
echo "test items: $ITEM $ITEM2"

echo "== 1. HOLD sale =="
HELD=$(curl -s -b $CJ -X PATCH $BASE/api/sales -H "Content-Type: application/json" -d "{
  \"action\":\"HOLD\",\"customerName\":\"Held Customer Test\",\"discountMinor\":500,
  \"items\":[{\"itemId\":\"$ITEM\",\"name\":\"Held item\",\"sku\":\"X\",\"quantity\":2,\"unitPriceMinor\":95000}]}")
HELD_ID=$(echo "$HELD" | python3 -c "import json,sys; print(json.load(sys.stdin)['held']['id'])")
echo "held id: $HELD_ID total: $(echo $HELD | python3 -c "import json,sys; print(json.load(sys.stdin)['held']['totalMinor'])")"

echo "== 1b. LIST held =="
curl -s -b $CJ "$BASE/api/sales?held=1" | python3 -c "import json,sys; h=json.load(sys.stdin)['held']; print('held count:', len(h))"

echo "== 1c. DISCARD held =="
curl -s -b $CJ -X DELETE "$BASE/api/sales?heldId=$HELD_ID" | head -c 60; echo

echo "== 2. CREATE sale for return test =="
SALE=$(curl -s -b $CJ -X POST $BASE/api/sales -H "Content-Type: application/json" -d "{
  \"customerName\":\"Return Tester\",\"items\":[{\"itemId\":\"$ITEM\",\"quantity\":3,\"unitPriceMinor\":95000},{\"itemId\":\"$ITEM2\",\"quantity\":2,\"unitPriceMinor\":120000}],
  \"discountMinor\":0,\"method\":\"CASH\",\"idempotencyKey\":\"e2e-ret-$(date +%s)\"}")
SALE_ID=$(echo "$SALE" | python3 -c "import json,sys; print(json.load(sys.stdin)['sale']['id'])")
SALE_NO=$(echo "$SALE" | python3 -c "import json,sys; print(json.load(sys.stdin)['sale']['number'])")
echo "sale: $SALE_NO ($SALE_ID)"
LINE1=$(echo "$SALE" | python3 -c "import json,sys; print(json.load(sys.stdin)['sale']['items'][0]['id'])")
LINE2=$(echo "$SALE" | python3 -c "import json,sys; print(json.load(sys.stdin)['sale']['items'][1]['id'])")

STOCK_BEFORE=$(curl -s -b $CJ "$BASE/api/inventory" | python3 -c "
import json,sys
items=json.load(sys.stdin)['items']
print(next(i['stockOnHand'] for i in items if i['id']=='$ITEM'))")
echo "stock before return: $STOCK_BEFORE"

echo "== 2b. forReturn payload =="
curl -s -b $CJ "$BASE/api/sales?forReturn=$SALE_ID" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('lines:', [(l['name'], l['returnable']) for l in d['lines']])"

echo "== 2c. RETURN 1 unit of line1, restock =="
RET=$(curl -s -b $CJ -X PATCH $BASE/api/sales -H "Content-Type: application/json" -d "{
  \"action\":\"RETURN\",\"saleId\":\"$SALE_ID\",\"reason\":\"Customer returned unopened pack\",\"method\":\"CASH\",\"restock\":true,
  \"lines\":[{\"saleItemId\":\"$LINE1\",\"quantity\":1}]}")
RET_NO=$(echo "$RET" | python3 -c "import json,sys; print(json.load(sys.stdin)['return']['number'])")
RET_TOTAL=$(echo "$RET" | python3 -c "import json,sys; print(json.load(sys.stdin)['return']['totalMinor'])")
echo "credit note: $RET_NO total: $RET_TOTAL"

STOCK_AFTER=$(curl -s -b $CJ "$BASE/api/inventory" | python3 -c "
import json,sys
items=json.load(sys.stdin)['items']
print(next(i['stockOnHand'] for i in items if i['id']=='$ITEM'))")
echo "stock after return: $STOCK_AFTER (expect $((STOCK_BEFORE+1)))"

echo "== 2d. over-return attempt (should 400) =="
curl -s -b $CJ -X PATCH $BASE/api/sales -H "Content-Type: application/json" -d "{
  \"action\":\"RETURN\",\"saleId\":\"$SALE_ID\",\"reason\":\"attempt too much\",\"method\":\"CASH\",\"restock\":true,
  \"lines\":[{\"saleItemId\":\"$LINE1\",\"quantity\":9}]}" -w " HTTP:%{http_code}\n" | head -c 200; echo

echo "== 2e. returns history =="
curl -s -b $CJ "$BASE/api/sales?returns=1" | python3 -c "import json,sys; r=json.load(sys.stdin)['returns']; print('returns:', [(x['number'], x['saleNumber'], x['totalMinor']) for x in r[:3]])"

echo "== 3. VOID sale =="
SALE2=$(curl -s -b $CJ -X POST $BASE/api/sales -H "Content-Type: application/json" -d "{
  \"items\":[{\"itemId\":\"$ITEM\",\"quantity\":1,\"unitPriceMinor\":95000}],\"discountMinor\":0,\"method\":\"CARD\",\"idempotencyKey\":\"e2e-void-$(date +%s)\"}")
SALE2_ID=$(echo "$SALE2" | python3 -c "import json,sys; print(json.load(sys.stdin)['sale']['id'])")
SALE2_NO=$(echo "$SALE2" | python3 -c "import json,sys; print(json.load(sys.stdin)['sale']['number'])")
curl -s -b $CJ -X PATCH $BASE/api/sales -H "Content-Type: application/json" -d "{\"action\":\"VOID\",\"saleId\":\"$SALE2_ID\",\"reason\":\"Test void operation\"}" | python3 -c "import json,sys; print('voided:', json.load(sys.stdin)['sale']['status'])"

echo "== 4. TODAY summary =="
curl -s -b $CJ "$BASE/api/sales?summary=1" | python3 -c "
import json,sys
s=json.load(sys.stdin)['summary']
print('count:', s['count'], 'gross:', s['grossMinor'], 'returns:', s['returnsMinor'], 'net:', s['netMinor'], 'voided:', s['voidedCount'])"

echo "== 5. SUPPLIERS =="
SUP=$(curl -s -b $CJ -X POST $BASE/api/suppliers -H "Content-Type: application/json" -d '{"name":"MedSupply Co","phone":"+2348000000000","email":"orders@medsupply.test","address":"1 Industrial Ave"}')
SUP_ID=$(echo "$SUP" | python3 -c "import json,sys; print(json.load(sys.stdin)['supplier']['id'])")
echo "supplier: $SUP_ID"
curl -s -b $CJ "$BASE/api/suppliers" | python3 -c "import json,sys; print('suppliers:', [s['name'] for s in json.load(sys.stdin)['suppliers']])"

echo "== 6. PURCHASE ORDER =="
PO=$(curl -s -b $CJ -X POST $BASE/api/purchase-orders -H "Content-Type: application/json" -d "{
  \"supplierId\":\"$SUP_ID\",\"notes\":\"E2E test order\",
  \"items\":[{\"itemId\":\"$ITEM\",\"quantity\":20,\"unitCostMinor\":70000}]}")
PO_ID=$(echo "$PO" | python3 -c "import json,sys; print(json.load(sys.stdin)['order']['id'])")
PO_NO=$(echo "$PO" | python3 -c "import json,sys; print(json.load(sys.stdin)['order']['number'])")
PO_LINE=$(echo "$PO" | python3 -c "import json,sys; print(json.load(sys.stdin)['order']['items'][0]['id'])")
echo "PO: $PO_NO ($PO_ID)"

curl -s -b $CJ -X PATCH $BASE/api/purchase-orders -H "Content-Type: application/json" -d "{\"action\":\"SET_STATUS\",\"purchaseOrderId\":\"$PO_ID\",\"status\":\"SUBMITTED\"}" | python3 -c "import json,sys; print('submitted:', json.load(sys.stdin)['order']['status'])"

STOCK_PRE_PO=$(curl -s -b $CJ "$BASE/api/inventory" | python3 -c "
import json,sys
items=json.load(sys.stdin)['items']
print(next(i['stockOnHand'] for i in items if i['id']=='$ITEM'))")

echo "== 6b. PARTIAL receive 12 of 20 =="
curl -s -b $CJ -X PATCH $BASE/api/purchase-orders -H "Content-Type: application/json" -d "{
  \"action\":\"RECEIVE\",\"purchaseOrderId\":\"$PO_ID\",
  \"lines\":[{\"poItemId\":\"$PO_LINE\",\"quantity\":12,\"batchNo\":\"POE2E-B1\",\"expiresAt\":\"2027-06-30\"}]}" | python3 -c "import json,sys; print('status after partial:', json.load(sys.stdin)['order']['status'])"

curl -s -b $CJ -X PATCH $BASE/api/purchase-orders -H "Content-Type: application/json" -d "{
  \"action\":\"RECEIVE\",\"purchaseOrderId\":\"$PO_ID\",
  \"lines\":[{\"poItemId\":\"$PO_LINE\",\"quantity\":8,\"batchNo\":\"POE2E-B2\",\"expiresAt\":\"2027-12-31\"}]}" | python3 -c "import json,sys; print('status after full:', json.load(sys.stdin)['order']['status'])"

STOCK_POST_PO=$(curl -s -b $CJ "$BASE/api/inventory" | python3 -c "
import json,sys
items=json.load(sys.stdin)['items']
print(next(i['stockOnHand'] for i in items if i['id']=='$ITEM'))")
echo "stock pre-PO: $STOCK_PRE_PO post-PO: $STOCK_POST_PO (expect +20)"

echo "== 7. STOCKTAKE =="
TARGET_ID=$ITEM
SYS=$(curl -s -b $CJ "$BASE/api/inventory" | python3 -c "
import json,sys
items=json.load(sys.stdin)['items']
print(next(i['stockOnHand'] for i in items if i['id']=='$TARGET_ID'))")
COUNTED=$((SYS+3))
curl -s -b $CJ -X PATCH $BASE/api/inventory -H "Content-Type: application/json" -d "{
  \"action\":\"STOCKTAKE\",\"reason\":\"E2E physical count\",
  \"lines\":[{\"itemId\":\"$TARGET_ID\",\"countedQty\":$COUNTED}]}" | python3 -c "
import json,sys
r=json.load(sys.stdin)['results'][0]
print('stocktake:', r['name'], 'system', r['systemQty'], '-> counted', r['countedQty'], 'variance', r['variance'])"

echo "== 8. DISPOSE (write off 2 units) =="
LOT=$(curl -s -b $CJ "$BASE/api/inventory" | python3 -c "
import json,sys
items=json.load(sys.stdin)['items']
it=next(i for i in items if i['id']=='$TARGET_ID')
lots=sorted(it['lots'], key=lambda l: -(l.get('qtyRemaining') or 0))
print(lots[0]['id'])")
curl -s -b $CJ -X PATCH $BASE/api/inventory -H "Content-Type: application/json" -d "{
  \"action\":\"DISPOSE\",\"itemId\":\"$TARGET_ID\",\"lotId\":\"$LOT\",\"quantity\":2,\"reason\":\"Broken bottles found\",\"type\":\"DAMAGE\"}" | head -c 80; echo

echo "== 9. INVENTORY SUMMARY =="
curl -s -b $CJ "$BASE/api/inventory?summary=1" | python3 -c "
import json,sys
s=json.load(sys.stdin)['summary']
print('items:', s['itemCount'], 'purchaseVal:', s['purchaseValueMinor'], 'retailVal:', s['retailValueMinor'], 'low:', s['lowStock'], 'expiredQty:', s['expiredQty'], 'expiring30:', s['expiringSoonQty'])"

echo "== 10. EXPIRING 90d =="
curl -s -b $CJ "$BASE/api/inventory?expiringDays=90" | python3 -c "import json,sys; print('expiring lots:', len(json.load(sys.stdin)['lots']))"

echo "== 11. ITEM UPDATE (price + archive roundtrip) =="
curl -s -b $CJ -X PATCH "$BASE/api/inventory?action=UPDATE_ITEM" -H "Content-Type: application/json" -d "{
  \"itemId\":\"$ITEM2\",\"sellingPriceMinor\":125000,\"reorderLevel\":8,\"barcode\":\"5012345678900\"}" | python3 -c "import json,sys; i=json.load(sys.stdin)['item']; print('updated price:', i['sellingPriceMinor'], 'reorder:', i['reorderLevel'])"

echo "== 12. RBAC: pos:refund mapping =="
bun -e "
import { permissionsForRole } from './src/lib/rbac.ts';
const ok = ['OWNER','ADMIN','PHARMACY'].every(r => permissionsForRole(r).includes('pos:refund'))
  && !['BILLING','RECEPTIONIST','NURSE','DOCTOR','LAB','STAFF'].some(r => permissionsForRole(r).includes('pos:refund'));
console.log(ok ? 'RBAC refund matrix OK' : 'RBAC MATRIX WRONG');
process.exit(ok ? 0 : 1);
" 2>/dev/null

echo "== 13. unauthorized sale (no cookie) =="
curl -s -X POST $BASE/api/sales -H "Content-Type: application/json" -d '{"items":[{"itemId":"x","quantity":1,"unitPriceMinor":1}]}' -w " HTTP:%{http_code}\n" | head -c 120

echo "ALL E2E CHECKS DONE"
