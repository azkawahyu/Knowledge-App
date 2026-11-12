# login-token-file.sh — writes a fresh JWT to $P1/.token for the browser probe.
# The token is a short-lived local test credential; the file is removed in cleanup.
. D:/Develop/knowledge-app/.pipeline/phase1/pre.sh
. "$P1/env.sh"
curl -s -X POST "$SERVER/api/auth/login" -H 'Content-Type: application/json' --data @- <<JSON | $JGET - token > "$P1/.token"
{"username":"$ADMIN_USERNAME","password":"$ADMIN_PASSWORD"}
JSON
rm -f /tmp/p1.env.* 2>/dev/null || true
echo "token saved, length $(wc -c < "$P1/.token" | tr -d ' ')"