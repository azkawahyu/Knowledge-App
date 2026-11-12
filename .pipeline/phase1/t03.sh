# T3 — fixtures + single-file happy path (AC1–AC4, AC8)
. /d/Develop/knowledge-app/.pipeline/phase1/pre.sh

echo "=== T3 single-file happy path (p1-ok3.txt) ==="
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/p1-ok3.txt;type=text/plain"
want 200 "single file"
echo "  response: $(cat "$P1/.last.json")"
chk single "$P1/.last.json"

DOCID=$($JGET "$P1/.last.json" results.0.documentId)
HASH=$($JGET "$P1/.last.json" results.0.contentHash)
echo "  documentId=$DOCID"
echo "  contentHash=$HASH"

FILESHA=$(sha256 "$FIX/p1-ok3.txt")
echo "  sha256sum(fixture)=$FILESHA"
[ "$HASH" = "$FILESHA" ] && echo "  contentHash == sha256(file) OK" || { echo "  FAIL contentHash: want=$FILESHA got=$HASH"; FAILED=1; }

KIND=$(q "select kind from documents where id='$DOCID';")
[ "$KIND" = "txt" ] && echo "  documents.kind=txt OK" || { echo "  FAIL kind=$KIND"; FAILED=1; }
SIZE=$(q "select size_bytes from documents where id='$DOCID';")
WANT_SIZE=$(wc -c < "$FIX/p1-ok3.txt" | tr -d ' ')
[ "$SIZE" = "$WANT_SIZE" ] && echo "  documents.size_bytes=$SIZE OK" || { echo "  FAIL size_bytes want=$WANT_SIZE got=$SIZE"; FAILED=1; }
POLICY=$(q "select access_policy from documents where id='$DOCID';")
[ "$POLICY" = "restricted" ] && echo "  default access_policy=restricted OK" || { echo "  FAIL access_policy=$POLICY"; FAILED=1; }
STATUS=$(q "select status from documents where id='$DOCID';")
echo "  documents.status=$STATUS (pending is expected per plan)"
CH=$(q "select count(*) from chunks where document_id='$DOCID';")
RESPCH=$($JGET "$P1/.last.json" results.0.chunkCount)
[ "$CH" = "$RESPCH" ] && echo "  SQL chunks ($CH) == response.chunkCount ($RESPCH) OK" || { echo "  FAIL chunks sql=$CH resp=$RESPCH"; FAILED=1; }
IDCOUNT=$(q "select count(*) from documents where sha256='$HASH';")
[ "$IDCOUNT" = "1" ] && echo "  exactly one documents row for this sha256 OK" || { echo "  FAIL rows for sha=$IDCOUNT"; FAILED=1; }
[ -f "$DB/data/uploads/$HASH.txt" ] && echo "  AC4 blob <hash>.txt present OK ($HASH.txt)" || { echo "  AC4 FAIL: no $HASH.txt in uploads"; ls "$DB/data/uploads"; FAILED=1; }

echo "--- non-ASCII filename check (résumé.txt) ---"
req -X POST "$UPLOAD" -H "Authorization: Bearer $TOKEN" -F "files=@$FIX/résumé.txt;type=text/plain"
want 200 "unicode filename accepted"
RESUME_ID=$($JGET "$P1/.last.json" results.0.documentId)
RESUME_NAME=$($JGET "$P1/.last.json" results.0.name)
echo "  response.name bytes: $(printf '%s' "$RESUME_NAME" | od -c | head -2 | tr '\n' ' ')"
echo "  documents.name (SQL): $(q "select name from documents where id='$RESUME_ID';" | od -c | head -2 | tr '\n' ' ')"
echo "  extract artifact present: $(ls "$DB/data/extracts" | grep -c "^$HASH" ) for p1-ok3"
want_tmp0
echo "FAILED=$FAILED"