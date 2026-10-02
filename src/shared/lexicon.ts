/**
 * The word list ("lexicon"): one entry per term the reader looked up, with every place they met it.
 * Pure logic only; persistence lives in storage.ts. Nothing here leaves the browser.
 */

import type { Explanation, Lookup } from './types';

export interface Sighting {
  sentence: string;
  url: string;
  title: string;
  at: number;
  lookupId: string;
}

export interface ReviewState {
  due: number;
  /** Days until the next review. */
  interval: number;
  /** Successful recalls in a row. */
  reps: number;
  lapses: number;
  last: number;
  lastGrade: 'again' | 'good';
}

export interface LexiconEntry {
  key: string;
  /** The text as it appears on pages (what "seen it before" matches). */
  term: string;
  headword: string;
  meaning: string;
  expansion?: string;
  gloss?: string;
  kind: Exclude<Explanation['kind'], 'passage'>;
  count: number;
  firstSeen: number;
  lastSeen: number;
  /** Newest first. */
  sightings: Sighting[];
  lookupIds: string[];
  review?: ReviewState;
}

/** Compact row kept for every entry so pages can underline known terms without loading the whole list. */
export interface TermIndexItem {
  k: string;
  t: string;
  m: string;
  c: number;
  at: number;
  /** First looked up. */
  f?: number;
  /** Where it was last met: sentence, page URL, and page title (or host). Powers "you met this before". */
  s?: string;
  u?: string;
  h?: string;
}

const MAX_SIGHTINGS = 8;
const MAX_TERM_CHARS = 60;

export function termKey(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“”‘’«»()[\]{}.,;:!?¿¡…-]+|[\s"'“”‘’«»()[\]{}.,;:!?¿¡…-]+$/g, '')
    .trim();
}

/** Words and short phrases go in the word list; passages and guard replies don't. */
export function lexiconEligible(l: Lookup): boolean {
  const text = l.selection.text.trim();
  return (
    l.result.kind !== 'passage' &&
    text.length > 0 &&
    text.length <= MAX_TERM_CHARS &&
    !text.includes('\n') &&
    text.split(/\s+/).length <= 6 &&
    // Code snippets aren't vocabulary.
    !/[{}();=<>[\]]/.test(termKey(text)) &&
    termKey(text).length > 0
  );
}

export function mergeEntry(existing: LexiconEntry | undefined, l: Lookup): LexiconEntry {
  const key = termKey(l.selection.text);
  const seenBefore = !!existing?.lookupIds.includes(l.id);
  const sighting: Sighting | null = l.selection.pageUrl
    ? {
        sentence: (l.selection.sentence || '').slice(0, 300),
        url: l.selection.pageUrl,
        title: (l.selection.pageTitle || '').slice(0, 140),
        at: l.createdAt,
        lookupId: l.id,
      }
    : null;
  const others = (existing?.sightings || []).filter((s) => s.lookupId !== l.id && !(sighting && s.url === sighting.url && s.sentence === sighting.sentence));
  const r = l.result;
  // Looking a word up again is the honest signal that it isn't known yet: start its reviews over.
  const review: ReviewState | undefined =
    existing?.review && !seenBefore
      ? { ...existing.review, reps: 0, interval: 1, lastGrade: 'again', due: l.createdAt + DAY_MS }
      : existing?.review;
  return {
    key,
    term: l.selection.text.trim().replace(/\s+/g, ' '),
    headword: r.headword,
    meaning: r.meaning,
    expansion: r.expansion || existing?.expansion,
    gloss: r.gloss || existing?.gloss,
    kind: r.kind === 'word' ? 'word' : 'phrase',
    count: (existing?.count || 0) + (seenBefore ? 0 : 1),
    firstSeen: Math.min(existing?.firstSeen ?? l.createdAt, l.createdAt),
    lastSeen: Math.max(existing?.lastSeen ?? 0, l.createdAt),
    sightings: (sighting ? [sighting, ...others] : others).slice(0, MAX_SIGHTINGS),
    lookupIds: seenBefore ? existing!.lookupIds : [l.id, ...(existing?.lookupIds || [])].slice(0, 20),
    ...(review ? { review } : {}),
  };
}

// ---- light review -------------------------------------------------------------

export const DAY_MS = 86_400_000;
const INTERVALS = [1, 3, 7, 16, 35, 80];
export const REVIEW_SESSION = 10;

/** New words come up for review a day after they were first looked up. */
export function dueAt(e: LexiconEntry): number {
  return e.review?.due ?? e.firstSeen + DAY_MS;
}

/** Oldest-due first, capped so a backlog never turns into a wall of cards. */
export function dueEntries(entries: LexiconEntry[], now: number, limit = REVIEW_SESSION): LexiconEntry[] {
  return entries
    .filter((e) => dueAt(e) <= now)
    .sort((a, b) => dueAt(a) - dueAt(b))
    .slice(0, limit);
}

export function applyReview(e: LexiconEntry, grade: 'again' | 'good', now: number): LexiconEntry {
  const prev = e.review;
  const reps = grade === 'good' ? (prev?.reps || 0) + 1 : 0;
  const interval = grade === 'good' ? INTERVALS[Math.min(reps - 1, INTERVALS.length - 1)] : 1;
  return {
    ...e,
    review: {
      due: now + interval * DAY_MS,
      interval,
      reps,
      lapses: (prev?.lapses || 0) + (grade === 'again' ? 1 : 0),
      last: now,
      lastGrade: grade,
    },
  };
}

/** "Known" means recalled three times in a row, not merely seen. */
export function isKnown(e: LexiconEntry): boolean {
  return (e.review?.reps || 0) >= 3;
}

