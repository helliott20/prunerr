# Prunerr Development Guide

## Project Overview
Prunerr is a media library cleanup tool for Plex/Sonarr/Radarr. It helps users reclaim disk space by identifying and removing unwanted content based on customizable rules.

## Tech Stack
- **Backend**: Node.js + Express + TypeScript
- **Frontend**: React + Vite + TailwindCSS
- **Database**: SQLite (better-sqlite3)
- **Deployment**: Docker (multi-arch: amd64/arm64)

## Project Structure
```
/client          # React frontend
/server          # Express backend
/assets          # Icons and images
/my-prunerr.xml  # Unraid template
```

## Release Workflow

**IMPORTANT: Always create a git tag when pushing changes that affect the Docker image.**

The GitHub Actions workflow only triggers on version tags, not on regular pushes to main.

```bash
# After committing changes:
git push
git tag v1.x.x
git push origin v1.x.x
```

This triggers the Docker build in `.github/workflows/docker-publish.yml`, which
publishes `:<version>`, `:<major>.<minor>`, `:<major>` and `:latest`.

**Beta channel.** Pushing to the `beta` branch rebuilds
`helliott20/prunerr:beta` automatically — no tag, no GitHub release, and
`:latest` is untouched (it is only published for release tags without a
pre-release suffix). Unraid users pick Stable or Beta from the template's
branch list; everyone else pulls `helliott20/prunerr:beta`. To put work on the
beta channel:

```bash
git push origin <your-branch>:beta
```

Merge the branch to `main` and tag as usual when it is ready to release.

**Announcements.** The in-app "What's new" panel is fed remotely; publish
from the Worker's `/admin` page (see `packaging/telemetry/README.md`). No
release step is involved.

**IMPORTANT: When releasing a new version, also bump the CasaOS manifest.**

The CasaOS App Store manifest at `packaging/casaos/Prunerr/docker-compose.yml`
pins an exact image tag (CasaOS forbids `:latest`). On every release update all
three fields to the new version, then open a follow-up PR to
`IceWhaleTech/CasaOS-AppStore` so users get the in-store update prompt:
- `image: helliott20/prunerr:<version>` (Docker Hub tags drop the `v` prefix)
- `x-casaos.version: "<version>"`
- `x-casaos.updateAt: "<YYYY-MM-DD>"`

The TrueNAS compose file at `packaging/truenas/docker-compose.yml` pins the
same tag and must be bumped too. CI's "Packaging manifests" job
(`scripts/check-pinned-tags.mjs`) fails when the two pins disagree or name an
unpublished image.

## Related Repositories
- **Main repo**: https://github.com/helliott20/prunerr
- **Unraid templates**: https://github.com/helliott20/unraid-templates
- **Docker Hub**: https://hub.docker.com/r/helliott20/prunerr

## Unraid Support
- **Forum thread**: https://forums.unraid.net/topic/196929-support-prunerr-media-library-cleanup-tool/

## Database Migrations
Migrations are in `/server/src/db/schema.ts`. They run automatically on startup. The migration system handles "duplicate column" errors gracefully for idempotency.

## Attribution
Do not attribute work to Claude anywhere in the repo or on GitHub. No
`Co-Authored-By: Claude` or session-link trailers in commit messages, no
"Generated with Claude Code" lines in PR descriptions, and no Claude footers
on issue, PR, review or discussion comments. Everything should read as coming
from the maintainer.

## Key Patterns
- Client uses `camelCase`, server/database uses `snake_case`
- Media type: client uses `'tv'`, server uses `'show'` - conversion happens in routes
- Version is injected at Docker build time via `APP_VERSION` env var
