/**
 * Instagram slide templates (1080×1350, 4:5) in Glossa's look. Each returns a full HTML document
 * that scripts/social-render.mjs screenshots to JPEG. Text in [[double brackets]] gets the lime highlight.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const font = (rel) => fs.readFileSync(path.join(root, 'node_modules', rel)).toString('base64');
const INTER = font('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2');
const MONO = font('@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2');

const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Escapes, then turns [[x]] into a highlighted span. */
const rich = (s = '') => esc(s).replace(/\[\[(.+?)\]\]/g, '<span class="hl">$1</span>');

const CSS = `
@font-face { font-family: Inter; src: url(data:font/woff2;base64,${INTER}) format('woff2'); font-weight: 100 900; }
@font-face { font-family: Mono; src: url(data:font/woff2;base64,${MONO}) format('woff2'); font-weight: 500; }
* { box-sizing: border-box; margin: 0; }
html, body { width: 1080px; height: 1350px; }
body { background: #12151a; color: #f5f6f7; font-family: Inter, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
.slide { position: relative; width: 1080px; height: 1350px; padding: 90px 88px 190px; overflow: hidden; display: flex; flex-direction: column; justify-content: center; }
.glow { position: absolute; width: 900px; height: 900px; border-radius: 50%; right: -380px; top: -420px; background: radial-gradient(circle, rgba(220,238,177,.14), transparent 65%); }
.kicker { font: 500 26px/1 Mono, monospace; letter-spacing: 3px; text-transform: uppercase; color: #9aa3ae; margin-bottom: 36px; }
h1 { font-size: 92px; line-height: 1.04; font-weight: 750; letter-spacing: -2.5px; }
h1.md { font-size: 74px; letter-spacing: -1.8px; }
h2 { font-size: 60px; line-height: 1.1; font-weight: 720; letter-spacing: -1.3px; }
.sub { margin-top: 36px; font-size: 38px; line-height: 1.4; color: #c4c9d0; font-weight: 420; max-width: 860px; }
.hl { background: #dceeb1; color: #12151a; padding: 0 12px; border-radius: 10px; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
.mark { width: 52px; height: 52px; border-radius: 13px; background: #dceeb1; display: grid; align-content: center; gap: 6px; padding: 0 11px; }
.mark i { height: 5px; border-radius: 3px; background: #12151a; opacity: .35; } .mark i:nth-child(2) { opacity: 1; } .mark i:nth-child(3) { width: 62%; }
.foot { position: absolute; left: 88px; right: 88px; bottom: 64px; display: flex; align-items: center; gap: 18px; font-size: 30px; font-weight: 650; }
.foot .url { margin-left: auto; font: 500 26px/1 Mono, monospace; color: #9aa3ae; }
.foot .count { font: 500 24px/1 Mono, monospace; color: #6c7480; margin-left: 22px; }
.card { margin-top: 48px; padding: 44px; border-radius: 30px; background: #1b1f25; border: 2px solid #2a3038; }
.label { font: 500 22px/1 Mono, monospace; letter-spacing: 2.5px; text-transform: uppercase; color: #8a929d; margin-bottom: 18px; }
.head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 14px 20px; }
.head b { font-size: 76px; letter-spacing: -1.5px; }
.tag { flex: none; white-space: nowrap; font: 500 24px/1 Mono, monospace; padding: 10px 16px; border-radius: 10px; background: #262c34; color: #aab1bc; }
.meaning { margin-top: 26px; font-size: 42px; line-height: 1.38; font-weight: 520; }
.quote { position: relative; margin-top: 34px; padding: 28px 32px 28px 84px; border-radius: 22px; background: #232830; border: 2px solid #2f3540; font-size: 33px; line-height: 1.45; color: #d5d9de; }
.quote::before { content: '\\201C'; position: absolute; left: 28px; top: 18px; font: 700 76px/1 Georgia, serif; color: #fcd535; }
.quote .cap { display: block; font: 500 20px/1 Mono, monospace; letter-spacing: 2.5px; text-transform: uppercase; color: #8a929d; margin-bottom: 12px; }
.general { margin-top: 30px; font-size: 32px; line-height: 1.45; color: #aab1bc; }
.list { margin-top: 56px; display: grid; gap: 30px; }
.list div { display: grid; grid-template-columns: 76px 1fr; gap: 24px; align-items: start; font-size: 40px; line-height: 1.35; font-weight: 520; }
.list span { font: 500 30px/76px Mono, monospace; width: 76px; height: 76px; text-align: center; border-radius: 20px; background: #232830; color: #dceeb1; }
.cta h1 { font-size: 110px; }
.pill { display: inline-block; margin-top: 56px; padding: 30px 48px; border-radius: 999px; background: #dceeb1; color: #12151a; font-size: 40px; font-weight: 750; }
.small { margin-top: 30px; font: 500 26px/1.5 Mono, monospace; color: #9aa3ae; letter-spacing: 1px; }
/* product mock-ups */
.mock { margin-top: 52px; border-radius: 30px; background: #f7f7f5; color: #16191d; padding: 46px; font-size: 36px; line-height: 1.7; position: relative; }
.ul { text-decoration: underline dotted #d6a000 4px; text-underline-offset: 9px; }
.sel { background: #dceeb1; padding: 2px 6px; border-radius: 6px; }
.chip { display: inline-flex; align-items: center; gap: 14px; margin-top: 26px; padding: 14px 18px 14px 14px; border-radius: 16px; background: #181a20; color: #f5f6f7; font-size: 30px; font-weight: 650; }
.chip .m { width: 36px; height: 36px; border-radius: 9px; background: #dceeb1; display: grid; align-content: center; gap: 4px; padding: 0 8px; }
.chip .m i { height: 4px; border-radius: 2px; background: #12151a; opacity: .35; } .chip .m i:nth-child(2) { opacity: 1; } .chip .m i:nth-child(3) { width: 62%; }
.chip kbd { font: 500 22px/1 Mono, monospace; padding: 7px 10px; border-radius: 8px; background: #262c34; color: #aab1bc; }
.hover { position: absolute; right: 40px; top: calc(100% - 26px); width: 640px; padding: 30px; border-radius: 22px; background: #1e2329; color: #eaecef; font-size: 27px; line-height: 1.45; box-shadow: 0 30px 60px rgba(0,0,0,.45); }
.hover b { font-size: 30px; } .hover .when { margin-top: 14px; padding-top: 14px; border-top: 2px solid #2b3139; color: #aab1bc; font-size: 24px; }
.hover em { display: block; margin-top: 8px; color: #c4c9d0; font-size: 24px; }
.hover .hm { background: #dceeb1; color: #12151a; font-style: normal; font-weight: 700; padding: 0 5px; border-radius: 5px; }
.stats { margin-top: 52px; display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
.stats div { padding: 36px; border-radius: 26px; background: #1b1f25; border: 2px solid #2a3038; }
.stats b { display: block; font-size: 96px; letter-spacing: -2px; }
.stats span { font-size: 30px; color: #9aa3ae; }
`;

