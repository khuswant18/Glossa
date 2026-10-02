/**
 * Finds a quote in the page's visible text, across element boundaries and with loose whitespace,
 * quotes and case, and returns it as a DOM Range. Used by "Show on page".
 */

import { UI_HOST_ATTR } from './capture';

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE']);

const foldChar = (c: string) =>
  c === '“' || c === '”' || c === '„' || c === '«' || c === '»' ? '"' : c === '‘' || c === '’' ? "'" : c === '–' || c === '—' ? '-' : c.toLowerCase();

/** Normalised text plus, for every character in it, the text node and offset it came from. */
function flatten(root: Node): { text: string; map: [Text, number][] } {
  const map: [Text, number][] = [];
  let text = '';
  let lastSpace = true;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      for (let el = n.parentElement; el; el = el.parentElement) {
        if (SKIP.has(el.tagName) || el.hasAttribute(UI_HOST_ATTR)) return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = node as Text;
    for (let i = 0; i < t.data.length; i++) {
      const ch = t.data[i];
      if (/\s/.test(ch)) {
        if (lastSpace) continue;
        text += ' ';
        lastSpace = true;
      } else {
        text += foldChar(ch);
        lastSpace = false;
      }
      map.push([t, i]);
    }
    // Separate adjacent nodes (e.g. block elements) so words don't run together.
    if (!lastSpace) {
      text += ' ';
      map.push([t, t.data.length]);
      lastSpace = true;
    }
  }
  return { text, map };
}

function fold(s: string): string {
  return [...s.replace(/\s+/g, ' ').trim()].map(foldChar).join('');
}

export function findTextRange(quote: string, root: Node = document.body): Range | null {
  const q = fold(quote.replace(/^[\s"'“”‘’.…]+|[\s"'“”‘’.…]+$/g, ''));
  if (q.length < 3 || !root) return null;
  const { text, map } = flatten(root);
  let at = text.indexOf(q);
  let len = q.length;
  // Long quotes may have been trimmed or reflowed; fall back to their opening words.
  if (at < 0 && q.length > 60) {
    const head = q.slice(0, 60);
    at = text.indexOf(head);
    len = head.length;
  }
  if (at < 0) return null;
  const [startNode, startOff] = map[at];
  const [endNode, endOff] = map[at + len - 1];
  const range = document.createRange();
  range.setStart(startNode, startOff);
  range.setEnd(endNode, Math.min(endOff + 1, endNode.data.length));
  return range;
}
