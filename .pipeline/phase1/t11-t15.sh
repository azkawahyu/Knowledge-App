# T11, T13, T14, T15 — mixed batch, auth/regression, abort semantics, field guards.

echo "### T11 mixed batch: good + corrupt docx -> 207"
D0=$(doccount)
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/p1-t11.txt;type=text/plain" -F "files=@$FIX/p1-broken2.docx;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document"
want 207 "mixed batch"
echo "  body: $(cat "$P1/.last.json")"
$CHECK mixed "$P1/.last.json" 1 1 p1-broken2.docx || FAILED=1
D1=$(doccount)
[ $((D1-D0)) = 1 ] && echo "  exactly one new document OK" || { echo "  FAIL documents delta=$((D1-D0))"; FAILED=1; }
want_tmp0

echo
echo "### T13a no Authorization header -> 401, and multer must NOT have run (tmp stays clean)"
D0=$(doccount)
req -X POST "$UPLOAD" -F "files=@$FIX/p1-ok.txt"
want 401 "no auth"
echo "  body: $(cat "$P1/.last.json")"
$CHECK status401 "$P1/.last.json" || FAILED=1
echo "  documents delta=$(( $(doccount) - D0 )) (want 0)"
want_tmp0

echo "### T13b garbage token -> 401 JSON"
req -X POST "$UPLOAD" -H "Authorization: Bearer not-a-real-token" -F "files=@$FIX/p1-ok.txt"
want 401 "garbage token"
echo "  body: $(cat "$P1/.last.json")"
$CHECK status401 "$P1/.last.json" || FAILED=1
want_tmp0

echo "### T13c /api/ingest/watch regression (JSON path upload)"
WATCH_PATH="$FIX/p1-t13.txt"
echo "  path sent: $WATCH_PATH"
req -X POST "$SERVER/api/ingest/watch" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data "{\"path\":\"$WATCH_PATH\"}"
want 200 "/watch still works"
echo "  body: $(cat "$P1/.last.json")"
T_ID=$($JGET "$P1/.last.json" documentId)
echo "  typeof documentId = $(case "$T_ID" in *-*-*-*-*) echo "string(uuid-like)";; *) echo "CHECK:$T_ID";; esac)"
echo "  chunkCount=$($JGET "$P1/.last.json" chunkCount)"
[ "$($JGET "$P1/.last.json" chunkCount)" = "1" ] && echo "  /watch chunkCount=1 OK" || { echo "  FAIL /watch chunkCount=$($JGET "$P1/.last.json" chunkCount)"; FAILED=1; }
want_tmp0

echo "### T13d /api/health"
req "$SERVER/api/health"
want 200 "/api/health"
echo "  body: $(cat "$P1/.last.json")"

echo "### T13e /api/search returns JSON, not HTML"
req -X POST "$SERVER/api/search" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data '{"q":"alpha"}'
echo "  search status $CODE (recorded; a 5xx here is the known out-of-scope FTS defect)"
echo "  body: $(head -c 300 "$P1/.last.json")"
$CHECK nohtml "$P1/.last.json" || FAILED=1

echo
echo "### T14 abort semantics: good file + .exe in one request -> whole batch 400"
D0=$(doccount)
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/p1-t11.txt;type=text/plain" -F "files=@$FIX/p1-bad.exe;type=application/x-msdownload"
want 400 "one bad file aborts the batch"
echo "  body: $(cat "$P1/.last.json")"
$CHECK contains "$P1/.last.json" "Unsupported file type: .exe" || FAILED=1
$CHECK nolist "$P1/.last.json" || FAILED=1
D1=$(doccount)
[ $((D1-D0)) = 0 ] && echo "  no rows from the aborted batch OK" || { echo "  FAIL documents delta=$((D1-D0))"; FAILED=1; }
want_tmp0

echo
echo "### T15a invalid metadata JSON -> 400 + no rows + no temp leak"
D0=$(doccount)
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/p1-ok.txt;type=text/plain" -F 'metadata=not json'
want 400 "invalid metadata"
echo "  body: $(cat "$P1/.last.json")"
$CHECK contains "$P1/.last.json" "Invalid metadata JSON" || FAILED=1
[ $(( $(doccount) - D0 )) = 0 ] && echo "  no rows OK" || { echo "  FAIL rows added"; FAILED=1; }
want_tmp0

echo "### T15b junk access_policy -> 400 + no rows + no temp leak"
D0=$(doccount)
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/p1-ok.txt;type=text/plain" -F 'access_policy=banana'
want 400 "invalid access_policy"
echo "  body: $(cat "$P1/.last.json")"
$CHECK contains "$P1/.last.json" "Invalid access_policy" || FAILED=1
[ $(( $(doccount) - D0 )) = 0 ] && echo "  no rows OK" || { echo "  FAIL rows added"; FAILED=1; }
want_tmp0

echo "### T15c positive control: valid metadata object persisted as jsonb"
D0=$(doccount)
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/p1-t15.txt;type=text/plain" -F 'metadata={"team":"ops"}'
want 200 "valid metadata accepted"
echo "  body: $(cat "$P1/.last.json")"
[ $(( $(doccount) - D0 )) = 1 ] && echo "  exactly one row ingested OK" || { echo "  FAIL documents delta=$(( $(doccount) - D0 ))"; FAILED=1; }
META=$(q "select metadata->>'team' from documents where sha256='$(sha256 "$FIX/p1-t15.txt")';" | tr -d ' \r')
[ "$META" = "ops" ] && echo "  metadata->>'team' = ops OK (jsonb round-trip)" || { echo "  FAIL metadata team=[$META]"; FAILED=1; }
want_tmp0
echo "FAILED=$FAILED"