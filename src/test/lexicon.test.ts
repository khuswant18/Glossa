import { describe, expect, it } from 'vitest';
import { applyReview, dueEntries, isKnown, lexiconEligible, mergeEntry, termKey, toAnki, toCsv, toJson, toMarkdown } from '../shared/lexicon';
import { clearLexicon, deleteLexiconEntry, getLexicon, getTermIndex, isKnownTerm, recordLookup, upsertLookup } from '../shared/storage';
import type { Lookup } from '../shared/types';

let n = 0;
const lookup = (text: string, over: Partial<Lookup> = {}, url = 'https://news.example.com/a'): Lookup => ({
  id: `id-${++n}`,
  selection: { text, sentence: `The ${text} rose sharply.`, context: '', pageTitle: 'Rates day', pageUrl: url, truncated: false },
  result: { kind: 'word', headword: text, meaning: `Meaning of ${text}` },
  followUps: [],
  createdAt: 1_700_000_000_000 + n * 1000,
  saved: false,
  trigger: 'chip',
  language: 'English',
  level: 'standard',
  source: 'test',
  ...over,
});

describe('termKey and eligibility', () => {
  it('normalises case, spacing and surrounding punctuation', () => {
    expect(termKey('  “Net  Interest Margin,” ')).toBe('net interest margin');
    expect(termKey('NIM')).toBe('nim');
  });
  it('keeps words and short phrases, not passages or long text', () => {
    expect(lexiconEligible(lookup('bank'))).toBe(true);
    expect(lexiconEligible(lookup('priced in', { result: { kind: 'phrase', headword: 'priced in', meaning: 'm' } }))).toBe(true);
    expect(lexiconEligible(lookup('A whole sentence about markets.', { result: { kind: 'passage', headword: 'x', meaning: 'm' } }))).toBe(false);
    expect(lexiconEligible(lookup('one two three four five six seven'))).toBe(false);
    expect(lexiconEligible(lookup('useMemo(() => x, [x])'))).toBe(false);
    expect(lexiconEligible(lookup('(NIM)'))).toBe(true);
    expect(lexiconEligible(lookup('C++'))).toBe(true);
  });
});

describe('mergeEntry', () => {
  it('counts each lookup once and keeps sightings newest first, de-duplicated', () => {
    const a = lookup('bank');
    const b = lookup('Bank', {}, 'https://river.example.org/b');
    let e = mergeEntry(undefined, a);
    e = mergeEntry(e, b);
    e = mergeEntry(e, { ...b, result: { ...b.result, meaning: 'Updated meaning' } }); // same lookup re-saved
    expect(e.count).toBe(2);
    expect(e.meaning).toBe('Updated meaning');
    expect(e.sightings.map((s) => s.url)).toEqual(['https://river.example.org/b', 'https://news.example.com/a']);
    expect(e.firstSeen).toBe(a.createdAt);
  });
  it('keeps an earlier gloss and expansion when a newer answer lacks them', () => {
    const first = lookup('NIM', { result: { kind: 'word', headword: 'NIM', meaning: 'm', expansion: 'Net Interest Margin', gloss: 'g' } });
    const e = mergeEntry(mergeEntry(undefined, first), lookup('NIM'));
    expect(e.expansion).toBe('Net Interest Margin');
    expect(e.gloss).toBe('g');
  });
});

describe('exports', () => {
  const e = mergeEntry(undefined, lookup('yield curve', { result: { kind: 'phrase', headword: 'yield curve', meaning: 'Rates, "short" to long', gloss: 'curva' } }));

  it('writes an Anki file with headers, HTML fields and the term marked in its sentence', () => {
    const out = toAnki([e]);
    expect(out.startsWith('#separator:tab\n#html:true\n#notetype:Basic\n#tags column:3\n')).toBe(true);
    const [front, back, tags] = out.trim().split('\n').pop()!.split('\t');
    expect(front).toBe('<b>yield curve</b><br><i>The <u>yield curve</u> rose sharply.</i>');
    expect(back).toContain('Rates, &quot;short&quot; to long<br>curva<br><small><a href="https://news.example.com/a">news.example.com</a></small>');
    expect(tags).toBe('glossa glossa::news.example.com');
  });
  it('writes valid CSV with quoting', () => {
    const lines = toCsv([e]).split('\r\n');
    expect(lines[0]).toBe('term,meaning,expansion,gloss,times_looked_up,first_seen,last_seen,sentence,source_url');
    expect(lines[1].startsWith('yield curve,"Rates, ""short"" to long",,curva,1,')).toBe(true);
  });
  it('writes Markdown and JSON', () => {
    expect(toMarkdown([e])).toContain('## yield curve\n\nRates, "short" to long\n\ncurva\n\n> The **yield curve** rose sharply.');
    const json = JSON.parse(toJson([e]));
    expect(json.format).toBe('glossa-lexicon');
    expect(json.entries[0].term).toBe('yield curve');
  });
});

