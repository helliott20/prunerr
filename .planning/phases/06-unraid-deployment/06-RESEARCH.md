# Phase 6: Unraid Deployment - Research

**Researched:** 2026-01-24
**Domain:** Unraid Community Applications, Docker template packaging, container health monitoring
**Confidence:** HIGH

## Summary

This phase focuses on packaging Prunerr for seamless deployment via Unraid Community Applications. The project already has a working Dockerfile with health checks, docker-compose configuration, and a draft unraid-template.xml that needs refinement.

The standard approach for Unraid CA deployment involves:
1. Publishing a Docker image to a registry (Docker Hub or GHCR)
2. Creating a properly formatted XML template following Unraid's DockerTemplateSchema
3. Setting up a GitHub template repository that CA can reference
4. Ensuring proper volume mappings for data persistence
5. Implementing Docker HEALTHCHECK that reports status to Unraid dashboard

The existing infrastructure is well-suited for this phase. The current Dockerfile already includes a HEALTHCHECK instruction and the /api/health endpoint returns appropriate status codes. The main work involves refining the XML template, publishing the Docker image, and setting up the template repository structure.

**Primary recommendation:** Use the existing Dockerfile with minor refinements, publish to Docker Hub or GHCR, and create a dedicated template repository following the patterns established by Tautulli and similar projects.

## Standard Stack

The established tools/patterns for Unraid CA deployment:

### Core
| Component | Version/Format | Purpose | Why Standard |
|-----------|----------------|---------|--------------|
| Docker HEALTHCHECK | Dockerfile instruction | Container health reporting | Native Docker feature, integrates with Unraid dashboard |
| XML Template | Container version="2" | CA plugin configuration | Required format for Unraid Community Applications |
| Docker Hub/GHCR | Registry | Image distribution | Standard registries supported by Unraid |
| GitHub Actions | CI/CD | Automated builds | Industry standard for Docker image publishing |

### Supporting
| Component | Purpose | When to Use |
|-----------|---------|-------------|
| docker/build-push-action | Multi-arch builds | Publishing to registries |
| docker/setup-qemu-action | ARM64 emulation | Building for Unraid ARM devices |
| docker/setup-buildx-action | Advanced builds | Multi-platform image creation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Docker Hub | GHCR | GHCR integrates better with GitHub but Docker Hub has wider recognition |
| Single-arch | Multi-arch | Multi-arch (amd64/arm64) supports more Unraid installations but adds build complexity |

## Architecture Patterns

### Recommended Repository Structure

For the template repository (can be in main repo or separate):

```
unraid/
├── templates/
│   └── prunerr.xml        # Main CA template
└── images/
    └── prunerr-icon.png   # 128x128 PNG icon
```

Or in the main repository:
```
project-root/
├── Dockerfile              # (existing)
├── docker-compose.yml      # (existing)
├── unraid-template.xml     # CA template (existing, needs updates)
└── assets/
    └── icon.png            # App icon for CA
```

### Pattern 1: Docker HEALTHCHECK Configuration
**What:** Dockerfile HEALTHCHECK instruction that reports container health to Unraid
**When to use:** Always - required for UNRAID-03 requirement

```dockerfile
# Source: Docker documentation + existing Dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1
```

**Exit codes:**
- 0: Container is healthy
- 1: Container is unhealthy

**Health states:**
- `starting`: During start_period, failures are ignored
- `healthy`: Health check passing
- `unhealthy`: Consecutive failures exceed retry count

### Pattern 2: XML Template Structure
**What:** Unraid CA template with proper Config elements
**When to use:** Required for CA publication

```xml
<?xml version="1.0"?>
<Container version="2">
    <Name>Prunerr</Name>
    <Repository>yourusername/prunerr:latest</Repository>
    <Registry>https://hub.docker.com/r/yourusername/prunerr</Registry>
    <Network>bridge</Network>
    <Privileged>false</Privileged>
    <Support>https://github.com/yourusername/prunerr/issues</Support>
    <Project>https://github.com/yourusername/prunerr</Project>
    <Overview>Media library cleanup tool for Plex/Sonarr/Radarr</Overview>
    <Category>MediaServer:Management Tools:</Category>
    <WebUI>http://[IP]:[PORT:3000]/</WebUI>
    <Icon>https://raw.githubusercontent.com/yourusername/prunerr/main/assets/icon.png</Icon>
    <TemplateURL>https://raw.githubusercontent.com/yourusername/prunerr/main/unraid-template.xml</TemplateURL>

    <!-- Port Configuration -->
    <Config Name="Web UI Port" Target="3000" Default="3000" Mode="tcp"
            Description="Port for the web interface"
            Type="Port" Display="always" Required="true" Mask="false">3000</Config>

    <!-- Data Path - CRITICAL for persistence -->
    <Config Name="Config Path" Target="/app/data" Default="/mnt/user/appdata/prunerr"
            Mode="rw" Description="Path to store database and configuration"
            Type="Path" Display="always" Required="true" Mask="false">/mnt/user/appdata/prunerr</Config>

    <!-- Standard Unraid user/group -->
    <Config Name="PUID" Target="PUID" Default="99"
            Description="User ID for file permissions"
            Type="Variable" Display="advanced" Required="false" Mask="false">99</Config>

    <Config Name="PGID" Target="PGID" Default="100"
            Description="Group ID for file permissions"
            Type="Variable" Display="advanced" Required="false" Mask="false">100</Config>
</Container>
```

