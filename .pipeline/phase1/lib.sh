# Phase 1 test helpers — sourced by each T-block. Never echoes secrets.
ROOT="D:/Develop/knowledge-app"
# Native form for everything — curl/node/psql are native Windows binaries here
# and MSYS path translation is disabled.
ROOTW="$ROOT"
P1="$ROOT/.pipeline/phase1"
P1W="$ROOTW/.pipeline/phase1"
SERVER="http://127.0.0.1:4000"
UPLOAD="$SERVER/api/ingest/upload"
FIX="$P1/fixtures"
FIXW="$P1W/fixtures"
DB="$ROOT/server"
DBW="$ROOTW/server"
PSQL="D:/Install/PostgreSQL/18/bin/psql.exe"
PGARGS="-h 127.0.0.1 -p 5432 -U knowledge_app -d knowledge_app"
JGET="node $P1W/jget-file.cjs"
CHECK="node $P1W/check.cjs"

req ()  { rm -f "$P1/.last.json"; local r; r=$(curl -s -o "$P1W/.last.json" -w '%{http_code}' "$@"); CODE="$r"; BODY=$(cat "$P1/.last.json" 2>/dev/null); }
want () { if [ "$CODE" = "$1" ]; then echo "  status $CODE OK  [$2]"; else echo "  STATUS FAIL want=$1 got=$CODE  [$2]"; FAILED=1; fi; }
chk  () { if $CHECK "$@"; then :; else FAILED=1; fi; }
jget () { $JGET "$@"; }
doccount   () { "$PSQL" $PGARGS -tAc "select count(*) from documents;" 2>/dev/null | tr -d ' \r'; }
chunkcount () { "$PSQL" $PGARGS -tAc "select count(*) from chunks;" 2>/dev/null | tr -d ' \r'; }
admincount () { "$PSQL" $PGARGS -tAc "select count(*) from admins;" 2>/dev/null | tr -d ' \r'; }
auditcount () { "$PSQL" $PGARGS -tAc "select count(*) from audit_log;" 2>/dev/null | tr -d ' \r'; }
q   () { "$PSQL" $PGARGS -tAc "$1" 2>/dev/null | tr -d '\r'; }
tmpcount () { find "$DB/data/tmp" -name 'tmp-*' 2>/dev/null | wc -l | tr -d ' \r'; }
want_tmp0 () { local n; n=$(tmpcount); if [ "$n" = 0 ]; then echo "  tmp clean (0) OK"; else echo "  TMP LEAK: $n file(s): $(find "$DB/data/tmp" -name 'tmp-*' | tr '\n' ' ')"; FAILED=1; fi; }
uplcount () { find "$DB/data/uploads" -type f 2>/dev/null | wc -l | tr -d ' \r'; }
sha256 () { sha256sum "$1" | cut -d' ' -f1; }
# row-scoped asserts
want_docs  () { local n; n=$(doccount);  if [ "$n" = "$1" ]; then echo "  documents=$n OK"; else echo "  DOCS FAIL want=$1 got=$n"; FAILED=1; fi; }
want_chunks() { local n; n=$(chunkcount); if [ "$n" = "$1" ]; then echo "  chunks=$n OK"; else echo "  CHUNKS FAIL want=$1 got=$n"; FAILED=1; fi; }
