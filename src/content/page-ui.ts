/**
 * Floating "Explain" button and toast, rendered in a shadow root so page CSS
 * can't restyle them and they can't restyle the page.
 */

import { UI_HOST_ATTR } from './capture';
import type { TermIndexItem } from '../shared/lexicon';

const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
  font: 500 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; }
/* Explain button: the Glossa mark (a highlighted line) plus a tail that points at the selection. */
.chip { position: fixed; display: none; align-items: center; gap: 7px; height: 30px; padding: 0 4px 0 5px;
  background: #181a20; color: #f5f6f7; border: 1px solid #2f3540; border-radius: 9px; cursor: pointer;
  pointer-events: auto; box-shadow: 0 10px 28px rgba(0,0,0,.34), inset 0 1px 0 rgba(255,255,255,.05);
  user-select: none; -webkit-user-select: none; --tail-x: 50%; --from-y: -4px; }
.chip.show { display: inline-flex; animation: chip-in .18s cubic-bezier(.2,.9,.3,1.15); }
.chip.above { --from-y: 4px; }
.chip::before { content: ''; position: absolute; left: var(--tail-x); top: -5px; width: 9px; height: 9px;
  background: #181a20; border-left: 1px solid #2f3540; border-top: 1px solid #2f3540; border-top-left-radius: 2px;
  transform: translateX(-50%) rotate(45deg); }
.chip.above::before { top: auto; bottom: -5px; border: 0; border-right: 1px solid #2f3540; border-bottom: 1px solid #2f3540;
  border-radius: 0 0 2px 0; }
