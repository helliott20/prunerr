/**
 * The announcements admin page, served at /admin.
 *
 * A single static page with no build step: sign in with the ADMIN_TOKEN, then
 * write, edit, preview and publish announcements, upload images, and see how
 * many installs each one will reach. It talks to the same admin API the CLI
 * uses (see announcements.js), so the page holds no privileges of its own —
 * every write carries the token and is checked server-side.
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
      "img-src 'self' https: data: blob:",
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

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const CSS = String.raw`
:root {
  color-scheme: dark;
  --bg:#0a0f1c; --bg2:#0e1526; --panel:#121a2e; --panel2:#182238; --line:#243050; --line2:#2f3d61;
  --text:#e8ebf4; --muted:#8f98b3; --dim:#5f688a;
  --accent:#f59e0b; --accent2:#fbbf24; --on-accent:#3b2200;
  --ok:#10b981; --warn:#fbbf24; --danger:#f43f5e; --info:#22d3ee; --violet:#a78bfa;
  --radius:14px; --shadow:0 20px 50px rgba(0,0,0,.45);
}
* { box-sizing:border-box; }
html, body { height:100%; }
body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; -webkit-font-smoothing:antialiased; }
button, input, select, textarea { font:inherit; }
a { color:var(--accent2); }
.hidden { display:none !important; }
.sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); }

/* --- gate --- */
.gate { min-height:100%; display:grid; place-items:center; padding:24px; background:radial-gradient(60% 40% at 50% 0%, rgba(245,158,11,.10), transparent 70%), var(--bg); }
.gate-card { width:100%; max-width:420px; background:var(--panel); border:1px solid var(--line); border-radius:20px; padding:28px; box-shadow:var(--shadow); }
.logo { display:flex; align-items:center; gap:12px; margin-bottom:18px; }
.logo-mark { width:40px; height:40px; border-radius:12px; background:linear-gradient(135deg,var(--accent),#d97706); display:grid; place-items:center; color:var(--on-accent); font-weight:800; font-size:18px; box-shadow:0 8px 20px rgba(245,158,11,.25); }
.logo b { display:block; font-size:16px; }
.logo span { color:var(--muted); font-size:12px; }
.gate p { color:var(--muted); margin:0 0 14px; }

/* --- shell --- */
.shell { max-width:1240px; margin:0 auto; padding:20px 20px 80px; }
.topbar { display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap; margin-bottom:16px; }
.topbar .logo { margin:0; }
.topbar-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin-bottom:18px; }
.stat { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); padding:12px 14px; }
.stat .k { color:var(--muted); font-size:11.5px; text-transform:uppercase; letter-spacing:.05em; }
.stat .v { font-size:22px; font-weight:700; margin-top:2px; line-height:1.2; }
.stat .s { color:var(--muted); font-size:12px; }
.layout { display:grid; grid-template-columns:minmax(0,5fr) minmax(0,7fr); gap:18px; align-items:start; }
@media (max-width:980px) { .layout { grid-template-columns:1fr; } }

/* --- cards --- */
.card { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); }
.card-h { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:14px 16px; border-bottom:1px solid var(--line); }
.card-h b { font-size:14.5px; }
.card-b { padding:14px 16px; }
.muted { color:var(--muted); font-size:12.5px; }
.dim { color:var(--dim); }

