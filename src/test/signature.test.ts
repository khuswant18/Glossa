import { describe, expect, it } from 'vitest';
import { findTextRange } from '../content/locate';
import { timeAgo } from '../content/page-ui';
import { textFragmentUrl } from '../shared/fragment';
import { applyReview, indexItem, mergeEntry, weeklyRecap } from '../shared/lexicon';
import type { Lookup } from '../shared/types';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-10T12:00:00Z');
let n = 0;
const lookup = (text: string, at: number, url = 'https://www.economist.com/finance/a', sentence = `The ${text} widened.`): Lookup => ({
  id: `s-${++n}`,
  selection: { text, sentence, context: '', pageTitle: 'The Economist', pageUrl: url, truncated: false },
  result: { kind: 'word', headword: text, meaning: `Meaning of ${text}` },
  followUps: [],
  createdAt: at,
  saved: false,
  trigger: 'chip',
  language: 'English',
  level: 'standard',
  source: 'test',
});

describe('you met this before', () => {
  it('index rows carry when and where the word was last met', () => {
    const e = mergeEntry(undefined, lookup('spread', NOW - 21 * DAY));
    expect(indexItem(e)).toMatchObject({ f: NOW - 21 * DAY, s: 'The spread widened.', u: 'https://www.economist.com/finance/a', h: 'The Economist' });
  });

  it('describes time the way people say it', () => {
    expect(timeAgo(NOW - 30_000, NOW)).toBe('just now');
    expect(timeAgo(NOW - 5 * 60_000, NOW)).toBe('5 min ago');
    expect(timeAgo(NOW - DAY, NOW)).toBe('yesterday');
    expect(timeAgo(NOW - 21 * DAY, NOW)).toBe('3 weeks ago');
    expect(timeAgo(NOW - 90 * DAY, NOW)).toBe('3 months ago');
  });
});

describe('show on page', () => {
  it('finds a quote across elements, with loose spacing, quotes and case', () => {
    document.body.innerHTML = '<p>Lenders reported a <b>wider</b>\n   net interest margin (NIM) this quarter.</p><p>Next paragraph.</p>';
    const r = findTextRange('“lenders reported a wider net interest margin (NIM)”');
    expect(r?.toString().replace(/\s+/g, ' ')).toBe('Lenders reported a wider net interest margin (NIM)');
  });

  it('falls back to the opening words of a long quote and returns null when absent', () => {
    document.body.innerHTML = '<p>The quarterly covenant test was breached after the impairment charge was booked in March.</p>';
    expect(findTextRange('The quarterly covenant test was breached after the impairment charge was booked in April, sources said.')).not.toBeNull();
    expect(findTextRange('nothing like this is on the page')).toBeNull();
  });

  it('builds text-fragment links that open the page at the sentence', () => {
    expect(textFragmentUrl('https://a.com/x#top', 'net interest margin')).toBe('https://a.com/x#:~:text=net%20interest%20margin');
    expect(textFragmentUrl('https://a.com/x', 'one two three four five six seven eight nine ten')).toBe(
      'https://a.com/x#:~:text=one%20two%20three%20four,seven%20eight%20nine%20ten'
    );
    expect(textFragmentUrl('https://a.com/x', 'well-known, cheap & fast')).toBe('https://a.com/x#:~:text=well%2Dknown%2C%20cheap%20%26%20fast');
    expect(textFragmentUrl('chrome-extension://abc/reader.html', 'x')).toBe('chrome-extension://abc/reader.html');
  });
});

describe('weekly recap', () => {
  it('counts new words, lookups, active days, known words and the most-met word', () => {
    let spread = mergeEntry(undefined, lookup('spread', NOW - 2 * DAY));
    spread = mergeEntry(spread, lookup('spread', NOW - DAY, 'https://ft.com/b', 'Credit spread jumped.'));
    spread = mergeEntry(spread, lookup('spread', NOW - 3600_000, 'https://wsj.com/c', 'The spread narrowed.'));
    const old = mergeEntry(undefined, lookup('basis point', NOW - 30 * DAY));
    let known = mergeEntry(undefined, lookup('tranche', NOW - 20 * DAY));
    known = applyReview(applyReview(applyReview(known, 'good', NOW - 10 * DAY), 'good', NOW - 8 * DAY), 'good', NOW - 2 * DAY);
    const r = weeklyRecap([spread, old, known], NOW);
    expect(r).toMatchObject({ newWords: 1, lookups: 3, activeDays: 3, known: 1, knownThisWeek: 1, top: { headword: 'spread', count: 3 } });
    expect(r.topSites).toEqual(expect.arrayContaining(['economist.com', 'ft.com', 'wsj.com']));
  });
});
