/**
 * The announcements admin page, served at /admin.
 *
 * A single static page with no build step: sign in with the ADMIN_TOKEN, then
 * add, edit, reorder and delete announcements, upload images, and publish.
 * It talks to the same admin API the CLI uses (see announcements.js), so the
 * page holds no privileges of its own — every write carries the token and is
 * checked server-side.
 *
 * Security posture:
 *   - The token is entered by the user and kept in the browser only
 *     (sessionStorage by default, localStorage if "remember" is ticked).
 *     It is never embedded in the page and never logged.
 *   - Strict Content-Security-Policy with a per-request nonce, so only the
 *     page's own script and styles run; no external resources at all.
 *   - `Cache-Control: no-store`, `X-Frame-Options: DENY`, `Referrer-Policy:
 *     no-referrer`, `X-Robots-Tag: noindex`, and the page is only served
 *     over HTTPS.
 *   - Announcement data is rendered with textContent / DOM APIs, never
 *     innerHTML, so a title containing markup is shown as text.
 *   - GET /v1/admin/verify answers 204 or 401 and nothing else, so the page
 *     can check a token without a write and without learning anything on
 *     failure.
 */

import { ANNOUNCEMENT_TYPES } from './announcements.js';

function nonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

function securityHeaders(n) {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': [
      "default-src 'none'",
      `script-src 'nonce-${n}'`,
      `style-src 'nonce-${n}'`,
      "img-src 'self' https: data:",
      "connect-src 'self'",
      "form-action 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}

const CSS = `
:root { color-scheme: dark; --bg:#0b1020; --panel:#121a2e; --line:#243050; --text:#e6e9f2; --muted:#8b94ad; --accent:#f59e0b; --danger:#f43f5e; --ok:#10b981; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
main { max-width:1080px; margin:0 auto; padding:24px 16px 64px; }
h1 { font-size:20px; margin:0; display:flex; align-items:center; gap:10px; }
h1 small { color:var(--muted); font-weight:400; font-size:12px; }
header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:20px; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:16px; }
label { display:block; font-size:12px; color:var(--muted); margin:10px 0 4px; }
input, select, textarea { width:100%; background:#0e1526; color:var(--text); border:1px solid var(--line); border-radius:8px; padding:8px 10px; font:inherit; }
textarea { min-height:140px; resize:vertical; }
input:focus, select:focus, textarea:focus { outline:2px solid rgba(245,158,11,.5); outline-offset:1px; }
button { font:inherit; border:1px solid var(--line); background:#1a2340; color:var(--text); border-radius:8px; padding:8px 12px; cursor:pointer; }
button:hover { background:#222d4f; }
button.primary { background:var(--accent); border-color:var(--accent); color:#3b2200; font-weight:600; }
button.primary:hover { background:#fbbf24; }
button.danger { color:#fda4af; border-color:rgba(244,63,94,.4); }
button.ghost { background:transparent; }
button:disabled { opacity:.5; cursor:not-allowed; }
.row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.grid { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(0,1fr); gap:20px; }
@media (max-width:860px) { .grid, .row { grid-template-columns:1fr; } }
.list { display:flex; flex-direction:column; gap:8px; }
.item { display:flex; align-items:center; gap:10px; padding:10px 12px; border:1px solid var(--line); border-radius:10px; background:#0e1526; }
.item.active { border-color:var(--accent); }
.item .t { flex:1; min-width:0; }
.item .t b { display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.item .t span { color:var(--muted); font-size:12px; }
.pill { font-size:10px; text-transform:uppercase; letter-spacing:.04em; padding:2px 8px; border-radius:999px; background:#1a2340; color:#c7cee0; }
.pill.pinned { background:rgba(245,158,11,.18); color:#fcd34d; }
.actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:14px; }
.muted { color:var(--muted); font-size:12px; }
.status { margin-top:12px; font-size:13px; min-height:20px; }
.status.ok { color:var(--ok); } .status.err { color:#fda4af; }
.gate { max-width:420px; margin:80px auto; }
.check { display:flex; align-items:center; gap:8px; margin-top:10px; font-size:13px; color:var(--muted); }
.check input { width:auto; }
.preview { border:1px solid var(--line); border-radius:18px; overflow:hidden; background:#070b16; max-width:360px; }
.preview .hero { height:180px; display:flex; align-items:center; justify-content:center; background:radial-gradient(ellipse at 50% 60%, rgba(245,158,11,.45), transparent 70%), linear-gradient(#1a2340,#0f1629); position:relative; }
.preview .hero img { width:84%; height:84%; object-fit:cover; border-radius:12px; box-shadow:0 20px 40px rgba(0,0,0,.5); }
.preview .hero .new { position:absolute; left:12px; top:12px; background:var(--accent); color:#3b2200; font-size:10px; font-weight:700; padding:2px 8px; border-radius:999px; }
.preview .body { padding:14px 16px 16px; }
.preview .meta { font-size:10.5px; color:var(--muted); margin-bottom:6px; display:flex; gap:8px; align-items:center; }
.preview h3 { margin:0; font-size:15.5px; }
.preview p { margin:6px 0 0; color:#aab2c8; font-size:13px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.hidden { display:none !important; }
.drop { border:1px dashed var(--line); border-radius:8px; padding:10px; text-align:center; color:var(--muted); font-size:12px; margin-top:6px; cursor:pointer; }
.drop:hover { border-color:var(--accent); color:var(--text); }
.unsaved { color:#fcd34d; font-size:12px; }
.actions-tight { margin:0; }
.bar { display:flex; justify-content:space-between; align-items:center; }
.bar-gap { margin-bottom:10px; }
.mt { margin-top:12px; }
.mt-lg { margin-top:16px; }
.preview-note { margin:4px 0 12px; }
.p-icon { font-size:28px; }
`;

const HTML_BODY = `
<main>
  <section id="gate" class="card gate">
    <h1>Prunerr announcements</h1>
    <p class="muted">Paste the admin token to manage what installs see under What's new.</p>
    <label for="token">Admin token</label>
    <input id="token" type="password" autocomplete="off" spellcheck="false" />
    <label class="check"><input id="remember" type="checkbox" /> Remember on this device</label>
    <div class="actions"><button id="signin" class="primary">Sign in</button></div>
    <div id="gate-status" class="status"></div>
  </section>

  <section id="app" class="hidden">
    <header>
      <h1>Prunerr announcements <small id="updated"></small></h1>
      <div class="actions actions-tight">
        <span id="dirty" class="unsaved hidden">Unpublished changes</span>
        <button id="publish" class="primary" disabled>Publish</button>
        <button id="signout" class="ghost">Sign out</button>
      </div>
    </header>

    <div class="grid">
      <div>
        <div class="card">
          <div class="bar bar-gap">
            <b>Announcements</b>
            <button id="new">+ New</button>
          </div>
          <div id="list" class="list"></div>
          <p id="empty" class="muted hidden">Nothing published yet. Add one.</p>
          <p class="muted mt">Order is newest first by publish date; pinned entries sit on top and pop up once on their own. Installs refresh every six hours, or immediately from the panel's refresh button.</p>
        </div>
      </div>

      <div>
        <form id="form" class="card hidden" autocomplete="off">
          <div class="bar">
            <b id="form-title">New announcement</b>
            <button type="button" id="delete" class="danger hidden">Delete</button>
          </div>

          <label for="f-title">Title</label>
          <input id="f-title" maxlength="120" required />

          <div class="row">
            <div>
              <label for="f-id">Id <span class="muted">(stable; change it to count as new again)</span></label>
              <input id="f-id" pattern="[a-z0-9][a-z0-9\\-]{0,63}" maxlength="64" required />
            </div>
            <div>
              <label for="f-type">Type</label>
              <select id="f-type"></select>
            </div>
          </div>

          <label for="f-body">Body <span class="muted">(plain text; blank line = paragraph; lines starting with "- " = bullets)</span></label>
          <textarea id="f-body" maxlength="4000"></textarea>

          <label for="f-image">Image URL</label>
          <input id="f-image" placeholder="https://…/v1/images/name.png" />
          <div id="drop" class="drop">Click to upload an image (PNG, JPG, WebP, GIF, SVG — up to 2MB, 16:10 looks best)</div>
          <input id="f-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" class="hidden" />

          <div class="row">
            <div>
              <label for="f-link">Link URL</label>
              <input id="f-link" placeholder="https://…" />
            </div>
            <div>
              <label for="f-link-label">Link label</label>
              <input id="f-link-label" maxlength="60" placeholder="Read more" />
            </div>
          </div>

          <div class="row">
            <div>
              <label for="f-published">Published</label>
              <input id="f-published" type="date" required />
            </div>
            <div>
              <label for="f-expires">Expires <span class="muted">(optional)</span></label>
              <input id="f-expires" type="date" />
            </div>
          </div>

          <div class="row">
            <div>
              <label for="f-min">Min version <span class="muted">(optional, e.g. 1.8.0)</span></label>
              <input id="f-min" pattern="\\d+\\.\\d+\\.\\d+(\\-[0-9A-Za-z.\\-]+)?" />
            </div>
            <div>
              <label for="f-max">Max version <span class="muted">(optional)</span></label>
              <input id="f-max" pattern="\\d+\\.\\d+\\.\\d+(\\-[0-9A-Za-z.\\-]+)?" />
            </div>
          </div>

          <label class="check"><input id="f-pinned" type="checkbox" /> Pinned — show first and pop up once on its own</label>

          <div class="actions">
            <button type="submit" class="primary">Save to draft</button>
            <button type="button" id="cancel">Cancel</button>
          </div>
          <div id="form-status" class="status"></div>
        </form>

        <div id="preview-wrap" class="card hidden mt-lg">
          <b>Preview</b>
          <p class="muted preview-note">Roughly how the teaser card looks in the app.</p>
          <div class="preview">
            <div class="hero"><span class="new">New</span><img id="p-img" alt="" class="hidden" /><span id="p-icon" class="p-icon">✦</span></div>
            <div class="body">
              <div class="meta"><span id="p-type" class="pill"></span><span id="p-date"></span></div>
              <h3 id="p-title"></h3>
              <p id="p-body"></p>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div id="status" class="status"></div>
  </section>
</main>
`;

const JS = `
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const TYPES = JSON.parse(document.currentScript.dataset.types);
  const KEY = 'prunerr-announce-token';

  let token = null;
  let feed = { announcements: [], updatedAt: null };
  let draft = [];
  let editing = null; // index into draft, or -1 for new
  let dirty = false;

  // ---- token storage ------------------------------------------------------
  function loadToken() {
    try { return sessionStorage.getItem(KEY) || localStorage.getItem(KEY); } catch { return null; }
  }
  function saveToken(value, remember) {
    try {
      sessionStorage.setItem(KEY, value);
      if (remember) localStorage.setItem(KEY, value); else localStorage.removeItem(KEY);
    } catch {}
  }
  function clearToken() {
    try { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); } catch {}
  }

  // ---- api ---------------------------------------------------------------
  async function api(path, init = {}) {
    const headers = Object.assign({}, init.headers || {}, token ? { Authorization: 'Bearer ' + token } : {});
    const res = await fetch(path, Object.assign({}, init, { headers, cache: 'no-store' }));
    if (res.status === 401) { throw new Error('Token rejected. Sign in again.'); }
    if (!res.ok) {
      let msg = res.status + ' ' + res.statusText;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch {}
      throw new Error(msg);
    }
    return res;
  }

  async function verify(candidate) {
    const res = await fetch('/v1/admin/verify', { headers: { Authorization: 'Bearer ' + candidate }, cache: 'no-store' });
    return res.status === 204;
  }

  async function loadFeed() {
    const res = await api('/v1/announcements');
    feed = await res.json();
    draft = feed.announcements.map((a) => Object.assign({}, a, a.link ? { link: Object.assign({}, a.link) } : {}));
    setDirty(false);
    renderList();
    $('updated').textContent = feed.updatedAt ? 'last published ' + new Date(feed.updatedAt).toLocaleString() : 'nothing published yet';
  }

  // ---- ui helpers --------------------------------------------------------
  function setStatus(el, text, kind) {
    el.textContent = text || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }
  function setDirty(v) {
    dirty = v;
    $('dirty').classList.toggle('hidden', !v);
    $('publish').disabled = !v;
  }
  function slug(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'announcement';
  }
  function dateOnly(iso) { return iso ? iso.slice(0, 10) : ''; }
  function sorted(list) {
    return list.slice().sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
    });
  }

  // ---- list --------------------------------------------------------------
  function renderList() {
    const list = $('list');
    list.textContent = '';
    const items = sorted(draft);
    $('empty').classList.toggle('hidden', items.length > 0);
    items.forEach((a) => {
      const row = document.createElement('div');
      row.className = 'item' + (editing !== null && draft[editing] === a ? ' active' : '');
      const t = document.createElement('div'); t.className = 't';
      const b = document.createElement('b'); b.textContent = a.title; t.appendChild(b);
      const s = document.createElement('span');
      s.textContent = a.id + ' · ' + dateOnly(a.publishedAt) + (a.expiresAt ? ' · until ' + dateOnly(a.expiresAt) : '') + (a.minVersion ? ' · ≥' + a.minVersion : '') + (a.maxVersion ? ' · ≤' + a.maxVersion : '');
      t.appendChild(s);
      row.appendChild(t);
      const pill = document.createElement('span'); pill.className = 'pill'; pill.textContent = a.type; row.appendChild(pill);
      if (a.pinned) { const p = document.createElement('span'); p.className = 'pill pinned'; p.textContent = 'pinned'; row.appendChild(p); }
      const edit = document.createElement('button'); edit.textContent = 'Edit'; edit.type = 'button';
      edit.addEventListener('click', () => openForm(draft.indexOf(a)));
      row.appendChild(edit);
      list.appendChild(row);
    });
  }

  // ---- form --------------------------------------------------------------
  const fields = ['title','id','type','body','image','link','link-label','published','expires','min','max'];
  const f = (name) => $('f-' + name);

  function openForm(index) {
    editing = index;
    const a = index >= 0 ? draft[index] : null;
    $('form-title').textContent = a ? 'Edit announcement' : 'New announcement';
    $('delete').classList.toggle('hidden', !a);
    f('title').value = a ? a.title : '';
    f('id').value = a ? a.id : '';
    f('type').value = a ? a.type : 'announcement';
    f('body').value = a ? a.body : '';
    f('image').value = a && a.imageUrl ? a.imageUrl : '';
    f('link').value = a && a.link ? a.link.url : '';
    f('link-label').value = a && a.link && a.link.label ? a.link.label : '';
    f('published').value = a ? dateOnly(a.publishedAt) : new Date().toISOString().slice(0, 10);
    f('expires').value = a && a.expiresAt ? dateOnly(a.expiresAt) : '';
    f('min').value = a && a.minVersion ? a.minVersion : '';
    f('max').value = a && a.maxVersion ? a.maxVersion : '';
    $('f-pinned').checked = Boolean(a && a.pinned);
    setStatus($('form-status'), '');
    $('form').classList.remove('hidden');
    $('preview-wrap').classList.remove('hidden');
    renderList();
    renderPreview();
    f('title').focus();
  }

  function closeForm() {
    editing = null;
    $('form').classList.add('hidden');
    $('preview-wrap').classList.add('hidden');
    renderList();
  }

  function readForm() {
    const entry = {
      id: f('id').value.trim(),
      type: f('type').value,
      title: f('title').value.trim(),
      body: f('body').value,
      publishedAt: f('published').value,
    };
    if (f('image').value.trim()) entry.imageUrl = f('image').value.trim();
    if (f('link').value.trim()) {
      entry.link = { url: f('link').value.trim() };
      if (f('link-label').value.trim()) entry.link.label = f('link-label').value.trim();
    }
    if (f('expires').value) entry.expiresAt = f('expires').value;
    if (f('min').value.trim()) entry.minVersion = f('min').value.trim();
    if (f('max').value.trim()) entry.maxVersion = f('max').value.trim();
    if ($('f-pinned').checked) entry.pinned = true;
    return entry;
  }

  function renderPreview() {
    const e = readForm();
    $('p-title').textContent = e.title || 'Title';
    $('p-body').textContent = e.body.split('\\n').map((l) => l.replace(/^- /, '').trim()).filter(Boolean).join(' ') || 'Body text';
    $('p-type').textContent = e.type;
    $('p-date').textContent = e.publishedAt ? new Date(e.publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    const img = $('p-img');
    if (e.imageUrl) { img.src = e.imageUrl; img.classList.remove('hidden'); $('p-icon').classList.add('hidden'); }
    else { img.removeAttribute('src'); img.classList.add('hidden'); $('p-icon').classList.remove('hidden'); }
  }

  // ---- events ------------------------------------------------------------
  $('signin').addEventListener('click', async () => {
    const candidate = $('token').value.trim();
    if (!candidate) return;
    setStatus($('gate-status'), 'Checking…');
    try {
      if (!(await verify(candidate))) { setStatus($('gate-status'), 'That token was not accepted.', 'err'); return; }
      token = candidate;
      saveToken(candidate, $('remember').checked);
      $('token').value = '';
      await enter();
    } catch (err) { setStatus($('gate-status'), err.message, 'err'); }
  });
  $('token').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('signin').click(); });

  $('signout').addEventListener('click', () => {
    if (dirty && !confirm('You have unpublished changes. Sign out anyway?')) return;
    clearToken(); token = null;
    $('app').classList.add('hidden'); $('gate').classList.remove('hidden');
  });

  $('new').addEventListener('click', () => openForm(-1));
  $('cancel').addEventListener('click', closeForm);

  f('title').addEventListener('input', () => {
    if (editing === -1 && !f('id').dataset.touched) f('id').value = slug(f('title').value);
    renderPreview();
  });
  f('id').addEventListener('input', () => { f('id').dataset.touched = '1'; });
  ['body','image','type','published'].forEach((n) => f(n).addEventListener('input', renderPreview));

  $('form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const entry = readForm();
    if (!entry.title) return setStatus($('form-status'), 'Title is required.', 'err');
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.id)) return setStatus($('form-status'), 'Id must be lowercase letters, digits and dashes.', 'err');
    const clash = draft.findIndex((a, i) => a.id === entry.id && i !== editing);
    if (clash !== -1) return setStatus($('form-status'), 'Another announcement already uses that id.', 'err');
    if (editing >= 0) draft[editing] = entry; else draft.push(entry);
    setDirty(true);
    closeForm();
    setStatus($('status'), 'Saved to draft. Publish to push it to installs.', 'ok');
  });

  $('delete').addEventListener('click', () => {
    if (editing < 0) return;
    if (!confirm('Remove "' + draft[editing].title + '" from the feed?')) return;
    draft.splice(editing, 1);
    setDirty(true);
    closeForm();
    setStatus($('status'), 'Removed from draft. Publish to apply.', 'ok');
  });

  $('publish').addEventListener('click', async () => {
    $('publish').disabled = true;
    setStatus($('status'), 'Publishing…');
    try {
      const res = await api('/v1/announcements', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ announcements: draft }) });
      feed = await res.json();
      draft = feed.announcements.slice();
      setDirty(false);
      renderList();
      $('updated').textContent = 'last published ' + new Date(feed.updatedAt).toLocaleString();
      setStatus($('status'), 'Published. Installs pick it up within six hours, or on their next refresh.', 'ok');
    } catch (err) {
      setStatus($('status'), err.message, 'err');
      $('publish').disabled = false;
      if (/Sign in again/.test(err.message)) $('signout').click();
    }
  });

  $('drop').addEventListener('click', () => $('f-file').click());
  $('f-file').addEventListener('change', async () => {
    const file = $('f-file').files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return setStatus($('form-status'), 'Image is over 2MB.', 'err');
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['png','jpg','jpeg','gif','webp','svg'].includes(ext)) return setStatus($('form-status'), 'Unsupported image type.', 'err');
    const base = slug(file.name.replace(/\\.[^.]+$/, '')) || 'image';
    const name = base + '-' + Date.now().toString(36) + '.' + ext;
    setStatus($('form-status'), 'Uploading…');
    try {
      const res = await api('/v1/images/' + name, { method: 'PUT', body: file });
      const info = await res.json();
      f('image').value = info.url;
      renderPreview();
      setStatus($('form-status'), 'Uploaded.', 'ok');
    } catch (err) { setStatus($('form-status'), err.message, 'err'); }
    $('f-file').value = '';
  });

  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---- boot --------------------------------------------------------------
  TYPES.forEach((t) => { const o = document.createElement('option'); o.value = t; o.textContent = t; f('type').appendChild(o); });

  async function enter() {
    $('gate').classList.add('hidden'); $('app').classList.remove('hidden');
    try { await loadFeed(); } catch (err) { setStatus($('status'), err.message, 'err'); }
  }

  (async () => {
    const stored = loadToken();
    if (stored && (await verify(stored).catch(() => false))) { token = stored; await enter(); }
    else if (stored) clearToken();
  })();
})();
`;

function page() {
  const n = nonce();
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Prunerr announcements</title>
<style nonce="${n}">${CSS}</style>
</head>
<body>
${HTML_BODY}
<script nonce="${n}" data-types='${JSON.stringify(ANNOUNCEMENT_TYPES)}'>${JS}</script>
</body>
</html>`;
  return new Response(html, { headers: securityHeaders(n) });
}

/**
 * Route an admin request, or return null if the path is not ours.
 *
 * `isAuthorized` is passed in from announcements.js so there is exactly one
 * token check in the Worker.
 */
export function handleAdminRequest(request, env, isAuthorized) {
  const url = new URL(request.url);

  if (url.pathname === '/admin' || url.pathname === '/admin/') {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    // workers.dev is always HTTPS; this guards a custom route without it.
    if (url.protocol !== 'https:') {
      return new Response('The admin page is only served over HTTPS.', { status: 403 });
    }
    return page();
  }

  if (url.pathname === '/v1/admin/verify') {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    return new Response(null, {
      status: isAuthorized(request, env) ? 204 : 401,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  return null;
}
