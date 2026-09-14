# Anonymous install count

Prunerr counts how many installs are out there. That is the whole feature, and
this page is the complete description of it.

## What is sent

Once a day, one HTTPS request:

```json
{
  "installId": "6d1a4f2e-8b3c-4a71-9f02-2b9c1d3e4f50",
  "version": "1.4.10"
}
```

- **`installId`** — a random UUID generated on this install's first run and
  stored in your own database. It is not derived from your hostname, your MAC
  address, your Plex token or anything else about your machine. It identifies
  one install as "the same install as yesterday", which is what turns a pile of
  requests into a count of running installs.
- **`version`** — which Prunerr release is running, so it's possible to tell
  whether people are actually getting updates.

## What is not sent

No library contents. No titles, paths or file sizes. No rules. No service URLs,
API keys or tokens. No hostname. No username or email. No IP address is stored
at the receiving end. There is no analytics SDK, no session tracking, no
cookies, and nothing is sent while you use the UI.

The exact payload is shown to you in **Settings → System → Privacy**, filled in
with your real values, so you can compare it against your own firewall logs
rather than take this page's word for it.

## Turning it off

Any one of these:

- **Settings → System → Privacy** — flip the switch off.
- The **Turn it off** button on the notice that appears on first run.
- Set `TELEMETRY_ENABLED=false` in your environment. This is a hard off switch:
  no heartbeat is sent and no install ID is generated, regardless of the
  in-app setting. The Settings toggle shows as locked when it's set.

Turning it off **deletes the install ID** from your database. It is not kept
and quietly reused if you turn it back on — you get a fresh one, and the old
install ages out of the count. Nothing is retained locally.

## How it behaves

- Sent once at startup and then at most once every 20 hours. The scheduler
  checks hourly, so installs spread themselves across the day by boot time
  instead of all reporting at the same minute.
- The request times out after 5 seconds and never retries. An install with no
  internet access, or one behind a firewall that blocks it, works exactly as
  normal — the failure is logged at debug level and forgotten.
- It never blocks startup, never fails a scheduled task, and never shows an
  error in the UI.
- The install ID is excluded from settings export and ignored on settings
  import, so restoring a backup on a second machine creates a second install
  rather than two machines claiming to be one.

## The receiving end

The server is a Cloudflare Worker whose complete source is in this repository
at [`packaging/telemetry`](../packaging/telemetry) — including the database
schema and its tests. A privacy promise about a server you can't see isn't
worth much, so you can read exactly what happens to the request.

In short: it stores one row per install (`install_id`, `version`, `first_seen`,
`last_seen`), request logging is disabled, and the ingest handler never reads
the client IP. Installs not seen for 90 days are deleted.

The aggregate count is public — anyone can check it, including you:

    https://prunerr-telemetry.harryelliott16.workers.dev/v1/stats

## Why it's on by default

An opt-in counter mostly measures who opts in, which doesn't answer the
question. So it ships on, with a notice on first run that says what it does and
offers to turn it off on the spot.

For comparison: Sonarr and Radarr's built-in analytics collect rather more than
this — browser information, which pages you use, error reports, OS and runtime
versions. Prunerr sends two fields.
