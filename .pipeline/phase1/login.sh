# login.sh — refresh $TOKEN only (no baseline assertions), for re-runs.
. D:/Develop/knowledge-app/.pipeline/phase1/pre.sh
. "$P1/env.sh"
TOKEN=$(curl -s -X POST "$SERVER/api/auth/login" -H 'Content-Type: application/json' --data @- <<JSON | $JGET - token
{"username":"$ADMIN_USERNAME","password":"$ADMIN_PASSWORD"}
JSON
)
rm -f /tmp/p1.env.* 2>/dev/null || true
export TOKEN
echo "token refreshed: length ${#TOKEN}"