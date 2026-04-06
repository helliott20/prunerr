<p align="center">
  <img src="assets/icon.svg" alt="Prunerr Logo" width="128" height="128">
</p>

<h1 align="center">Prunerr</h1>

<p align="center">
  <strong>Intelligent media library cleanup for Plex, Sonarr, and Radarr</strong>
</p>

<p align="center">
  <a href="#features">Features</a> &bull;
  <a href="#installation">Installation</a> &bull;
  <a href="#configuration">Configuration</a> &bull;
  <a href="#usage">Usage</a> &bull;
  <a href="#mobile-access">Mobile</a> &bull;
  <a href="#api">API</a>
</p>

<p align="center">
  <a href="https://hub.docker.com/r/helliott20/prunerr"><img src="https://img.shields.io/docker/pulls/helliott20/prunerr?style=flat-square&color=0db7ed" alt="Docker Pulls"></a>
  <img src="https://img.shields.io/github/license/helliott20/prunerr?style=flat-square" alt="License">
  <a href="https://github.com/helliott20/prunerr/releases"><img src="https://img.shields.io/github/v/release/helliott20/prunerr?style=flat-square&color=brightgreen" alt="Release"></a>
  <a href="https://forums.unraid.net/topic/196929-support-prunerr-media-library-cleanup-tool/"><img src="https://img.shields.io/badge/Unraid-Community%20App-orange?style=flat-square" alt="Unraid"></a>
</p>

---

## What is Prunerr?

Prunerr is a self-hosted media library management tool that automatically identifies and cleans up unwatched, stale, or low-quality content from your Plex library. It integrates with Sonarr, Radarr, Tautulli/Tracearr, and Overseerr to make intelligent decisions about what to keep and what to remove.

Stop manually hunting through your library for content nobody watches. Let Prunerr handle it.

---

## Features

### Library Management
- **Full Library Sync** &mdash; Automatically scans and indexes your Plex libraries with metadata from Plex, Sonarr, Radarr, and Tautulli/Tracearr
- **Rich Media Details** &mdash; View file size, resolution, codec, HDR status, ratings (IMDb, TMDB, Rotten Tomatoes), genres, studio, runtime, and more
- **Watch History Tracking** &mdash; Per-user watch history with play counts, last watched dates, and watched-by information
- **Bulk Actions** &mdash; Select multiple items to protect, queue for deletion, or export

### Rules Engine (v2)
- **Three Rule-Building Modes**
  - **Templates** &mdash; Pre-built rules based on your library's actual data (e.g., "Never Watched Movies Over 50GB")
  - **Easy Setup** &mdash; Natural language sentence builder: *"Delete movies that haven't been watched in 90 days and are larger than 10 GB"*
  - **Custom Builder** &mdash; Full-featured nested condition editor with AND/OR/NOT groups
- **28+ Condition Fields** across 6 categories:
  - **Basics** &mdash; Title, media type, release year, days since added/watched, play count, file size
  - **Quality** &mdash; Resolution, video/audio codec, HDR format, bitrate
  - **Ratings** &mdash; IMDb, TMDB, Rotten Tomatoes scores, content rating (PG, R, TV-MA, etc.)
  - **Watching** &mdash; Per-user watch status with configurable time windows
  - **Collections** &mdash; Collection membership, protected collection membership
  - **Metadata** &mdash; Genres, tags, studio, runtime, season/episode count, series status, language
- **Live Preview** &mdash; See matching items, reclaimable storage, and sample results in real-time as you build rules
- **Priority System** &mdash; Higher priority rules take precedence when items match multiple rules
- **Searchable Dropdowns** &mdash; Type to filter through condition fields and user lists

### Collections
- **Radarr Collection Sync** &mdash; Automatically imports movie collections from Radarr (e.g., "The Dark Knight Collection", "Marvel Cinematic Universe")
- **Collection Protection** &mdash; Protect entire collections to prevent any member from being cleaned up
- **Queue Collections for Deletion** &mdash; Bulk-queue all items in a collection with configurable grace periods
- **Protection Cascade** &mdash; Collection-level protection is reflected on individual items in the library view

### Deletion Management
- **Grace Periods** &mdash; Configure how long items wait in the deletion queue before removal (1-365 days)
- **Deletion Actions** &mdash; Choose per-item or per-rule:
  - Unmonitor Only (keep files)
  - Delete Files Only
  - Unmonitor & Delete Files
  - Full Removal (delete everything from Sonarr/Radarr)
- **Overseerr/Seerr Integration** &mdash; Optionally reset requests when content is removed so users can re-request
- **Protection** &mdash; Mark individual items or entire collections as protected to prevent deletion
- **Deletion Queue** &mdash; Review, approve, or cancel pending deletions before they execute

### Dashboard & Monitoring
- **At-a-Glance Stats** &mdash; Total storage, movie/show counts, reclaimable space, collection count
- **Service Health** &mdash; Real-time connection status and response times for all integrated services
- **Activity Timeline** &mdash; Full audit log of scans, rule matches, deletions, protection changes, and manual actions
- **Storage Trends** &mdash; Historical chart showing library size over time
- **Upcoming Deletions** &mdash; See what's scheduled for removal and when
- **Recommendations** &mdash; Smart suggestions for content that may be worth cleaning up

