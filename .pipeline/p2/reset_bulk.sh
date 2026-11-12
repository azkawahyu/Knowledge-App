#!/usr/bin/env bash
# Remove ONLY the p2-bulk-* fixture from p2test (the EXPLAIN fixture), leaving the
# 9-document / 11-chunk functional fixture intact. Used to reset between runner attempts.
# Scoped by name inside p2test; never touches public/f1test. Chunks go with ON DELETE CASCADE.
set -uo pipefail
cd "D:/Develop/knowledge-app"
psql() { bash server/scripts/p2_psql.sh -h 127.0.0.1 -p 5432 -U knowledge_app -d knowledge_app -X -q -v ON_ERROR_STOP=1 "$@"; }
psql -c "SET search_path = p2test;
         DELETE FROM documents WHERE name LIKE 'p2-bulk-%';
         DELETE FROM documents WHERE name = 'p2-upload.txt';"
psql -tA -c "SET search_path = p2test; SELECT count(*) FROM documents;"
psql -tA -c "SET search_path = p2test; SELECT count(*) FROM chunks;"
