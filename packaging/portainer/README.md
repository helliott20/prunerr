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

## For distribution: submit to the aggregators

Neither of these is curated by Portainer themselves, and both are where
self-hosters actually get their template lists from:

- [`Lissy93/portainer-templates`](https://github.com/Lissy93/portainer-templates)
  — drop the file into `sources/` and it is merged into the combined
  `templates.json` automatically. `make validate` checks it against
  `Schema.json` first.
- [`SpauriRosso/portainer-templates-v3`](https://github.com/SpauriRosso/portainer-templates-v3)
  — same idea, v3-only.

[`portainer/templates`](https://github.com/portainer/templates) is Portainer's
own list (the `v3` branch is the default). It is deliberately small and mostly
covers base images and Portainer's own stack, so it is not a realistic target.

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
