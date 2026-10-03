/**
 * Private admin dashboard: login, signed session cookie, and a server-rendered stats page.
 * No JavaScript on these pages (the site's CSP forbids inline scripts anyway) and every value
 * that came from outside (paths, referrers, feedback) is HTML-escaped.
 */

import crypto from 'node:crypto';
import type { DayRow, Summary } from './stats';

export const ADMIN_COOKIE = 'glossa_admin';
const SESSION_MS = 12 * 60 * 60 * 1000;

const sha = (s: string) => crypto.createHash('sha256').update(s).digest();
const hmac = (secret: string, s: string) => crypto.createHmac('sha256', secret).update(s).digest('base64url');

/** Constant-time check of both fields (hashing first makes lengths equal). */
export function credentialsMatch(expectedUser: string, expectedPassword: string, user: string, password: string): boolean {
  const u = crypto.timingSafeEqual(sha(`u:${expectedUser}`), sha(`u:${user}`));
  const p = crypto.timingSafeEqual(sha(`p:${expectedPassword}`), sha(`p:${password}`));
  return u && p;
}

export function makeSession(secret: string, now = Date.now()): string {
  const exp = now + SESSION_MS;
  return `${exp}.${hmac(secret, `admin:${exp}`)}`;
}

export function validSession(cookieHeader: string | undefined, secret: string, now = Date.now()): boolean {
  const raw = (cookieHeader || '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${ADMIN_COOKIE}=`))
    ?.slice(ADMIN_COOKIE.length + 1);
  if (!raw) return false;
  const [exp, sig] = raw.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < now) return false;
  const expected = hmac(secret, `admin:${exp}`);
  return expected.length === sig.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

export function sessionCookie(value: string, secure: boolean): string {
  return `${ADMIN_COOKIE}=${value}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`;
}

export function clearedCookie(secure: boolean): string {
  return `${ADMIN_COOKIE}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const num = (n: number) => n.toLocaleString('en-US');
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 1000) / 10}%` : '–');

const STYLE = `
:root { color-scheme: dark; --bg:#0b0e11; --surface:#161a1e; --surface2:#1e2329; --line:#2b3139; --text:#eaecef; --muted:#848e9c; --lime:#dceeb1; --yellow:#fcd535; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 Inter, -apple-system, "Segoe UI", system-ui, sans-serif; }
a { color: var(--lime); }
.wrap { max-width: 1180px; margin: 0 auto; padding: 24px 20px 64px; }
.top { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 20px; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 18px; }
.mark { width: 26px; height: 26px; border-radius: 6px; background: var(--lime); display: grid; align-content: center; gap: 3px; padding: 0 5px; }
.mark i { height: 3px; border-radius: 2px; background: #181a20; opacity: .35; } .mark i:nth-child(2) { opacity: 1; } .mark i:nth-child(3) { width: 62%; }
.spacer { flex: 1; }
.range a { display: inline-block; padding: 6px 12px; border: 1px solid var(--line); border-radius: 999px; color: var(--text); text-decoration: none; font-size: 13px; margin-left: 4px; }
.range a.on { background: var(--lime); color: #181a20; border-color: var(--lime); font-weight: 600; }
button, .btn { font: inherit; border: 1px solid var(--line); background: var(--surface2); color: var(--text); padding: 7px 14px; border-radius: 8px; cursor: pointer; }
.note { margin-bottom: 16px; padding: 10px 14px; border: 1px solid #5c4f17; background: #2a2510; border-radius: 10px; color: #f3e3a0; font-size: 13px; }
.kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(165px, 1fr)); gap: 10px; margin-bottom: 18px; }
.kpi { padding: 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
.kpi b { display: block; font-size: 26px; font-weight: 700; letter-spacing: -.5px; }
.kpi span { color: var(--muted); font-size: 12px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 14px; margin-bottom: 14px; }
.card { padding: 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); min-width: 0; }
.card h2 { margin: 0 0 12px; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
.funnel div { display: grid; grid-template-columns: 150px 1fr 90px; align-items: center; gap: 10px; margin: 6px 0; font-size: 13px; }
.bar { height: 22px; border-radius: 6px; background: var(--surface2); overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--lime); border-radius: 6px; min-width: 2px; }
.funnel em { font-style: normal; color: var(--muted); text-align: right; }
svg { display: block; width: 100%; height: auto; }
table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
th, td { padding: 7px 8px; border-bottom: 1px solid var(--line); text-align: right; white-space: nowrap; }
th:first-child, td:first-child { text-align: left; }
th { color: var(--muted); font-weight: 600; font-size: 11.5px; }
.scroll { overflow-x: auto; }
.list td:first-child { max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
.empty { color: var(--muted); font-size: 13px; }
.fb { padding: 10px 0; border-bottom: 1px solid var(--line); }
.fb small { color: var(--muted); }
.fb p { margin: 4px 0 0; white-space: pre-wrap; word-break: break-word; }
.legend { display: flex; gap: 14px; font-size: 12px; color: var(--muted); margin-top: 6px; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
.login { max-width: 360px; margin: 14vh auto 0; padding: 28px; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); }
.login h1 { margin: 14px 0 4px; font-size: 20px; }
.login p { margin: 0 0 18px; color: var(--muted); font-size: 13px; }
.login label { display: block; margin: 12px 0 6px; font-size: 12px; color: var(--muted); }
.login input { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--text); font: inherit; }
.login button { width: 100%; margin-top: 18px; background: var(--lime); color: #181a20; border-color: var(--lime); font-weight: 600; }
.err { margin-top: 14px; padding: 9px 12px; border-radius: 8px; border: 1px solid #6b2b2b; background: #2a1414; color: #f4b4b4; font-size: 13px; }
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}

const MARK = '<span class="mark" aria-hidden="true"><i></i><i></i><i></i></span>';

export function renderLogin(opts: { error?: string } = {}): string {
  return page(
    'Glossa admin · Sign in',
    `<form class="login" method="post" action="/admin/login" autocomplete="on">
      <div class="brand">${MARK} Glossa admin</div>
      <h1>Sign in</h1>
      <p>This area is private.</p>
      <label for="u">Username</label>
      <input id="u" name="username" autocomplete="username" required autofocus>
      <label for="p">Password</label>
      <input id="p" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Sign in</button>
      ${opts.error ? `<div class="err" role="alert">${esc(opts.error)}</div>` : ''}
    </form>`
  );
}

/** Simple bar chart (oldest → newest) as inline SVG; one or two series. */
function chart(rows: DayRow[], series: { key: keyof DayRow; color: string; label: string }[]): string {
  const data = [...rows].reverse();
  const W = 560;
  const H = 150;
  const pad = 18;
  const max = Math.max(1, ...data.flatMap((r) => series.map((s) => Number(r[s.key]) || 0)));
  const slot = (W - pad) / Math.max(1, data.length);
  const bw = Math.max(2, (slot - 2) / series.length);
  const bars = data
    .map((r, i) =>
      series
        .map((s, j) => {
          const v = Number(r[s.key]) || 0;
          const h = Math.round((v / max) * (H - 30));
          const x = pad + i * slot + j * bw;
          return `<rect x="${x.toFixed(1)}" y="${H - 16 - h}" width="${(bw - 1).toFixed(1)}" height="${h}" rx="2" fill="${s.color}"><title>${esc(r.day)} · ${esc(s.label)}: ${v}</title></rect>`;
        })
        .join('')
    )
    .join('');
  const first = data[0]?.day.slice(5) || '';
  const last = data[data.length - 1]?.day.slice(5) || '';
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map((s) => s.label).join(', '))}">
    <text x="0" y="12" fill="#848e9c" font-size="11">${num(max)}</text>
    <line x1="${pad}" y1="${H - 16}" x2="${W}" y2="${H - 16}" stroke="#2b3139"/>
    ${bars}
    <text x="${pad}" y="${H - 2}" fill="#848e9c" font-size="11">${esc(first)}</text>
    <text x="${W}" y="${H - 2}" fill="#848e9c" font-size="11" text-anchor="end">${esc(last)}</text>
  </svg><div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}</div>`;
}

