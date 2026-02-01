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

This triggers the Docker build in `.github/workflows/docker-publish.yml`.

## Related Repositories
- **Main repo**: https://github.com/helliott20/prunerr
- **Unraid templates**: https://github.com/helliott20/unraid-templates
- **Docker Hub**: https://hub.docker.com/r/helliott20/prunerr

## Unraid Support
- **Forum thread**: https://forums.unraid.net/topic/196929-support-prunerr-media-library-cleanup-tool/

## Database Migrations
Migrations are in `/server/src/db/schema.ts`. They run automatically on startup. The migration system handles "duplicate column" errors gracefully for idempotency.

## Key Patterns
- Client uses `camelCase`, server/database uses `snake_case`
- Media type: client uses `'tv'`, server uses `'show'` - conversion happens in routes
- Version is injected at Docker build time via `APP_VERSION` env var