.chip:hover { border-color: #4a5260; }
.chip:hover::before { border-color: #4a5260; }
.chip:active { transform: translateY(1px); }
.mark { display: grid; align-content: center; gap: 2.5px; width: 20px; height: 20px; padding: 0 4px; border-radius: 6px; background: #dceeb1; }
.mark i { display: block; height: 2.4px; border-radius: 2px; background: #181a20; opacity: .35; transform-origin: left center; }
.mark i:nth-child(2) { opacity: 1; }
.mark i:nth-child(3) { width: 62%; }
.chip:hover .mark i:nth-child(2) { animation: sweep .5s cubic-bezier(.3,.7,.2,1); }
.label { font-weight: 650; letter-spacing: -.1px; }
.kbd { font: 500 10.5px/1 "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace; color: #aab1bc;
  background: #232830; border: 1px solid #343b46; border-bottom-width: 2px; border-radius: 5px; padding: 3px 5px 2px; }
.sep { width: 1px; height: 16px; background: #2f3540; }
.x { width: 20px; height: 20px; display: grid; place-items: center; color: #707a8a; border-radius: 6px; }
.x:hover { color: #f5f6f7; background: #2b3139; }
.dot { width: 8px; height: 8px; border-radius: 2px; background: #fcd535; }
@keyframes chip-in { from { opacity: 0; transform: translateY(var(--from-y)) scale(.96); } to { opacity: 1; transform: none; } }
@keyframes sweep { from { transform: scaleX(.15); } to { transform: scaleX(1); } }
.toast { position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 8px); opacity: 0; max-width: min(440px, calc(100vw - 32px));
  background: #1e2329; color: #eaecef; border: 1px solid #2b3139; border-radius: 8px; padding: 10px 14px;
  font-weight: 400; line-height: 1.45; box-shadow: 0 10px 30px rgba(0,0,0,.3); transition: opacity .16s ease, transform .16s ease; }
.toast.show { opacity: 1; transform: translate(-50%, 0); }
.toast.warn::before { content: ''; display: inline-block; width: 8px; height: 8px; margin-right: 8px; border-radius: 2px;
  background: #fcd535; vertical-align: 1px; }
.toast b { color: #fff; font-weight: 600; }
.flash { position: fixed; pointer-events: none; border-radius: 3px; background: rgba(220, 238, 177, .55);
  box-shadow: 0 0 0 2px rgba(220, 238, 177, .9); animation: flash 2.4s ease-out forwards; }
@keyframes flash { 0%, 55% { opacity: 1; } 100% { opacity: 0; } }
.seen { position: fixed; display: none; width: min(300px, calc(100vw - 16px)); padding: 10px 12px; pointer-events: auto;
  background: #1e2329; color: #eaecef; border: 1px solid #2b3139; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,.3);
  font-weight: 400; line-height: 1.45; }
.seen.show { display: block; }
.seen-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
.seen-term { font-weight: 600; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.seen-count { margin-left: auto; flex: none; font: 500 11px/1 "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace; color: #929aa5; }
.seen-meaning { color: #d5d8dc; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.seen-memory { margin-top: 9px; padding-top: 9px; border-top: 1px solid #2b3139; }
.seen-memory[hidden] { display: none; }
.seen-when { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: #aab1bc; }
.seen-when svg { flex: none; color: #dceeb1; }
.seen-when b { color: #eaecef; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.seen-past { margin-top: 5px; font-size: 12px; font-style: italic; line-height: 1.5; color: #c4c9d0;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.seen-past mark { background: #dceeb1; color: #181a20; font-style: normal; font-weight: 600; padding: 0 2px; border-radius: 3px; }
.seen-foot { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.seen-label { font-size: 11px; color: #929aa5; display: inline-flex; align-items: center; gap: 6px; }
.seen-btn { margin-left: auto; border: 0; border-radius: 6px; padding: 6px 10px; background: #fcd535; color: #181a20; font: 600 12px/1 inherit;
  font-family: inherit; cursor: pointer; }
.seen-btn:hover { background: #f0b90b; }
@media (prefers-reduced-motion: reduce) { .toast { transition: none; } .chip.show, .chip:hover .mark i { animation: none; } }
`;

function sameDocument(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname === y.pathname && x.search === y.search;
  } catch {
    return false;
  }
}

export function timeAgo(ts: number, now = Date.now()): string {
  const min = Math.max(0, Math.floor((now - ts) / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  if (d < 365) return `${Math.round(d / 30)} months ago`;
  return `${Math.round(d / 365)} year${d >= 730 ? 's' : ''} ago`;
}

export class PageUi {
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private chip!: HTMLDivElement;
  private toastEl!: HTMLDivElement;
  private seenEl!: HTMLDivElement;
  private seenAction: () => void = () => undefined;
  private toastTimer: number | undefined;
  private onChipClick: () => void;
  private onChipDismiss: () => void;
  private onChipHover: () => void;

  constructor(handlers: { onChipClick: () => void; onChipDismiss: () => void; onChipHover: () => void }) {
    this.onChipClick = handlers.onChipClick;
    this.onChipDismiss = handlers.onChipDismiss;
    this.onChipHover = handlers.onChipHover;
  }

  private ensure(): void {
    if (this.host && this.host.isConnected) return;
    this.host = document.createElement('glossa-ui');
    this.host.setAttribute(UI_HOST_ATTR, '');
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLES;
    const wrap = document.createElement('div');
    wrap.className = 'wrap';

    this.chip = document.createElement('div');
    this.chip.className = 'chip';
    this.chip.setAttribute('data-glossa-chip', '');
    this.chip.setAttribute('role', 'button');
    this.chip.setAttribute('aria-label', 'Explain selection with Glossa');
    this.chip.innerHTML =
      '<span class="mark" aria-hidden="true"><i></i><i></i><i></i></span><span class="label">Explain</span><span class="kbd"></span>' +
      '<span class="sep" aria-hidden="true"></span><span class="x" title="Hide" aria-label="Hide">' +
      '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 1l8 8M9 1L1 9"/></svg></span>';
    this.chip.addEventListener('pointerenter', () => this.onChipHover());
    // mousedown + preventDefault keeps the page selection alive while clicking.
    this.chip.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    this.chip.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.target as Element;
      if (target.closest('.x')) this.onChipDismiss();
      else this.onChipClick();
    });

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast';
    this.toastEl.setAttribute('data-glossa-toast', '');
    this.toastEl.setAttribute('role', 'status');
    this.toastEl.setAttribute('aria-live', 'polite');

    this.seenEl = document.createElement('div');
    this.seenEl.className = 'seen';
    this.seenEl.setAttribute('data-glossa-seen', '');
    this.seenEl.setAttribute('role', 'dialog');
    this.seenEl.setAttribute('aria-label', 'Saved meaning');
    this.seenEl.innerHTML =
      '<div class="seen-head"><span class="seen-term"></span><span class="seen-count"></span></div>' +
      '<div class="seen-meaning"></div>' +
      '<div class="seen-memory" hidden><div class="seen-when">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>' +
      '<span class="seen-when-text"></span></div><div class="seen-past"></div></div>' +
      '<div class="seen-foot"><span class="seen-label"><span class="dot"></span>In your words</span>' +
      '<button class="seen-btn" type="button">Explain here</button></div>';
    this.seenEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    this.seenEl.querySelector('.seen-btn')!.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.hideSeenCard();
      this.seenAction();
    });

    wrap.append(this.chip, this.toastEl, this.seenEl);
    this.root.append(style, wrap);
    (document.body || document.documentElement).appendChild(this.host);
  }

  showChip(rect: DOMRect, shortcut: string): void {
    this.ensure();
    const kbd = this.chip.querySelector('.kbd') as HTMLElement;
    kbd.textContent = shortcut;
    kbd.style.display = shortcut ? '' : 'none';
    this.chip.classList.add('show');
    const w = this.chip.offsetWidth || 130;
    const h = this.chip.offsetHeight || 30;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rect.right - w / 2;
    let top = rect.bottom + 10;
    const above = top + h > vh - 8;
    if (above) top = rect.top - h - 10;
    left = Math.min(Math.max(8, left), vw - w - 8);
    top = Math.min(Math.max(8, top), vh - h - 8);
    this.chip.style.left = `${Math.round(left)}px`;
    this.chip.style.top = `${Math.round(top)}px`;
    // Point the tail at the end of the selection.
    this.chip.style.setProperty('--tail-x', `${Math.round(Math.min(Math.max(rect.right - left, 14), w - 14))}px`);
    this.chip.classList.toggle('above', above);
  }

  hideChip(): void {
    this.chip?.classList.remove('show');
  }

  isChipVisible(): boolean {
    return !!this.chip?.classList.contains('show');
  }

  toast(message: string, tone: 'info' | 'warn' = 'info', ms = 3200): void {
    this.ensure();
    this.toastEl.textContent = message;
    this.toastEl.classList.toggle('warn', tone === 'warn');
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  showSeenCard(rect: DOMRect, item: TermIndexItem, onExplain: () => void): void {
    this.ensure();
    this.seenAction = onExplain;
    (this.seenEl.querySelector('.seen-term') as HTMLElement).textContent = item.t;
    (this.seenEl.querySelector('.seen-count') as HTMLElement).textContent = item.c > 1 ? `looked up ${item.c}×` : 'looked up once';
    (this.seenEl.querySelector('.seen-meaning') as HTMLElement).textContent = item.m;
    this.renderMemory(item);
    this.seenEl.classList.add('show');
    const w = this.seenEl.offsetWidth || 300;
    const h = this.seenEl.offsetHeight || 110;
    let left = rect.left;
    let top = rect.bottom + 6;
    if (top + h > window.innerHeight - 8) top = rect.top - h - 6;
    left = Math.min(Math.max(8, left), window.innerWidth - w - 8);
    this.seenEl.style.left = `${Math.round(left)}px`;
    this.seenEl.style.top = `${Math.round(Math.max(8, top))}px`;
  }

  /** "You met it 3 weeks ago · The Economist" plus the sentence it was in, with the word marked. Text only, never HTML. */
  private renderMemory(item: TermIndexItem): void {
    const box = this.seenEl.querySelector('.seen-memory') as HTMLElement;
    const when = this.seenEl.querySelector('.seen-when-text') as HTMLElement;
    const past = this.seenEl.querySelector('.seen-past') as HTMLElement;
    when.replaceChildren();
    past.replaceChildren();
    if (!item.u && !item.s) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const here = !!item.u && sameDocument(item.u, location.href);
    if (here) {
      when.append(`You looked this up on this page · ${timeAgo(item.at)}`);
    } else {
      const firstTime = item.c <= 1 || !item.f;
      when.append(`${firstTime ? 'You met it' : 'Last met'} ${timeAgo(item.at)}`);
      if (item.h) {
        when.append(' · ');
        const b = document.createElement('b');
        b.textContent = item.h;
        when.append(b);
      }
    }
    const sentence = (item.s || '').trim();
    if (sentence && !here) {
      const i = sentence.toLowerCase().indexOf(item.t.toLowerCase());
      past.append('“');
      if (i >= 0) {
        const mark = document.createElement('mark');
        mark.textContent = sentence.slice(i, i + item.t.length);
        past.append(sentence.slice(0, i), mark, sentence.slice(i + item.t.length));
      } else {
        past.append(sentence);
      }
      past.append('”');
    }
  }

  /** Scrolls a range into view, then briefly lights it up (fixed boxes over its line rects). */
  flashRange(range: Range): void {
    this.ensure();
    const target = range.startContainer.parentElement;
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const draw = () => {
      const wrap = this.root!.querySelector('.wrap')!;
      wrap.querySelectorAll('.flash').forEach((f) => f.remove());
      for (const r of Array.from(range.getClientRects())) {
        if (r.width < 1 || r.height < 1) continue;
        const box = document.createElement('div');
        box.className = 'flash';
        box.setAttribute('data-glossa-flash', '');
        Object.assign(box.style, { left: `${r.left - 2}px`, top: `${r.top - 1}px`, width: `${r.width + 4}px`, height: `${r.height + 2}px` });
        wrap.append(box);
        setTimeout(() => box.remove(), 2600);
      }
    };
    let done = false;
    const once = () => {
      if (done) return;
      done = true;
      draw();
    };
    window.addEventListener('scrollend', once, { once: true });
    setTimeout(once, 700);
  }

  hideSeenCard(): void {
    this.seenEl?.classList.remove('show');
  }

  isSeenCardVisible(): boolean {
    return !!this.seenEl?.classList.contains('show');
  }

  isOverSeenCard(x: number, y: number): boolean {
    if (!this.isSeenCardVisible()) return false;
    const r = this.seenEl.getBoundingClientRect();
    return x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 8 && y <= r.bottom + 4;
  }

  contains(node: EventTarget | null): boolean {
    return !!this.host && node instanceof Node && this.host.contains(node);
  }
}
