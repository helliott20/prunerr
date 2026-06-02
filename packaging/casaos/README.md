# CasaOS App Store submission

This folder holds the package for listing Prunerr in the [CasaOS App Store](https://github.com/IceWhaleTech/CasaOS-AppStore).

```
Prunerr/
├─ docker-compose.yml   # app manifest + x-casaos metadata
├─ icon.png             # 256x256 (192x192 transparent required only for "featured")
└─ screenshot-1.png     # 1274x629 (1280x720 required only for "featured")
```

## How to submit

1. **Test locally first.** The reviewers require the compose to be installed and
   working on a real CasaOS box before they'll merge. Import this
   `docker-compose.yml` via CasaOS → *Custom Install* and confirm the Web UI,
   volume persistence, and health check all work.
2. **Fork** `IceWhaleTech/CasaOS-AppStore`.
3. Copy this `Prunerr/` folder into the fork's `Apps/` directory (so it becomes
   `Apps/Prunerr/`). The `icon`/`screenshot_link` URLs point at
   `raw.githubusercontent.com/helliott20/prunerr/main/assets/...` — assets we
   own and control, so they resolve immediately (no chicken-and-egg with the
   store repo). If a reviewer prefers the assets be served from the store repo
   itself, switch them to
   `https://cdn.jsdelivr.net/gh/IceWhaleTech/CasaOS-AppStore@main/Apps/Prunerr/icon.png`
   (etc.) — those resolve only after merge, since `icon.png`/`screenshot-1.png`
   ship in this folder too.
4. Open a PR. Title e.g. `Add Prunerr`. Mention it's tested on your own CasaOS.

## Notes / things to confirm before submitting

- **Image tag is pinned to `1.5.8`** (CONTRIBUTING.md forbids `:latest`). Docker
  Hub tags drop the `v` prefix, so it's `helliott20/prunerr:1.5.8`, not `:v1.5.8`.
  On each new release, bump `image:` + the `version:`/`updateAt:` fields and open
  a follow-up PR to the store so users get the in-store update prompt.
- **`/api/health`** is assumed for the health check — confirm that endpoint
  exists (it's referenced in the root `docker-compose.yml`).
- Going for a **featured** slot later needs a 192x192 transparent icon, a
  784x442 thumbnail, and 1280x720 screenshots.
