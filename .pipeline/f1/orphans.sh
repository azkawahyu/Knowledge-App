#!/usr/bin/env bash
# REPORT ONLY. Lists orphan blob / corrupt blob / stale temp / orphan extract /
# dangling-row (MISSING_BLOB) candidates.
# Deletes nothing. Read-only: find/stat/printf/grep/sha256sum + SELECT.
#
# Plan: .pipeline/f1/PLAN.md §6.2 (F1: Blob Orphan Audit & Fix).
# Every record is tab-separated with a leading token, so `awk -F'\t'` / `cut -f2`
# is safe. Exit code is always 0 — this is a report, not a gate. The pipeline
# requires explicit user approval before deleting anything listed here.
#
# Class tokens: ORPHAN_BLOB, HASH_MISMATCH, ZERO_LEN, STALE_TMP, INGEST_TMP,
# ORPHAN_EXTRACT, MISSING_BLOB, LEFTOVER_UPLOAD_TMP (8 after the post-PASS
# follow-up added MISSING_BLOB).
#
# Overridable (T14 points these at a scratch dir + the f1test schema):
#   F1_ROOT        project root (default D:/Develop/knowledge-app)
#   F1_DATA_DIR    data dir    (default $F1_ROOT/server/data)
#   F1_PSQL        psql binary (default D:/Install/PostgreSQL/18/bin/psql.exe)
#   F1_PGARGS      psql args   (default -h 127.0.0.1 -p 5432 -U knowledge_app -d knowledge_app)
#   F1_TMP_AGE_MIN minutes before a temp counts as STALE_TMP (default 60)
set -u
ROOT="${F1_ROOT:-D:/Develop/knowledge-app}"
DB="${F1_DATA_DIR:-$ROOT/server/data}"
UP="$DB/uploads"; EX="$DB/extracts"; TMP="$DB/tmp"
PSQL="${F1_PSQL:-D:/Install/PostgreSQL/18/bin/psql.exe}"
PGARGS="${F1_PGARGS:--h 127.0.0.1 -p 5432 -U knowledge_app -d knowledge_app}"
AGE="${F1_TMP_AGE_MIN:-60}"

HASHES=$("$PSQL" $PGARGS -Atc "SELECT DISTINCT sha256 FROM documents;" 2>/dev/null | tr -d '\r')
in_db () { printf '%s' "$HASHES" | grep -qxF -- "$1"; }

echo "== blobs: orphan (O1) and content-address mismatch (O2/O12) =="
find "$UP" -maxdepth 1 -type f ! -name '.ingest-tmp-*' -printf '%f\n' 2>/dev/null \
 | while read -r f; do
     [ -n "$f" ] || continue
     sha="${f%%.*}"                                   # correct with or without an extension
     # Hash via stdin: with a Windows-style path (backslashes) GNU sha256sum
     # prefixes its output line with '\' and escapes the name, which corrupts
     # `cut -f1`. Reading stdin prints "<hash>  -" and avoids the escaping.
     got=$(sha256sum < "$UP/$f" | cut -d' ' -f1 | tr -d '\r')
     [ "$got" = "$sha" ] || printf 'HASH_MISMATCH\t%s\t%s\t%s\n' "$f" "$sha" "$got"
     in_db "$sha" || printf 'ORPHAN_BLOB\t%s\t%s\t%s\n' "$sha" "$(stat -c %s "$UP/$f")" "$UP/$f"
   done

echo "== zero-length blobs (O2, degenerate case) =="
find "$UP" -maxdepth 1 -type f -size 0 ! -name '.ingest-tmp-*' \
     -printf 'ZERO_LEN\t%f\n' 2>/dev/null

echo "== stale ingest temp files (O10) =="
find "$UP" -maxdepth 1 -type f -name '.ingest-tmp-*' -mmin +"$AGE" \
     -printf 'STALE_TMP\t%f\t%s\n' 2>/dev/null
echo "== all ingest temp files, any age (O10, informational) =="
find "$UP" -maxdepth 1 -type f -name '.ingest-tmp-*' -printf 'INGEST_TMP\t%f\t%s\n' 2>/dev/null

echo "== orphan extracts (O7) =="
find "$EX" -maxdepth 1 -type f -name '*.txt' -printf '%f\n' 2>/dev/null \
 | while read -r f; do
     [ -n "$f" ] || continue
     sha="${f%.txt}"
     in_db "$sha" || printf 'ORPHAN_EXTRACT\t%s\t%s\n' "$sha" "$EX/$f"
   done

echo "== committed rows whose source_path is gone: MISSING_BLOB (O13) =="
# O13 (stale/mismatched source_path) — PLAN §6.1 Q2. A row whose source_path no
# longer exists is the "row without a blob" state that the rename-after-COMMIT
# window (§5.2b) can leave behind, i.e. exactly the direction this fix can fail
# in, so the report must be able to see it. Rows with NULL/empty source_path are
# pre-Phase-1 rows and are skipped: they are not this defect. Deliberately NOT
# pg_stat_file() — the app role gets "permission denied for function
# pg_stat_file", so existence is tested in bash with `[ -f ]` (works for both
# backslash and forward-slash Windows paths). Read-only: SELECT + `[ -f ]`.
# The query status is kept so a failed scan is reported as UNKNOWN on stderr
# rather than silently looking like "clean".
SP_ROWS=$("$PSQL" $PGARGS -At -F $'\t' \
    -c "SELECT id, name, source_path FROM documents WHERE source_path IS NOT NULL AND source_path <> '';" 2>/dev/null)
SP_RC=$?
SP_ROWS=$(printf '%s' "$SP_ROWS" | tr -d '\r')
if [ "$SP_RC" -ne 0 ]; then
    echo "WARN: the MISSING_BLOB scan could not read documents.source_path (psql exit $SP_RC) — UNKNOWN, not clean" >&2
elif [ -n "$SP_ROWS" ]; then
    printf '%s\n' "$SP_ROWS" \
     | while IFS=$'\t' read -r doc_id doc_name doc_sp; do
         [ -n "${doc_sp:-}" ] || continue
         [ -f "$doc_sp" ] || printf 'MISSING_BLOB\t%s\t%s\t%s\n' "$doc_id" "$doc_name" "$doc_sp"
       done
fi

echo "== leftover multer temp files (route tmp, not this fix's class) =="
find "$TMP" -maxdepth 1 -type f -name 'tmp-*' -printf 'LEFTOVER_UPLOAD_TMP\t%f\t%s\n' 2>/dev/null

# Report, not a gate: never fail a caller because a directory is missing.
exit 0