### Pattern 3: Volume Mapping for Persistence
**What:** Proper host-to-container path mapping for SQLite database
**When to use:** Always - required for UNRAID-02 requirement

```
Host: /mnt/user/appdata/prunerr
Container: /app/data

Contents:
  - prunerr.db (SQLite database)
  - Any other persistent configuration
```

**Critical:** The container must use the DATA_DIR environment variable (/app/data) for all persistent storage.

### Pattern 4: GitHub Actions Multi-Arch Build
**What:** Workflow for building and pushing multi-platform images
**When to use:** For supporting both AMD64 and ARM64 Unraid servers

```yaml
# Source: Docker documentation
name: Build and Push Docker Image

on:
  release:
    types: [published]
  push:
    tags:
      - 'v*'

jobs:
  docker:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ vars.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: |
            yourusername/prunerr:latest
            yourusername/prunerr:${{ github.ref_name }}
```

### Anti-Patterns to Avoid
- **Hardcoded paths in container:** Use environment variables (DATA_DIR) not hardcoded /app/data
- **Missing PUID/PGID support:** Unraid expects PUID=99 and PGID=100 by default; container must respect these
- **Using /mnt/user/appdata directly:** Write to /mnt/cache/appdata for performance if cache is available
- **Omitting start_period in HEALTHCHECK:** Container may fail health checks during startup initialization

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multi-arch builds | Custom build scripts | docker/build-push-action | Handles QEMU, buildx, platform matrix |
| Docker auth | Manual token handling | docker/login-action | Secure credential handling |
| Image tagging | Manual tag parsing | docker/metadata-action | Generates tags from git refs |
| Icon hosting | Self-hosted CDN | raw.githubusercontent.com | Free, reliable, commonly used |

**Key insight:** The Docker GitHub Actions ecosystem has mature, well-tested actions for CI/CD. Rolling your own introduces security and reliability risks.

## Common Pitfalls

### Pitfall 1: SQLite Database Corruption on Unraid
**What goes wrong:** SQLite database corruption when writing through /mnt/user share
**Why it happens:** Unraid's user share has overhead and can cause issues with SQLite WAL mode
**How to avoid:**
- Use direct cache path: /mnt/cache/appdata/prunerr instead of /mnt/user/appdata/prunerr
- Ensure proper file locking
- Consider PRAGMA journal_mode settings
**Warning signs:** Random "database is locked" errors, container restart loops

### Pitfall 2: Health Check Fails During Startup
**What goes wrong:** Container marked unhealthy before it's ready
**Why it happens:** HEALTHCHECK runs before the Node.js server is fully initialized
**How to avoid:**
- Use `--start-period=10s` (or longer) in HEALTHCHECK
- Ensure /api/health endpoint responds quickly
- Current Dockerfile uses 5s which may be too short
**Warning signs:** Container cycling between healthy/unhealthy on startup

### Pitfall 3: File Permission Issues
**What goes wrong:** Container can't write to mounted volumes
**Why it happens:** PUID/PGID not properly applied or container running as wrong user
**How to avoid:**
- Implement PUID/PGID environment variable handling in entrypoint
- Ensure chown runs on /app/data at container startup
- Use nobody:users (99:100) as Unraid default
**Warning signs:** "Permission denied" errors in logs, database not created

### Pitfall 4: Template Not Appearing in CA
**What goes wrong:** Template created but not visible in Community Applications
**Why it happens:** XML formatting issues, missing fields, or repository not indexed
**How to avoid:**
- Follow exact XML schema (Container version="2")
- Include all required fields (Name, Repository, Overview, Category)
- Use raw GitHub URLs for TemplateURL
- Test template locally first
**Warning signs:** Template works when manually added but not in CA search

### Pitfall 5: Icon Not Displaying
**What goes wrong:** Template loads but shows generic icon
**Why it happens:** Icon URL not HTTPS, wrong format, or returns 404
**How to avoid:**
- Use HTTPS URLs only
- Use PNG format (128x128 recommended)
- Host on raw.githubusercontent.com
- Test URL directly in browser
**Warning signs:** Broken image icon in Unraid Docker tab

## Code Examples

Verified patterns from official sources:

