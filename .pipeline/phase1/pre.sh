# Common preamble — sourced by every T-block. Usage: . "$ROOT/.pipeline/phase1/pre.sh"
#
# PATH NOTE (this host): MSYS path translation is DISABLED and curl/node/psql
# are native Windows binaries. A /d/... path passed to them is resolved against
# the CURRENT DRIVE (=> D:\d\...), which silently discards responses — that
# cost an earlier attempt. So ROOT is set from git-bash's own realpath (always
# correct, D:/ form) and every path used by the suite derives from it.
export ROOT="D:/Develop/knowledge-app"
export P1="$ROOT/.pipeline/phase1"
export FIX="$P1/fixtures"
export DB="$ROOT/server"
export ROOTW="$ROOT"
export P1W="$P1"
export FIXW="$FIX"
export DBW="$DB"
export PATH="/c/Users/PC_DEV/AppData/Local/Author Software/nvm/.nodejs:$PATH"
. "$P1/lib.sh"