/* 9:16 stories (1080×1920). Instagram covers the top ~250px and bottom ~340px with its own UI, so content stays in the middle. */
const STORY_CSS = `
html, body { width: 1080px; height: 1920px; }
.story { position: relative; width: 1080px; height: 1920px; padding: 280px 90px 500px; overflow: hidden; display: flex; flex-direction: column; justify-content: center; }
.story .glow { width: 1200px; height: 1200px; right: -520px; top: -380px; }
.story .badge { align-self: flex-start; font: 500 30px/1 Mono, monospace; letter-spacing: 4px; text-transform: uppercase; color: #12151a; background: #dceeb1; padding: 16px 22px; border-radius: 12px; margin-bottom: 54px; }
.story h1 { font-size: 132px; letter-spacing: -3px; line-height: 1.02; }
.story .say { margin-top: 26px; font: 500 34px/1.3 Mono, monospace; color: #9aa3ae; }
.story .meaning { font-size: 54px; line-height: 1.32; margin-top: 54px; }
.story .quote { font-size: 40px; margin-top: 54px; }
.story .q { font-size: 96px; line-height: 1.08; font-weight: 750; letter-spacing: -2px; }
.story .opts { margin-top: 64px; display: grid; gap: 22px; }
.story .opts div { padding: 34px 40px; border-radius: 26px; background: #1b1f25; border: 2px solid #2a3038; font-size: 46px; font-weight: 600; }
.story .hint { margin-top: 60px; font-size: 40px; color: #c4c9d0; }
.story .sfoot { position: absolute; left: 90px; right: 90px; bottom: 380px; display: flex; align-items: center; gap: 20px; font-size: 36px; font-weight: 650; }
.story .sfoot .url { margin-left: auto; font: 500 30px/1 Mono, monospace; color: #9aa3ae; }
`;

