# T12 (continued) — residual run-generated rows + fixtures removal + final proof.
#
# WHY THERE IS A SECOND PASS: T12 step 1 derives the delete set from the fixture
# FILES on disk. Three rows in this run came from bytes that are not fixture files:
#   - two browser-probe uploads (files created inside the browser, never on disk)
#   - one earlier duplicate-pair upload whose fixture was overwritten by a later
#     concurrency run (same NAME, different BYTES => different hash)
# They are still provably *this run's* data: PRE_SHA was empty and the DB baseline
# was documents=0, so every surviving row was created after T2. The rule applied
# below is identical in kind to step 2 — hash-scoped, never name-scoped — and the
# hash set is exactly `current DB hashes MINUS PRE_SHA`.
. D:/Develop/knowledge-app/.pipeline/phase1/pre.sh

echo "########## T12 step 6b: residual run-generated hashes (current MINUS PRE_SHA)"
CUR_SHA=$(q "select sha256 from documents;")
RESID=$(comm -23 <(printf '%s\n' "$CUR_SHA" | grep . | LC_ALL=C sort -u) <(printf '%s' "$PRE_SHA" | grep . | LC_ALL=C sort -u) | grep . || true)
echo "  residual hashes: [$(printf '%s' "$RESID" | tr '\n' ' ')]"
for h in $RESID; do
  echo "  -- $h rows=$(q "select count(*) from documents where sha256='$h';") name(s)=$(q "select string_agg(name,',') from documents where sha256='$h';")"
done
if [ -n "$RESID" ]; then
  IN=$(printf "'%s'," $RESID); IN=${IN%,}
  "$PSQL" $PGARGS -c "delete from chunks where document_id in (select id from documents where sha256 in ($IN));"
  "$PSQL" $PGARGS -c "delete from documents where sha256 in ($IN);"
  for h in $RESID; do rm -f "$DB/data/extracts/$h".*; done
fi

echo "########## T12 step 3b: any blob written by this run"
for b in $(comm -13 <(printf '%s\n' "$BEFORE_UPLOADS" | grep . | LC_ALL=C sort) <(ls "$DB/data/uploads" | LC_ALL=C sort)); do
  rm -f "$DB/data/uploads/$b"; echo "  removed $b"
done

echo "########## T12 step 8: fixtures removed"
rm -f "$FIX"/p1-* "$FIX"/résumé.txt "$FIX"/p1-dup-*.txt
echo "  fixtures dir contents: [$(ls -A "$FIX" | tr '\n' ' ')] count=$(ls -A "$FIX" | wc -l | tr -d ' ')"

echo "########## T12 FINAL PROOF"
echo "documents=$(doccount) (baseline 0)"
echo "chunks=$(chunkcount) (baseline 0)"
echo "admins=$(admincount) (baseline 1)"
echo "audit_log=$(auditcount) (baseline 0)"
echo "uploads: [$(ls "$DB/data/uploads" | tr '\n' ' ')]  files=$(uplcount)  identical-to-T2=$([ "$(ls "$DB/data/uploads" | sort)" = "$(printf '%s\n' "$BEFORE_UPLOADS" | grep . | sort)" ] && echo YES || echo NO)"
echo "extracts: [$(ls -A "$DB/data/extracts" | tr '\n' ' ')] count=$(ls -A "$DB/data/extracts" | wc -l | tr -d ' ')"
echo "tmp-* anywhere under server/data: $(find "$DB/data" -name 'tmp-*' 2>/dev/null | wc -l | tr -d ' ')"
echo "server/data/tmp contents: [$(ls -A "$DB/data/tmp" | tr '\n' ' ')]"
echo "pre-existing hashes that disappeared: $(comm -23 <(printf '%s' "$PRE_SHA" | grep . | LC_ALL=C sort -u) <(q "select sha256 from documents;" | grep . | LC_ALL=C sort -u) | grep -c . || true) (0 = nothing lost)"
echo "hashes in DB now: [$(q "select sha256 from documents;" | tr '\n' ' ')]"