/**
 * Floating "Explain" button and toast, rendered in a shadow root so page CSS
 * can't restyle them and they can't restyle the page.
 */

import { UI_HOST_ATTR } from './capture';

const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
  font: 500 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; }
.chip { position: fixed; display: none; align-items: center; gap: 8px; height: 30px; padding: 0 6px 0 10px;
  background: #1e2329; color: #eaecef; border: 1px solid #2b3139; border-radius: 6px; cursor: pointer;
  pointer-events: auto; box-shadow: 0 6px 20px rgba(0,0,0,.28); user-select: none; -webkit-user-select: none; }
.chip.show { display: inline-flex; }
.chip:hover { border-color: #474d57; }
.chip:active { transform: translateY(1px); }
.dot { width: 8px; height: 8px; border-radius: 2px; background: #fcd535; }
.label { font-weight: 600; letter-spacing: 0; }
.kbd { font: 500 11px/1 "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace; color: #929aa5;
  border: 1px solid #2b3139; border-radius: 4px; padding: 3px 5px; }
.x { width: 20px; height: 20px; display: grid; place-items: center; color: #707a8a; border-radius: 4px; }
.x:hover { color: #eaecef; background: #2b3139; }
.toast { position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 8px); opacity: 0; max-width: min(440px, calc(100vw - 32px));
  background: #1e2329; color: #eaecef; border: 1px solid #2b3139; border-radius: 8px; padding: 10px 14px;
  font-weight: 400; line-height: 1.45; box-shadow: 0 10px 30px rgba(0,0,0,.3); transition: opacity .16s ease, transform .16s ease; }
.toast.show { opacity: 1; transform: translate(-50%, 0); }
.toast.warn { border-left: 3px solid #fcd535; }
.toast b { color: #fff; font-weight: 600; }
@media (prefers-reduced-motion: reduce) { .toast { transition: none; } }
`;

export class PageUi {
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private chip!: HTMLDivElement;
  private toastEl!: HTMLDivElement;
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
      '<span class="dot"></span><span class="label">Explain</span><span class="kbd"></span>' +
      '<span class="x" title="Hide" aria-label="Hide">' +
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

    wrap.append(this.chip, this.toastEl);
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
    let top = rect.bottom + 8;
    if (top + h > vh - 8) top = rect.top - h - 8;
    left = Math.min(Math.max(8, left), vw - w - 8);
    top = Math.min(Math.max(8, top), vh - h - 8);
    this.chip.style.left = `${Math.round(left)}px`;
    this.chip.style.top = `${Math.round(top)}px`;
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

  contains(node: EventTarget | null): boolean {
    return !!this.host && node instanceof Node && this.host.contains(node);
  }
}
