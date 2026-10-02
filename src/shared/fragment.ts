/**
 * Builds a link that opens a page scrolled to (and highlighting) a sentence, using Chrome's
 * text fragments: https://example.com/a#:~:text=start,end
 */

const enc = (s: string) => encodeURIComponent(s).replace(/-/g, '%2D').replace(/,/g, '%2C').replace(/&/g, '%26');

export function textFragmentUrl(url: string, quote: string): string {
  if (!/^https?:/.test(url)) return url;
  const words = quote.replace(/[“”"]/g, '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return url;
  const base = url.split('#')[0];
  const directive =
    words.length <= 8 ? enc(words.join(' ')) : `${enc(words.slice(0, 4).join(' '))},${enc(words.slice(-4).join(' '))}`;
  return `${base}#:~:text=${directive}`;
}
