#!/bin/sh
# Operator smoke test for the local pilot (SYNTHETIC ONLY: fixed synthetic clock, synthetic
# calendar holds, no provider, no network listener). POSIX sh; also runs under zsh:
#
#   sh scripts/operator-smoke.sh      # uses ../sparq-policy/target/debug/sparq-policy-decide
#   zsh scripts/operator-smoke.sh     # or set AWP_SPARQ_POLICY_BIN=/abs/path first
#
# Requires `npm run build`. Everything happens in a fresh temporary directory that is removed
# at the end. Every step below is also the documented operator procedure (OPERATOR-RUNBOOK.md).
set -eu

HERE=$(cd "$(dirname "$0")/.." && pwd)
# The local policy binary: AWP_SPARQ_POLICY_BIN, else the sibling sparq-policy worktree's debug
# build (the same default as `npm run pilot:sparq-cases`). Never the ambient `sparq` command.
: "${AWP_SPARQ_POLICY_BIN:=$(cd "$HERE/.." && pwd)/sparq-policy/target/debug/sparq-policy-decide}"
[ -x "$AWP_SPARQ_POLICY_BIN" ] || {
  printf 'setup-required: no sparq-policy-decide at %s; build it or set AWP_SPARQ_POLICY_BIN\n' \
    "$AWP_SPARQ_POLICY_BIN" >&2
  exit 3
}
WORK=$(mktemp -d "${TMPDIR:-/tmp}/awp-smoke.XXXXXX")
SERVER=""
# Cleanup on ANY exit: close our FIFO writer, stop only OUR server child if it is still alive
# (never anything else), then remove the temporary directory.
cleanup() {
  exec 3>&- 2> /dev/null || true
  if [ -n "$SERVER" ] && kill -0 "$SERVER" 2> /dev/null; then
    kill "$SERVER" 2> /dev/null || true
    sleep 1
    kill -9 "$SERVER" 2> /dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT
trap 'exit 130' INT TERM
# wait_gone PID SECONDS — bounded wait for a child to exit; returns 1 on timeout.
wait_gone() {
  n=0
  while kill -0 "$1" 2> /dev/null; do
    n=$((n + 1))
    [ "$n" -le "$2" ] || return 1
    sleep 1
  done
}
AWP_DIR="$WORK/agents"
AWP_NOW="2026-10-19T08:00:00Z"

# Portable helpers (shell functions, not variables holding a command line).
awp() { node "$HERE/dist/pilot/cli.js" "$@" --dir "$AWP_DIR" --now "$AWP_NOW"; }
mcp() { node "$HERE/scripts/mcp-client.mjs" --dir "$AWP_DIR" --now "$AWP_NOW" "$@"; }
field() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let v=JSON.parse(s);for(const k of process.argv[1].split("."))v=v==null?v:v[k];process.stdout.write(typeof v==="string"?v:JSON.stringify(v))})' "$1"
}
say() { printf '== %s\n' "$*" >&2; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

say "1. initialise two independent agents (owner keys in a SEPARATE owner directory); each records and probes the SPARQ policy module"
OWNERS="$WORK/owners"
awp init --name alice --party 'https://alice.example/#me' \
  --actor 'https://agents.alice.example/personal#agent' --timezone Europe/London \
  --known-party 'https://bob.example/#me' --sparq-bin="$AWP_SPARQ_POLICY_BIN" \
  --owner-dir "$OWNERS" > "$WORK/alice.json"
awp init --name bob --party 'https://bob.example/#me' \
  --actor 'https://agents.hostco.example/bob#agent' --operator 'https://hostco.example/#org' \
  --timezone America/New_York --known-party 'https://alice.example/#me' \
  --sparq-bin="$AWP_SPARQ_POLICY_BIN" --owner-dir "$OWNERS" > "$WORK/bob.json"
[ "$(field policyModule.engine < "$WORK/alice.json")" = sparq ] || fail "alice did not record SPARQ"
for who in alice bob; do
  [ ! -e "$AWP_DIR/$who/keys/owner.private.jwk.json" ] || fail "$who's service directory holds an owner key"
  [ -f "$OWNERS/$who/owner.private.jwk.json" ] || fail "$who's owner key is not in the owner directory"
done

say "2. exchange cards and pin them (in real use, compare these thumbprints out of band)"
awp card --name alice > "$WORK/alice.card.json"
awp card --name bob > "$WORK/bob.card.json"
awp pin --name alice --card "$WORK/bob.card.json" \
  --party-kid="$(field partyKid < "$WORK/bob.json")" \
  --actor-kid="$(field actorKid < "$WORK/bob.json")" > /dev/null
awp pin --name bob --card "$WORK/alice.card.json" \
  --party-kid="$(field partyKid < "$WORK/alice.json")" \
  --actor-kid="$(field actorKid < "$WORK/alice.json")" > /dev/null

say "3. a running MCP server owns the agent: a competing CLI runtime is refused; closing stdin stops it"
mkfifo "$WORK/alice.in"
node "$HERE/dist/pilot/cli.js" mcp --name alice --dir "$AWP_DIR" --now "$AWP_NOW" \
  < "$WORK/alice.in" > "$WORK/alice.mcp.out" 2> "$WORK/alice.mcp.err" &
SERVER=$!
exec 3> "$WORK/alice.in"
i=0
until grep -q 'ready:' "$WORK/alice.mcp.err" 2> /dev/null; do
  i=$((i + 1))
  [ "$i" -le 30 ] || { cat "$WORK/alice.mcp.err" >&2; fail "MCP server did not become ready"; }
  sleep 1
done
if awp status --name alice > /dev/null 2> "$WORK/locked.err"; then
  cat "$WORK/alice.mcp.err" >&2
  fail "a second runtime opened an agent owned by the MCP server"
fi
grep -q 'state is locked' "$WORK/locked.err" || fail "unexpected refusal: $(cat "$WORK/locked.err")"
exec 3>&-
# Closing the only writer is EOF on the server's stdin: it must stop by itself, promptly.
wait_gone "$SERVER" 15 || {
  cat "$WORK/alice.mcp.err" >&2
  fail "MCP server did not stop within 15 s of stdin EOF (it will be killed by cleanup; NOT a pass)"
}
wait "$SERVER" || fail "MCP server exited non-zero"
SERVER=""
grep -q 'stopping (stdin closed)' "$WORK/alice.mcp.err" || fail "server did not observe stdin EOF"
grep -q 'lock released' "$WORK/alice.mcp.err" || fail "no graceful shutdown line"
[ ! -s "$WORK/alice.mcp.out" ] || fail "server wrote to stdout without a client"

say "4. schedule a synthetic meeting over MCP (both servers spawned, messages shuttled, servers stopped)"
mcp schedule alice bob --window-start 2026-10-20T13:00:00Z --window-end 2026-10-20T17:00:00Z \
  > "$WORK/schedule.json"
[ "$(field phases.alice.conversations < "$WORK/schedule.json")" = '["completed"]' ] || fail "alice not completed"
[ "$(field phases.bob.conversations < "$WORK/schedule.json")" = '["completed"]' ] || fail "bob not completed"
[ "$(field phases.alice.holds < "$WORK/schedule.json")" = 1 ] || fail "alice hold count"
[ "$(field phases.bob.holds < "$WORK/schedule.json")" = 1 ] || fail "bob hold count"

say "5. after shutdown the CLI can inspect; a restarted MCP server sees the same state"
[ "$(awp status --name alice | field conversations.0.phase)" = completed ] || fail "CLI status"
[ "$(awp verify-ledger --name bob | field ok)" = true ] || fail "bob ledger"
[ "$(mcp call bob get_status | field conversations.0.phase)" = completed ] || fail "restart status"
[ "$(mcp call bob get_evidence '{"type":"authorisation-decision","limit":1}' | field records.0.record.policy.evaluator | cut -c1-13)" = sparq-policy@ ] \
  || fail "decision not made by SPARQ"

say "6. the documented coding-agent MCP configuration launches a working server"
cat > "$WORK/mcp.json" <<EOF
{
  "mcpServers": {
    "awp-alice": {
      "type": "stdio",
      "command": "node",
      "args": ["$HERE/dist/pilot/cli.js", "mcp", "--name", "alice", "--dir", "$AWP_DIR"]
    }
  }
}
EOF
node "$HERE/scripts/check-mcp-config.mjs" "$WORK/mcp.json" awp-alice > "$WORK/config-check.json" \
  || fail "configured server did not start"
[ "$(field policyModule.evaluator.name < "$WORK/config-check.json")" = sparq-policy ] || fail "config check"

SHELL_LABEL=sh
[ -n "${ZSH_VERSION:-}" ] && SHELL_LABEL="zsh $ZSH_VERSION"
say "OK — all smoke steps passed (shell: $SHELL_LABEL)"
