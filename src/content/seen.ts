/**
 * "Seen it before": quietly underlines terms from the reader's word list when they appear on a page,
 * and shows the saved meaning on hover. Runs entirely in the page; nothing is sent anywhere.
 *
 * Uses the CSS Custom Highlight API, so the page's DOM is never modified (no wrapping spans that
 * could break sites or editors).
 */

import { termKey, type TermIndexItem } from '../shared/lexicon';
import { UI_HOST_ATTR } from './capture';

export const HIGHLIGHT_NAME = 'glossa-seen';
const MAX_TERMS = 3000;
const MAX_MATCHES = 400;
const MAX_PER_TERM = 6;
const MAX_SCAN_CHARS = 300_000; // ~50 ms worst case with 3,000 terms
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'HEAD', 'TITLE']);

const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Terms worth underlining: not tiny, not numbers, not huge. Acronyms of 2+ capitals are fine. */
export function underlinable(t: string): boolean {
  const s = t.trim();
  if (s.length > 60 || /^[\d\s.,%$€£-]+$/.test(s)) return false;
  if (s.length >= 3) return true;
  return /^[A-Z]{2}$/.test(s);
}

export interface Matcher {
  re: RegExp;
  byKey: Map<string, TermIndexItem>;
}

export function buildMatcher(items: TermIndexItem[]): Matcher | null {
  const chosen = items
    .filter((i) => underlinable(i.t))
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_TERMS);
  if (!chosen.length) return null;
  const byKey = new Map(chosen.map((i) => [i.k, i]));
  const alts = [...new Set(chosen.map((i) => i.t.trim()))]
    .sort((a, b) => b.length - a.length)
    .map((t) => reEsc(t).replace(/\s+/g, '\\s+'));
  return { re: new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alts.join('|')})(?![\\p{L}\\p{N}_])`, 'giu'), byKey };
}

/** Finds term matches in a string; returns [start, end, item] triples. */
export function matchText(text: string, m: Matcher): [number, number, TermIndexItem][] {
  const out: [number, number, TermIndexItem][] = [];
  m.re.lastIndex = 0;
  for (const hit of text.matchAll(m.re)) {
    const item = m.byKey.get(termKey(hit[0]));
    if (item) out.push([hit.index!, hit.index! + hit[0].length, item]);
  }
  return out;
}

interface Hit {
  start: number;
  end: number;
  item: TermIndexItem;
}

function skippable(el: Element | null): boolean {
  for (let cur = el; cur; cur = cur.parentElement) {
    if (SKIP_TAGS.has(cur.tagName.toUpperCase())) return true;
    if ((cur as HTMLElement).isContentEditable) return true;
    if (cur.hasAttribute(UI_HOST_ATTR)) return true;
  }
  return false;
}

export class SeenHighlighter {
  private matcher: Matcher | null = null;
  private enabled = false;
  private hits = new Map<Text, Hit[]>();
  private observer: MutationObserver | null = null;
  private scanTimer: number | undefined;
  private lastScan = 0;
  private hoverTimer: number | undefined;
  private hoverKey = '';
  private moveQueued = false;

  constructor(
    private ui: {
      showSeenCard: (rect: DOMRect, item: TermIndexItem, onExplain: () => void) => void;
      hideSeenCard: () => void;
      isOverSeenCard: (x: number, y: number) => boolean;
    },
    private onExplain: (range: Range) => void
  ) {}

  static supported(): boolean {
    return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
  }

  get count(): number {
    let c = 0;
    for (const h of this.hits.values()) c += h.length;
    return c;
  }

  update(items: TermIndexItem[], enabled: boolean): void {
    this.matcher = buildMatcher(items);
    this.enabled = enabled && !!this.matcher && SeenHighlighter.supported();
    if (!this.enabled) {
      this.clear();
      this.stopObserving();
      return;
    }
    this.ensureStyle();
    this.startObserving();
    this.schedule(0);
  }

  private ensureStyle(): void {
    if (document.getElementById('glossa-seen-style')) return;
    const style = document.createElement('style');
    style.id = 'glossa-seen-style';
    style.textContent = `::highlight(${HIGHLIGHT_NAME}) { text-decoration: underline dotted rgba(214, 160, 0, 0.95) 2px; text-underline-offset: 3px; }`;
    (document.head || document.documentElement).appendChild(style);
  }

  private clear(): void {
    this.hits.clear();
    delete document.documentElement.dataset.glossaSeenCount;
    if (SeenHighlighter.supported()) CSS.highlights.delete(HIGHLIGHT_NAME);
    this.ui.hideSeenCard();
  }

  /** Rescans after `delay`, but never more than once every 2 s (pages that mutate constantly). */
  private schedule(delay: number): void {
    window.clearTimeout(this.scanTimer);
    const wait = this.lastScan ? Math.max(delay, 2000 - (Date.now() - this.lastScan)) : delay;
    this.scanTimer = window.setTimeout(() => {
      if ('requestIdleCallback' in window) requestIdleCallback(() => this.scan(), { timeout: 1000 });
      else this.scan();
    }, wait);
  }

  scan(): void {
    this.lastScan = Date.now();
    if (!this.enabled || !this.matcher || !document.body) return;
    const hits = new Map<Text, Hit[]>();
    const perTerm = new Map<string, number>();
    const ranges: Range[] = [];
    let scanned = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const data = (n as Text).data;
        if (data.length < 2 || !/[\p{L}\p{N}]/u.test(data)) return NodeFilter.FILTER_REJECT;
        return skippable(n.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    let node: Node | null;
    outer: while ((node = walker.nextNode())) {
      const text = node as Text;
      scanned += text.data.length;
      if (scanned > MAX_SCAN_CHARS) break;
      for (const [start, end, item] of matchText(text.data, this.matcher)) {
        const used = perTerm.get(item.k) || 0;
        if (used >= MAX_PER_TERM) continue;
        perTerm.set(item.k, used + 1);
        const r = document.createRange();
        r.setStart(text, start);
        r.setEnd(text, end);
        ranges.push(r);
        const list = hits.get(text) || [];
        list.push({ start, end, item });
        hits.set(text, list);
        if (ranges.length >= MAX_MATCHES) break outer;
      }
    }
    this.hits = hits;
    if (ranges.length) CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
    else CSS.highlights.delete(HIGHLIGHT_NAME);
    // Lets the page (and tests) know how many terms are underlined without reaching into this world.
    document.documentElement.dataset.glossaSeenCount = String(ranges.length);
  }

  private startObserving(): void {
    if (this.observer || !document.body) return;
    this.observer = new MutationObserver((records) => {
      if (records.every((r) => r.target instanceof Element && r.target.closest(`[${UI_HOST_ATTR}]`))) return;
      this.schedule(1200);
    });
    this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener('mousemove', this.onMove, { passive: true });
    window.addEventListener('scroll', this.onScroll, { passive: true, capture: true });
  }

  private stopObserving(): void {
    this.observer?.disconnect();
    this.observer = null;
    document.removeEventListener('mousemove', this.onMove);
    window.removeEventListener('scroll', this.onScroll, { capture: true });
  }

  private onScroll = () => {
    this.hoverKey = '';
    this.ui.hideSeenCard();
  };

  /** The underlined term under the pointer, if any. */
  hitAt(x: number, y: number): { hit: Hit; range: Range } | null {
    if (!this.hits.size) return null;
    const pos = (document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null })
      .caretPositionFromPoint?.(x, y);
    const node = pos ? pos.offsetNode : document.caretRangeFromPoint?.(x, y)?.startContainer;
    const offset = pos ? pos.offset : document.caretRangeFromPoint?.(x, y)?.startOffset ?? -1;
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;
    const list = this.hits.get(node as Text);
    const hit = list?.find((h) => offset >= h.start && offset <= h.end);
    if (!hit) return null;
    const range = document.createRange();
    range.setStart(node, hit.start);
    range.setEnd(node, hit.end);
    // caret APIs snap to the nearest text; make sure the pointer is really on the word.
    const inside = Array.from(range.getClientRects()).some((r) => x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 2 && y <= r.bottom + 2);
    return inside ? { hit, range } : null;
  }

  private onMove = (e: MouseEvent) => {
    if (this.moveQueued) return;
    this.moveQueued = true;
    const { clientX: x, clientY: y } = e;
    requestAnimationFrame(() => {
      this.moveQueued = false;
      if (this.ui.isOverSeenCard(x, y)) {
        window.clearTimeout(this.hoverTimer);
        return;
      }
      const found = this.hitAt(x, y);
      const key = found ? `${found.hit.item.k}@${found.hit.start}` : '';
      if (key === this.hoverKey) return;
      this.hoverKey = key;
      window.clearTimeout(this.hoverTimer);
      if (!found) {
        this.hoverTimer = window.setTimeout(() => this.ui.hideSeenCard(), 350);
        return;
      }
      this.hoverTimer = window.setTimeout(() => {
        const rect = found.range.getBoundingClientRect();
        // The list may have changed since the last scan (e.g. the word was just looked up again): show the latest.
        const item = this.matcher?.byKey.get(found.hit.item.k) ?? found.hit.item;
        this.ui.showSeenCard(rect, item, () => this.onExplain(found.range));
      }, 250);
    });
  };
}
