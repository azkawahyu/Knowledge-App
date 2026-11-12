# xhr-flow2.sh — EXTRA CHECKS 1/2/3/5 after the T2–T15 suite.
#
# The request shape is copied from the real Inbox page (read-only inspection):
#   web/src/app/dashboard/inbox/page.tsx:31-35
#       const form = new FormData(); files.forEach((f) => form.append("files", f));
#   web/src/lib/api.ts:44-47   ingestUpload -> POST /ingest/upload, body = FormData
#   web/src/lib/api.ts:14-26   the ONLY header set is Authorization: Bearer <token>;
#                              Content-Type is never set, so the browser writes the boundary
#   web/src/lib/api.ts:1       API base http://localhost:4000/api  (cross-origin from :3000)
#
# usage: xhr-flow2.sh base|empty|concurrency|noauth
. D:/Develop/knowledge-app/.pipeline/phase1/pre.sh
MODE="${1:-base}"

echo "=== browser preflight (what :3000 sends before an authorized XHR) ==="
curl -s -D - -o /dev/null -X OPTIONS "$UPLOAD" \
  -H 'Origin: http://localhost:3000' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization' \
  | grep -iE '^(HTTP/|access-control)' | tr -d '\r'

case "$MODE" in
base)
  echo "=== POST exactly as the Inbox page sends it (Origin + Bearer, field 'files', no manual Content-Type) ==="
  req -X POST "$UPLOAD" -H 'Origin: http://localhost:3000' -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/p1-t18c.txt"
  echo "  status=$CODE"
  echo "  ACAO on the actual POST: $(curl -s -D - -o /dev/null -X POST "$UPLOAD" -H 'Origin: http://localhost:3000' -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/p1-t18c.txt" | grep -i '^access-control-allow-origin' | tr -d '\r')"
  echo "  body: $(cat "$P1/.last.json")"
  echo "  chunkCount=$($JGET "$P1/.last.json" results.0.chunkCount)  documentId=$($JGET "$P1/.last.json" results.0.documentId)"
  ;;
empty)
  echo "=== EXTRA CHECK 2: empty-string form fields (the Inbox page never sends these) ==="
  echo "--- (i) -F 'metadata=' only ---"
  req -X POST "$UPLOAD" -H 'Origin: http://localhost:3000' -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/p1-t18c.txt" -F 'metadata='
  echo "  status=$CODE  body: $(cat "$P1/.last.json")"
  echo "--- (ii) -F 'access_policy=' only ---"
  req -X POST "$UPLOAD" -H 'Origin: http://localhost:3000' -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/p1-t18c.txt" -F 'access_policy='
  echo "  status=$CODE  body: $(cat "$P1/.last.json")"
  echo "--- (iii) both empty ---"
  req -X POST "$UPLOAD" -H 'Origin: http://localhost:3000' -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/p1-t18c.txt" -F 'metadata=' -F 'access_policy='
  echo "  status=$CODE  body: $(cat "$P1/.last.json")"
  want_tmp0
  ;;
concurrency)
  echo "=== EXTRA CHECK 3: two concurrent uploads of the SAME new bytes, different names ==="
  cat > "$FIX/_mk2.js" <<'JS'
const fs=require('fs');
const t='Wombat zeppelin cinder dapple ember fathom gable hollow indigo jasper kettle lunar mosaic nectar opal prism quiver ripple sable tundra umbra vessel willow xenon yarrow zephyr. '+Date.now()+' '.repeat(6);
fs.writeFileSync(process.argv[2], t); fs.writeFileSync(process.argv[3], t);
JS
  node "$FIX/_mk2.js" "$FIX/p1-dup-a.txt" "$FIX/p1-dup-b.txt"
  rm -f "$FIX/_mk2.js"
  DUP_SHA=$(sha256 "$FIX/p1-dup-a.txt")
  echo "  sha256(a)=$DUP_SHA"
  echo "  sha256(b)=$(sha256 "$FIX/p1-dup-b.txt")"
  echo "  rows/ blobs before: documents=$(doccount) chunks=$(chunkcount) uploads=$(uplcount) tmp=$(tmpcount)"
  ( curl -s -o "$P1/.c1.json" -w '%{http_code}' -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/p1-dup-a.txt" > "$P1/.c1.code" 2>&1 ) &
  JA=$!
  ( curl -s -o "$P1/.c2.json" -w '%{http_code}' -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/p1-dup-b.txt" > "$P1/.c2.code" 2>&1 ) &
  JB=$!
  wait $JA $JB
  echo "  A status=$(cat "$P1/.c1.code")  body=$(head -c 400 "$P1/.c1.json")"
  echo "  B status=$(cat "$P1/.c2.code")  body=$(head -c 400 "$P1/.c2.json")"
  echo "  A documentId=$($JGET "$P1/.c1.json" results.0.documentId) chunkCount=$($JGET "$P1/.c1.json" results.0.chunkCount)"
  echo "  B documentId=$($JGET "$P1/.c2.json" results.0.documentId) chunkCount=$($JGET "$P1/.c2.json" results.0.chunkCount)"
  echo "  after: documents=$(doccount) chunks=$(chunkcount) uploads=$(uplcount) tmp=$(tmpcount)"
  echo "  rows with this sha256: $(q "select count(*) from documents where sha256='$DUP_SHA';")"
  echo "  chunks for those rows: $(q "select count(*) from chunks where document_id in (select id from documents where sha256='$DUP_SHA');")"
  echo "  blob present: $(ls "$DB/data/uploads" | grep -c "^$DUP_SHA" )"
  echo "  server log errors mentioning dup/EEXIST: $(grep -ci 'eexist\|duplicate key' /tmp/p1-server.log)"
  ;;
noauth)
  echo "=== EXTRA CHECK 5: /api/ingest/upload with NO Authorization header ==="
  D0=$(doccount)
  req -X POST "$UPLOAD" -F "files=@$FIX/p1-t18c.txt"
  echo "  status=$CODE  body: $(cat "$P1/.last.json")"
  echo "  documents delta=$(( $(doccount) - D0 ))"
  echo "  tmp-* files: $(tmpcount)"
  ;;
esac
echo "FAILED=$FAILED"