import { textFragmentUrl } from '../shared/fragment';
import type { Message } from '../shared/types';

/**
 * "Show on page": flashes the quote in the page if that page is the active tab (or an open Glossa
 * reader); otherwise opens the page in a new tab, scrolled to the sentence via a text fragment.
 */
export async function showOnPage(url: string, quote: string): Promise<'shown' | 'opened' | 'missing'> {
  const msg: Message = { type: 'SHOW_ON_PAGE', url, quote };
  if (url.startsWith('chrome-extension:')) {
    const res = (await chrome.runtime.sendMessage(msg).catch(() => undefined)) as { found?: boolean } | undefined;
    return res?.found ? 'shown' : 'missing';
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined) {
    const res = (await chrome.tabs.sendMessage(tab.id, msg).catch(() => undefined)) as { found?: boolean } | undefined;
    if (res?.found) return 'shown';
    if (res) return 'missing';
  }
  await chrome.tabs.create({ url: textFragmentUrl(url, quote) });
  return 'opened';
}
