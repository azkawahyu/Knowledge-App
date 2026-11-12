# T2 — login once, export TOKEN, capture baseline counts.
# The credentials are expanded inside a heredoc body (never argv, never echoed).
. /d/Develop/knowledge-app/.pipeline/phase1/pre.sh
. "$P1/env.sh"
echo "creds loaded: ADMIN_USERNAME set=$([ -n "$ADMIN_USERNAME" ] && echo yes) ADMIN_PASSWORD set=$([ -n "$ADMIN_PASSWORD" ] && echo yes)"
echo "server config: PORT=$PORT HOST=$HOST LOG_LEVEL=$LOG_LEVEL"

TOKEN=$(curl -s -X POST "$SERVER/api/auth/login" -H 'Content-Type: application/json' --data @- <<JSON | $JGET - token
{"username":"$ADMIN_USERNAME","password":"$ADMIN_PASSWORD"}
JSON
)
rm -f /tmp/p1.env.* 2>/dev/null || true
echo "token length: ${#TOKEN} (expect > 100)"
export TOKEN

DOC0=$(doccount); CHUNK0=$(chunkcount)
echo "documents=$DOC0 chunks=$CHUNK0"
echo "admins=$(admincount) audit_log=$(auditcount)"
BEFORE_UPLOADS=$(ls "$DB/data/uploads" | sort)
echo "BEFORE_UPLOADS listing: [${BEFORE_UPLOADS}] (files=$(uplcount))"
PRE_SHA=$("$PSQL" $PGARGS -tAc "select sha256 from documents;" 2>/dev/null | tr -d ' \r' | grep . | LC_ALL=C sort -u)
echo "pre-existing document hashes: $(printf '%s' "$PRE_SHA" | grep -c .)"
[ "$DOC0" = 0 ] || { echo "  NON-EMPTY BASELINE — stop and report before running the suite"; FAILED=1; }
echo "baseline gate: documents=$DOC0 (want 0) chunks=$CHUNK0 (want 0) uploads=$(uplcount) (want 0) tmp=$(tmpcount) (want 0)"
echo "FAILED=$FAILED"