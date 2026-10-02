import { afterEach, describe, expect, it, vi } from 'vitest';
import { explain, followUp } from '../ai/client';
import { onDeviceStatus } from '../ai/ondevice';
import { mergeSettings } from '../shared/storage';

const settings = (language = 'English') => mergeSettings({ aiSource: 'on-device', language });
const g = globalThis as { LanguageModel?: unknown };

function fakeModel(status: string, reply: string) {
  const calls: { create?: Record<string, unknown>; prompt?: string; destroyed: number } = { destroyed: 0 };
  g.LanguageModel = {
    availability: vi.fn(async () => status),
    create: vi.fn(async (opts: Record<string, unknown>) => {
      calls.create = opts;
      return {
        prompt: async (input: string) => {
          calls.prompt = input;
          return reply;
        },
        destroy: () => calls.destroyed++,
      };
    }),
  };
  return calls;
}

afterEach(() => {
  delete g.LanguageModel;
});

describe('on-device mode', () => {
  it('reports unavailable when Chrome has no built-in model', async () => {
    expect(await onDeviceStatus()).toBe('unavailable');
    await expect(explain({ text: 'ledger', level: 'standard', length: 'brief', language: 'English' }, settings(), { bypassCache: true })).rejects.toMatchObject({
      code: 'bad-request',
    });
  });

  it('explains with the built-in model, sends the system prompt, and cleans up the session', async () => {
    const calls = fakeModel('available', '{"kind":"word","headword":"ledger","meaning":"A record of money in and out."}');
    const out = await explain(
      { text: 'ledger', sentence: 'Check the ledger before paying.', level: 'standard', length: 'brief', language: 'English' },
      settings(),
      { bypassCache: true }
    );
    expect(out.result.meaning).toBe('A record of money in and out.');
    expect(out.source).toBe('On this device');
    expect(JSON.stringify(calls.create)).toContain('You tell a reader what a piece of text');
    expect(calls.prompt).toContain('SELECTED TEXT:\n"""ledger"""');
    expect(calls.destroyed).toBe(1);
  });

  it('answers follow-ups too', async () => {
    fakeModel('available', '{"answer":"Like a diary for money."}');
    const out = await followUp({ kind: 'simpler', text: 'ledger', meaning: 'A record.', level: 'standard', language: 'English' }, settings());
    expect(out.answer).toBe('Like a diary for money.');
  });

  it('explains clearly when the language or the download is not ready', async () => {
    fakeModel('available', '{}');
    await expect(explain({ text: 'x1', level: 'standard', length: 'brief', language: 'Hindi' }, settings('Hindi'), { bypassCache: true })).rejects.toThrow(
      /English, Spanish and Japanese/
    );
    fakeModel('downloadable', '{}');
    await expect(explain({ text: 'x2', level: 'standard', length: 'brief', language: 'English' }, settings(), { bypassCache: true })).rejects.toThrow(
      /finished downloading/
    );
  });
});
