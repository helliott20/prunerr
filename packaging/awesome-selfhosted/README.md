# awesome-selfhosted

`prunerr.yml` is the entry for
[`awesome-selfhosted/awesome-selfhosted-data`](https://github.com/awesome-selfhosted/awesome-selfhosted-data),
which is where the list actually lives — the rendered
[awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted)
README and [awesome-selfhosted.net](https://awesome-selfhosted.net) are both
generated from it. Do not PR the README directly.

## How to submit

1. Fork `awesome-selfhosted/awesome-selfhosted-data`.
2. Copy this file to `software/prunerr.yml` (kebab-case filename, one file per
   piece of software).
3. Open a PR with a descriptive commit message, e.g. `Add Prunerr`.

That is the whole change. The fields below are **not** ours to fill in —
`stargazers_count`, `updated_at`, `archived`, `current_release` and
`commit_history` are injected and kept fresh by their CI after merge.

## Eligibility, checked

Their addition template makes you tick these off. All of them hold:

| Requirement | Status |
|---|---|
| First released more than 4 months ago | ✅ first release Jan 2026 |
| Actively maintained | ✅ v1.6.1 shipped Aug 2026 |
| Working installation instructions | ✅ README quick start + wiki |
| Free and open-source licence with an SPDX identifier | ✅ `MIT` |
| Not dependent on a third-party service outside the user's control | ✅ talks only to your own Plex/Jellyfin/Emby, Sonarr, Radarr |
| Not already on awesome-sysadmin / staticgen / dbdb.io | ✅ |
| English documentation | ✅ |

Disqualifiers that do not apply to us either: it is not a desktop or mobile
app, not a library or SDK, not a PaaS, and not a port of an existing
application.

## Field choices

Every value is checked against the repo's own vocabulary rather than guessed:

- **`tags: [Media Management]`** — `tags/media-management.yml` exists and is
  what Radarr, Sonarr and Seerr all use. Kept to a single tag to match them;
  `Automation` is listed as a related tag if a reviewer would rather have both.
- **`platforms: [Docker, Nodejs]`** — both `platforms/docker.yml` and
  `platforms/nodejs.yml` exist. Note the spelling is `Nodejs`, not `Node.js`.
- **`licenses: [MIT]`** — matches the `MIT` identifier in `licenses.yml`.
- **`description`** — 207 characters, under their 250 limit, sentence case, no
  trailing marketing.

## Useful context for the PR description

Prunerr slots in next to software already on the list: **Radarr**, **Sonarr**,
**Seerr**, **Plex** and **Jellyfin** all have entries, and Prunerr is the
cleanup side of that same stack — which is worth saying, because "another *arr
tool" is an easy reason for a reviewer to bounce something that does not
clearly do its own thing.
