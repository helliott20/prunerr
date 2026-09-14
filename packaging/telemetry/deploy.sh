#!/usr/bin/env bash
#
# One-shot deploy for the Prunerr telemetry receiver.
#
#   cd packaging/telemetry
#   npx wrangler login      # once, opens a browser
#   ./deploy.sh
#
# Creates the D1 database if it doesn't exist, writes its id into
# wrangler.toml, applies the schema, deploys the Worker, and prints the
# endpoint to paste into server/src/config/index.ts.
#
# Safe to re-run: every step checks for existing state first.

set -euo pipefail

cd "$(dirname "$0")"

DB_NAME="prunerr-telemetry"
WRANGLER="npx --yes wrangler@latest"

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[31mError: %s\033[0m\n' "$1" >&2; exit 1; }

command -v node >/dev/null || die "node is required but not on PATH."

# --- 0. Authenticated? ------------------------------------------------------

say "Checking Cloudflare login"
if ! $WRANGLER whoami >/dev/null 2>&1; then
  die "Not logged in. Run:  npx wrangler login"
fi
$WRANGLER whoami | sed -n '1,6p' || true

# --- 1. The database --------------------------------------------------------
#
# `d1 create` fails if the database already exists, so list first and only
# create when it's genuinely missing. Either way the id comes from `d1 list`,
# which is a stable JSON contract — unlike scraping the create output.

say "Ensuring D1 database '$DB_NAME' exists"

db_id() {
  $WRANGLER d1 list --json 2>/dev/null | node -e '
    let raw = "";
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      // wrangler can print banner lines before the JSON; start at the array.
      const start = raw.indexOf("[");
      if (start === -1) process.exit(0);
      try {
        const rows = JSON.parse(raw.slice(start));
        // Last argv entry: correct under `node -e script arg` (no filename in
        // argv) and under `node file.js arg` alike.
        const want = process.argv[process.argv.length - 1];
        const hit = rows.find((r) => r.name === want);
        if (hit) process.stdout.write(hit.uuid ?? hit.database_id ?? "");
      } catch {
        /* no match; caller treats empty as "not found" */
      }
    });
  ' "$DB_NAME"
}

DB_ID="$(db_id || true)"

if [ -z "$DB_ID" ]; then
  echo "Not found — creating it."
  $WRANGLER d1 create "$DB_NAME"
  DB_ID="$(db_id || true)"
fi

[ -n "$DB_ID" ] || die "Could not determine the database id. Run 'npx wrangler d1 list' and paste the id into wrangler.toml by hand."
echo "database_id = $DB_ID"

# --- 2. Wire it into wrangler.toml -----------------------------------------

say "Writing database_id into wrangler.toml"
node -e '
  const fs = require("fs");
  const [file, id] = process.argv.slice(1);
  const before = fs.readFileSync(file, "utf8");
  const after = before.replace(/^database_id = ".*"$/m, `database_id = "${id}"`);
  if (after === before && !before.includes(`database_id = "${id}"`)) {
    console.error("Could not find the database_id line to replace.");
    process.exit(1);
  }
  fs.writeFileSync(file, after);
' wrangler.toml "$DB_ID"
grep -n 'database_id' wrangler.toml

# --- 3. Schema --------------------------------------------------------------
#
# schema.sql is entirely CREATE TABLE/INDEX IF NOT EXISTS, so re-applying it
# on an existing database is a no-op rather than destructive.

say "Applying schema"
$WRANGLER d1 execute "$DB_NAME" --remote --file=./schema.sql --yes

# --- 4. Ship ----------------------------------------------------------------

say "Deploying the Worker"
DEPLOY_LOG="$(mktemp)"
trap 'rm -f "$DEPLOY_LOG"' EXIT
$WRANGLER deploy | tee "$DEPLOY_LOG"

HOST="$(grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' "$DEPLOY_LOG" | head -1 || true)"

# --- 5. What to do with it --------------------------------------------------

if [ -z "$HOST" ]; then
  say "Deployed, but the hostname wasn't in the output"
  echo "Find it with 'npx wrangler deployments list' or in the Cloudflare dashboard,"
  echo "then set DEFAULT_TELEMETRY_ENDPOINT as described below."
  exit 0
fi

say "Verifying the endpoint responds"
if curl -fsS --max-time 15 "$HOST/v1/stats"; then
  printf '\n'
else
  echo "Could not reach /v1/stats yet — a fresh Worker can take a few seconds to propagate. Retry:"
  echo "  curl $HOST/v1/stats"
fi

say "Done. One step left."
cat <<EOF
Set this in server/src/config/index.ts (the DEFAULT_TELEMETRY_ENDPOINT constant):

    const DEFAULT_TELEMETRY_ENDPOINT = '$HOST/v1/ping';

Until that constant is set, Prunerr sends nothing at all — an empty endpoint
makes telemetry inert no matter what the in-app toggle says.

Your public count will be at:  $HOST/v1/stats
EOF
