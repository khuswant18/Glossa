import type { Explanation, Lookup } from '../shared/types';
import { toPlain } from './Markdown';

export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol.startsWith('http') ? u.hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function dayLabel(ts: number, now = Date.now()): string {
  const start = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const diff = Math.round((start(now) - start(ts)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function explanationToText(e: Explanation, selected?: string): string {
  const parts: string[] = [];
  const head = [e.headword, e.pronunciation, e.partOfSpeech].filter(Boolean).join('  ');
  parts.push(head);
  if (e.expansion) parts.push(e.expansion);
  if (selected && selected !== e.headword) parts.push(`“${selected}”`);
  parts.push('', e.meaning);
  if (e.gloss) parts.push(e.gloss);
  if (e.fromPage) parts.push('', `From the page: “${e.fromPage}”`);
  if (e.explanation) parts.push('', e.explanation);
  if (e.definition) parts.push('', `In general: ${e.definition}`);
  if (e.example) parts.push('', `Example: ${e.example}`);
  if (e.synonyms?.length) parts.push('', `Similar: ${e.synonyms.join(', ')}`);
  if (e.keyTerms?.length) parts.push('', ...e.keyTerms.map((t) => `• ${t.term}: ${t.definition}`));
  if (e.note) parts.push('', `Note: ${e.note}`);
  return parts.join('\n').trim();
}

export function lookupToMarkdown(l: Lookup): string {
  const e = l.result;
  const lines = [`## ${e.headword}${e.pronunciation ? ` ${e.pronunciation}` : ''}`];
  if (e.partOfSpeech) lines.push(`*${e.partOfSpeech}*`);
  if (e.expansion) lines.push(`*${e.expansion}*`);
  if (l.selection.text !== e.headword) lines.push('', `> ${l.selection.text.replace(/\n/g, '\n> ')}`);
  lines.push('', e.meaning);
  if (e.gloss) lines.push('', e.gloss);
  if (e.fromPage) lines.push('', `**From the page:** “${e.fromPage}”`);
  if (e.explanation) lines.push('', e.explanation);
  if (e.definition) lines.push('', `**In general:** ${e.definition}`);
  if (e.example) lines.push('', `**Example:** ${e.example}`);
  if (e.synonyms?.length) lines.push('', `**Similar:** ${e.synonyms.join(', ')}`);
  if (e.keyTerms?.length) lines.push('', ...e.keyTerms.map((t) => `- **${t.term}:** ${t.definition}`));
  for (const f of l.followUps) lines.push('', `**${f.label}**`, '', f.answer);
  if (l.selection.pageUrl) lines.push('', `Source: [${l.selection.pageTitle || hostOf(l.selection.pageUrl)}](${l.selection.pageUrl})`);
  lines.push(`Looked up ${new Date(l.createdAt).toLocaleString()}`);
  return lines.join('\n');
}

export function followUpsToText(l: Lookup): string {
  return l.followUps.map((f) => `${f.label}\n${toPlain(f.answer)}`).join('\n\n');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Speaks text with the browser's built-in voices. Returns a stop function. */
export function speak(text: string, lang?: string, onEnd?: () => void): () => void {
  if (typeof speechSynthesis === 'undefined') {
    onEnd?.();
    return () => undefined;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (lang) u.lang = lang;
  u.rate = 0.95;
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  speechSynthesis.speak(u);
  return () => {
    speechSynthesis.cancel();
    onEnd?.();
  };
}

const LANG_CODES: Record<string, string> = {
  English: 'en', Hindi: 'hi', Spanish: 'es', French: 'fr', German: 'de', Portuguese: 'pt', Italian: 'it',
  Dutch: 'nl', Russian: 'ru', Japanese: 'ja', Korean: 'ko', 'Chinese (Simplified)': 'zh-CN', Arabic: 'ar',
  Turkish: 'tr', Indonesian: 'id', Bengali: 'bn', Punjabi: 'pa', Tamil: 'ta', Urdu: 'ur', Vietnamese: 'vi',
};

export function langCode(language: string): string {
  return LANG_CODES[language] || 'en';
}
