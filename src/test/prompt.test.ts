import { describe, expect, it } from 'vitest';
import {
  buildExplainPrompt,
  buildFollowUpPrompt,
  normalizeExplanation,
  normalizeFollowUp,
  parseJsonObject,
} from '../shared/prompt';

describe('buildExplainPrompt', () => {
  it('includes selection, sentence, context and host but not the full URL path', () => {
    const { system, user } = buildExplainPrompt({
      text: 'bank',
      sentence: 'The boat reached the bank.',
      context: 'Rivers section',
      pageTitle: 'Rowing 101',
      pageUrl: 'https://example.com/private/path?token=abc',
      level: 'simple',
      length: 'brief',
      language: 'Spanish',
    });
    expect(system).toMatch(/Explain exactly the SELECTED text/);
    expect(user).toContain('"""bank"""');
    expect(user).toContain('The boat reached the bank.');
    expect(user).toContain('PAGE: example.com');
    expect(user).not.toContain('token=abc');
    expect(user).toContain('Write all values in Spanish');
    expect(user).toContain('12-year-old');
  });

  it('omits the sentence when it equals the selection', () => {
    const { user } = buildExplainPrompt({ text: 'Hello.', sentence: 'Hello.', level: 'standard', length: 'normal', language: 'English' });
    expect(user).not.toContain('SENTENCE IT APPEARS IN');
  });
});

describe('buildFollowUpPrompt', () => {
  it('carries the earlier thread and the question', () => {
    const { user } = buildFollowUpPrompt({
      kind: 'ask',
      text: 'jitter',
      meaning: 'random delay',
      question: 'why random?',
      level: 'standard',
      language: 'English',
      thread: [{ q: 'what is it', a: 'a delay' }],
    });
    expect(user).toContain("READER'S QUESTION: why random?");
    expect(user).toContain('Q: what is it');
  });
});

describe('parseJsonObject', () => {
  it('parses plain, fenced and embedded JSON', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonObject('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(parseJsonObject('Sure! Here you go: {"a":3} hope that helps')).toEqual({ a: 3 });
    expect(parseJsonObject('no json here')).toBeNull();
    expect(parseJsonObject('[1,2]')).toBeNull();
  });
});

describe('normalizeExplanation', () => {
  it('keeps valid fields and drops junk', () => {
    const e = normalizeExplanation(
      JSON.stringify({
        kind: 'word',
        headword: 'bank',
        pronunciation: '/bæŋk/',
        partOfSpeech: 'noun',
        meaning: 'The land beside a river.',
        explanation: 'The land beside a river.',
        synonyms: ['shore', 'edge', 3, '', 'side', 'brink', 'margin'],
        keyTerms: [{ term: 'x' }, { term: 'ok', definition: 'fine' }],
      }),
      'bank'
    );
    expect(e.meaning).toBe('The land beside a river.');
    expect(e.explanation).toBeUndefined(); // duplicate of meaning
    expect(e.synonyms).toEqual(['shore', 'edge', 'side', 'brink']);
    expect(e.keyTerms).toEqual([{ term: 'ok', definition: 'fine' }]);
    expect(e.pronunciation).toBe('/bæŋk/');
  });

  it('removes pronunciation for phrases', () => {
    const e = normalizeExplanation('{"kind":"phrase","headword":"priced in","pronunciation":"/x/","meaning":"expected already"}', 'priced in');
    expect(e.pronunciation).toBeUndefined();
  });

  it('falls back to prose when the model ignores JSON', () => {
    const e = normalizeExplanation('It means the edge of a river.', 'bank');
    expect(e.meaning).toBe('It means the edge of a river.');
    expect(e.kind).toBe('word');
  });

  it('throws on empty output', () => {
    expect(() => normalizeExplanation('', 'x')).toThrow(/could not read/);
    expect(() => normalizeExplanation('{"headword":"x"}', 'x')).toThrow();
  });

  it('guesses kind from length when missing', () => {
    expect(normalizeExplanation('{"meaning":"m"}', 'a b c d e f g h i j').kind).toBe('passage');
  });
});

describe('normalizeFollowUp', () => {
  it('reads answer or falls back to raw text', () => {
    expect(normalizeFollowUp('{"answer":"- one\\n- two"}')).toBe('- one\n- two');
    expect(normalizeFollowUp('plain words')).toBe('plain words');
    expect(() => normalizeFollowUp('{"answer":""}')).toThrow();
  });
});

describe('grounded explanations', () => {
  const sources = 'Banks reported a higher Net Interest Margin (NIM) this quarter.\nSection: Results';
  const raw = (extra: Record<string, unknown>) =>
    JSON.stringify({ kind: 'word', headword: 'NIM', meaning: 'The gap between interest earned and paid.', ...extra });

  it('keeps a quote that appears in the page text, ignoring case, spacing and curly quotes', () => {
    const e = normalizeExplanation(raw({ fromPage: '“higher  net interest margin (NIM)”', basis: 'page' }), 'NIM', sources);
    expect(e.fromPage).toBe('higher  net interest margin (NIM)');
    expect(e.basis).toBe('page');
  });

  it('drops an invented quote and downgrades "page" to "general"', () => {
    const e = normalizeExplanation(raw({ fromPage: 'NIM is a measure of bank profitability', basis: 'page' }), 'NIM', sources);
    expect(e.fromPage).toBeUndefined();
    expect(e.basis).toBe('general');
  });

  it('keeps quote marks that belong to the page text', () => {
    const src = '“Services” means the hosted software described in Schedule A.';
    const e = normalizeExplanation(raw({ fromPage: '“Services” means the hosted software' }), 'Services', src);
    expect(e.fromPage).toBe('“Services” means the hosted software');
  });

  it('drops a quote that is just the selection itself', () => {
    expect(normalizeExplanation(raw({ fromPage: 'NIM' }), 'NIM', sources).fromPage).toBeUndefined();
  });

  it('keeps expansion, gloss and confidence; drops an expansion equal to the selection', () => {
    const e = normalizeExplanation(raw({ expansion: 'Net Interest Margin', gloss: 'शुद्ध ब्याज मार्जिन', confidence: 'low' }), 'NIM', sources);
    expect(e.expansion).toBe('Net Interest Margin');
    expect(e.gloss).toBe('शुद्ध ब्याज मार्जिन');
    expect(e.confidence).toBe('low');
    expect(normalizeExplanation(raw({ expansion: 'nim', confidence: 'sure' }), 'NIM', sources).expansion).toBeUndefined();
    expect(normalizeExplanation(raw({ confidence: 'sure' }), 'NIM', sources).confidence).toBeUndefined();
  });

  it('puts the page definition and first language in the prompt', () => {
    const { user } = buildExplainPrompt({
      text: 'NIM',
      pageDefinition: 'Net Interest Margin (NIM)',
      level: 'standard',
      length: 'normal',
      language: 'English',
      nativeLanguage: 'Hindi',
    });
    expect(user).toContain('DEFINED ON THIS PAGE:\n"""Net Interest Margin (NIM)"""');
    expect(user).toContain("READER'S FIRST LANGUAGE: Hindi");
  });

  it('omits the first-language line when it matches the answer language', () => {
    const { user } = buildExplainPrompt({ text: 'x', level: 'standard', length: 'normal', language: 'Hindi', nativeLanguage: 'hindi' });
    expect(user).not.toContain('FIRST LANGUAGE');
  });
});
