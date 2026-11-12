#!/usr/bin/env bash
# Phase 2 / Part A — seed p2test + assert guards G1..G8 (plan §A3.1, §A3.4).
# Every psql call: -X (no psqlrc), ON_ERROR_STOP=1, explicit `SET search_path = p2test`.
set -uo pipefail
cd "D:/Develop/knowledge-app"
psql() {
  PGPASSWORD="$PGPASSWORD" "/d/Install/PostgreSQL/18/bin/psql.exe" \
    -h 127.0.0.1 -p 5432 -U knowledge_app -d knowledge_app -X -q -v ON_ERROR_STOP=1 "$@"
}
q() { psql -tA -c "$1"; }

fails=0
chk() { # name expected actual
  if [ "$2" = "$3" ]; then printf 'G%-3s %-58s expected=%-6s actual=%-6s PASS\n' "$1" "$4" "$2" "$3";
  else printf 'G%-3s %-58s expected=%-6s actual=%-6s FAIL\n' "$1" "$4" "$2" "$3"; fails=$((fails+1)); fi
}

# --- extract the DB password from DATABASE_URL without echoing it ---
PGPASSWORD="$(sed -nE 's#^DATABASE_URL=postgresql://[^:]+:([^@]*)@.*#\1#p' server/.env)"
export PGPASSWORD

if [ "${1:-}" = "seed" ]; then
  echo "=== SEED (server/src/db/schema.ts DDL + §A3.2 fixture) ==="
  HASH="$(cat server/.p2tmp/admin_hash.txt)"
  psql -v admin_hash="$HASH" -f .pipeline/p2/seed_fixture.sql && echo "seed: OK"
fi

echo
echo "=== GUARDS (each run with SET search_path = p2test) ==="
chk 1 p2test "$(q 'SET search_path = p2test; SELECT current_schema();')" "current_schema()"
chk 2 2      "$(q "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('documents','chunks');")" "public plans documents+chunks exist"
chk 2b 0     "$(q 'SELECT count(*) FROM public.chunks;')" "public.chunks rows (fixture invisible there)"
chk 3 182    "$(q 'SELECT count(*) FROM f1test.documents;')" "f1test.documents untouched"
chk 4 0      "$(q "SET search_path = p2test; SELECT count(*) FROM documents WHERE name NOT LIKE 'p2-%';")" "p2test docs not named p2-*"
chk 5 11     "$(q 'SET search_path = p2test; SELECT count(*) FROM chunks;')" "p2test.chunks (G5 = 11)"
chk 6 9      "$(q 'SET search_path = p2test; SELECT count(*) FROM documents;')" "p2test.documents (G6 = 9)"
chk 7 1      "$(q 'SET search_path = p2test; SELECT count(*) FROM admins;')" "p2test.admins (R7 side effect)"
chk 8 1      "$(q "SELECT count(*) FROM pg_namespace WHERE nspname='p2test';")" "pg_namespace p2test = 1 (pre-DROP)"
echo "guard_failures=$fails"