function listTable(rows: [string, number][], label: string, empty: string, fmt: (k: string) => string = (k) => k): string {
  if (!rows.length) return `<p class="empty">${esc(empty)}</p>`;
  const total = rows.reduce((a, [, v]) => a + v, 0);
  return `<table class="list"><tr><th>${esc(label)}</th><th>Count</th><th>Share</th></tr>${rows
    .map(([k, v]) => `<tr><td title="${esc(k)}">${esc(fmt(k))}</td><td>${num(v)}</td><td>${pct(v, total)}</td></tr>`)
    .join('')}</table>`;
}

const flag = (cc: string) => (/^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) + ' ' + cc : cc);

const active = (r: DayRow) =>
  r.visitors + r.pageviews + r.downloads + r.installs + r.uninstalls + r.activeInstalls + r.lookups + r.followUps > 0;

export function renderDashboard(s: Summary, days: number, now = Date.now()): string {
  const rows = s.days;
  const sum = (k: keyof DayRow) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const pageviews = sum('pageviews');
  const downloads = sum('downloads');
  const installs = sum('installs');
  const uninstalls = sum('uninstalls');
  const lookups = sum('lookups');
  const followUps = sum('followUps');
  const repeats = sum('repeatLookups');
  const firstLookups = sum('newInstalls');
  // Retention only counts cohorts old enough to have had the chance.
  const matured = (n: number) => rows.filter((r) => Date.parse(r.day) <= now - n * 86_400_000);
  const d7Base = matured(7).reduce((a, r) => a + r.newInstalls, 0);
  const d7 = matured(7).reduce((a, r) => a + r.retainedD7, 0);
  const d30Base = matured(30).reduce((a, r) => a + r.newInstalls, 0);
  const d30 = matured(30).reduce((a, r) => a + r.retainedD30, 0);
  const wordList10 = rows[0]?.installsWithWordList10 || 0;

  const kpi = (v: string, label: string) => `<div class="kpi"><b>${v}</b><span>${esc(label)}</span></div>`;
  const funnelSteps: [string, number][] = [
    ['Unique visitors', s.uniqueVisitors],
    ['Downloads', downloads],
    ['Installs', installs],
    ['First lookup', firstLookups],
    ['Back after 7 days', d7],
  ];
  const fmax = Math.max(1, ...funnelSteps.map(([, v]) => v));
  const funnel = funnelSteps
    .map(
      ([label, v], i) =>
        `<div><span>${esc(label)}</span><span class="bar"><i style="width:${((v / fmax) * 100).toFixed(1)}%"></i></span><em>${num(v)}${i ? ` · ${pct(v, funnelSteps[i - 1][1])}` : ''}</em></div>`
    )
    .join('');

  const cohorts = rows.filter((r) => r.newInstalls > 0);
  const range = [7, 30, 90].map((d) => `<a href="/admin?days=${d}" class="${d === days ? 'on' : ''}">${d} days</a>`).join('');

  return page(
    'Glossa admin',
    `<div class="wrap">
      <div class="top">
        <div class="brand">${MARK} Glossa admin</div>
        <span class="spacer"></span>
        <span class="range">${range}</span>
        <form method="post" action="/admin/logout"><button type="submit">Log out</button></form>
      </div>
      ${
        s.store === 'memory'
          ? '<div class="note">Counts are kept in this server’s memory (Upstash isn’t configured or reachable), so they reset on restart and differ between serverless instances. Add the Upstash variables for real numbers.</div>'
          : ''
      }
      <div class="kpis">
        ${kpi(num(s.uniqueVisitors), 'Unique visitors')}
        ${kpi(num(pageviews), 'Page views')}
        ${kpi(num(downloads), 'Downloads')}
        ${kpi(num(installs), 'Installs')}
        ${kpi(num(uninstalls), 'Uninstalls')}
        ${kpi(num(s.uniqueActiveInstalls), 'Active users (free service)')}
        ${kpi(num(lookups), 'Lookups')}
        ${kpi(num(followUps), 'Follow-ups')}
        ${kpi(pct(repeats, lookups), 'Repeat lookups')}
        ${kpi(num(wordList10), 'Users with 10+ words (today)')}
        ${kpi(d7Base ? pct(d7, d7Base) : '–', 'Back after 7 days')}
        ${kpi(d30Base ? pct(d30, d30Base) : '–', 'Back after 30 days')}
      </div>
      <div class="grid">
        <section class="card"><h2>Funnel · last ${days} days</h2><div class="funnel">${funnel}</div></section>
        <section class="card"><h2>Website traffic</h2>${chart(rows, [
          { key: 'visitors', color: '#dceeb1', label: 'Visitors' },
          { key: 'pageviews', color: '#5b6b45', label: 'Page views' },
        ])}</section>
      </div>
      <div class="grid">
        <section class="card"><h2>Downloads and installs</h2>${chart(rows, [
          { key: 'downloads', color: '#fcd535', label: 'Downloads' },
          { key: 'installs', color: '#dceeb1', label: 'Installs' },
          { key: 'uninstalls', color: '#f08080', label: 'Uninstalls' },
        ])}</section>
        <section class="card"><h2>Extension usage</h2>${chart(rows, [
          { key: 'lookups', color: '#dceeb1', label: 'Lookups' },
          { key: 'activeInstalls', color: '#fcd535', label: 'Active users' },
        ])}</section>
      </div>
      <div class="grid">
        <section class="card"><h2>Top pages</h2>${listTable(s.topPages, 'Page', 'No visits yet.')}</section>
        <section class="card"><h2>Referrers</h2>${listTable(s.topReferrers, 'Site', 'No referrers yet. Direct visits aren’t listed.')}</section>
        <section class="card"><h2>Countries</h2>${listTable(s.countries, 'Country', 'No country data yet (only available on Vercel).', flag)}</section>
      </div>
      <section class="card" style="margin-bottom:14px"><h2>Retention by first-lookup day</h2>${
        cohorts.length
          ? `<div class="scroll"><table><tr><th>Day</th><th>New users</th><th>Back 7+ days</th><th>%</th><th>Back 30+ days</th><th>%</th></tr>${cohorts
              .map(
                (r) =>
                  `<tr><td>${esc(r.day)}</td><td>${num(r.newInstalls)}</td><td>${num(r.retainedD7)}</td><td>${pct(r.retainedD7, r.newInstalls)}</td><td>${num(r.retainedD30)}</td><td>${pct(r.retainedD30, r.newInstalls)}</td></tr>`
              )
              .join('')}</table></div>`
          : '<p class="empty">No first lookups in this range yet.</p>'
      }</section>
      <section class="card" style="margin-bottom:14px"><h2>Daily (days with activity)</h2><div class="scroll"><table>
        <tr><th>Day</th><th>Visitors</th><th>Views</th><th>Downloads</th><th>Installs</th><th>Uninstalls</th><th>Active</th><th>New</th><th>Lookups</th><th>Follow-ups</th><th>Repeats</th></tr>
        ${(rows.some(active) ? rows.filter(active) : rows.slice(0, 1))
          .map(
            (r) =>
              `<tr><td>${esc(r.day)}</td><td>${num(r.visitors)}</td><td>${num(r.pageviews)}</td><td>${num(r.downloads)}</td><td>${num(r.installs)}</td><td>${num(r.uninstalls)}</td><td>${num(r.activeInstalls)}</td><td>${num(r.newInstalls)}</td><td>${num(r.lookups)}</td><td>${num(r.followUps)}</td><td>${num(r.repeatLookups)}</td></tr>`
          )
          .join('')}
      </table></div></section>
      <section class="card"><h2>Latest feedback</h2>${
        s.feedback.length
          ? s.feedback
              .map((f) => `<div class="fb"><small>${esc(new Date(f.at).toLocaleString('en-US'))}${f.reason ? ` · ${esc(f.reason)}` : ''}</small>${f.message ? `<p>${esc(f.message)}</p>` : ''}</div>`)
              .join('')
          : '<p class="empty">No feedback yet.</p>'
      }</section>
      <p class="empty" style="margin-top:18px">Active users, first lookups and retention count people on the free service only (own-key and on-device users never reach the server). Downloads can include bots. Times are UTC.</p>
    </div>`
  );
}
