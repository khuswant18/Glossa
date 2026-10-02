import { describe, expect, it } from 'vitest';
import { buildMatcher, matchText, underlinable } from '../content/seen';
import type { TermIndexItem } from '../shared/lexicon';

const item = (t: string, at = 1): TermIndexItem => ({ k: t.toLowerCase().replace(/\s+/g, ' '), t, m: `m:${t}`, c: 1, at });

describe('seen-it-before matcher', () => {
  it('skips tiny words and numbers but keeps two-letter acronyms', () => {
    expect(underlinable('of')).toBe(false);
    expect(underlinable('AI')).toBe(true);
    expect(underlinable('42%')).toBe(false);
    expect(underlinable('bank')).toBe(true);
  });

  it('matches whole words case-insensitively, longest phrase first', () => {
    const m = buildMatcher([item('yield'), item('yield curve'), item('NIM')])!;
    const hits = matchText('The Yield Curve inverted; nimble traders watched NIM and yield.', m);
    expect(hits.map(([s, e, i]) => [i.t, 'The Yield Curve inverted; nimble traders watched NIM and yield.'.slice(s, e)])).toEqual([
      ['yield curve', 'Yield Curve'],
      ['NIM', 'NIM'],
      ['yield', 'yield'],
    ]);
  });

  it('tolerates line breaks and extra spaces inside phrases', () => {
    const m = buildMatcher([item('priced in')])!;
    expect(matchText('it was priced\n  in already', m)).toHaveLength(1);
  });

  it('respects letter boundaries in non-English text and escapes regex characters', () => {
    const m = buildMatcher([item('Schadenfreude'), item('C++')])!;
    expect(matchText('Schadenfreudes', m)).toHaveLength(0);
    expect(matchText('pure Schadenfreude.', m)).toHaveLength(1);
    expect(matchText('learn C++ now', m)).toHaveLength(1);
  });

  it('returns null when nothing is underlinable', () => {
    expect(buildMatcher([item('of'), item('7')])).toBeNull();
  });
});
