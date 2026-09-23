#!/usr/bin/env node
/**
 * Publish to the in-app "What's new" feed.
 *
 *   export PRUNERR_ANNOUNCE_TOKEN=...   # the Worker's ADMIN_TOKEN secret
 *   node announce.mjs show                       # print the live feed
 *   node announce.mjs pull  > feed.json          # save it to edit
 *   node announce.mjs push  feed.json            # replace the feed
 *   node announce.mjs image ./hero.png [name]    # upload, prints the URL
 *   node announce.mjs unimage hero.png           # delete an image
 *
 * A feed file looks like:
 *
 *   {
 *     "announcements": [
 *       {
 *         "id": "smart-rules",              // stable, lowercase, dashes
 *         "type": "feature",                // announcement | feature | improvement | fix | feedback
 *         "title": "Smart rules are here",
 *         "body": "Line breaks are kept.\n\nBlank lines make paragraphs.",
 *         "publishedAt": "2026-09-22",
 *         "imageUrl": "https://.../v1/images/smart-rules.png",   // optional
 *         "link": { "url": "https://...", "label": "Tell us what you think" }, // optional
 *         "minVersion": "1.5.0",            // optional: only installs at or above
 *         "maxVersion": "1.6.0",            // optional: only installs at or below
 *         "expiresAt": "2026-12-31",        // optional: hidden after this date
 *         "pinned": true                    // optional: shown first, opens the panel once
 *       }
 *     ]
 *   }
 *
 * Set PRUNERR_ANNOUNCE_URL to point at a different Worker.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const BASE = (process.env.PRUNERR_ANNOUNCE_URL ?? 'https://prunerr-telemetry.harryelliott16.workers.dev').replace(/\/$/, '');
const TOKEN = process.env.PRUNERR_ANNOUNCE_TOKEN ?? '';

const [command, ...args] = process.argv.slice(2);

function die(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function needToken() {
  if (!TOKEN) die('PRUNERR_ANNOUNCE_TOKEN is not set');
  return { Authorization: `Bearer ${TOKEN}` };
}

async function expectOk(res) {
  if (res.ok) return res;
  let detail = `${res.status} ${res.statusText}`;
  try {
    const body = await res.json();
    if (body?.error) detail = `${res.status}: ${body.error}`;
  } catch {
    /* not JSON */
  }
  die(detail);
}

async function show() {
  const res = await expectOk(await fetch(`${BASE}/v1/announcements`));
  const feed = await res.json();
  if (feed.announcements.length === 0) {
    console.log('(no announcements)');
    return;
  }
  for (const a of feed.announcements) {
    const flags = [a.pinned && 'pinned', a.minVersion && `>=${a.minVersion}`, a.maxVersion && `<=${a.maxVersion}`, a.expiresAt && `until ${a.expiresAt.slice(0, 10)}`]
      .filter(Boolean)
      .join(', ');
    console.log(`${a.publishedAt.slice(0, 10)}  [${a.type}]  ${a.id}  ${a.title}${flags ? `  (${flags})` : ''}`);
  }
  console.log(`\nupdated ${feed.updatedAt}`);
}

async function pull() {
  const res = await expectOk(await fetch(`${BASE}/v1/announcements`));
  const feed = await res.json();
  process.stdout.write(`${JSON.stringify({ announcements: feed.announcements }, null, 2)}\n`);
}

async function push(file) {
  if (!file) die('usage: announce.mjs push feed.json');
  const body = readFileSync(file, 'utf8');
  JSON.parse(body); // fail here with a JSON error rather than a 400
  const res = await expectOk(
    await fetch(`${BASE}/v1/announcements`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...needToken() },
      body,
    })
  );
  const feed = await res.json();
  console.log(`published ${feed.announcements.length} announcement(s) at ${feed.updatedAt}`);
}

async function image(file, name) {
  if (!file) die('usage: announce.mjs image ./picture.png [name.png]');
  const target = (name ?? basename(file)).toLowerCase();
  const bytes = readFileSync(file);
  const res = await expectOk(
    await fetch(`${BASE}/v1/images/${target}`, {
      method: 'PUT',
      headers: needToken(),
      body: bytes,
    })
  );
  const info = await res.json();
  console.log(info.url);
}

async function unimage(name) {
  if (!name) die('usage: announce.mjs unimage name.png');
  await expectOk(await fetch(`${BASE}/v1/images/${name}`, { method: 'DELETE', headers: needToken() }));
  console.log(`deleted ${name}`);
}

const commands = { show, pull, push, image, unimage };

if (!command || !commands[command]) {
  console.error('usage: announce.mjs <show|pull|push|image|unimage> [args]');
  process.exit(command ? 1 : 0);
}

commands[command](...args).catch((error) => die(error.message));
