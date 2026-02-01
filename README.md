<p align="center">
  <img src="assets/icon.svg" alt="Prunerr Logo" width="128" height="128">
</p>

<h1 align="center">Prunerr</h1>

<p align="center">
  <strong>Intelligent media library cleanup for Plex, Sonarr, and Radarr</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#usage">Usage</a> •
  <a href="#screenshots">Screenshots</a>
</p>

<p align="center">
  <img src="https://img.shields.io/docker/pulls/helliott20/prunerr?style=flat-square" alt="Docker Pulls">
  <img src="https://img.shields.io/github/license/helliott20/prunerr?style=flat-square" alt="License">
  <img src="https://img.shields.io/github/v/release/helliott20/prunerr?style=flat-square" alt="Release">
</p>

---

## What is Prunerr?

Prunerr is a media library management tool that helps you automatically identify and clean up unwatched or stale content from your Plex library. It integrates with Sonarr, Radarr, Tautulli, and Overseerr to make intelligent decisions about what to keep and what to remove.

Stop manually hunting through your library for content nobody watches. Let Prunerr handle it.

## Features

- **Smart Rules Engine** - Create flexible rules based on watch status, age, file size, and more
- **Plex Integration** - Syncs with your Plex library to track what's been watched
- **Tautulli Support** - Deep watch history analysis for accurate cleanup decisions
- **Sonarr & Radarr Integration** - Automatically unmonitor or delete content from your *arr apps
- **Overseerr Integration** - Reset requests when content is removed so users can re-request
- **Grace Periods** - Configure how long items wait in the deletion queue before removal
- **Protection Rules** - Mark content as protected to prevent accidental deletion
- **Deletion Queue** - Review and approve deletions before they happen
- **Activity History** - Full audit log of all actions taken
- **Discord Notifications** - Get notified when content is flagged or deleted
- **Modern Web UI** - Beautiful, responsive dashboard that works on desktop and mobile

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
version: '3.8'
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
      - SONARR_URL=http://sonarr:8989
      - SONARR_API_KEY=your-sonarr-api-key
      - RADARR_URL=http://radarr:7878
      - RADARR_API_KEY=your-radarr-api-key
      # Optional integrations
      - TAUTULLI_URL=http://tautulli:8181
      - TAUTULLI_API_KEY=your-tautulli-api-key
      - OVERSEERR_URL=http://overseerr:5055
      - OVERSEERR_API_KEY=your-overseerr-api-key
      - DISCORD_WEBHOOK_URL=your-discord-webhook
    restart: unless-stopped
```

### Unraid

Prunerr is available in the Unraid Community Applications. Search for "Prunerr" or use the template URL:

```
https://raw.githubusercontent.com/helliott20/prunerr/main/unraid-template.xml
```

## Configuration

### Required

| Variable | Description |
|----------|-------------|
| `PLEX_URL` | URL to your Plex server (e.g., `http://192.168.1.100:32400`) |
| `PLEX_TOKEN` | Your Plex authentication token ([how to find](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/)) |

### Sonarr/Radarr (Recommended)

| Variable | Description |
|----------|-------------|
| `SONARR_URL` | URL to your Sonarr instance |
| `SONARR_API_KEY` | Sonarr API key (Settings → General → Security) |
| `RADARR_URL` | URL to your Radarr instance |
| `RADARR_API_KEY` | Radarr API key (Settings → General → Security) |

### Optional Integrations

| Variable | Description |
|----------|-------------|
| `TAUTULLI_URL` | URL to your Tautulli instance |
| `TAUTULLI_API_KEY` | Tautulli API key (Settings → Web Interface) |
| `OVERSEERR_URL` | URL to your Overseerr instance |
| `OVERSEERR_API_KEY` | Overseerr API key (Settings → General) |
| `DISCORD_WEBHOOK_URL` | Discord webhook for notifications |

### Application Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Logging level: `error`, `warn`, `info`, `debug` |
| `PUID` | `99` | User ID for file permissions |
| `PGID` | `100` | Group ID for file permissions |

## Usage

### Creating Rules

Prunerr uses a smart rule builder to create cleanup policies:

1. **Template Rules** - Start with pre-built templates like "Never Watched" or "Watched Once"
2. **Sentence Builder** - Create rules using natural language: "Delete movies that have never been watched and were added more than 30 days ago"
3. **Advanced Mode** - Full control over conditions and operators

### Rule Actions

- **Flag** - Mark items for review without scheduling deletion
- **Delete** - Add items to the deletion queue with a grace period
- **Notify** - Send a notification without taking action

### Deletion Actions

When deleting content, choose how it's removed:

- **Unmonitor Only** - Stop monitoring but keep files
- **Delete Files Only** - Remove files but keep in Sonarr/Radarr
- **Unmonitor & Delete** - Remove files and stop monitoring
- **Full Removal** - Completely remove from Sonarr/Radarr

### Protection

Mark important content as protected to prevent deletion:
- Manually protect individual items
- Use bulk actions to protect multiple items
- Protected items are ignored by all rules

## Screenshots

*Coming soon*

## API

Prunerr exposes a REST API for automation and integration:

- `GET /api/library` - List library items
- `GET /api/queue` - View deletion queue
- `GET /api/rules` - List rules
- `POST /api/rules/:id/run` - Run a rule manually
- `GET /api/stats` - Dashboard statistics

Full API documentation coming soon.

## Development

### Prerequisites

- Node.js 18+
- npm or yarn

### Setup

```bash
# Clone the repository
git clone https://github.com/helliott20/prunerr.git
cd prunerr

# Install dependencies
npm install

# Start development server
npm run dev
```

### Building

```bash
# Build for production
npm run build

# Build Docker image
docker build -t prunerr .
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

- **Issues**: [GitHub Issues](https://github.com/helliott20/prunerr/issues)
- **Discussions**: [GitHub Discussions](https://github.com/helliott20/prunerr/discussions)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Plex](https://www.plex.tv/) for the amazing media server
- [Sonarr](https://sonarr.tv/) and [Radarr](https://radarr.video/) for *arr automation
- [Tautulli](https://tautulli.com/) for detailed Plex statistics
- [Overseerr](https://overseerr.dev/) for request management
