# T12 — CLEANUP (PLAN §7 T12), run LAST, hash-scoped exactly as written.
# 1) test hashes = fixture hashes MINUS any hash the user already owned (PRE_SHA)
# 2) delete chunks then documents, scoped BY HASH only
# 3) delete blobs present now but absent from the T2 BEFORE_UPLOADS listing
# 4) remove extract artefacts for the test hashes; then prove the zero state.
. D:/Develop/knowledge-app/.pipeline/phase1/pre.sh

echo "########## T12 PRE-STATE"
echo "documents=$(doccount) chunks=$(chunkcount) admins=$(admincount) audit_log=$(auditcount)"
echo "uploads ($(uplcount)): $(ls "$DB/data/uploads" | tr '\n' ' ')"
echo "extracts ($(ls -A "$DB/data/extracts" | wc -l | tr -d ' '))"
echo "tmp-* files: $(tmpcount)"
echo "BEFORE_UPLOADS (T2): [$BEFORE_UPLOADS]"
echo "PRE_SHA (T2): [$(printf '%s' "$PRE_SHA" | tr '\n' ' ')]"

FIX_SHA=$(for f in "$FIX"/p1-* "$FIX"/résumé.txt; do [ -f "$f" ] && sha256sum "$f"; done | cut -d' ' -f1 | LC_ALL=C sort -u)
TEST_SHA=$(comm -23 <(printf '%s\n' "$FIX_SHA") <(printf '%s\n' "$PRE_SHA" | grep . || true) | grep . || true)
echo "fixture hashes: $(printf '%s\n' "$FIX_SHA" | grep -c .)  test hashes (minus PRE_SHA): $(printf '%s\n' "$TEST_SHA" | grep -c .)"

echo "########## T12 STEP 1-2: delete by hash"
if [ -n "$TEST_SHA" ]; then
  IN=$(printf "'%s'," $TEST_SHA); IN=${IN%,}
  "$PSQL" $PGARGS -c "delete from chunks where document_id in (select id from documents where sha256 in ($IN));"
  "$PSQL" $PGARGS -c "delete from documents where sha256 in ($IN);"
fi

echo "########## T12 STEP 3: blob listing delta"
for b in $(comm -13 <(printf '%s\n' "$BEFORE_UPLOADS" | grep . | LC_ALL=C sort) <(ls "$DB/data/uploads" | LC_ALL=C sort)); do
  rm -f "$DB/data/uploads/$b"; echo "  removed $b"
done

echo "########## T12 STEP 4: extract artefacts for test hashes"
for h in $TEST_SHA; do rm -f "$DB/data/extracts/$h".*; done
echo "  extracts remaining: $(ls -A "$DB/data/extracts" | wc -l | tr -d ' ')"

echo "########## T12 ALSO: run-only fixtures + helper scratch files"
rm -f "$FIX"/p1-dup-a.txt "$FIX"/p1-dup-b.txt
rm -f "$P1"/.last.json "$P1"/.token "$P1"/.c1.json "$P1"/.c2.json "$P1"/.c1.code "$P1"/.c2.code "$P1"/.conc1.json "$P1"/.conc2.json "$P1"/.conc1.code "$P1"/.conc2.code "$P1"/.probe.json "$P1"/.x.json
echo "  helper scratch files in $P1: $(ls -A "$P1" | grep -c '^\.\(last\|token\|c1\|c2\|conc1\|conc2\|probe\|x\)')"

echo "########## T12 POST-STATE (proof)"
echo "documents=$(doccount)  (want 0)"
echo "chunks=$(chunkcount)  (want 0)"
echo "admins=$(admincount)  (want 1)"
echo "audit_log=$(auditcount)  (want 0)"
echo "uploads listing: [$(ls "$DB/data/uploads" | tr '\n' ' ')]"
echo "uploads identical to T2 BEFORE_UPLOADS: $([ "$(ls "$DB/data/uploads" | sort)" = "$(printf '%s\n' "$BEFORE_UPLOADS" | grep . | sort)" ] && echo YES || echo NO)"
echo "extracts: [$(ls -A "$DB/data/extracts" | tr '\n' ' ')]"
echo "tmp-* anywhere under data/: $(find "$DB/data" -name 'tmp-*' 2>/dev/null | wc -l | tr -d ' ')"
echo "fixtures dir: [$(ls -A "$FIX" | tr '\n' ' ')]  count=$(ls -A "$FIX" | wc -l | tr -d ' ')"
echo "post-DB hashes: [$(q "select sha256 from documents;" | tr '\n' ' ')]"
echo "PRE_SHA still present in DB (0 because DB started empty): $(printf '%s' "$PRE_SHA" | grep -c .)"