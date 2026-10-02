/**
 * Private mode: answers from the model built into Chrome (Prompt API, Gemini Nano), so the
 * selection never leaves the computer. Available to extensions from Chrome 138 on supported hardware.
 * https://developer.chrome.com/docs/ai/prompt-api
 */

import { AiError } from './errors';

export type OnDeviceStatus = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface LanguageModelSession {
  prompt(input: string, opts?: { signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}

interface DownloadMonitor {
  addEventListener(type: 'downloadprogress', cb: (e: { loaded: number }) => void): void;
}

interface LanguageModelStatic {
  availability(opts?: object): Promise<OnDeviceStatus>;
  create(opts?: object): Promise<LanguageModelSession>;
}

function api(): LanguageModelStatic | undefined {
  return (globalThis as { LanguageModel?: LanguageModelStatic }).LanguageModel;
}

/** Output languages the built-in model supports today. */
export const ON_DEVICE_LANGUAGES: Record<string, string> = { English: 'en', Spanish: 'es', Japanese: 'ja' };

function io(lang: string) {
  return {
    expectedInputs: [{ type: 'text', languages: ['en', lang] }],
    expectedOutputs: [{ type: 'text', languages: [lang] }],
  };
}

export async function onDeviceStatus(language = 'English'): Promise<OnDeviceStatus> {
  const lm = api();
  if (!lm) return 'unavailable';
  try {
    return await lm.availability(io(ON_DEVICE_LANGUAGES[language] || 'en'));
  } catch {
    return 'unavailable';
  }
}

/** Starts (or waits for) Chrome's one-time model download. Must be called from a click. */
export async function downloadOnDeviceModel(onProgress: (fraction: number) => void): Promise<void> {
  const lm = api();
  if (!lm) throw new AiError('bad-request', 'This browser can’t run the on-device model.');
  const session = await lm.create({
    ...io('en'),
    monitor(m: DownloadMonitor) {
      m.addEventListener('downloadprogress', (e) => onProgress(e.loaded));
    },
  });
  session.destroy();
}

export async function onDeviceChat(system: string, user: string, language: string, signal: AbortSignal): Promise<string> {
  const lm = api();
  if (!lm) {
    throw new AiError('bad-request', 'This browser can’t run the on-device model. It needs Chrome 138 or newer on a supported computer. Switch to Glossa (free) in Settings.');
  }
  const lang = ON_DEVICE_LANGUAGES[language];
  if (!lang) {
    throw new AiError('bad-request', 'On-device answers are available in English, Spanish and Japanese. Change “Explain in”, or switch to Glossa (free) in Settings.');
  }
  const status = await onDeviceStatus(language);
  if (status !== 'available') {
    throw new AiError(
      'bad-request',
      status === 'unavailable'
        ? 'This computer can’t run the on-device model. Switch to Glossa (free) in Settings.'
        : 'The on-device model hasn’t finished downloading. Download it in Settings, or switch to Glossa (free) for now.'
    );
  }
  const session = await lm.create({ ...io(lang), initialPrompts: [{ role: 'system', content: system }], signal });
  try {
    return await session.prompt(user, { signal });
  } finally {
    session.destroy();
  }
}
