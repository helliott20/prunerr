# TrueNAS

Two routes onto TrueNAS, in increasing order of effort.

## 1. Install via YAML (works today, no submission needed)

TrueNAS Community Edition 25.04 ("Fangtooth") replaced the old Kubernetes app
layer with plain Docker Compose, so a custom app is just a compose file:

1. **Apps** → **Discover Apps** → the three-dot menu → **Install via YAML**.
2. Paste `docker-compose.yml` from this folder into **Custom Config**.
3. Edit the two `EDIT ME` lines — the dataset path and your timezone.
4. Install, then open `http://<truenas-ip>:9393`.

Everything else (Plex/Jellyfin/Emby, Sonarr, Radarr) is configured in the web
UI, so there are no API keys to put in the YAML.

### Why host port 9393 and not 3000

Under the old Kubernetes backend TrueNAS refused any node port below 9000 — a
limit inherited from upstream Kubernetes, not a TrueNAS choice. The Docker
backend in 25.04+ dropped the restriction and only warns about ports already in
use, but defaulting to 9393 keeps the same YAML working on older installs and
steers clear of the low ports TrueNAS uses for its own services. Change it
freely if 3000 is free on your box.

### Permissions

The container starts as root, then drops to `PUID`/`PGID` via `su-exec`, so it
can chown its own data directory on first run. `568:568` is the built-in
TrueNAS `apps` user; if the dataset you mount is owned by someone else, set
`PUID`/`PGID` to match or Prunerr will not be able to write `prunerr.db`.

Do **not** add a `user:` key to the compose — that bypasses the entrypoint's
setup and breaks the first-run chown.

## 2. Get listed in the community catalog (bigger lift)

An app in **Apps → Discover** proper lives in
[`truenas/apps`](https://github.com/truenas/apps) under
`ix-dev/community/prunerr/` and needs rather more than a compose file:

```
ix-dev/community/prunerr/
├─ app.yaml                       # metadata; train: community, version starts at 1.0.0
├─ ix_values.yaml                 # image repo/tag and container-name constants
├─ questions.yaml                 # the install form schema (ports, storage, resources)
├─ README.md
└─ templates/
   ├─ docker-compose.yaml         # Jinja2 template using the ix_lib render API
   └─ test_values/basic-values.yaml   # CI fixture covering every question
```

Notes from their `CONTRIBUTIONS.md` worth knowing before starting:

- Only `ix-dev/` and `library/` may be edited; everything else is generated.
- `lib_version` must be the current 2.x library version in `library/`.
- Port defaults must not collide — `./.github/scripts/port_validation.py`
  checks this.
- Icons and screenshots are attached to the PR; a reviewer uploads them to the
  CDN rather than you committing them.
- iX review the PR by hand and "reserve the right to reject, remove, or
  unpublish any application at its sole discretion".

The Jinja2 template against their render library is the real work here. Worth
doing once the YAML route has proven there's TrueNAS demand.
