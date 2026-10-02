import { useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { WEBSITE_URL } from '../shared/brand';
import type { WeeklyRecap } from '../shared/lexicon';

const LIME = '#dceeb1';
const INK = '#181a20';

function siteHost(): string {
  try {
    const h = new URL(WEBSITE_URL).host;
    return /localhost|127\.0\.0\.1/.test(h) ? 'glossa.wovenbit.tech' : h;
  } catch {
    return 'glossa.wovenbit.tech';
  }
}

/** Draws the shareable "My reading week" card (1200×630, the size social sites preview). */
export async function drawRecap(r: WeeklyRecap): Promise<Blob> {
  await document.fonts?.ready;
  const W = 1200;
  const H = 630;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const font = (weight: number, size: number) => `${weight} ${size}px "Inter Variable", Inter, system-ui, sans-serif`;

  g.fillStyle = INK;
  g.fillRect(0, 0, W, H);

  // Brand mark: three lines, the middle one highlighted.
  const mx = 72;
  const my = 64;
  g.fillStyle = LIME;
  g.beginPath();
  g.roundRect(mx, my, 56, 56, 12);
  g.fill();
  g.fillStyle = INK;
  [
    [14, 0.35, 32],
    [26, 1, 32],
    [38, 0.35, 21],
  ].forEach(([y, a, w]) => {
    g.globalAlpha = a;
    g.beginPath();
    g.roundRect(mx + 12, my + y - 2, w, 5, 2.5);
    g.fill();
  });
  g.globalAlpha = 1;
  g.fillStyle = '#f5f6f7';
  g.font = font(700, 34);
  g.fillText('Glossa', mx + 76, my + 40);

  g.fillStyle = '#9aa3ae';
  g.font = font(500, 26);
  g.fillText('My reading week', mx, 196);

  const stats: [string, string][] = [
    [String(r.newWords), r.newWords === 1 ? 'new word' : 'new words'],
    [String(r.lookups), r.lookups === 1 ? 'lookup' : 'lookups'],
    [String(r.activeDays), r.activeDays === 1 ? 'day reading' : 'days reading'],
    [String(r.known), 'words known'],
  ];
  const colW = (W - mx * 2) / 4;
  stats.forEach(([n, label], i) => {
    const x = mx + i * colW;
    g.fillStyle = '#f5f6f7';
    g.font = font(700, 96);
    g.fillText(n, x, 320);
    g.fillStyle = '#9aa3ae';
    g.font = font(500, 26);
    g.fillText(label, x, 362);
  });

  if (r.top) {
    g.fillStyle = '#9aa3ae';
    g.font = font(500, 26);
    const lead = 'Most met: ';
    g.fillText(lead, mx, 460);
    const lx = mx + g.measureText(lead).width + 6;
    g.font = font(700, 30);
    const word = r.top.headword.length > 34 ? `${r.top.headword.slice(0, 33)}…` : r.top.headword;
    const ww = g.measureText(word).width;
    g.fillStyle = LIME;
    g.beginPath();
    g.roundRect(lx - 8, 428, ww + 16, 44, 8);
    g.fill();
    g.fillStyle = INK;
    g.fillText(word, lx, 460);
    g.fillStyle = '#9aa3ae';
    g.font = font(500, 26);
    g.fillText(`×${r.top.count}`, lx + ww + 20, 460);
  }

  g.fillStyle = '#2f3540';
  g.fillRect(mx, 528, W - mx * 2, 2);
  g.fillStyle = '#c4c9d0';
  g.font = font(500, 24);
  g.fillText('The explainer that remembers', mx, 576);
  g.fillStyle = LIME;
  const host = siteHost();
  g.fillText(host, W - mx - g.measureText(host).width, 576);

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('image failed'))), 'image/png'));
}

export function recapText(r: WeeklyRecap): string {
  const parts = [
    `My reading week with Glossa: ${r.newWords} new word${r.newWords === 1 ? '' : 's'}, ${r.lookups} lookup${r.lookups === 1 ? '' : 's'} over ${r.activeDays} day${r.activeDays === 1 ? '' : 's'}, ${r.known} word${r.known === 1 ? '' : 's'} known.`,
  ];
  if (r.top) parts.push(`Most met: "${r.top.headword}".`);
  parts.push(siteHost());
  return parts.join(' ');
}

export function RecapCard({ recap }: { recap: WeeklyRecap }) {
  const [status, setStatus] = useState('');
  const flash = (s: string) => {
    setStatus(s);
    setTimeout(() => setStatus(''), 1800);
  };

  const save = async () => {
    const blob = await drawRecap(recap);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `glossa-week-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const copy = async () => {
    try {
      const blob = await drawRecap(recap);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob, 'text/plain': new Blob([recapText(recap)], { type: 'text/plain' }) })]);
      flash('Copied. Paste it anywhere.');
    } catch {
      await navigator.clipboard.writeText(recapText(recap)).catch(() => undefined);
      flash('Copied as text.');
    }
  };

  return (
    <section className="recap" data-testid="recap">
      <div className="recap-head">
        <span>Your week</span>
        <span className="recap-actions">
          <button className="icon-btn" onClick={copy} aria-label="Copy recap image" title="Copy image">
            <Copy size={14} />
          </button>
          <button className="icon-btn" onClick={save} aria-label="Download recap image" title="Download image" data-testid="recap-save">
            <Download size={14} />
          </button>
        </span>
      </div>
      <div className="recap-stats">
        <div>
          <b className="num">{recap.newWords}</b>
          <span>new words</span>
        </div>
        <div>
          <b className="num">{recap.lookups}</b>
          <span>lookups</span>
        </div>
        <div>
          <b className="num">{recap.activeDays}</b>
          <span>days</span>
        </div>
        <div>
          <b className="num">{recap.known}</b>
          <span>known</span>
        </div>
      </div>
      {recap.top && (
        <div className="recap-top">
          Most met: <mark>{recap.top.headword}</mark> <span className="muted">×{recap.top.count}</span>
        </div>
      )}
      {status && (
        <div className="recap-status" role="status">
          {status}
        </div>
      )}
    </section>
  );
}