### Integrations
| Service | Purpose | Required |
|---------|---------|----------|
| **Plex** | Media server &mdash; library data, watch status | Yes |
| **Sonarr** | TV show management &mdash; unmonitor/delete series | Recommended |
| **Radarr** | Movie management &mdash; unmonitor/delete movies, collections | Recommended |
| **Tautulli** | Watch history &mdash; per-user play data, detailed statistics | One required* |
| **Tracearr** | Watch history &mdash; alternative to Tautulli | One required* |
| **Overseerr/Seerr** | Request management &mdash; reset requests on deletion | Optional |
| **Unraid** | Server monitoring &mdash; disk usage, array health | Optional |
| **Discord** | Notifications &mdash; alerts for flagged/deleted content | Optional |

*\*At least one watch history provider (Tautulli or Tracearr) is required for watch-based rules.*

### Technical
- **Scheduled Automation** &mdash; Configurable scan schedules, automated queue processing, daily storage snapshots
- **Multi-Architecture Docker** &mdash; Runs on amd64 and arm64 (Raspberry Pi, Synology, etc.)
- **SQLite Database** &mdash; Zero-config, embedded database with automatic migrations
- **Mobile-Friendly UI** &mdash; Responsive design works on phones and tablets
- **REST API** &mdash; Full API for automation and custom integrations

---

## Installation

### Docker (Recommended)

```bash
docker run -d \
  --name prunerr \
  -p 3000:3000 \
  -v /path/to/data:/app/data \
  -e PLEX_URL=http://your-plex-server:32400 \
  -e PLEX_TOKEN=your-plex-token \
  -e SONARR_URL=http://your-sonarr:8989 \
  -e SONARR_API_KEY=your-sonarr-api-key \
  -e RADARR_URL=http://your-radarr:7878 \
  -e RADARR_API_KEY=your-radarr-api-key \
  helliott20/prunerr:latest
```

### Docker Compose

```yaml
services:
  prunerr:
    image: helliott20/prunerr:latest
    container_name: prunerr
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    environment:
      - PLEX_URL=http://plex:32400
      - PLEX_TOKEN=your-plex-token
      # Sonarr & Radarr (recommended)
      - SONARR_URL=http://sonarr:8989
      - SONARR_API_KEY=your-sonarr-api-key
      - RADARR_URL=http://radarr:7878
      - RADARR_API_KEY=your-radarr-api-key
      # Watch history (at least one required)
      - TAUTULLI_URL=http://tautulli:8181
      - TAUTULLI_API_KEY=your-tautulli-api-key
      # Optional
      - OVERSEERR_URL=http://overseerr:5055
      - OVERSEERR_API_KEY=your-overseerr-api-key
      - DISCORD_WEBHOOK_URL=your-discord-webhook
    restart: unless-stopped
```

### Unraid

Prunerr is available in the Unraid Community Applications store. Search for **"Prunerr"** or install manually with the template URL:

```
https://raw.githubusercontent.com/helliott20/prunerr/main/my-prunerr.xml
```

> **Tip:** After installing, configure your services in Settings. Prunerr will guide you through connecting Plex, Sonarr, Radarr, and your watch history provider.

---

## Configuration

### Required

| Variable | Description |
|----------|-------------|
| `PLEX_URL` | URL to your Plex server (e.g., `http://192.168.1.100:32400`) |
| `PLEX_TOKEN` | Your Plex authentication token ([how to find](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/)) |

### Sonarr / Radarr (Recommended)

| Variable | Description |
|----------|-------------|
| `SONARR_URL` | URL to your Sonarr instance |
| `SONARR_API_KEY` | Sonarr API key (Settings > General > Security) |
| `RADARR_URL` | URL to your Radarr instance |
| `RADARR_API_KEY` | Radarr API key (Settings > General > Security) |

### Watch History (One Required)

| Variable | Description |
|----------|-------------|
| `TAUTULLI_URL` | URL to your Tautulli instance |
| `TAUTULLI_API_KEY` | Tautulli API key (Settings > Web Interface) |

