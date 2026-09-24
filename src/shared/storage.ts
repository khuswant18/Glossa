/**
 * chrome.storage wrapper. Settings + history live in storage.local; transient
 * hand-off state between background and side panel lives in storage.session.
 */

import type { Lookup, PanelNotice, PendingRequest, Quota, Settings } from './types';
import { LIMITS } from './brand';

export const KEYS = {
  settings: 'glossa.settings',
  history: 'glossa.history',
  cache: 'glossa.cache',
  installId: 'glossa.installId',
  quota: 'glossa.quota',
  stats: 'glossa.stats',
  pending: 'glossa.pending',
  notice: 'glossa.notice',
} as const;

export const DEFAULT_SETTINGS: Settings = {
  aiSource: 'hosted',
  provider: 'openai',
  apiKeys: {},
  models: {},
  customBaseUrl: '',
  level: 'standard',
  length: 'normal',
  language: 'English',
  theme: 'system',
  textScale: 1,
  showChip: true,
  includeContext: true,
  saveHistory: true,
  paused: false,
  disabledSites: [],
  serverUrl: '',
};

const hasChrome = () => typeof chrome !== 'undefined' && !!chrome.storage?.local;

// In-memory fallback so UI code also runs outside the extension (tests, local preview).
const memory: Record<string, unknown> = {};
const sessionMemory: Record<string, unknown> = {};

// Outside the extension (the website playground) values persist in localStorage when allowed.
function webGet(key: string): unknown {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    if (raw !== null) return JSON.parse(raw);
  } catch {
    // private mode / blocked storage: fall through to memory
  }
  return memory[key];
}

function webSet(key: string, value: unknown): void {
  memory[key] = value;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota or blocked storage: memory copy is enough
  }
}

async function localGet<T>(key: string): Promise<T | undefined> {
  if (!hasChrome()) return webGet(key) as T | undefined;
  const data = await chrome.storage.local.get(key);
  return data[key] as T | undefined;
}

async function localSet(key: string, value: unknown): Promise<void> {
  if (!hasChrome()) {
    webSet(key, value);
    return;
  }
  await chrome.storage.local.set({ [key]: value });
}

async function sessionGet<T>(key: string): Promise<T | undefined> {
  if (!hasChrome() || !chrome.storage.session) return sessionMemory[key] as T | undefined;
  const data = await chrome.storage.session.get(key);
  return data[key] as T | undefined;
}

async function sessionSet(key: string, value: unknown): Promise<void> {
  if (!hasChrome() || !chrome.storage.session) {
    sessionMemory[key] = value;
    return;
  }
  await chrome.storage.session.set({ [key]: value });
}

export function mergeSettings(stored: Partial<Settings> | undefined): Settings {
  const s = { ...DEFAULT_SETTINGS, ...(stored || {}) };
  s.apiKeys = { ...(stored?.apiKeys || {}) };
  s.models = { ...(stored?.models || {}) };
  s.disabledSites = Array.isArray(stored?.disabledSites) ? stored!.disabledSites : [];
  s.textScale = clamp(Number(s.textScale) || 1, 0.85, 1.3);
  return s;
}

export async function getSettings(): Promise<Settings> {
  return mergeSettings(await localGet<Partial<Settings>>(KEYS.settings));
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = mergeSettings({ ...(await getSettings()), ...patch });
  await localSet(KEYS.settings, next);
  return next;
}

export async function resetSettings(): Promise<Settings> {
  await localSet(KEYS.settings, DEFAULT_SETTINGS);
  return mergeSettings(DEFAULT_SETTINGS);
}

// ---- History ---------------------------------------------------------------

export async function getHistory(): Promise<Lookup[]> {
  const list = await localGet<Lookup[]>(KEYS.history);
  return Array.isArray(list) ? list : [];
}