export function indexItem(e: LexiconEntry): TermIndexItem {
  const s = e.sightings[0];
  return {
    k: e.key,
    t: e.term,
    m: e.meaning.slice(0, 160),
    c: e.count,
    at: e.lastSeen,
    f: e.firstSeen,
    ...(s ? { s: s.sentence.slice(0, 180), u: s.url.slice(0, 400), h: (s.title || hostOfUrl(s.url)).slice(0, 70) } : {}),
  };
}

export function hostOfUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol.startsWith('http') ? u.hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}

// ---- exports ---------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const oneLine = (s: string) => s.replace(/[\t\r\n]+/g, ' ').trim();
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function markTerm(sentence: string, term: string, open: string, close: string): string {
  if (!term) return sentence;
  return sentence.replace(new RegExp(reEsc(term), 'i'), (m) => `${open}${m}${close}`);
}

/** Anki import file: tab-separated, HTML fields, with headers Anki 2.1.55+ reads automatically. */
export function toAnki(entries: LexiconEntry[]): string {
  const rows = entries.map((e) => {
    const s = e.sightings[0];
    const front = `<b>${esc(oneLine(e.headword))}</b>${s?.sentence ? `<br><i>${markTerm(esc(oneLine(s.sentence)), esc(e.term), '<u>', '</u>')}</i>` : ''}`;
    const back = [
      esc(oneLine(e.meaning)),
      e.expansion ? `<small>${esc(oneLine(e.expansion))}</small>` : '',
      e.gloss ? esc(oneLine(e.gloss)) : '',
      s?.url ? `<small><a href="${esc(s.url)}">${esc(hostOfUrl(s.url) || s.url)}</a></small>` : '',
    ]
      .filter(Boolean)
      .join('<br>');
    const host = s?.url ? hostOfUrl(s.url).replace(/[^a-z0-9.-]/gi, '') : '';
    return [front, back, ['glossa', host && `glossa::${host}`].filter(Boolean).join(' ')].join('\t');
  });
  return ['#separator:tab', '#html:true', '#notetype:Basic', '#tags column:3', ...rows].join('\n') + '\n';
}

function csvCell(v: string | number): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(entries: LexiconEntry[]): string {
  const head = ['term', 'meaning', 'expansion', 'gloss', 'times_looked_up', 'first_seen', 'last_seen', 'sentence', 'source_url'];
  const rows = entries.map((e) => {
    const s = e.sightings[0];
    return [
      e.headword,
      e.meaning,
      e.expansion || '',
      e.gloss || '',
      e.count,
      new Date(e.firstSeen).toISOString(),
      new Date(e.lastSeen).toISOString(),
      s?.sentence || '',
      s?.url || '',
    ]
      .map(csvCell)
      .join(',');
  });
  return [head.join(','), ...rows].join('\r\n') + '\r\n';
}

/** One Markdown file, friendly to Obsidian and other note apps. */
export function toMarkdown(entries: LexiconEntry[]): string {
  const blocks = entries.map((e) => {
    const lines = [`## ${e.headword}`];
    if (e.expansion) lines.push(`*${e.expansion}*`);
    lines.push('', e.meaning);
    if (e.gloss) lines.push('', e.gloss);
    for (const s of e.sightings.slice(0, 3)) {
      if (s.sentence) lines.push('', `> ${markTerm(oneLine(s.sentence), e.term, '**', '**')}`);
      if (s.url) lines.push(`> — [${s.title || hostOfUrl(s.url)}](${s.url})`);
    }
    lines.push('', `Looked up ${e.count} time${e.count === 1 ? '' : 's'} · first ${new Date(e.firstSeen).toISOString().slice(0, 10)} #glossa`);
    return lines.join('\n');
  });
  return `# Glossa word list\n\n${blocks.join('\n\n---\n\n')}\n`;
}

export function toJson(entries: LexiconEntry[]): string {
  return JSON.stringify({ format: 'glossa-lexicon', version: 1, exportedAt: new Date().toISOString(), entries }, null, 2);
}

// ---- weekly recap -------------------------------------------------------------

export interface WeeklyRecap {
  /** Words first looked up in the last 7 days. */
  newWords: number;
  /** Times words were met (looked up) in the last 7 days. */
  lookups: number;
  /** Days with at least one lookup. */
  activeDays: number;
  /** Words recalled three times in a row, total, and how many got there this week. */
  known: number;
  knownThisWeek: number;
  /** The word met most often this week. */
  top?: { headword: string; count: number };
  topSites: string[];
}

export function weeklyRecap(entries: LexiconEntry[], now = Date.now()): WeeklyRecap {
  const since = now - 7 * DAY_MS;
  const days = new Set<string>();
  const sites = new Map<string, number>();
  let lookups = 0;
  let top: WeeklyRecap['top'];
  for (const e of entries) {
    const week = e.sightings.filter((s) => s.at >= since);
    // Sightings collapse repeat lookups of the same sentence, so a word first met this week uses its full count.
    // Typed lookups have no sighting; count the latest one if it happened this week.
    const n = e.firstSeen >= since ? e.count : week.length || (e.lastSeen >= since ? 1 : 0);
    lookups += n;
    for (const s of week) {
      days.add(new Date(s.at).toDateString());
      const h = hostOfUrl(s.url);
      if (h) sites.set(h, (sites.get(h) || 0) + 1);
    }
    if (!week.length && e.lastSeen >= since) days.add(new Date(e.lastSeen).toDateString());
    if (n && (!top || n > top.count)) top = { headword: e.headword, count: n };
  }
  return {
    newWords: entries.filter((e) => e.firstSeen >= since).length,
    lookups,
    activeDays: days.size,
    known: entries.filter(isKnown).length,
    knownThisWeek: entries.filter((e) => isKnown(e) && (e.review?.last || 0) >= since).length,
    top,
    topSites: [...sites.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h]) => h),
  };
}