Or use [Tracearr](https://github.com/helliott20/tracearr) as an alternative watch history provider. Configure it in the Prunerr Settings UI.

### Optional Integrations

| Variable | Description |
|----------|-------------|
| `OVERSEERR_URL` | URL to your Overseerr/Seerr instance |
| `OVERSEERR_API_KEY` | Overseerr API key (Settings > General) |
| `DISCORD_WEBHOOK_URL` | Discord webhook URL for notifications |

### Application Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Logging level: `error`, `warn`, `info`, `debug` |
| `PUID` | `99` | User ID for file permissions |
| `PGID` | `100` | Group ID for file permissions |

---

## Usage

### Getting Started

1. **Install Prunerr** using Docker, Docker Compose, or the Unraid Community Apps store
2. **Open the web UI** at `http://your-server:3000`
3. **Configure services** in Settings &mdash; connect Plex, Sonarr/Radarr, and a watch history provider
4. **Run your first scan** to import your library
5. **Create rules** to start identifying content for cleanup

### Creating Rules

Prunerr offers three ways to create rules:

**Templates** &mdash; Start with personalized suggestions based on your library's actual data. Each template shows how many items it would match and how much space you'd reclaim.

**Easy Setup** &mdash; Build rules as natural language sentences:
> *"Mark for deletion **movies** that **haven't been watched in 90 days** and **are larger than 10 GB**"*

**Custom Builder** &mdash; Full control with nested AND/OR/NOT condition groups, 28+ fields, and operators like `contains`, `between`, `regex_match`, `is_null`, and more.

### Deletion Actions

When content matches a rule, choose how it's handled:

| Action | What it does |
|--------|-------------|
| **Unmonitor Only** | Stop monitoring in Sonarr/Radarr but keep all files |
| **Delete Files Only** | Remove media files but keep the entry for re-download |
| **Unmonitor & Delete** | Remove files and stop monitoring (recommended) |
| **Full Removal** | Completely remove from Sonarr/Radarr including all metadata |

### Collections

Prunerr syncs movie collections from Radarr (e.g., "Harry Potter Collection", "Marvel Cinematic Universe"). You can:

- **Protect collections** to prevent any member from being cleaned up
- **Queue entire collections for deletion** with configurable grace periods and deletion actions
- View collection membership on individual media items

### Protection

Prevent important content from ever being deleted:

- **Individual protection** &mdash; Right-click any item and select "Protect"
- **Collection protection** &mdash; Protect entire collections from the Collections page
- **Bulk protection** &mdash; Select multiple items in the Library and protect in one click
- Protected items are skipped by all rules and cannot be queued for deletion

---

## Mobile Access

### nzb360

Prunerr works great as a custom web app in [nzb360](https://nzb360.com/), the popular Android app for managing your media server stack.

**To add Prunerr to nzb360:**

1. Open nzb360 > **Settings**
2. Scroll down and tap **Add New Service**
3. Choose **Custom Web App**
4. Enter your Prunerr URL (e.g., `http://192.168.1.100:3000`)
5. Set the name to **Prunerr**
6. Optionally set the icon to the Prunerr logo

Prunerr's responsive UI adapts to mobile screens, giving you full access to your dashboard, library, rules, collections, and deletion queue from your phone.

### Browser Access

Prunerr's web UI is fully responsive and works in any mobile browser. Simply navigate to your Prunerr URL on your phone or tablet.

---

## API

Prunerr exposes a REST API for automation and custom integrations:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/stats` | GET | Dashboard statistics |
| `/api/library` | GET | List library items (paginated, filterable, sortable) |
| `/api/library/:id` | GET | Get a single media item's details |
| `/api/library/:id/mark-deletion` | POST | Queue an item for deletion |
| `/api/library/bulk/mark-deletion` | POST | Bulk queue items for deletion |
| `/api/rules` | GET | List all rules |
| `/api/rules` | POST | Create a new rule |
| `/api/rules/:id/run` | POST | Run a rule manually |
| `/api/rules/preview` | POST | Preview which items a rule would match |
| `/api/collections` | GET | List all collections |
| `/api/collections/sync` | POST | Sync collections from Radarr |
| `/api/collections/:id/protection` | PATCH | Toggle collection protection |
| `/api/collections/:id/queue` | POST | Queue a collection for deletion |
| `/api/queue` | GET | View the deletion queue |
| `/api/queue/process` | POST | Process pending deletions |
| `/api/activity` | GET | Activity log (paginated, filterable) |
| `/api/library/sync` | POST | Trigger a library scan |
| `/api/users/sync` | POST | Sync Plex users |

---

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
git clone https://github.com/helliott20/prunerr.git
cd prunerr
npm install
npm run dev
```

This starts both the backend API server and the Vite frontend dev server concurrently.

### Building

```bash
# Production build
npm run build

# Docker image (multi-arch)
docker build -t prunerr .
```

### Tech Stack

- **Backend:** Node.js, Express, TypeScript, SQLite (better-sqlite3)
- **Frontend:** React 18, Vite, TailwindCSS, TanStack Query
- **Deployment:** Docker (multi-arch amd64/arm64), Unraid Community Apps

---

## Support

- **Unraid Forum:** [Prunerr Support Thread](https://forums.unraid.net/topic/196929-support-prunerr-media-library-cleanup-tool/)
- **GitHub Issues:** [Report a Bug](https://github.com/helliott20/prunerr/issues)
- **GitHub Discussions:** [Ask a Question](https://github.com/helliott20/prunerr/discussions)
- **Docker Hub:** [helliott20/prunerr](https://hub.docker.com/r/helliott20/prunerr)

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- [Plex](https://www.plex.tv/) &mdash; Media server
- [Sonarr](https://sonarr.tv/) & [Radarr](https://radarr.video/) &mdash; *arr automation
- [Tautulli](https://tautulli.com/) &mdash; Plex statistics
- [Tracearr](https://github.com/helliott20/tracearr) &mdash; Watch history tracking
- [Overseerr](https://overseerr.dev/) &mdash; Request management
- [nzb360](https://nzb360.com/) &mdash; Mobile app for managing your stack