/* --- buttons --- */
.btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; border:1px solid var(--line2); background:var(--panel2); color:var(--text); border-radius:10px; padding:8px 13px; cursor:pointer; font-weight:500; white-space:nowrap; transition:background .12s,border-color .12s,transform .06s; }
.btn:hover { background:#202c4a; border-color:#3a4a75; }
.btn:active { transform:translateY(1px); }
.btn.primary { background:var(--accent); border-color:var(--accent); color:var(--on-accent); font-weight:700; }
.btn.primary:hover { background:var(--accent2); border-color:var(--accent2); }
.btn.danger { color:#fda4af; border-color:rgba(244,63,94,.35); background:rgba(244,63,94,.08); }
.btn.danger:hover { background:rgba(244,63,94,.16); }
.btn.ghost { background:transparent; border-color:transparent; color:var(--muted); }
.btn.ghost:hover { background:var(--panel2); color:var(--text); }
.btn.sm { padding:5px 9px; font-size:12.5px; border-radius:8px; }
.btn.lg { padding:11px 18px; font-size:15px; border-radius:12px; }
.btn:disabled { opacity:.45; cursor:not-allowed; transform:none; }
.btn .kbd { margin-left:4px; font-size:10.5px; opacity:.7; border:1px solid currentColor; border-radius:4px; padding:0 4px; }

/* --- forms --- */
.field { margin-top:14px; }
.field:first-child { margin-top:0; }
.field label, .field .lbl { display:flex; align-items:baseline; justify-content:space-between; gap:8px; font-size:12.5px; font-weight:600; color:#c9d0e3; margin-bottom:5px; }
.field .hint { font-weight:400; color:var(--muted); font-size:11.5px; }
.field .count { font-weight:400; color:var(--dim); font-size:11px; font-variant-numeric:tabular-nums; }
.field .count.over { color:#fda4af; }
.input, select.input, textarea.input { width:100%; background:var(--bg2); color:var(--text); border:1px solid var(--line); border-radius:10px; padding:9px 11px; transition:border-color .12s, box-shadow .12s; }
.input:focus { outline:none; border-color:rgba(245,158,11,.7); box-shadow:0 0 0 3px rgba(245,158,11,.18); }
.input.invalid { border-color:rgba(244,63,94,.6); }
textarea.input { min-height:150px; resize:vertical; line-height:1.55; }
.input::placeholder { color:var(--dim); }
.row2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
@media (max-width:560px) { .row2 { grid-template-columns:1fr; } }
.seg { display:flex; gap:6px; flex-wrap:wrap; }
.seg button { border:1px solid var(--line); background:var(--bg2); color:var(--muted); border-radius:999px; padding:5px 11px; cursor:pointer; font-size:12.5px; display:inline-flex; gap:6px; align-items:center; }
.seg button .dot { width:8px; height:8px; border-radius:50%; background:currentColor; }
.seg button.on { color:var(--text); border-color:var(--line2); background:var(--panel2); box-shadow:inset 0 0 0 1px var(--line2); }
.toggle { display:flex; align-items:center; gap:10px; cursor:pointer; user-select:none; padding:10px 12px; border:1px solid var(--line); border-radius:10px; background:var(--bg2); }
.toggle input { position:absolute; opacity:0; }
.toggle .sw { width:36px; height:20px; border-radius:999px; background:#2b3554; position:relative; flex:none; transition:background .15s; }
.toggle .sw::after { content:""; position:absolute; top:2px; left:2px; width:16px; height:16px; border-radius:50%; background:#fff; transition:transform .15s; }
.toggle input:checked + .sw { background:var(--accent); }
.toggle input:checked + .sw::after { transform:translateX(16px); }
.toggle b { font-size:13px; }
.toggle span { color:var(--muted); font-size:12px; display:block; }
details.more { margin-top:16px; border:1px solid var(--line); border-radius:12px; background:var(--bg2); }
details.more summary { cursor:pointer; padding:11px 14px; font-weight:600; font-size:13px; color:#c9d0e3; list-style:none; display:flex; justify-content:space-between; align-items:center; }
details.more summary::-webkit-details-marker { display:none; }
details.more summary::after { content:"▾"; color:var(--muted); transition:transform .15s; }
details.more[open] summary::after { transform:rotate(180deg); }
details.more .inner { padding:2px 14px 14px; }
.reach { margin-top:6px; font-size:12px; color:var(--muted); }
.reach b { color:var(--text); }
.drop { margin-top:8px; border:1.5px dashed var(--line2); border-radius:12px; padding:14px; text-align:center; color:var(--muted); font-size:12.5px; cursor:pointer; transition:border-color .12s, background .12s; }
.drop:hover, .drop.over { border-color:var(--accent); background:rgba(245,158,11,.05); color:var(--text); }
.drop b { color:var(--text); }
.imgbar { display:flex; gap:8px; align-items:center; margin-top:8px; flex-wrap:wrap; }
.thumb { width:72px; height:45px; object-fit:cover; border-radius:8px; border:1px solid var(--line); background:#000; }
.form-actions { display:flex; gap:8px; align-items:center; margin-top:18px; flex-wrap:wrap; }
.form-actions .spacer { flex:1; }
.tools { display:flex; gap:6px; margin-bottom:6px; flex-wrap:wrap; }

/* --- list --- */
.searchbar { display:flex; gap:8px; padding:10px 12px; border-bottom:1px solid var(--line); }
.filters { display:flex; gap:6px; padding:8px 12px 2px; flex-wrap:wrap; }
.filters button { border:1px solid transparent; background:transparent; color:var(--muted); border-radius:999px; padding:3px 9px; font-size:12px; cursor:pointer; }
.filters button.on { background:var(--panel2); color:var(--text); border-color:var(--line2); }
.list { padding:10px 12px 12px; display:flex; flex-direction:column; gap:8px; }
.item { display:grid; grid-template-columns:44px minmax(0,1fr) auto; gap:12px; align-items:center; padding:10px 12px; border:1px solid var(--line); border-radius:12px; background:var(--bg2); cursor:pointer; transition:border-color .12s, background .12s; text-align:left; color:inherit; width:100%; }
.item:hover { border-color:var(--line2); background:#111a2f; }
.item.active { border-color:var(--accent); box-shadow:0 0 0 2px rgba(245,158,11,.18); }
.item .ic { width:44px; height:44px; border-radius:10px; display:grid; place-items:center; font-size:18px; background:linear-gradient(135deg,#1a2340,#0f1629); border:1px solid var(--line); overflow:hidden; }
.item .ic img { width:100%; height:100%; object-fit:cover; }
.item .t b { display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:13.5px; }
.item .t .m { color:var(--muted); font-size:11.5px; display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-top:2px; }
.chip { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; padding:2px 7px; border-radius:999px; background:var(--panel2); color:#c7cee0; border:1px solid var(--line); }
.chip.live { color:#6ee7b7; border-color:rgba(16,185,129,.35); background:rgba(16,185,129,.08); }
.chip.scheduled { color:#93c5fd; border-color:rgba(147,197,253,.35); background:rgba(147,197,253,.08); }
.chip.expired { color:#fda4af; border-color:rgba(244,63,94,.3); background:rgba(244,63,94,.06); }
.chip.pinned { color:#fcd34d; border-color:rgba(245,158,11,.35); background:rgba(245,158,11,.08); }
.chip.draft { color:#c4b5fd; border-color:rgba(167,139,250,.35); background:rgba(167,139,250,.08); }
.chip.type-feature { color:#fcd34d; } .chip.type-improvement { color:#67e8f9; } .chip.type-fix { color:#6ee7b7; } .chip.type-feedback { color:#c4b5fd; } .chip.type-announcement { color:#c7cee0; }
.empty { padding:26px 18px; text-align:center; color:var(--muted); }
.empty b { display:block; color:var(--text); font-size:15px; margin-bottom:4px; }
.empty ol { text-align:left; display:inline-block; margin:12px 0 0; padding-left:18px; color:var(--muted); }

/* --- preview --- */
.pv-wrap { position:sticky; top:16px; }
.pv-tabs { display:flex; gap:4px; background:var(--bg2); border:1px solid var(--line); padding:3px; border-radius:10px; }
.pv-tabs button { flex:1; border:0; background:transparent; color:var(--muted); border-radius:8px; padding:6px; cursor:pointer; font-size:12.5px; font-weight:600; }
.pv-tabs button.on { background:var(--panel2); color:var(--text); }
.pv-stage { margin-top:12px; padding:18px; border-radius:16px; background:radial-gradient(80% 60% at 70% 20%, rgba(245,158,11,.06), transparent), #070b16; border:1px solid var(--line); display:flex; justify-content:flex-end; }
.pcard { width:360px; max-width:100%; border:1px solid #2a3350; border-radius:18px; overflow:hidden; background:#060a14; box-shadow:0 30px 60px rgba(0,0,0,.55); font-family:system-ui,-apple-system,"Segoe UI",sans-serif; }
.pcard .hero { position:relative; display:flex; align-items:center; justify-content:center; overflow:hidden; background:radial-gradient(ellipse at 50% 60%, var(--glow, rgba(245,158,11,.5)) 0%, rgba(15,23,42,0) 70%), linear-gradient(180deg,#1a2340 0%,#0f1629 100%); }
.pcard .hero.img { aspect-ratio:16/10; }
.pcard .hero.icon { height:96px; }
.pcard .hero img { width:84%; height:84%; object-fit:cover; border-radius:12px; box-shadow:0 20px 40px rgba(0,0,0,.5); outline:1px solid rgba(255,255,255,.1); }
.pcard .hero .ico { width:48px; height:48px; border-radius:16px; background:rgba(6,10,20,.7); outline:1px solid rgba(255,255,255,.1); display:grid; place-items:center; font-size:22px; }
.pcard .hero .new { position:absolute; left:12px; top:12px; background:var(--accent); color:var(--on-accent); font-size:10px; font-weight:800; letter-spacing:.05em; padding:2px 8px; border-radius:999px; text-transform:uppercase; }
.pcard .hero .x { position:absolute; right:8px; top:8px; width:26px; height:26px; border-radius:50%; background:rgba(6,10,20,.6); color:#c7cee0; display:grid; place-items:center; font-size:13px; }
.pcard .pb { padding:14px 16px 16px; }
.pcard .meta { display:flex; align-items:center; gap:8px; font-size:10.5px; margin-bottom:6px; }
.pcard .meta .pill { text-transform:uppercase; letter-spacing:.05em; font-weight:700; padding:2px 8px; border-radius:999px; background:rgba(245,158,11,.15); color:#fcd34d; }
.pcard .meta .date { color:#8f98b3; }
.pcard h3 { margin:0; font-size:15.5px; font-weight:800; line-height:1.3; color:#f4f6fb; }
.pcard .teaser { margin:6px 0 0; color:#aab2c8; font-size:13px; line-height:1.5; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.pcard .full { margin-top:8px; color:#c4cad9; font-size:13px; line-height:1.55; }
.pcard .full p { margin:0 0 8px; } .pcard .full ul { margin:0 0 8px; padding-left:18px; } .pcard .full li { margin:2px 0; }
.pcard .link { display:inline-flex; align-items:center; gap:6px; margin-top:6px; background:var(--accent); color:var(--on-accent); font-weight:700; font-size:12.5px; padding:6px 12px; border-radius:8px; }
.pcard .less { margin-top:10px; color:#8f98b3; font-size:12px; }
.pv-note { margin-top:10px; color:var(--dim); font-size:11.5px; }

/* --- dialogs, toasts --- */
dialog { border:1px solid var(--line2); border-radius:16px; background:var(--panel); color:var(--text); padding:0; max-width:520px; width:calc(100% - 32px); box-shadow:var(--shadow); }
dialog::backdrop { background:rgba(3,6,14,.7); backdrop-filter:blur(3px); }
dialog .dh { padding:16px 18px 6px; font-weight:700; font-size:15px; }
dialog .db { padding:6px 18px 14px; color:var(--muted); font-size:13.5px; }
dialog .db ul { margin:8px 0 0; padding-left:18px; }
dialog .db li { margin:3px 0; color:var(--text); }
dialog .df { padding:12px 18px 16px; display:flex; justify-content:flex-end; gap:8px; }
.toasts { position:fixed; right:16px; bottom:16px; display:flex; flex-direction:column; gap:8px; z-index:50; }
.toast { background:var(--panel2); border:1px solid var(--line2); border-left:3px solid var(--info); color:var(--text); padding:10px 14px; border-radius:10px; box-shadow:var(--shadow); font-size:13px; max-width:360px; animation:in .18s ease-out; }
.toast.ok { border-left-color:var(--ok); } .toast.err { border-left-color:var(--danger); } .toast.warn { border-left-color:var(--warn); }
@keyframes in { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
.imggrid { display:grid; grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); gap:10px; padding:4px 18px 14px; max-height:50vh; overflow:auto; }
.imgcell { border:1px solid var(--line); border-radius:10px; overflow:hidden; background:var(--bg2); cursor:pointer; position:relative; }
.imgcell:hover { border-color:var(--accent); }
.imgcell img { width:100%; aspect-ratio:16/10; object-fit:cover; display:block; background:#000; }
.imgcell .n { padding:6px 8px; font-size:11px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.imgcell .used { position:absolute; top:6px; left:6px; }
.imgcell .del { position:absolute; top:4px; right:4px; }
.banner { background:rgba(245,158,11,.08); border:1px solid rgba(245,158,11,.3); color:#fcd34d; border-radius:12px; padding:10px 14px; font-size:13px; margin-bottom:14px; display:flex; justify-content:space-between; gap:10px; align-items:center; flex-wrap:wrap; }
.mt12 { margin-top:12px; } .mt16 { margin-top:16px; } .w100 { width:100%; } .grow { flex:1; min-width:200px; } .self-center { align-self:center; }
.status-line { min-height:20px; margin-top:10px; } .status-line-sm { min-height:18px; margin-top:8px; }
.v-sm { font-size:16px !important; } .hgroup { display:flex; gap:6px; } .hgroup-between { display:flex; justify-content:space-between; align-items:center; }
.welcome-b { padding:28px 22px; text-align:center; } .welcome-ico { font-size:30px; } .welcome-t { display:block; font-size:16px; margin:6px 0 4px; }
.skeleton { height:56px; border-radius:12px; background:linear-gradient(90deg,var(--bg2),var(--panel2),var(--bg2)); background-size:200% 100%; animation:sk 1.2s infinite; }
@keyframes sk { from { background-position:200% 0; } to { background-position:-200% 0; } }
`;

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

const HTML_BODY = String.raw`
<div id="gate" class="gate">
  <div class="gate-card">
    <div class="logo"><div class="logo-mark">✂</div><div><b>Prunerr announcements</b><span>What's new, for every install</span></div></div>
    <p>Paste the admin token to sign in. It stays in this browser and is never shown again.</p>
    <div class="field">
      <label for="token">Admin token</label>
      <input id="token" class="input" type="password" autocomplete="off" spellcheck="false" placeholder="••••••••••••••••••••••••" />
    </div>
    <label class="toggle mt12"><input id="remember" type="checkbox" /><span class="sw"></span><span><b>Remember on this device</b><span>Leave off on a shared computer.</span></span></label>
    <div class="form-actions"><button id="signin" class="btn primary lg w100">Sign in</button></div>
    <div id="gate-status" class="muted status-line"></div>
  </div>
</div>

<div id="app" class="shell hidden">
  <div class="topbar">
    <div class="logo"><div class="logo-mark">✂</div><div><b>Prunerr announcements</b><span id="updated">…</span></div></div>
    <div class="topbar-actions">
      <button id="images-btn" class="btn ghost">Image library</button>
      <button id="export-btn" class="btn ghost">Export JSON</button>
      <button id="discard" class="btn hidden">Discard changes</button>
      <button id="publish" class="btn primary" disabled>Publish <span class="kbd">⌘S</span></button>
      <button id="signout" class="btn ghost">Sign out</button>
    </div>
  </div>

  <div id="dirty-banner" class="banner hidden"><span>You have unpublished changes. Installs still see the last published version until you press <b>Publish</b>.</span></div>

  <div class="stats">
    <div class="stat"><div class="k">Active installs</div><div class="v" id="s-installs">—</div><div class="s">seen in the last 30 days</div></div>
    <div class="stat"><div class="k">Most common version</div><div class="v" id="s-version">—</div><div class="s" id="s-version-share"></div></div>
    <div class="stat"><div class="k">Live announcements</div><div class="v" id="s-live">—</div><div class="s" id="s-live-sub"></div></div>
    <div class="stat"><div class="k">Last published</div><div class="v v-sm" id="s-published">—</div><div class="s" id="s-published-sub"></div></div>
  </div>

  <div class="layout">
    <section class="card">
      <div class="card-h"><b>Announcements</b><button id="new" class="btn primary sm">+ New announcement</button></div>
      <div class="searchbar"><input id="search" class="input" placeholder="Search titles, ids, text…" /></div>
      <div class="filters" id="filters">
        <button data-f="all" class="on">All</button><button data-f="live">Live</button><button data-f="scheduled">Scheduled</button><button data-f="expired">Expired</button><button data-f="pinned">Pinned</button><button data-f="changed">Unpublished</button>
      </div>
      <div id="list" class="list"><div class="skeleton"></div><div class="skeleton"></div></div>
      <div id="empty" class="empty hidden">
        <b>No announcements yet</b>
        Tell your users something. It takes about a minute:
        <ol><li>Press <b>New announcement</b></li><li>Write a title and a sentence or two</li><li>Optionally drop in a picture</li><li>Press <b>Publish</b></li></ol>
      </div>
      <div id="noresults" class="empty hidden">Nothing matches that search.</div>
    </section>

    <section>
      <div id="editor" class="card hidden">
        <div class="card-h"><b id="editor-title">New announcement</b><div class="hgroup"><button id="duplicate" class="btn ghost sm hidden">Duplicate</button><button id="delete" class="btn danger sm hidden">Delete</button></div></div>
        <form id="form" class="card-b" autocomplete="off" novalidate>
          <div class="field">
            <label for="f-title">Title <span class="count" id="c-title">0/120</span></label>
            <input id="f-title" class="input" maxlength="120" placeholder="e.g. Smart rules are here" />
          </div>

          <div class="field">
            <div class="lbl">What kind of update is this? <span class="hint">sets the colour and the label on the card</span></div>
            <div class="seg" id="f-type"></div>
          </div>

          <div class="field">
            <label for="f-body">Message <span class="count" id="c-body">0/4000</span></label>
            <div class="tools"><button type="button" class="btn sm ghost" data-tool="bullet">• Bullet</button><button type="button" class="btn sm ghost" data-tool="para">¶ Paragraph</button><span class="muted self-center">Plain text. Blank line starts a paragraph, "- " starts a bullet.</span></div>
            <textarea id="f-body" class="input" maxlength="4000" placeholder="What changed, why it matters, what to do next."></textarea>
          </div>

          <div class="field">
            <div class="lbl">Picture <span class="hint">optional · shows large on the card · 16:10 looks best · up to 2MB</span></div>
            <div id="drop" class="drop"><b>Drop an image here</b> or click to choose — PNG, JPG, WebP, GIF or SVG</div>
            <input id="f-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" class="hidden" />
            <div class="imgbar" id="imgbar"><img id="f-thumb" class="thumb hidden" alt="" /><input id="f-image" class="input grow" placeholder="…or paste an image URL" /><button type="button" id="pick-image" class="btn sm">Library</button><button type="button" id="clear-image" class="btn sm ghost hidden">Remove</button></div>
          </div>

          <div class="field">
            <label class="toggle"><input id="f-pinned" type="checkbox" /><span class="sw"></span><span><b>Pop up for everyone</b><span>Pinned: shows first and opens on its own, once per person. Good for launches and feedback requests.</span></span></label>
          </div>

          <details class="more" id="more">
            <summary>More options <span class="muted" id="more-summary">link, dates, version targeting, id</span></summary>
            <div class="inner">
              <div class="row2">
                <div class="field"><label for="f-link">Button link <span class="hint">optional</span></label><input id="f-link" class="input" placeholder="https://…" /></div>
                <div class="field"><label for="f-link-label">Button text</label><input id="f-link-label" class="input" maxlength="60" placeholder="Read more" /></div>
              </div>
              <div class="row2">
                <div class="field"><label for="f-published">Show from</label><input id="f-published" class="input" type="date" /></div>
                <div class="field"><label for="f-expires">Hide after <span class="hint">optional</span></label><input id="f-expires" class="input" type="date" /></div>
              </div>
              <div class="row2">
                <div class="field"><label for="f-min">Only for versions from <span class="hint">e.g. 1.8.0</span></label><input id="f-min" class="input" placeholder="any" /></div>
                <div class="field"><label for="f-max">…up to <span class="hint">optional</span></label><input id="f-max" class="input" placeholder="any" /></div>
              </div>
              <div class="reach" id="reach"></div>
              <div class="field"><label for="f-id">Id <span class="hint">stable reference · change it to make this count as new again</span></label><input id="f-id" class="input" maxlength="64" placeholder="auto from title" /></div>
            </div>
          </details>

          <div class="form-actions">
            <button type="submit" id="save" class="btn primary lg">Save</button>
            <button type="button" id="cancel" class="btn lg">Cancel</button>
            <span class="spacer"></span>
            <span class="muted">Saving keeps it as a draft. Publish when you're ready.</span>
          </div>
          <div id="form-status" class="muted status-line-sm"></div>
        </form>
      </div>

      <div id="preview" class="card pv-wrap hidden mt16">
        <div class="card-h"><b>Preview</b><div class="pv-tabs" id="pv-tabs"><button data-v="teaser" class="on">Popup</button><button data-v="expanded">Expanded</button></div></div>
        <div class="card-b">
          <div class="pv-stage">
            <div class="pcard" id="pcard">
              <div class="hero icon" id="p-hero"><span class="new">New</span><span class="x">×</span><img id="p-img" alt="" class="hidden" /><div class="ico" id="p-ico">✦</div></div>
              <div class="pb">
                <div class="meta"><span class="pill" id="p-type">Announcement</span><span class="date" id="p-date"></span></div>
                <h3 id="p-title">Title</h3>
                <p class="teaser" id="p-teaser"></p>
                <div class="full hidden" id="p-full"></div>
                <span class="link hidden" id="p-link"></span>
                <div class="less hidden" id="p-less">Show less</div>
              </div>
            </div>
          </div>
          <div class="pv-note">This is how the card appears in the bottom-right corner of Prunerr. Clicking it in the app opens the expanded view.</div>
        </div>
      </div>

      <div id="welcome" class="card"><div class="card-b welcome-b">
        <div class="welcome-ico">📣</div>
        <b class="welcome-t">Pick an announcement to edit, or make a new one</b>
        <span class="muted">Announcements appear inside Prunerr under <b>What's new</b> within a few hours of publishing. Nothing about your users is collected in return.</span>
      </div></div>
    </section>
  </div>
</div>

<dialog id="dlg"><div class="dh" id="dlg-h"></div><div class="db" id="dlg-b"></div><div class="df"><button id="dlg-cancel" class="btn">Cancel</button><button id="dlg-ok" class="btn primary">OK</button></div></dialog>
<dialog id="imgdlg"><div class="dh hgroup-between">Image library <button id="imgdlg-upload" class="btn sm">Upload new</button></div><div class="db" id="imgdlg-note">Click an image to use it. Images referenced by an announcement are marked.</div><div class="imggrid" id="imggrid"></div><div class="df"><button id="imgdlg-close" class="btn">Close</button></div></dialog>
<div class="toasts" id="toasts"></div>
`;

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------

const JS = String.raw`
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const TYPES = JSON.parse(document.currentScript.dataset.types);
  const TYPE_META = {
    announcement: { label: 'Announcement', icon: '📣', glow: 'rgba(148,163,184,0.4)', pill: ['rgba(148,163,184,.18)', '#c7cee0'] },
    feature:      { label: 'New feature',  icon: '✦',  glow: 'rgba(245,158,11,0.55)', pill: ['rgba(245,158,11,.15)', '#fcd34d'] },
    improvement:  { label: 'Improvement',  icon: '⚡', glow: 'rgba(6,182,212,0.5)',   pill: ['rgba(6,182,212,.15)', '#67e8f9'] },
    fix:          { label: 'Fix',          icon: '🔧', glow: 'rgba(16,185,129,0.5)',  pill: ['rgba(16,185,129,.15)', '#6ee7b7'] },
    feedback:     { label: 'Feedback request', icon: '💬', glow: 'rgba(139,92,246,0.55)', pill: ['rgba(139,92,246,.15)', '#c4b5fd'] },
  };
  const APP_LABEL = { announcement: 'Announcement', feature: 'New', improvement: 'Improved', fix: 'Fixed', feedback: 'Your feedback' };
  const KEY = 'prunerr-announce-token';
  const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
  const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

  let token = null;
  let feed = { announcements: [], updatedAt: null };
  let published = new Map();   // id -> JSON string, as last published
  let draft = [];
  let editing = null;          // index into draft, or -1 for new
  let filter = 'all';
  let query = '';
  let previewMode = 'teaser';
  let stats = null;
  let formDirty = false;

  // ---- storage -----------------------------------------------------------
  const loadToken = () => { try { return sessionStorage.getItem(KEY) || localStorage.getItem(KEY); } catch { return null; } };
  const saveToken = (v, remember) => { try { sessionStorage.setItem(KEY, v); if (remember) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch {} };
  const clearToken = () => { try { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); } catch {} };

  // ---- api ---------------------------------------------------------------
  async function api(path, init) {
    init = init || {};
    const headers = Object.assign({}, init.headers || {}, token ? { Authorization: 'Bearer ' + token } : {});
    const res = await fetch(path, Object.assign({}, init, { headers, cache: 'no-store' }));
    if (res.status === 401) { const e = new Error('Your session has expired. Please sign in again.'); e.auth = true; throw e; }
    if (!res.ok) {
      let msg = 'Request failed (' + res.status + ')';
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch {}
      throw new Error(msg);
    }
    return res;
  }
  const verify = async (t) => (await fetch('/v1/admin/verify', { headers: { Authorization: 'Bearer ' + t }, cache: 'no-store' })).status === 204;

  // ---- helpers -----------------------------------------------------------
  function toast(text, kind, ms) {
    const el = document.createElement('div'); el.className = 'toast ' + (kind || ''); el.textContent = text;
    $('toasts').appendChild(el); setTimeout(() => el.remove(), ms || 3800);
  }
  function confirmDialog(title, bodyNode, okLabel, danger) {
    return new Promise((resolve) => {
      $('dlg-h').textContent = title;
      const b = $('dlg-b'); b.textContent = '';
      if (typeof bodyNode === 'string') b.textContent = bodyNode; else b.appendChild(bodyNode);
      const ok = $('dlg-ok'); ok.textContent = okLabel || 'OK'; ok.className = 'btn ' + (danger ? 'danger' : 'primary');
      const done = (v) => { $('dlg').close(); ok.onclick = null; $('dlg-cancel').onclick = null; resolve(v); };
      ok.onclick = () => done(true); $('dlg-cancel').onclick = () => done(false);
      $('dlg').oncancel = (e) => { e.preventDefault(); done(false); };
      $('dlg').showModal();
    });
  }
  const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  const dateOnly = (iso) => (iso ? iso.slice(0, 10) : '');
  const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  function parseVersion(v) { const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(v).trim()); return m ? { p: [+m[1], +m[2], +m[3]], pre: m[4] || null } : null; }
  function cmpVersion(a, b) { for (let i = 0; i < 3; i++) if (a.p[i] !== b.p[i]) return a.p[i] - b.p[i]; if (a.pre && !b.pre) return -1; if (!a.pre && b.pre) return 1; return 0; }
  function statusOf(a, now) {
    now = now || Date.now();
    if (a.expiresAt && Date.parse(a.expiresAt) <= now) return 'expired';
    if (Date.parse(a.publishedAt) > now) return 'scheduled';
    return 'live';
  }
  const isChanged = (a) => published.get(a.id) !== JSON.stringify(a);
  function sorted(list) {
    return list.slice().sort((a, b) => (Boolean(a.pinned) !== Boolean(b.pinned)) ? (a.pinned ? -1 : 1) : Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  }
  function normalize(a) {
    // Match the server's canonical form so the change detector compares like with like.
    const out = { id: a.id, type: a.type, title: a.title.trim(), body: a.body, publishedAt: new Date(a.publishedAt).toISOString() };
    if (a.imageUrl) out.imageUrl = a.imageUrl;
    if (a.link) { out.link = { url: a.link.url }; if (a.link.label) out.link.label = a.link.label; }
    if (a.minVersion) out.minVersion = a.minVersion;
    if (a.maxVersion) out.maxVersion = a.maxVersion;
    if (a.expiresAt) out.expiresAt = new Date(a.expiresAt).toISOString();
    if (a.pinned) out.pinned = true;
    return out;
  }
  function blocks(text) {
    const out = [];
    for (const raw of text.split(/\n{2,}/)) {
      const lines = raw.split('\n').map((l) => l.trimEnd()).filter(Boolean);
      if (!lines.length) continue;
      const fb = lines.findIndex((l) => l.startsWith('- '));
      if (fb === 0 && lines.every((l) => l.startsWith('- '))) { out.push({ ul: lines.map((l) => l.slice(2)) }); continue; }
      if (fb > 0 && lines.slice(fb).every((l) => l.startsWith('- '))) { out.push({ p: lines.slice(0, fb).join(' ') }); out.push({ ul: lines.slice(fb).map((l) => l.slice(2)) }); continue; }
      out.push({ p: lines.join(' ') });
    }
    return out;
  }
  const teaser = (text) => text.split('\n').map((l) => l.replace(/^- /, '').trim()).filter(Boolean).join(' ');

  // ---- dirty state -------------------------------------------------------
  function changes() {
    const added = [], changed = [], removed = [];
    const draftIds = new Set(draft.map((a) => a.id));
    for (const a of draft) { if (!published.has(a.id)) added.push(a); else if (isChanged(a)) changed.push(a); }
    for (const a of feed.announcements) if (!draftIds.has(a.id)) removed.push(a);
    return { added, changed, removed, any: added.length + changed.length + removed.length > 0 };
  }
  function refreshDirty() {
    const c = changes();
    $('publish').disabled = !c.any;
    $('discard').classList.toggle('hidden', !c.any);
    $('dirty-banner').classList.toggle('hidden', !c.any);
  }

  // ---- stats -------------------------------------------------------------
  async function loadStats() {
    try {
      const res = await fetch('/v1/stats', { cache: 'no-store' });
      if (!res.ok) return;
      stats = await res.json();
      $('s-installs').textContent = stats.activeInstalls.toLocaleString();
      const top = stats.versions[0];
      if (top) { $('s-version').textContent = 'v' + top.version; $('s-version-share').textContent = Math.round((top.count / Math.max(1, stats.activeInstalls)) * 100) + '% of installs'; }
      renderReach();
    } catch {}
  }
  function renderStats() {
    const live = draft.filter((a) => statusOf(a) === 'live');
    $('s-live').textContent = String(live.length);
    $('s-live-sub').textContent = live.filter((a) => a.pinned).length + ' pinned · ' + draft.filter((a) => statusOf(a) === 'scheduled').length + ' scheduled';
    if (feed.updatedAt) { const d = new Date(feed.updatedAt); $('s-published').textContent = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); $('s-published-sub').textContent = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); $('updated').textContent = 'Last published ' + d.toLocaleString(); }
    else { $('s-published').textContent = 'Never'; $('s-published-sub').textContent = ''; $('updated').textContent = 'Nothing published yet'; }
  }

  // ---- list --------------------------------------------------------------
  function renderList() {
    const list = $('list'); list.textContent = '';
    const q = query.trim().toLowerCase();
    const items = sorted(draft).filter((a) => {
      const st = statusOf(a);
      if (filter === 'pinned' && !a.pinned) return false;
      if (filter === 'changed' && !isChanged(a)) return false;
      if (['live', 'scheduled', 'expired'].includes(filter) && st !== filter) return false;
      if (q && !(a.title + ' ' + a.id + ' ' + a.body).toLowerCase().includes(q)) return false;
      return true;
    });
    $('empty').classList.toggle('hidden', draft.length > 0);
    $('noresults').classList.toggle('hidden', !(draft.length > 0 && items.length === 0));
    for (const a of items) {
      const row = el('button', 'item' + (editing !== null && draft[editing] === a ? ' active' : '')); row.type = 'button';
      const ic = el('div', 'ic');
      if (a.imageUrl) { const im = el('img'); im.src = a.imageUrl; im.alt = ''; ic.appendChild(im); } else ic.textContent = (TYPE_META[a.type] || TYPE_META.announcement).icon;
      row.appendChild(ic);
      const t = el('div', 't'); t.appendChild(el('b', null, a.title));
      const m = el('div', 'm');
      const st = statusOf(a);
      m.appendChild(el('span', 'chip ' + st, st));
      m.appendChild(el('span', 'chip type-' + a.type, (TYPE_META[a.type] || TYPE_META.announcement).label));
      if (a.pinned) m.appendChild(el('span', 'chip pinned', 'pinned'));
      if (isChanged(a)) m.appendChild(el('span', 'chip draft', published.has(a.id) ? 'edited' : 'new'));
      const bits = [fmtDate(a.publishedAt)];
      if (a.expiresAt) bits.push('until ' + fmtDate(a.expiresAt));
      if (a.minVersion || a.maxVersion) bits.push('v' + (a.minVersion || '…') + ' – ' + (a.maxVersion ? 'v' + a.maxVersion : '…'));
      m.appendChild(el('span', null, bits.join(' · ')));
      t.appendChild(m); row.appendChild(t);
      const edit = el('span', 'btn sm ghost', 'Edit'); row.appendChild(edit);
      row.addEventListener('click', () => openForm(draft.indexOf(a)));
      list.appendChild(row);
    }
    renderStats();
  }

  // ---- form --------------------------------------------------------------
  const f = (n) => $('f-' + n);
  let currentType = 'announcement';

  function setType(t) {
    currentType = t;
    for (const b of $('f-type').children) b.classList.toggle('on', b.dataset.t === t);
    renderPreview();
  }
  function setImage(url) {
    f('image').value = url || '';
    $('f-thumb').classList.toggle('hidden', !url); if (url) $('f-thumb').src = url;
    $('clear-image').classList.toggle('hidden', !url);
    renderPreview();
  }
  function counters() {
    const t = f('title').value.length, b = f('body').value.length;
    $('c-title').textContent = t + '/120'; $('c-title').classList.toggle('over', t > 120);
    $('c-body').textContent = b + '/4000'; $('c-body').classList.toggle('over', b > 4000);
  }
  function openForm(index) {
    editing = index;
    const a = index >= 0 ? draft[index] : null;
    $('editor-title').textContent = a ? 'Edit announcement' : 'New announcement';
    $('delete').classList.toggle('hidden', !a); $('duplicate').classList.toggle('hidden', !a);
    f('title').value = a ? a.title : '';
    f('id').value = a ? a.id : ''; f('id').dataset.touched = a ? '1' : '';
    setType(a ? a.type : 'announcement');
    f('body').value = a ? a.body : '';
    setImage(a && a.imageUrl ? a.imageUrl : '');
    f('link').value = a && a.link ? a.link.url : '';
    f('link-label').value = a && a.link && a.link.label ? a.link.label : '';
    f('published').value = a ? dateOnly(a.publishedAt) : new Date().toISOString().slice(0, 10);
    f('expires').value = a && a.expiresAt ? dateOnly(a.expiresAt) : '';
    f('min').value = a && a.minVersion ? a.minVersion : '';
    f('max').value = a && a.maxVersion ? a.maxVersion : '';
    $('f-pinned').checked = Boolean(a && a.pinned);
    $('more').open = Boolean(a && (a.link || a.expiresAt || a.minVersion || a.maxVersion));
    $('form-status').textContent = '';
    for (const i of document.querySelectorAll('#form .invalid')) i.classList.remove('invalid');
    $('editor').classList.remove('hidden'); $('preview').classList.remove('hidden'); $('welcome').classList.add('hidden');
    formDirty = false;
    counters(); renderList(); renderPreview(); renderReach();
    if (window.innerWidth < 980) $('editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
    f('title').focus();
  }
  async function closeForm(force) {
    if (formDirty && !force && !(await confirmDialog('Discard this edit?', 'Changes in the editor have not been saved.', 'Discard', true))) return false;
    editing = null; formDirty = false;
    $('editor').classList.add('hidden'); $('preview').classList.add('hidden'); $('welcome').classList.remove('hidden');
    renderList();
    return true;
  }
  function readForm() {
    const e = { id: f('id').value.trim() || slug(f('title').value) || 'announcement', type: currentType, title: f('title').value.trim(), body: f('body').value, publishedAt: f('published').value || new Date().toISOString().slice(0, 10) };
    if (f('image').value.trim()) e.imageUrl = f('image').value.trim();
    if (f('link').value.trim()) { e.link = { url: f('link').value.trim() }; if (f('link-label').value.trim()) e.link.label = f('link-label').value.trim(); }
    if (f('expires').value) e.expiresAt = f('expires').value;
    if (f('min').value.trim()) e.minVersion = f('min').value.trim();
    if (f('max').value.trim()) e.maxVersion = f('max').value.trim();
    if ($('f-pinned').checked) e.pinned = true;
    return e;
  }
  function validate(e) {
    const problems = [];
    const mark = (n, bad) => f(n).classList.toggle('invalid', Boolean(bad));
    mark('title', !e.title); if (!e.title) problems.push('Give it a title.');
    mark('id', !ID_RE.test(e.id)); if (!ID_RE.test(e.id)) problems.push('The id can only contain lowercase letters, digits and dashes.');
    const clash = draft.some((a, i) => a.id === e.id && i !== editing); if (clash) { mark('id', true); problems.push('Another announcement already uses that id.'); }
    const badUrl = (u) => { try { const x = new URL(u); return !/^https?:$/.test(x.protocol); } catch { return true; } };
    mark('image', e.imageUrl && badUrl(e.imageUrl)); if (e.imageUrl && badUrl(e.imageUrl)) problems.push('The image URL must start with http:// or https://.');
    mark('link', e.link && badUrl(e.link.url)); if (e.link && badUrl(e.link.url)) problems.push('The button link must start with http:// or https://.');
    mark('min', e.minVersion && !VERSION_RE.test(e.minVersion)); if (e.minVersion && !VERSION_RE.test(e.minVersion)) problems.push('"Only for versions from" must look like 1.8.0.');
    mark('max', e.maxVersion && !VERSION_RE.test(e.maxVersion)); if (e.maxVersion && !VERSION_RE.test(e.maxVersion)) problems.push('"…up to" must look like 1.8.0.');
    if (e.expiresAt && Date.parse(e.expiresAt) <= Date.parse(e.publishedAt)) { mark('expires', true); problems.push('"Hide after" must be later than "Show from".'); } else mark('expires', false);
    return problems;
  }
  function renderReach() {
    const r = $('reach'); if (!stats) { r.textContent = ''; return; }
    const min = parseVersion(f('min').value), max = parseVersion(f('max').value);
    if (!min && !max) { r.textContent = 'Reaches every install.'; return; }
    let n = 0;
    for (const v of stats.versions) { const pv = parseVersion(v.version); if (!pv) continue; if (min && cmpVersion(pv, min) < 0) continue; if (max && cmpVersion(pv, max) > 0) continue; n += v.count; }
    r.textContent = ''; r.appendChild(el('span', null, 'Reaches about ')); r.appendChild(el('b', null, n.toLocaleString())); r.appendChild(el('span', null, ' of ' + stats.activeInstalls.toLocaleString() + ' active installs.'));
  }
  function renderPreview() {
    const e = readForm();
    const meta = TYPE_META[e.type] || TYPE_META.announcement;
    $('pcard').style.setProperty('--glow', meta.glow);
    const hero = $('p-hero'); hero.className = 'hero ' + (e.imageUrl ? 'img' : 'icon');
    $('p-img').classList.toggle('hidden', !e.imageUrl); $('p-ico').classList.toggle('hidden', Boolean(e.imageUrl));
    if (e.imageUrl) $('p-img').src = e.imageUrl; else $('p-img').removeAttribute('src');
    $('p-ico').textContent = meta.icon;
    const pill = $('p-type'); pill.textContent = APP_LABEL[e.type] || e.type; pill.style.background = meta.pill[0]; pill.style.color = meta.pill[1];
    $('p-date').textContent = fmtDate(e.publishedAt);
    $('p-title').textContent = e.title || 'Your title here';
    const expanded = previewMode === 'expanded';
    $('p-teaser').classList.toggle('hidden', expanded); $('p-teaser').textContent = teaser(e.body) || 'Your message appears here, trimmed to two lines.';
    const full = $('p-full'); full.classList.toggle('hidden', !expanded); full.textContent = '';
    for (const b of blocks(e.body || 'Your message appears here.')) { if (b.p) full.appendChild(el('p', null, b.p)); else { const ul = el('ul'); for (const li of b.ul) ul.appendChild(el('li', null, li)); full.appendChild(ul); } }
    $('p-link').classList.toggle('hidden', !(expanded && e.link)); if (e.link) $('p-link').textContent = (e.link.label || 'Read more') + ' ↗';
    $('p-less').classList.toggle('hidden', !expanded);
    hero.querySelector('.x').classList.toggle('hidden', expanded);
  }

  // ---- images ------------------------------------------------------------
  async function uploadFile(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast('That image is over 2MB. Please shrink it first.', 'err');
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return toast('Use PNG, JPG, WebP, GIF or SVG.', 'err');
    const name = (slug(file.name.replace(/\.[^.]+$/, '')) || 'image') + '-' + Date.now().toString(36) + '.' + ext;
    $('drop').textContent = 'Uploading…';
    try {
      const res = await api('/v1/images/' + name, { method: 'PUT', body: file });
      const info = await res.json(); setImage(info.url); formDirty = true; toast('Image uploaded.', 'ok');
    } catch (err) { toast(err.message, 'err'); if (err.auth) signOut(); }
    $('drop').textContent = ''; $('drop').appendChild(el('b', null, 'Drop an image here')); $('drop').appendChild(document.createTextNode(' or click to choose — PNG, JPG, WebP, GIF or SVG'));
  }
  async function openLibrary() {
    const grid = $('imggrid'); grid.textContent = ''; grid.appendChild(el('div', 'muted', 'Loading…'));
    $('imgdlg').showModal();
    try {
      const { images } = await (await api('/v1/images')).json();
      grid.textContent = '';
      if (!images.length) grid.appendChild(el('div', 'muted', 'No images uploaded yet.'));
      const used = new Set(draft.map((a) => a.imageUrl).filter(Boolean));
      for (const im of images) {
        const cell = el('div', 'imgcell'); const img = el('img'); img.src = im.url; img.alt = ''; cell.appendChild(img);
        cell.appendChild(el('div', 'n', im.name));
        if (used.has(im.url)) cell.appendChild(el('span', 'chip live used', 'in use'));
        const del = el('button', 'btn sm danger del', '×'); del.type = 'button'; del.title = 'Delete image';
        del.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          if (used.has(im.url) && !(await confirmDialog('Delete an image in use?', 'An announcement still points at this image. Its card will fall back to an icon.', 'Delete', true))) return;
          if (!used.has(im.url) && !(await confirmDialog('Delete this image?', im.name, 'Delete', true))) return;
          try { await api('/v1/images/' + im.name, { method: 'DELETE' }); cell.remove(); toast('Image deleted.', 'ok'); } catch (err) { toast(err.message, 'err'); }
        });
        cell.appendChild(del);
        cell.addEventListener('click', () => { if (editing !== null) { setImage(im.url); formDirty = true; } $('imgdlg').close(); });
        grid.appendChild(cell);
      }
    } catch (err) { grid.textContent = ''; grid.appendChild(el('div', 'muted', err.message)); if (err.auth) { $('imgdlg').close(); signOut(); } }
  }

  // ---- publish -----------------------------------------------------------
  async function publish() {
    const c = changes(); if (!c.any) return;
    if (editing !== null && formDirty && !(await confirmDialog('Unsaved edit', 'The editor has changes that are not saved yet. Save it first, then publish.', 'OK'))) return;
    if (editing !== null && formDirty) return;
    const body = el('div'); body.appendChild(el('div', null, 'This replaces what every install sees under What\'s new:'));
    const ul = el('ul');
    for (const a of c.added) ul.appendChild(el('li', null, '＋ ' + a.title));
    for (const a of c.changed) ul.appendChild(el('li', null, '✎ ' + a.title));
    for (const a of c.removed) ul.appendChild(el('li', null, '－ ' + a.title + ' (removed)'));
    body.appendChild(ul);
    if (!(await confirmDialog('Publish ' + (c.added.length + c.changed.length + c.removed.length) + ' change' + (c.added.length + c.changed.length + c.removed.length === 1 ? '' : 's') + '?', body, 'Publish'))) return;
    $('publish').disabled = true; $('publish').textContent = 'Publishing…';
    try {
      const res = await api('/v1/announcements', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ announcements: draft }) });
      applyFeed(await res.json());
      toast('Published. Installs see it on their next page load (within a few minutes), or right away from the panel\'s refresh button.', 'ok', 6000);
    } catch (err) { toast(err.message, 'err', 7000); if (err.auth) signOut(); }
    $('publish').textContent = ''; $('publish').appendChild(document.createTextNode('Publish ')); $('publish').appendChild(el('span', 'kbd', '⌘S'));
    refreshDirty();
  }
  function applyFeed(next) {
    feed = next;
    published = new Map(feed.announcements.map((a) => [a.id, JSON.stringify(a)]));
    draft = feed.announcements.map((a) => JSON.parse(JSON.stringify(a)));
    refreshDirty(); renderList();
  }
  async function loadFeed() {
    const res = await api('/v1/announcements');
    applyFeed(await res.json());
  }

  // ---- auth --------------------------------------------------------------
  async function enter() {
    $('gate').classList.add('hidden'); $('app').classList.remove('hidden');
    try { await loadFeed(); } catch (err) { toast(err.message, 'err'); if (err.auth) return signOut(); }
    loadStats();
  }
  function signOut() {
    clearToken(); token = null; editing = null; formDirty = false;
    $('app').classList.add('hidden'); $('gate').classList.remove('hidden'); $('token').focus();
  }

  // ---- events ------------------------------------------------------------
  $('signin').addEventListener('click', async () => {
    const c = $('token').value.trim(); if (!c) return $('token').focus();
    $('signin').disabled = true; $('gate-status').textContent = 'Checking…';
    try {
      if (!(await verify(c))) { $('gate-status').textContent = 'That token was not accepted.'; $('signin').disabled = false; return; }
      token = c; saveToken(c, $('remember').checked); $('token').value = ''; $('gate-status').textContent = '';
      await enter();
    } catch (err) { $('gate-status').textContent = err.message; }
    $('signin').disabled = false;
  });
  $('token').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('signin').click(); });
  $('signout').addEventListener('click', async () => { if (changes().any && !(await confirmDialog('Sign out with unpublished changes?', 'Your draft edits will be lost.', 'Sign out', true))) return; signOut(); });
  $('new').addEventListener('click', async () => { if (editing !== null && !(await closeForm())) return; openForm(-1); });
  $('cancel').addEventListener('click', () => closeForm());
  $('discard').addEventListener('click', async () => { if (await confirmDialog('Discard all unpublished changes?', 'Everything goes back to the last published state.', 'Discard', true)) { await closeForm(true); applyFeed(feed); toast('Changes discarded.'); } });
  $('publish').addEventListener('click', publish);
  $('images-btn').addEventListener('click', openLibrary);
  $('pick-image').addEventListener('click', openLibrary);
  $('imgdlg-close').addEventListener('click', () => $('imgdlg').close());
  $('imgdlg-upload').addEventListener('click', () => { $('imgdlg').close(); $('f-file').click(); });
  $('clear-image').addEventListener('click', () => { setImage(''); formDirty = true; });
  $('export-btn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ announcements: draft }, null, 2)], { type: 'application/json' });
    const a = el('a'); a.href = URL.createObjectURL(blob); a.download = 'prunerr-announcements.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('search').addEventListener('input', () => { query = $('search').value; renderList(); });
  $('filters').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; filter = b.dataset.f; for (const x of $('filters').children) x.classList.toggle('on', x === b); renderList(); });
  $('pv-tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; previewMode = b.dataset.v; for (const x of $('pv-tabs').children) x.classList.toggle('on', x === b); renderPreview(); });

  for (const t of TYPES) { const b = el('button'); b.type = 'button'; b.dataset.t = t; const d = el('span', 'dot'); d.style.color = TYPE_META[t].pill[1]; b.appendChild(d); b.appendChild(document.createTextNode(TYPE_META[t].label)); b.addEventListener('click', () => { setType(t); formDirty = true; }); $('f-type').appendChild(b); }

  f('title').addEventListener('input', () => { if (!f('id').dataset.touched) f('id').value = slug(f('title').value); formDirty = true; counters(); renderPreview(); });
  f('id').addEventListener('input', () => { f('id').dataset.touched = '1'; formDirty = true; });
  f('body').addEventListener('input', () => { formDirty = true; counters(); renderPreview(); });
  for (const n of ['image', 'link', 'link-label', 'published', 'expires', 'min', 'max']) f(n).addEventListener('input', () => { formDirty = true; renderPreview(); renderReach(); });
  f('image').addEventListener('change', () => setImage(f('image').value.trim()));
  $('f-pinned').addEventListener('change', () => { formDirty = true; });
  document.querySelector('[data-tool=bullet]').addEventListener('click', () => { const ta = f('body'); const s = ta.selectionStart; const before = ta.value.slice(0, s); const lineStart = before.lastIndexOf('\n') + 1; ta.value = ta.value.slice(0, lineStart) + '- ' + ta.value.slice(lineStart); ta.focus(); ta.selectionStart = ta.selectionEnd = s + 2; ta.dispatchEvent(new Event('input')); });
  document.querySelector('[data-tool=para]').addEventListener('click', () => { const ta = f('body'); const s = ta.selectionStart; ta.value = ta.value.slice(0, s) + '\n\n' + ta.value.slice(s); ta.focus(); ta.selectionStart = ta.selectionEnd = s + 2; ta.dispatchEvent(new Event('input')); });

  $('drop').addEventListener('click', () => $('f-file').click());
  $('drop').addEventListener('dragover', (e) => { e.preventDefault(); $('drop').classList.add('over'); });
  $('drop').addEventListener('dragleave', () => $('drop').classList.remove('over'));
  $('drop').addEventListener('drop', (e) => { e.preventDefault(); $('drop').classList.remove('over'); uploadFile(e.dataTransfer.files[0]); });
  $('f-file').addEventListener('change', () => { uploadFile($('f-file').files[0]); $('f-file').value = ''; });
  document.addEventListener('paste', (e) => { if (editing === null) return; const item = [...(e.clipboardData.items || [])].find((i) => i.type.startsWith('image/')); if (item) { e.preventDefault(); const file = item.getAsFile(); uploadFile(new File([file], 'pasted.' + (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg'), { type: file.type })); } });

  $('form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const e = readForm(); const problems = validate(e);
    if (problems.length) { $('form-status').textContent = problems[0]; toast(problems[0], 'err'); return; }
    const entry = normalize(e);
    if (editing >= 0) draft[editing] = entry; else draft.push(entry);
    formDirty = false;
    closeForm(true); refreshDirty();
    toast('Saved as a draft. Press Publish when you\'re ready.', 'ok');
  });
  $('delete').addEventListener('click', async () => {
    if (editing < 0) return;
    if (!(await confirmDialog('Remove this announcement?', 'It disappears from every install the next time you publish.', 'Remove', true))) return;
    draft.splice(editing, 1); formDirty = false; closeForm(true); refreshDirty(); toast('Removed from the draft.');
  });
  $('duplicate').addEventListener('click', () => {
    if (editing < 0) return;
    const copy = JSON.parse(JSON.stringify(draft[editing])); copy.id = copy.id + '-copy'; copy.title = copy.title + ' (copy)'; delete copy.pinned;
    draft.push(copy); openForm(draft.length - 1); refreshDirty(); toast('Duplicated. Edit the copy and save.');
  });

  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (editing !== null && formDirty) $('form').requestSubmit(); else if (!$('publish').disabled) publish(); }
    if (e.key === 'Escape' && editing !== null && !$('dlg').open && !$('imgdlg').open) closeForm();
  });
  window.addEventListener('beforeunload', (e) => { if (changes().any || formDirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---- boot --------------------------------------------------------------
  (async () => {
    const stored = loadToken();
    if (stored && (await verify(stored).catch(() => false))) { token = stored; await enter(); }
    else { if (stored) clearToken(); $('token').focus(); }
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
