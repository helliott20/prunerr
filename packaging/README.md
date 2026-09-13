# Packaging & distribution

Where Prunerr is listed, where it isn't yet, and what each one needs.

Almost all installs arrive through app stores rather than through GitHub —
25k+ Docker Hub pulls against 13 stars — so these channels are the growth
lever, not the README.

| Channel | Status | Next action |
|---|---|---|
| [Docker Hub](https://hub.docker.com/r/helliott20/prunerr) | Live | — |
| Unraid Community Applications | Live | Keep [`my-prunerr.xml`](../my-prunerr.xml) in sync |
| [CasaOS App Store](casaos/) | Submitted | Bump manifest + follow-up PR on each release |
| [TrueNAS](truenas/) | Install-via-YAML ready | Post the YAML to the forums; catalog PR later |
| [Portainer](portainer/) | Template ready | PR to the community aggregators |
| [awesome-selfhosted](awesome-selfhosted/) | Entry ready | Fork, add `software/prunerr.yml`, PR |

Each folder has its own README with the exact submission steps, the format
rules that apply, and what has already been checked.

## Release checklist

Versioned manifests drift silently, so on every release:

- `packaging/casaos/Prunerr/docker-compose.yml` — `image:`, `x-casaos.version`,
  `x-casaos.updateAt` (see the root `CLAUDE.md`)
- `packaging/truenas/docker-compose.yml` — `image:`
- `packaging/portainer/prunerr-template.json` — nothing, it tracks `:latest`
- `my-prunerr.xml` — nothing, it tracks `:latest`

## Channels not yet packaged

Worth considering, roughly in order of reach per unit of effort:

- **r/selfhosted / r/unRAID** — no packaging needed, just a post. The single
  cheapest thing on this list.
- **Runtipi / Umbrel / Dockge / Coolify** — each has its own app store format,
  all of them compose-shaped, so the TrueNAS and CasaOS manifests are most of
  the work already.
- **TrueNAS community catalog** — a real submission, needs Jinja2 templates
  against their render library. See [`truenas/README.md`](truenas/README.md).