describe('word list storage', () => {
  it('builds itself from existing history the first time', async () => {
    await upsertLookup(lookup('ephemeral'));
    await upsertLookup(lookup('A long passage here.', { result: { kind: 'passage', headword: 'x', meaning: 'm' } }));
    const list = await getLexicon();
    expect(list.map((e) => e.term)).toEqual(['ephemeral']);
  });

  it('records lookups, counts repeats and updates the index', async () => {
    await recordLookup(lookup('NIM'));
    await recordLookup(lookup('nim', {}, 'https://other.example.com/x'));
    expect(await isKnownTerm('Nim')).toBe(true);
    const index = await getTermIndex();
    expect(index[0]).toMatchObject({ k: 'nim', c: 2 });
    const entry = (await getLexicon()).find((e) => e.key === 'nim')!;
    expect(entry.sightings).toHaveLength(2);
  });

  it('ignores ineligible lookups and supports delete and clear', async () => {
    expect(await recordLookup(lookup('x'.repeat(80)))).toBeNull();
    await deleteLexiconEntry('nim');
    expect(await isKnownTerm('NIM')).toBe(false);
    await clearLexicon();
    expect(await getLexicon()).toEqual([]);
  });
});

describe('light review', () => {
  const day = 86_400_000;
  const base = () => mergeEntry(undefined, lookup('fiduciary'));

  it('comes up a day after the first lookup, capped per session, oldest first', () => {
    const e = base();
    expect(dueEntries([e], e.firstSeen + day - 1)).toHaveLength(0);
    expect(dueEntries([e], e.firstSeen + day)).toHaveLength(1);
    const many = Array.from({ length: 15 }, (_, i) => ({ ...base(), key: `k${i}`, firstSeen: 1000 + i }));
    const due = dueEntries(many, 10 * day);
    expect(due).toHaveLength(10);
    expect(due[0].key).toBe('k0');
  });

  it('spaces reviews out on success, resets on a miss, and only calls three in a row "known"', () => {
    let e = base();
    const t = e.firstSeen + day;
    e = applyReview(e, 'good', t);
    expect(e.review).toMatchObject({ reps: 1, interval: 1 });
    e = applyReview(e, 'good', t + day);
    expect(e.review?.interval).toBe(3);
    expect(isKnown(e)).toBe(false);
    e = applyReview(e, 'good', t + 4 * day);
    expect(e.review?.interval).toBe(7);
    expect(isKnown(e)).toBe(true);
    e = applyReview(e, 'again', t + 11 * day);
    expect(e.review).toMatchObject({ reps: 0, interval: 1, lapses: 1, lastGrade: 'again' });
    expect(isKnown(e)).toBe(false);
  });

  it('a new lookup of a word under review starts its reviews over', () => {
    let e = applyReview(applyReview(base(), 'good', 1), 'good', 2);
    e = mergeEntry(e, lookup('fiduciary'));
    expect(e.review?.reps).toBe(0);
    expect(e.count).toBe(2);
  });
});

describe('index upgrade', () => {
  it('fills "where you met it" into lists saved before that existed', async () => {
    await clearLexicon();
    await recordLookup(lookup('arbitrage'));
    // Simulate an old index row without the new fields.
    const old = (await getTermIndex()).map(({ k, t, m, c, at }) => ({ k, t, m, c, at }));
    localStorage.setItem('glossa.terms', JSON.stringify(old));
    const up = await getTermIndex();
    expect(up[0]).toMatchObject({ k: 'arbitrage', s: 'The arbitrage rose sharply.', h: 'Rates day' });
    expect(up[0].f).toBeTypeOf('number');
  });
});
