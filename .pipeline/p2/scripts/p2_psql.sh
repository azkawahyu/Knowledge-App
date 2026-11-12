#!/usr/bin/env bash
# psql wrapper for the Phase 2 Part A runner.
# psql.exe on Windows requires a terminal for its password prompt, so the password from
# DATABASE_URL is placed in a throw-away PGPASSFILE (mode 600, deleted on exit). It is never
# printed. All arguments are passed straight through to psql.
set -uo pipefail
cd "D:/Develop/knowledge-app/server"
PW="$(sed -nE 's#^DATABASE_URL=postgresql://[^:]+:([^@]*)@.*#\1#p' .env | tr -d '\r')"
if [ -z "$PW" ]; then echo "psql-wrap: no password in DATABASE_URL" >&2; exit 1; fi
PGPASSFILE_TMP="$(mktemp)"
chmod 600 "$PGPASSFILE_TMP"
printf '127.0.0.1:5432:knowledge_app:knowledge_app:%s\n' "$PW" > "$PGPASSFILE_TMP"
trap 'rm -f "$PGPASSFILE_TMP"' EXIT
PGPASSFILE="$PGPASSFILE_TMP" exec "D:/Install/PostgreSQL/18/bin/psql.exe" "$@"
