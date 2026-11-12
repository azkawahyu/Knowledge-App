# reset-test-data.sh — hash-scoped removal of fixture-derived test data.
# Identical rules to PLAN §7 T12 steps 1-4 (fixture hashes minus PRE_SHA, then
# blobs that are not in BEFORE_UPLOADS), so it can never touch pre-existing user
# data: PRE_SHA/BEFORE_UPLOADS come from the T2 baseline (empty in this run).
# Used to re-zero the DB after the tooling broke mid-run, never in place of T12.
. /d/Develop/knowledge-app/.pipeline/phase1/pre.sh

FIX_SHA=$(for f in "$FIX"/p1-* "$FIX"/résumé.txt; do [ -f "$f" ] && sha256sum "$f"; done | cut -d' ' -f1 | LC_ALL=C sort -u)
TEST_SHA=$(comm -23 <(printf '%s\n' "$FIX_SHA") <(printf '%s\n' "$PRE_SHA") | grep . || true)
echo "fixture hashes: $(printf '%s\n' "$FIX_SHA" | grep -c .); test hashes to remove: $(printf '%s\n' "$TEST_SHA" | grep -c .)"
if [ -n "$TEST_SHA" ]; then
  IN=$(printf "'%s'," $TEST_SHA); IN=${IN%,}
  echo "deleting chunks where document_id in (select id from documents where sha256 in (...))"
  "$PSQL" $PGARGS -c "delete from chunks where document_id in (select id from documents where sha256 in ($IN));"
  echo "deleting documents where sha256 in (...)"
  "$PSQL" $PGARGS -c "delete from documents where sha256 in ($IN);"
fi
for b in $(comm -13 <(printf '%s\n' "$BEFORE_UPLOADS" | grep .) <(ls "$DB/data/uploads" | LC_ALL=C sort)); do
  rm -f "$DB/data/uploads/$b"; echo "  removed run blob: $b"
done
for h in $TEST_SHA; do rm -f "$DB/data/extracts/$h".*; done
echo "after reset: documents=$(doccount) chunks=$(chunkcount) uploads=$(uplcount) tmp=$(tmpcount)"