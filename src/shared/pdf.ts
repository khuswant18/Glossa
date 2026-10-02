/** Helpers for sending PDFs to the Glossa reader (Chrome's own PDF viewer hides selections from extensions). */

export function looksLikePdf(url?: string): boolean {
  return !!url && /^(https?|file):/.test(url) && /\.pdf(?:$|[?#])/i.test(url);
}

export function readerUrl(pdfUrl?: string): string {
  const base = chrome.runtime.getURL('reader.html');
  return pdfUrl ? `${base}?url=${encodeURIComponent(pdfUrl)}` : base;
}

/**
 * Opens a PDF in the reader. Call from a click: asking for permission to load the PDF's site needs a user gesture.
 * Replaces the given tab when one is passed, so the reader takes the PDF's place.
 */
export async function openInReader(pdfUrl?: string, tabId?: number): Promise<void> {
  if (pdfUrl && /^https?:/.test(pdfUrl)) {
    const origin = new URL(pdfUrl).origin;
    await chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
  }
  const url = readerUrl(pdfUrl);
  if (tabId !== undefined) await chrome.tabs.update(tabId, { url });
  else await chrome.tabs.create({ url });
}
