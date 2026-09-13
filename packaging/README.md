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
| [Portainer](portainer/) | Template ready | Add as a source in the Lissy93 aggregator |
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

## On AI assistance, per channel

Checked rather than assumed, because the answers differ:

- **awesome-selfhosted** is the only one with an explicit rule:
  "Machine/LLM-generated contributions, that do not respect project guidelines
  are not allowed and will result in a ban." The qualifier is the whole rule —
  follow their house style and you are fine; submit unreviewed output and the
  penalty is a ban, not a rejection.
- **Lissy93/portainer-templates** has no written policy but does have a
  honeypot for agents hidden in an HTML comment in `CONTRIBUTING.md`. See
  [`portainer/README.md`](portainer/README.md).
- **truenas/apps**, **CasaOS-AppStore** and the **Unraid** template repos say
  nothing about it either way.
- **Reddit** has no site-wide ban on AI-written text; subreddit rules are the
  real constraint, so read r/selfhosted's sidebar before posting.

The common thread: nobody objects to the tool, everybody objects to output
nobody checked. Whoever opens the PR owns it and has to answer for it on the
thread.