### Current Health Endpoint (existing code)
```typescript
// Source: server/src/routes/health.ts
router.get('/', (_req: Request, res: Response) => {
  let dbStatus: 'connected' | 'disconnected' = 'disconnected';

  try {
    const db = getDatabase();
    db.prepare('SELECT 1').get();
    dbStatus = 'connected';
  } catch (error) {
    dbStatus = 'disconnected';
  }

  const health = {
    status: dbStatus === 'connected' ? 'healthy' : 'unhealthy',
    // ... additional fields
  };

  const statusCode = health.status === 'unhealthy' ? 503 : 200;
  res.status(statusCode).json(health);
});
```

This is already correct for Docker HEALTHCHECK - returns 200 for healthy, 503 for unhealthy.

### Dockerfile HEALTHCHECK (existing)
```dockerfile
# Source: Dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1
```

**Recommendation:** Increase start-period to 10s for more reliable startup.

### XML Config Types Reference
```xml
<!-- Port type -->
<Config Name="Web UI Port" Target="3000" Default="3000" Mode="tcp"
        Type="Port" Display="always" Required="true">3000</Config>

<!-- Path type (volume mapping) -->
<Config Name="Config" Target="/app/data" Default="/mnt/user/appdata/prunerr"
        Mode="rw" Type="Path" Display="always" Required="true">/mnt/user/appdata/prunerr</Config>

<!-- Variable type (environment) -->
<Config Name="PUID" Target="PUID" Default="99"
        Type="Variable" Display="advanced" Required="false">99</Config>

<!-- Variable with mask (secrets) -->
<Config Name="Plex Token" Target="PLEX_TOKEN" Default=""
        Type="Variable" Display="always" Required="true" Mask="true"></Config>
```

### Display Attribute Options
- `always` - Always visible in basic view
- `advanced` - Only visible in advanced view
- `always-hide` - Hidden but applied
- `advanced-hide` - Hidden in advanced view but applied

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single-arch images | Multi-arch (amd64/arm64) | 2023+ | Supports ARM-based Unraid servers |
| Docker Hub only | GHCR as alternative | 2020+ | Better GitHub integration, no rate limits |
| Manual template repos | Automated with GitHub Actions | 2022+ | Auto-update templates on release |
| Container version="1" | Container version="2" | Unraid 6.2+ | Required for modern CA features |

**Deprecated/outdated:**
- XML schema version 1: Use version="2" for all new templates
- Single-platform builds: Multi-arch is now expected
- Self-hosted template repositories: GitHub raw URLs are preferred

## Open Questions

Things that couldn't be fully resolved:

1. **Docker Hub vs GHCR preference**
   - What we know: Both work with Unraid CA
   - What's unclear: Which is preferred by the community
   - Recommendation: Use Docker Hub for wider recognition, or GHCR for better GitHub integration

2. **Icon design requirements**
   - What we know: PNG format, HTTPS URL required
   - What's unclear: Exact size requirements (128x128 is common)
   - Recommendation: Create 128x128 PNG, test in Unraid UI

3. **PUID/PGID implementation in Node.js**
   - What we know: LinuxServer.io uses shell scripts in entrypoint
   - What's unclear: Best approach for Node.js apps without init system
   - Recommendation: May need to add an entrypoint script or run as root with chown

4. **Community Applications submission process**
   - What we know: Requires template repo, support thread on forums
   - What's unclear: Current moderation timeline, exact requirements
   - Recommendation: Start with self-hosted template repo, submit to CA later

## Sources

### Primary (HIGH confidence)
- Docker official docs: [Multi-platform GitHub Actions](https://docs.docker.com/build/ci/github-actions/multi-platform/)
- [Selfhosters.net Unraid templating guide](https://selfhosters.net/docker/templating/templating/)
- [LinuxServer.io PUID/PGID documentation](https://docs.linuxserver.io/general/understanding-puid-and-pgid/)
- Existing project files: Dockerfile, docker-compose.yml, unraid-template.xml, health.ts

### Secondary (MEDIUM confidence)
- [Tautulli Unraid Template](https://github.com/Tautulli/Tautulli-Unraid-Template) - Real-world example
- [Unraid Community Applications documentation](https://docs.unraid.net/unraid-os/using-unraid-to/run-docker-containers/community-applications/)
- Unraid forum discussions on template submission

### Tertiary (LOW confidence)
- Various GitHub template repositories (patterns vary)
- Community forum advice on SQLite persistence

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Based on Docker docs and established Unraid patterns
- Architecture: HIGH - Follows patterns from Tautulli, LinuxServer projects
- Pitfalls: MEDIUM - Based on forum discussions and known SQLite issues
- CA submission process: LOW - Could not access forum thread, based on partial docs

**Research date:** 2026-01-24
**Valid until:** 60 days (Unraid CA patterns are stable)
