# Prunerr telemetry receiver

The endpoint that answers one question: **how many Prunerr installs are still
running?**

It is a Cloudflare Worker backed by a D1 (SQLite) database. The source is here
rather than on a private server on purpose — the promise Prunerr makes in its
UI ("a random ID and a version number, nothing else") is only worth anything if
the receiving end is auditable too.

```
packaging/telemetry/
├─ src/worker.js   # the whole receiver
├─ schema.sql      # one row per install
└─ wrangler.toml   # deployment config
```

## What it stores

| Column       | Example                                | Why |
|--------------|----------------------------------------|-----|
| `install_id` | `3f2a...` (random UUID from the install) | Distinguishes one install from another so the count isn't just "number of pings" |
| `version`    | `1.4.10`                               | Tells you whether people are actually updating |
| `first_seen` | unix seconds                           | New installs over time |
| `last_seen`  | unix seconds                           | "Live" = seen in the last 30 days |

That is the complete list. **No IP addresses**, no user agents, no geolocation,
no request logs, no library data, no settings, no credentials. The ingest
handler never reads `CF-Connecting-IP` or the Cloudflare `cf` object, and
`[observability] enabled = false` in `wrangler.toml` keeps request logging off.

The row is assembled field by field from an allowlist — the request body is
never spread into the insert — so a field the Worker wasn't taught to expect
cannot silently become a stored column. `install_id` must match a UUID pattern
and `version` a short semver-ish pattern; anything else is a `400`. A hostname,
an email or a file path cannot be smuggled through either field.

## Why one row per install

A heartbeat is an `UPSERT` that moves `last_seen`, not an append. Two
consequences:

- The table never grows past the number of installs that have ever reported,
  and daily writes equal the number of *active* installs — not the number of
  pings. On D1's free plan (100k row writes/day, hard-enforced since
  1 September 2026) that comfortably covers tens of thousands of installs.
- There is no ping history to leak, because none is kept.

A daily cron records the day's count into `daily_counts` (a number, no IDs) and
deletes installs not seen for 90 days.

## Deploy

Free tier throughout; no domain purchase needed.

```bash
cd packaging/telemetry
npx wrangler login

# 1. Create the database — this prints a database_id.
npx wrangler d1 create prunerr-telemetry

# 2. Paste that id into wrangler.toml (database_id = "...").

# 3. Create the tables.
npx wrangler d1 execute prunerr-telemetry --remote --file=./schema.sql

# 4. Ship it.
npx wrangler deploy
```

Deploy prints the hostname, e.g.
`https://prunerr-telemetry.<your-subdomain>.workers.dev`.

**5. Point Prunerr at it.** Set `DEFAULT_TELEMETRY_ENDPOINT` in
`server/src/config/index.ts` to `<that hostname>/v1/ping`. Until that constant
is filled in, Prunerr sends nothing at all — an empty endpoint means telemetry
is inert regardless of any toggle, so that no build can be pointed at a URL
somebody else controls.

## Endpoints

```bash
# One heartbeat.
curl -X POST https://<host>/v1/ping \
  -H 'Content-Type: application/json' \
  -d '{"installId":"6d1a4f2e-0000-4000-8000-2b9c1d3e4f50","version":"1.4.10"}'
# -> 204

# The public count.
curl https://<host>/v1/stats
# -> {"activeInstalls":128,"windowDays":30,"versions":[{"version":"1.4.10","count":91}],...}
```

`/v1/stats` is public, CORS-enabled and cached for 15 minutes, so it can be
fetched straight from a README badge or a stats page.

Visiting `/` returns a plain-English description of what the endpoint does —
worth keeping, since that URL is the first thing anyone finds when they spot
the outbound request in their firewall logs.

## Checking it without deploying

```bash
cd packaging/telemetry
npx wrangler d1 execute prunerr-telemetry --local --file=./schema.sql
npx wrangler dev
```

`wrangler dev` serves on `http://localhost:8787`; point a dev Prunerr at it
with `TELEMETRY_URL=http://localhost:8787/v1/ping`.

## Cost

Zero at any plausible Prunerr scale. The free plan gives 100k Worker
requests/day, 5M D1 row reads/day and 100k D1 row writes/day; one install
consumes roughly one request, one read and one write per day.