async function writeHistory(list: Lookup[]): Promise<Lookup[]> {
  // Saved items are never evicted by the size cap.
  const saved = list.filter((l) => l.saved);
  const rest = list.filter((l) => !l.saved);
  const room = Math.max(0, LIMITS.historyItems - saved.length);
  const keep = new Set([...saved, ...rest.slice(0, room)].map((l) => l.id));
  const next = list.filter((l) => keep.has(l.id));
  await localSet(KEYS.history, next);
  return next;
}

export async function upsertLookup(item: Lookup): Promise<Lookup[]> {
  const list = await getHistory();
  const idx = list.findIndex((l) => l.id === item.id);
  if (idx >= 0) {
    list[idx] = item;
    return writeHistory(list);
  }
  // Looking the same thing up again replaces the older unsaved entry instead of piling up duplicates.
  const same = (l: Lookup) =>
    !l.saved &&
    l.selection.pageUrl === item.selection.pageUrl &&
    l.selection.text.trim().toLowerCase() === item.selection.text.trim().toLowerCase();
  return writeHistory([item, ...list.filter((l) => !same(l))]);
}

export async function deleteLookup(id: string): Promise<Lookup[]> {
  return writeHistory((await getHistory()).filter((l) => l.id !== id));
}

export async function clearHistory(keepSaved: boolean): Promise<Lookup[]> {
  return writeHistory(keepSaved ? (await getHistory()).filter((l) => l.saved) : []);
}

// ---- Response cache (identical selection + context + options) --------------

interface CacheEntry {
  key: string;
  value: unknown;
  at: number;
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const list = (await localGet<CacheEntry[]>(KEYS.cache)) || [];
  const hit = list.find((e) => e.key === key);
  if (!hit || Date.now() - hit.at > CACHE_TTL_MS) return undefined;
  return hit.value as T;
}

export async function cachePut(key: string, value: unknown): Promise<void> {
  const list = ((await localGet<CacheEntry[]>(KEYS.cache)) || []).filter((e) => e.key !== key);
  list.unshift({ key, value, at: Date.now() });
  await localSet(KEYS.cache, list.slice(0, LIMITS.cacheItems));
}

export async function clearCache(): Promise<void> {
  await localSet(KEYS.cache, []);
}

// ---- Install id, quota, stats ---------------------------------------------

export async function getInstallId(): Promise<string> {
  let id = await localGet<string>(KEYS.installId);
  if (!id) {
    id = randomId();
    await localSet(KEYS.installId, id);
  }
  return id;
}

export async function getQuota(): Promise<Quota | undefined> {
  return localGet<Quota>(KEYS.quota);
}

export async function setQuota(q: Quota): Promise<void> {
  await localSet(KEYS.quota, q);
}

export interface Stats {
  total: number;
  days: Record<string, number>;
}

export async function getStats(): Promise<Stats> {
  return (await localGet<Stats>(KEYS.stats)) || { total: 0, days: {} };
}

export async function bumpStats(): Promise<Stats> {
  const stats = await getStats();
  const day = dayKey(Date.now());
  stats.total += 1;
  stats.days[day] = (stats.days[day] || 0) + 1;
  // Keep 60 days.
  const cutoff = dayKey(Date.now() - 60 * 86400000);
  for (const d of Object.keys(stats.days)) if (d < cutoff) delete stats.days[d];
  await localSet(KEYS.stats, stats);
  return stats;
}

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- Session hand-off ------------------------------------------------------

export async function setPending(p: PendingRequest): Promise<void> {
  await sessionSet(KEYS.pending, p);
}

export async function getPending(): Promise<PendingRequest | undefined> {
  return sessionGet<PendingRequest>(KEYS.pending);
}

export async function setNotice(n: PanelNotice): Promise<void> {
  await sessionSet(KEYS.notice, n);
}

export async function getNotice(): Promise<PanelNotice | undefined> {
  return sessionGet<PanelNotice>(KEYS.notice);
}

// ---- helpers ---------------------------------------------------------------

export function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function siteKey(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
