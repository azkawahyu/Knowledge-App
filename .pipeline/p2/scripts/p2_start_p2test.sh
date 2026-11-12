#!/usr/bin/env bash
# P-0 (plan §A3.4): start the backend with `npx tsx src/index.ts` against the p2test
# scratch schema via DATABASE_URL + options=-c search_path=p2test.
# NOT `npm start` — that runs the stale un-baselined dist/index.js.
set -uo pipefail
cd "D:/Develop/knowledge-app/server"
BASE="$(sed -nE 's/^DATABASE_URL=(.*)$/\1/p' .env | tr -d '\r')"
if [ -z "$BASE" ]; then echo "BLOCKED: no DATABASE_URL in server/.env"; exit 1; fi
export DATABASE_URL="$BASE"
# DEVIATION D-1 (see IMPLEMENTATION-A.md): §A3.4's `&options=-c%20search_path%3Dp2test`
# appended to DATABASE_URL fails — `npx` normalises env names, libpq ignores lower-case
# `options` and Postgres sees "knowledge_app&options=..." as the database name.
# PGOPTIONS is the libpq-native spelling and is not mangled; the URL stays byte-identical.
export PGOPTIONS="-c search_path=p2test"
echo "starting: npx tsx src/index.ts (PGOPTIONS=-c search_path=p2test)"
exec npx tsx src/index.ts
