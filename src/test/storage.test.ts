import { describe, expect, it } from 'vitest';
import {
  clearHistory,
  deleteLookup,
  getHistory,
  mergeSettings,
  saveSettings,
  getSettings,
  siteKey,
  upsertLookup,
} from '../shared/storage';
import type { Lookup } from '../shared/types';
import { LIMITS } from '../shared/brand';

const make = (id: string, saved = false): Lookup => ({
  id,
  selection: { text: id, sentence: '', context: '', pageTitle: '', pageUrl: '', truncated: false },
  result: { kind: 'word', headword: id, meaning: 'm' },
  followUps: [],
  createdAt: Date.now(),
  saved,
  trigger: 'lookup',
  language: 'English',
  level: 'standard',
  source: 'test',
});

describe('settings', () => {
  it('fills defaults and clamps text scale', () => {
    const s = mergeSettings({ textScale: 9 } as never);
    expect(s.textScale).toBe(1.3);
    expect(s.aiSource).toBe('hosted');
    expect(s.disabledSites).toEqual([]);
  });

  it('persists partial updates without losing other fields', async () => {
    await saveSettings({ language: 'Hindi' });
    await saveSettings({ level: 'expert' });
    const s = await getSettings();
    expect(s.language).toBe('Hindi');
    expect(s.level).toBe('expert');
  });
});

describe('history', () => {
  it('adds, updates in place, deletes, and clears but keeps saved', async () => {
    await clearHistory(false);
    await upsertLookup(make('a'));
    await upsertLookup(make('b', true));
    await upsertLookup({ ...make('a'), result: { kind: 'word', headword: 'a', meaning: 'updated' } });
    let h = await getHistory();
    expect(h.map((l) => l.id)).toEqual(['b', 'a']);
    expect(h[1].result.meaning).toBe('updated');
    h = await deleteLookup('a');
    expect(h.map((l) => l.id)).toEqual(['b']);
    await upsertLookup(make('c'));
    h = await clearHistory(true);
    expect(h.map((l) => l.id)).toEqual(['b']);
  });

  it('replaces an older unsaved lookup of the same text on the same page', async () => {
    await clearHistory(false);
    await upsertLookup(make('first'));
    await upsertLookup({ ...make('second'), selection: { ...make('x').selection, text: 'FIRST ' } });
    const h = await getHistory();
    expect(h.map((l) => l.id)).toEqual(['second']);
    await upsertLookup(make('keep', true));
    await upsertLookup({ ...make('again'), selection: { ...make('x').selection, text: 'keep' } });
    expect((await getHistory()).map((l) => l.id)).toEqual(['again', 'keep', 'second']);
  });

  it('caps history size but never evicts saved items', async () => {
    const limits = LIMITS as { historyItems: number };
    const real = limits.historyItems;
    limits.historyItems = 50; // the real cap is large; a small one keeps the test fast
    try {
      await clearHistory(false);
      await upsertLookup(make('keep', true));
      for (let i = 0; i < 60; i++) await upsertLookup(make(`x${i}`));
      const h = await getHistory();
      expect(h.length).toBe(50);
      expect(h.some((l) => l.id === 'keep')).toBe(true);
    } finally {
      limits.historyItems = real;
    }
  });
});

describe('siteKey', () => {
  it('normalises hostnames', () => {
    expect(siteKey('https://www.example.com/a')).toBe('example.com');
    expect(siteKey('not a url')).toBe('');
  });
});
