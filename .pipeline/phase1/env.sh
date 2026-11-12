# Sources server/.env into the shell WITHOUT echoing any value.
# The file starts with a UTF-8 BOM, which breaks `source` (line 1 becomes
# "$'\357\273\277#': command not found"), so the BOM is stripped into a
# scratch copy first. The scratch copy lives outside the repo and is chmod 600.
ENVF="$ROOT/server/.env"
BOMLESS="/tmp/p1.env.$$"
sed '1s/^\xEF\xBB\xBF//' "$ENVF" > "$BOMLESS"
chmod 600 "$BOMLESS" 2>/dev/null || true
set -a
. "$BOMLESS"
set +a
# keep BOMLESS around only for this shell; it is removed by env_cleanup