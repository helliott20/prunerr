#!/usr/bin/env node
/**
 * Verifies that every image tag pinned in packaging/ actually exists on Docker
 * Hub, and that the pins agree with each other.
 *
 * This exists because they drifted for real: the manifests were bumped to a
 * version that was never released, so both pointed at an image that did not
 * exist and any install from them failed at the pull. A checklist did not catch
 * it; this does, in about a second.
 *
 * Usage: node scripts/check-pinned-tags.mjs [--offline]
 *   --offline  skip the registry lookup and only check the pins agree
 */
import { readFileSync } from 'node:fs';

const REPO = 'helliott20/prunerr';
const offline = process.argv.includes('--offline');

/** Files that pin an exact tag, and how to find it. */
const PINS = [
  {
    file: 'packaging/casaos/Prunerr/docker-compose.yml',
    patterns: [
      { label: 'image', re: /image:\s*helliott20\/prunerr:([^\s"']+)/ },
      { label: 'x-casaos.version', re: /^\s*version:\s*"([^"]+)"/m },
    ],
  },
  {
    file: 'packaging/truenas/docker-compose.yml',
    patterns: [{ label: 'image', re: /image:\s*helliott20\/prunerr:([^\s"']+)/ }],
  },
];

const found = [];
let failed = false;

for (const { file, patterns } of PINS) {
  let text;
  try {
    text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  } catch {
    console.error(`✗ ${file}: not readable`);
    failed = true;
    continue;
  }
  for (const { label, re } of patterns) {
    const m = text.match(re);
    if (!m) {
      console.error(`✗ ${file}: no ${label} pin found (pattern changed?)`);
      failed = true;
      continue;
    }
    found.push({ file, label, tag: m[1] });
  }
}

if (!found.length) {
  console.error('✗ no pins found at all — this check is not doing its job');
  process.exit(1);
}

// Every pin should name the same version.
const tags = [...new Set(found.map((f) => f.tag))];
for (const f of found) console.log(`  ${f.file} (${f.label}) → ${f.tag}`);

if (tags.length > 1) {
  console.error(`✗ pins disagree: ${tags.join(', ')}`);
  failed = true;
} else {
  console.log(`✓ all ${found.length} pins agree on ${tags[0]}`);
}

// `latest` would defeat the point, and CasaOS forbids it outright.
for (const f of found) {
  if (f.tag === 'latest') {
    console.error(`✗ ${f.file} (${f.label}) pins :latest — CasaOS rejects it and it is not reproducible`);
    failed = true;
  }
}

if (!offline && !failed) {
  for (const tag of tags) {
    const url = `https://hub.docker.com/v2/repositories/${REPO}/tags/${tag}`;
    try {
      const res = await fetch(url);
      if (res.ok) {
        console.log(`✓ ${REPO}:${tag} exists on Docker Hub`);
      } else if (res.status === 404) {
        console.error(`✗ ${REPO}:${tag} does NOT exist on Docker Hub (HTTP 404)`);
        console.error('  Installs from these manifests would fail at the pull.');
        failed = true;
      } else {
        console.warn(`? registry returned HTTP ${res.status} for ${tag} — not treating as a failure`);
      }
    } catch (err) {
      console.warn(`? could not reach Docker Hub (${err.message}) — skipping the existence check`);
    }
  }
}

process.exit(failed ? 1 : 0);
