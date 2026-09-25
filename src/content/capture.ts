/**
 * Reads exactly what the user selected, plus the sentence and nearby text it sits in.
 * No geometry, no guessing: the browser's Selection/Range is the source of truth.
 */

import { LIMITS } from '../shared/brand';
import type { CapturedSelection } from '../shared/types';

const BLOCK_TAGS = new Set([
  'P', 'LI', 'TD', 'TH', 'DD', 'DT', 'BLOCKQUOTE', 'PRE', 'FIGCAPTION', 'CAPTION',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'ARTICLE', 'SECTION', 'MAIN', 'ASIDE', 'SUMMARY', 'LABEL',
]);

export const UI_HOST_ATTR = 'data-glossa-ui';

/** Collapses whitespace inside lines but keeps line structure (useful for code). */
export function cleanText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[​-‍﻿]/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Single-line version for sentence/context strings. */
export function flatText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

const SENTENCE_END = /[.!?。！？](?=\s|$)|\n\n/g;

/** Given text before and after the selection, returns the sentence containing it. */
export function sentenceAround(before: string, selected: string, after: string): string {
  const pre = flatText(before).slice(-500);
  const post = flatText(after).slice(0, 500);

  let startIdx = 0;
  let m: RegExpExecArray | null;
  SENTENCE_END.lastIndex = 0;
  while ((m = SENTENCE_END.exec(pre))) startIdx = m.index + m[0].length;
  const head = pre.slice(startIdx).trimStart();

  SENTENCE_END.lastIndex = 0;
  const endMatch = SENTENCE_END.exec(post);
  const tail = endMatch ? post.slice(0, endMatch.index + endMatch[0].length) : post;

  const joinLeft = head && !/\s$/.test(before) && !/^\s/.test(selected) ? '' : ' ';
  const joinRight = tail && !/^\s/.test(after) && !/\s$/.test(selected) ? '' : ' ';
  return flatText(`${head}${joinLeft}${flatText(selected)}${joinRight}${tail}`);
}

function blockOf(node: Node | null): Element | null {
  let el: Element | null = node && node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement || null;
  while (el && el !== document.body) {
    if (BLOCK_TAGS.has(el.tagName)) return el;
    if (el.tagName === 'DIV' && flatText(el.textContent || '').length > 40) return el;
    el = el.parentElement;
  }
  return el;
}

function nearestHeading(el: Element | null): string {
  let cur: Element | null = el;
  let hops = 0;
  while (cur && cur !== document.body && hops < 40) {
    let prev = cur.previousElementSibling;
    while (prev && hops < 40) {
      hops++;
      if (/^H[1-3]$/.test(prev.tagName)) return flatText(prev.textContent || '').slice(0, 140);
      const inner = prev.querySelectorAll('h1, h2, h3');
      if (inner.length) return flatText(inner[inner.length - 1].textContent || '').slice(0, 140);
      prev = prev.previousElementSibling;
    }
    cur = cur.parentElement;
  }
  return '';
}

function siblingText(el: Element | null, dir: 'prev' | 'next'): string {
  let sib = dir === 'prev' ? el?.previousElementSibling : el?.nextElementSibling;
  for (let i = 0; sib && i < 3; i++) {
    const text = flatText(sib.textContent || '');
    if (text.length > 30) return text.slice(0, 500);
    sib = dir === 'prev' ? sib.previousElementSibling : sib.nextElementSibling;
  }
  return '';
}

function clipAround(text: string, needle: string, max: number): string {
  if (text.length <= max) return text;
  const at = text.indexOf(needle.slice(0, 80));
  if (at === -1) return `${text.slice(0, max)}…`;
  const start = Math.max(0, at - Math.floor((max - needle.length) / 2));
  const end = Math.min(text.length, start + max);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

function isEditableField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return ['text', 'search', 'url', 'email', 'tel', ''].includes(type);
}

function finish(text: string, sentence: string, context: string): CapturedSelection | null {
  const clean = cleanText(text);
  if (!clean || !/[\p{L}\p{N}\p{S}]/u.test(clean)) return null;
  const truncated = clean.length > LIMITS.maxSelectionChars;
  return {
    text: truncated ? clean.slice(0, LIMITS.maxSelectionChars) : clean,
    sentence: sentence.length > 600 ? clipAround(sentence, flatText(clean), 600) : sentence,
    context: clipAround(context, flatText(clean), LIMITS.maxContextChars),
    pageTitle: document.title.slice(0, 200),
    pageUrl: location.href,
    truncated,
  };
}

function captureFromField(field: HTMLInputElement | HTMLTextAreaElement): CapturedSelection | null {
  const { selectionStart: s, selectionEnd: e, value } = field;
  if (s == null || e == null || s === e) return null;
  const before = value.slice(Math.max(0, s - 600), s);
  const selected = value.slice(s, e);
  const after = value.slice(e, e + 600);
  const label = field.labels?.[0]?.textContent || field.getAttribute('aria-label') || field.placeholder || '';
  const context = [flatText(label), flatText(`${before}${selected}${after}`)].filter(Boolean).join('\n');
  return finish(selected, sentenceAround(before, selected, after), context);
}

/** Returns the current selection in this frame, or null if nothing meaningful is selected. */
export function captureSelection(): CapturedSelection | null {
  const active = document.activeElement;
  if (isEditableField(active)) {
    const fromField = captureFromField(active);
    if (fromField) return fromField;
  }

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const anchor = range.commonAncestorContainer;
  const anchorEl = anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement;
  if (anchorEl?.closest(`[${UI_HOST_ATTR}]`)) return null;

  const selected = sel.toString();
  const block = blockOf(range.startContainer);

  let before = '';
  let after = '';
  if (block) {
    try {
      const pre = document.createRange();
      pre.selectNodeContents(block);
      pre.setEnd(range.startContainer, range.startOffset);
      before = pre.toString();
      const post = document.createRange();
      post.selectNodeContents(block);
      post.setStart(range.endContainer, range.endOffset);
      // If the selection runs past this block, there is nothing "after" within it.
      after = block.contains(range.endContainer) ? post.toString() : '';
    } catch {
      // Ranges can throw on exotic DOMs (e.g. across shadow roots); context is optional.
    }
  }

  const sentence = sentenceAround(before, selected, after);
  const heading = nearestHeading(block);
  const context = [
    heading ? `Section: ${heading}` : '',
    siblingText(block, 'prev'),
    flatText(`${before}${selected}${after}`),
    siblingText(block, 'next'),
  ]
    .filter(Boolean)
    .join('\n');

  return finish(selected, sentence, context);
}

/** Viewport rect of the current selection's end, for positioning the floating button. */
export function selectionRect(): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
  if (rects.length) return rects[rects.length - 1];
  const box = range.getBoundingClientRect();
  return box.width || box.height ? box : null;
}