function storyDoc(inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}${STORY_CSS}</style></head><body>
<div class="story"><div class="glow"></div>${inner}
<div class="sfoot"><span class="mark"><i></i><i></i><i></i></span>Glossa<span class="url">link in bio</span></div></div></body></html>`;
}

export const STORY_TEMPLATES = {
  word: (s) =>
    storyDoc(`<span class="badge">${esc(s.badge || 'Word of the day')}</span><h1>${esc(s.word)}</h1>${s.say ? `<div class="say">${esc(s.say)}</div>` : ''}
      <div class="meaning">${esc(s.meaning)}</div>${s.sentence ? `<div class="quote"><span class="cap">In a sentence</span>${rich(s.sentence)}</div>` : ''}`),
  quiz: (s) =>
    storyDoc(`<span class="badge">${esc(s.badge || 'Quick quiz')}</span><div class="q">${rich(s.question)}</div>
      <div class="opts">${(s.options || []).map((o, i) => `<div>${'ABC'[i]}. ${esc(o)}</div>`).join('')}</div><p class="hint">${rich(s.hint || 'Answer in today’s post. Reply with your guess 👇')}</p>`),
  tip: (s) => storyDoc(`<span class="badge">${esc(s.badge || 'Reading tip')}</span><div class="q">${rich(s.title)}</div><p class="hint">${rich(s.body || '')}</p>`),
  teaser: (s) =>
    storyDoc(`<span class="badge">${esc(s.badge || 'New post')}</span><div class="q">${rich(s.title)}</div><p class="hint">${rich(s.body || 'Tap our profile to see it. Save it for later.')}</p>`),
};

function doc(inner, { n, total }) {
  const count = total > 1 ? `<span class="count">${n}/${total}</span>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="slide"><div class="glow"></div>${inner}
<div class="foot"><span class="mark"><i></i><i></i><i></i></span>Glossa${count}<span class="url">glossa.wovenbit.tech</span></div></div></body></html>`;
}

const MOCKS = {
  select: (s) => `<div class="mock">${rich(s.text || 'With a quarter-point cut already [[priced in]], traders shrugged.').replace('class="hl"', 'class="sel"')}
    <div><span class="chip"><span class="m"><i></i><i></i><i></i></span>Explain<kbd>⌥E</kbd></span></div></div>`,
  underline: (s) => `<div class="mock" style="margin-bottom:290px">${esc(s.before || 'The lender said its')} <span class="ul">${esc(s.word || 'net interest margin')}</span> ${esc(s.after || 'would narrow next year.')}
    <div class="hover"><b>${esc(s.word || 'net interest margin')}</b><div>${esc(s.meaning || 'The gap between interest a bank earns and pays.')}</div>
    <div class="when">You met it 3 weeks ago · The Economist<em>“…banks reported a wider <span class="hm">${esc(s.word || 'net interest margin')}</span> this quarter…”</em></div></div></div>`,
  answer: (s) => `<div class="card"><div class="head"><b>${esc(s.word)}</b>${s.tag ? `<span class="tag">${esc(s.tag)}</span>` : ''}</div>
    <div class="meaning">${esc(s.meaning)}</div>${s.quote ? `<div class="quote"><span class="cap">${esc(s.quoteLabel || 'From the page')}</span>${rich(s.quote)}</div>` : ''}</div>`,
  stats: (s) => `<div class="stats">${(s.stats || []).map(([v, l]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>`,
};

export const TEMPLATES = {
  cover: (s, meta) =>
    doc(`${s.kicker ? `<div class="kicker">${esc(s.kicker)}</div>` : ''}<h1 class="${s.size === 'md' ? 'md' : ''}">${rich(s.title)}</h1>${s.sub ? `<p class="sub">${rich(s.sub)}</p>` : ''}${s.mock ? MOCKS[s.mock](s) : ''}`, meta),
  term: (s, meta) =>
    doc(`<div class="kicker">${esc(s.kicker || 'Decoded')}</div><div class="card" style="margin-top:0"><div class="head"><b>${esc(s.word)}</b>${s.tag ? `<span class="tag">${esc(s.tag)}</span>` : ''}</div>
      <div class="quote"><span class="cap">${esc(s.sentenceLabel || 'In the article')}</span>${rich(s.sentence)}</div>
      <div class="meaning">${esc(s.meaning)}</div>${s.general ? `<div class="general">In general: ${esc(s.general)}</div>` : ''}</div>`, meta),
  feature: (s, meta) =>
    doc(`<div class="kicker">${esc(s.kicker || 'Glossa')}</div><h2>${rich(s.title)}</h2>${s.body ? `<p class="sub">${rich(s.body)}</p>` : ''}${s.mock ? MOCKS[s.mock](s) : ''}`, meta),
  list: (s, meta) =>
    doc(`<div class="kicker">${esc(s.kicker || '')}</div><h2>${rich(s.title)}</h2><div class="list">${(s.items || []).map((t, i) => `<div><span>${i + 1}</span><p>${rich(t)}</p></div>`).join('')}</div>`, meta),
  cta: (s, meta) =>
    doc(`<div class="cta"><h1>${rich(s.title || 'Select. Understand. [[Remember.]]')}</h1><p class="sub">${rich(s.sub || 'Glossa explains anything you select, grounded in the page, and keeps every word you look up.')}</p>
      <span class="pill">${esc(s.button || 'Free at glossa.wovenbit.tech')}</span><p class="small">${esc(s.small || 'Chrome extension · no API key · link in bio')}</p></div>`, meta),
};
