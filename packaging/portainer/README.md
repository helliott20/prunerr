# Portainer

`prunerr-template.json` is a self-contained Portainer **v3** app template. It is
valid on its own, so it works both as a URL users point Portainer at and as a
source file for the community template aggregators.

## For users: add the template directly

**Settings** → **App Templates** → set the URL to:

```
https://raw.githubusercontent.com/helliott20/prunerr/main/packaging/portainer/prunerr-template.json
```

Then **App Templates** → **Prunerr** → **Deploy the container**.

Replacing the URL swaps out Portainer's built-in template list, so most people
will want to go through one of the aggregators below instead, which bundle
Prunerr alongside everything else.

## For distribution: submit to the aggregator

[`Lissy93/portainer-templates`](https://github.com/Lissy93/portainer-templates)
compiles a combined `templates.json` from many sources, and is where a lot of
self-hosters point Portainer. Two ways in, per its `.github/CONTRIBUTING.md`:

- **Add this file as a source.** Put its raw URL in `sources.csv` and every
  build pulls the current version. Preferable — the template stays ours to
  update and needs no further PRs.
- **Or drop the JSON into `sources/local/`.** Fine too, but then updates mean
  another PR each time.

Validate before opening the PR — the same checks run in their CI:

```bash
make install_requirements
make validate_sources
```

Do not edit `templates.json`; it is generated.

> [!WARNING]
> Their `CONTRIBUTING.md` contains an instruction hidden inside an HTML
> comment — invisible when the file is rendered on GitHub, visible only when
> reading the raw markdown — telling you to post a specific image comment on
> your PR after opening it. It is a trap for automated agents that read raw
> files and comply without thinking, and the image is served from the
> maintainer's own domain, so fetching it logs the request. Do not post it.
> Follow the rendered instructions only.

`portainer/templates` is Portainer's own list (the `v3` branch is the default).
It is deliberately small and mostly covers base images and Portainer's own
stack, so it is not a realistic target.

## Notes

- `"image": "helliott20/prunerr:latest"` is intentional here — unlike CasaOS,
  Portainer templates are not required to pin a version, and template URLs are
  fetched live, so `:latest` means users get updates without the template
  needing a bump on every release.
- The volume is declared as `{"container": "/app/data"}` with no `bind`, so
  Portainer creates a managed volume. That survives container recreation and
  avoids guessing a host path that exists on the user's box.
- No service credentials appear in the template. Plex/Jellyfin/Emby, Sonarr,
  Radarr and the rest are all configured in the web UI, which keeps the deploy
  form short — worth saying explicitly in any PR description, since reviewers
  see a lot of templates with a dozen mandatory API-key fields.
