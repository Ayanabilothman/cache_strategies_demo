#!/usr/bin/env bash
# Runs all five caching strategy demos. Every endpoint does exactly ONE
# thing: the two read strategies are plain GETs (call twice to see MISS
# then HIT); the three write strategies are single POSTs that ONLY create a
# product -- nothing is chained after. Write-Back's row reaches MongoDB
# purely via its own background job, on its own schedule; this script just
# waits for it rather than forcing it. Watch the app's console output
# alongside this for the HIT/MISS/READ/WRITE/STORE/FLUSH logs.
set -e
BASE="http://localhost:3000/api"
FLUSH_MS="${WRITE_BACK_FLUSH_INTERVAL_MS:-10000}"

pretty() { node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync(0,'utf8')), null, 2))"; }
extract_id() { node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).product._id)"; }
pause() { read -rp "-- press enter to continue --" _; }

echo "== Reset: reseed MongoDB and clear all demo cache keys =="
curl -s -X POST "$BASE/seed" > /dev/null
curl -s -X DELETE "$BASE/cache" > /dev/null
echo "done"
pause

echo "###################################################"
echo "# 1) CACHE-ASIDE -- read p1 twice: MISS then HIT"
echo "###################################################"
curl -s "$BASE/cache-aside" | pretty
curl -s "$BASE/cache-aside" | pretty
pause

echo "###################################################"
echo "# 2) READ-THROUGH -- read p2 twice: MISS then HIT"
echo "###################################################"
curl -s "$BASE/read-through" | pretty
curl -s "$BASE/read-through" | pretty
pause

echo "###################################################"
echo "# 3) WRITE-THROUGH -- create only, cache primed immediately"
echo "###################################################"
RESP=$(curl -s -X POST "$BASE/write-through")
echo "$RESP" | pretty
ID=$(echo "$RESP" | extract_id)
echo "-- Redis is already warm for the new product (exists:true):"
curl -s "$BASE/inspect/redis/$ID?strategy=writeThrough" | pretty
pause

echo "###################################################"
echo "# 4) WRITE-AROUND -- create only, cache left untouched"
echo "###################################################"
RESP=$(curl -s -X POST "$BASE/write-around")
echo "$RESP" | pretty
ID=$(echo "$RESP" | extract_id)
echo "-- Redis was never contacted for the new product (exists:false):"
curl -s "$BASE/inspect/redis/$ID?strategy=writeAround" | pretty
pause

echo "###################################################"
echo "# 5) WRITE-BACK -- create only, MongoDB catches up on its own"
echo "###################################################"
RESP=$(curl -s -X POST "$BASE/write-back")
echo "$RESP" | pretty
ID=$(echo "$RESP" | extract_id)
echo "-- MongoDB does NOT have this row yet (expect 404):"
curl -s -o /dev/null -w "  HTTP %{http_code}\n" "$BASE/inspect/mongo/$ID"
echo "-- waiting for the background flush job (up to ${FLUSH_MS}ms, no request triggers it)..."
sleep $(( (FLUSH_MS + 1500) / 1000 ))
echo "-- MongoDB now has it, persisted entirely by the background timer:"
curl -s "$BASE/inspect/mongo/$ID" | pretty

echo
echo "Demo complete."
echo "Poke at a specific id with:"
echo "  curl $BASE/inspect/mongo/<id>"
echo "  curl \"$BASE/inspect/redis/<id>?strategy=<strategy>\"   (strategy: cacheAside, readThrough, writeThrough, writeAround, writeBack)"
echo "Clear cache keys with:"
echo "  curl -X DELETE \"$BASE/cache?strategy=<strategy>&id=<id>\""
echo "Or go straight to the source:"
echo "  docker exec -it cache-demo-redis redis-cli"
echo "  docker exec -it cache-demo-mongo mongosh cache_demo"
