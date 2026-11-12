# T4–T11 — failure-mode and multi-file matrix.
# Precondition: DB at the empty baseline, TOKEN set by the caller.

echo "### T4 multi-file (+2 rows)"
D0=$(doccount); C0=$(chunkcount)
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/p1-ok.txt;type=text/plain" -F "files=@$FIX/p1-ok2.txt;type=text/plain"
want 200 "two files, one request"
echo "  response: $(cat "$P1/.last.json")"
$CHECK mixed "$P1/.last.json" 2 0 || FAILED=1
D1=$(doccount); C1=$(chunkcount)
echo "  documents $D0 -> $D1 (delta=$((D1-D0)))  chunks $C0 -> $C1"
[ $((D1-D0)) = 2 ] && echo "  +2 documents rows OK" || { echo "  FAIL documents delta=$((D1-D0))"; FAILED=1; }
want_tmp0

echo "### T5a empty multipart (valid boundary, no part)"
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -F "dummy="
want 400 "empty multipart"
echo "  body: $(cat "$P1/.last.json")"
chk contains "$P1/.last.json" "Missing file in request body"
chk nolist "$P1/.last.json"
want_tmp0

echo "### T5b wrong field name (file= instead of files=)"
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -F "file=@$FIX/p1-ok.txt"
want 400 "wrong field name"
echo "  body: $(cat "$P1/.last.json")"
chk contains "$P1/.last.json" 'Unexpected field'
chk nolist "$P1/.last.json"
want_tmp0

echo "### T6 unsupported extension (.exe)"
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/p1-bad.exe;type=application/x-msdownload"
want 400 "exe rejected"
echo "  body: $(cat "$P1/.last.json")"
chk contains "$P1/.last.json" "Unsupported file type: .exe"
chk nolist "$P1/.last.json"
want_tmp0

echo "### T7 oversized file (26 MiB > 25 MiB limit) -> 413"
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/p1-big.txt;type=text/plain"
want 413 "oversized"
echo "  body: $(cat "$P1/.last.json")"
chk err "$P1/.last.json"
chk nolist "$P1/.last.json"
want_tmp0

echo "### T8a malformed: JSON body, no multipart"
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data '{"files":"nope"}'
want 400 "non-multipart JSON"
echo "  body: $(cat "$P1/.last.json")"
chk nolist "$P1/.last.json"
chk nohtml "$P1/.last.json"
want_tmp0

echo "### T8b malformed: multipart/form-data WITHOUT boundary (must NOT be an HTML 500)"
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: multipart/form-data' --data-binary 'garbage'
want 400 "multipart without boundary"
echo "  body: $(cat "$P1/.last.json")"
chk nohtml "$P1/.last.json"
chk nolist "$P1/.last.json"
want_tmp0

echo "### T9 ingestion throws mid-way (corrupt .docx)"
D0=$(doccount); C0=$(chunkcount); U0=$(uplcount)
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/p1-broken.docx;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document"
echo "  status=$CODE (expect 400 all-failed)"
echo "  body: $(cat "$P1/.last.json")"
D1=$(doccount); C1=$(chunkcount); U1=$(uplcount)
echo "  documents delta=$((D1-D0)) chunks delta=$((C1-C0)) uploads delta=$((U1-U0))"
[ $((D1-D0)) = 0 ] && echo "  no documents row OK" || { echo "  FAIL documents delta=$((D1-D0))"; FAILED=1; }
want_tmp0
BROKEN_SHA=$(sha256 "$FIX/p1-broken.docx")
echo "  sha256(corrupt docx)=$BROKEN_SHA"
ORPHAN_BLOB=$(ls "$DB/data/uploads" | grep "^$BROKEN_SHA" || true)
echo "  \$ORPHAN_BLOB=[${ORPHAN_BLOB:-<none>}]"

echo "### T10 duplicate upload / dedupe"
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/p1-t10.txt;type=text/plain"
want 200 "first upload of p1-t10.txt"
ID_A=$($JGET "$P1/.last.json" results.0.documentId); CH_A=$($JGET "$P1/.last.json" results.0.chunkCount)
echo "  first: documentId=$ID_A chunkCount=$CH_A"
D0=$(doccount)
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/p1-t10.txt;type=text/plain"
want 200 "duplicate upload of p1-t10.txt"
echo "  response: $(cat "$P1/.last.json")"
ID_B=$($JGET "$P1/.last.json" results.0.documentId); CH_B=$($JGET "$P1/.last.json" results.0.chunkCount); HASH_B=$($JGET "$P1/.last.json" results.0.contentHash)
D1=$(doccount)
echo "  second: documentId=$ID_B chunkCount=$CH_B contentHash=$HASH_B"
[ "$ID_A" = "$ID_B" ] && echo "  same documentId returned OK" || echo "  NOTE documentId differs: $ID_A vs $ID_B"
[ "$CH_B" = "0" ] && echo "  second upload chunkCount=0 OK" || echo "  NOTE second chunkCount=$CH_B"
[ "$HASH_B" = "$ID_B" ] && echo "  contentHash==documentId in response OK" || echo "  NOTE contentHash != documentId in response"
[ $((D1-D0)) = 0 ] && echo "  no new documents row OK" || { echo "  FAIL documents delta=$((D1-D0))"; FAILED=1; }
want_tmp0
echo "FAILED=$FAILED"