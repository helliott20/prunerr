# Prunerr telemetry receiver

The endpoint that answers one question: **how many Prunerr installs are still
running?**

It is a Cloudflare Worker backed by a D1 (SQLite) database. The source is here
rather than on a private server on purpose — the promise Prunerr makes in its
UI ("a random ID and a version number, nothing else") is only worth anything if
the receiving end is auditable too.

```
packaging/telemetry/
├─ src/worker.js          # the receiver
├─ src/announcements.js   # the in-app "What's new" feed
├─ src/admin.js           # the editor for that feed, served at /admin
├─ announce.mjs           # CLI alternative for publishing to the feed
├─ schema.sql             # one row per install
└─ wrangler.toml          # deployment config
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

## Deployed

Live at **https://prunerr-telemetry.harryelliott16.workers.dev**, with the
public count at
[`/v1/stats`](https://prunerr-telemetry.harryelliott16.workers.dev/v1/stats).
`DEFAULT_TELEMETRY_ENDPOINT` in `server/src/config/index.ts` points at it, so
released builds report to it.

The D1 database and its schema are provisioned and `wrangler.toml` carries the
real `database_id`, so there is nothing to paste.

## Redeploying

After changing `src/worker.js`:

```bash
cd packaging/telemetry
npx wrangler login    # once; opens a browser
npx wrangler deploy
```

`./deploy.sh` does the same thing with the database checks and schema re-apply
included (every statement is `IF NOT EXISTS`, so it is a no-op on an existing
database). A freshly deployed `workers.dev` hostname can take up to a minute to
start answering — a 1042 or a 500 straight after deploy is propagation, not a
broken Worker.

Deploying to a **different** Cloudflare account means creating a new database
(`npx wrangler d1 create prunerr-telemetry`), putting its id in
`wrangler.toml`, applying `schema.sql`, and pointing
`DEFAULT_TELEMETRY_ENDPOINT` at the new hostname. An empty endpoint makes
Prunerr send nothing at all, regardless of any toggle — which is what stops a
build being pointed at a URL somebody else controls.

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

## The "What's new" feed

The same Worker serves the announcements shown in Prunerr's sidebar panel, so
a feature announcement or a request for feedback reaches every install
without a release. Prunerr fetches `GET /v1/announcements?version=<its
version>` every six hours (and on boot) and caches the result in its own
database. Nothing ships in the image: until something is published here,
the panel is empty. It is switched off by the same Privacy toggle as the
heartbeat, and by `TELEMETRY_ENABLED=false`.

Reads are anonymous and nothing about the request is stored; the version in
the query string only lets `minVersion`/`maxVersion` on an entry target a
release.

### One-time setup

```bash
cd packaging/telemetry
npx wrangler kv namespace create ANNOUNCEMENTS   # paste the id into wrangler.toml
npx wrangler secret put ADMIN_TOKEN              # a long random string; writes need it
npx wrangler deploy
```

### Publishing from the browser

Open **https://prunerr-telemetry.harryelliott16.workers.dev/admin** and paste
the `ADMIN_TOKEN`. The everyday path is three fields: a title, a message, and
optionally a picture (drop, paste or pick from the library). **Save** keeps it
as a draft; **Publish** (or Cmd/Ctrl+S) shows exactly what will change and
pushes it to every install.

What else is there:

- **Live preview** of the card as it appears in Prunerr, both the popup and
  the expanded view.
- **Pop up for everyone** (pinned) makes it open on its own, once per person.
- **More options**: a button link, show-from and hide-after dates, and a
  version range with a live "reaches about N of M installs" estimate from
  the install counter.
- **Status chips** (live, scheduled, expired, pinned, edited) with search and
  filters; **Duplicate**, **Delete**, **Discard changes**, **Export JSON**.
- An **image library** showing what is uploaded and what is in use.

The page is a single static file served by the Worker. The token stays in
your browser (session-only unless you tick "Remember on this device") and is
sent as a bearer header on each write; the page itself carries no
privileges. It is served only over HTTPS with a strict per-request CSP, no
caching, and `noindex`, and it renders announcement text as text, never as
HTML. There is no account system to reset: if the token leaks, run
`npx wrangler secret put ADMIN_TOKEN` again and every existing session is
signed out.

### Publishing from the command line

```bash
export PRUNERR_ANNOUNCE_TOKEN='<the ADMIN_TOKEN>'

node announce.mjs pull > feed.json     # the live feed, ready to edit
node announce.mjs image ./hero.png     # prints the URL to put in imageUrl
node announce.mjs push feed.json       # replace the feed
node announce.mjs show                 # what installs now see
```

The entry format is documented at the top of `announce.mjs`. Everything is
keyed by `id`: keep an id stable to edit an announcement in place, remove the
entry to unpublish it, and use a new id when you want it to count as unread
again. Images are capped at 2MB and served from `/v1/images/<name>` with a
day-long cache, so upload a changed picture under a new name.

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
