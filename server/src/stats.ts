/**
 * Anonymous product and traffic counts for the hosted service and website. Never stores text, full URLs
 * of reading pages, IP addresses or raw install ids: only per-day counters, per-day breakdowns (site path,
 * referrer host, country), HyperLogLog sets of hashed ids, each hashed install's first day, and feedback
 * messages people chose to send.
 */

import crypto from 'node:crypto';

export interface UsageEvent {
  install: string;
  kind: 'explain' | 'follow-up';
  /** The term was already in the reader's word list. */
  repeat: boolean;
  /** Size of the reader's word list. */
  lexicon: number;
  now?: number;
}

export interface PageHit {
  /** Website path, e.g. "/install". */
  path: string;
  /** Referrer host (other sites only). */
  ref?: string;
  /** Two-letter country code from the host's geo header. */
  country?: string;
  /** Daily-rotating anonymous visitor hash (never an IP). */
  visitor: string;
  now?: number;
}

export type FunnelEvent = 'download' | 'install' | 'uninstall';

export interface FeedbackEntry {
  at: string;
  reason: string;
  message: string;
}

export interface DayRow {
  day: string;
  lookups: number;
  followUps: number;
  repeatLookups: number;
  activeInstalls: number;
  newInstalls: number;
  installsWithWordList10: number;
  /** Of installs first seen this day, how many came back 7+ / 30+ days later. */
  retainedD7: number;
  retainedD30: number;
  pageviews: number;
  visitors: number;
  downloads: number;
  installs: number;
  uninstalls: number;
}

export interface Summary {
  /** Newest first. */
  days: DayRow[];
  /** Unique across the whole range, not a sum of days. */
  uniqueVisitors: number;
  uniqueActiveInstalls: number;
  topPages: [string, number][];
  topReferrers: [string, number][];
  countries: [string, number][];
  feedback: FeedbackEntry[];
  store: 'shared' | 'memory';
}

export interface UsageStats {
  record(e: UsageEvent): Promise<void>;
  hit(h: PageHit): Promise<void>;
  /** `id` makes an event count once per install (installs). */
  event(name: FunnelEvent, id?: string, now?: number): Promise<void>;
  feedback(f: FeedbackEntry): Promise<void>;
  report(days: number, now?: number): Promise<DayRow[]>;
  summary(days: number, now?: number): Promise<Summary>;
}

const DAY_MS = 86_400_000;
const dayOf = (ts: number) => new Date(ts).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
export const hashInstall = (id: string) => crypto.createHash('sha256').update(`glossa:${id}`).digest('hex').slice(0, 20);
const FUNNEL_KEY: Record<FunnelEvent, string> = { download: 'downloads', install: 'installs', uninstall: 'uninstalls' };
const COUNTERS = ['lookups', 'followUps', 'repeat', 'new', 'r7', 'r30', 'pageviews', 'downloads', 'installs', 'uninstalls'] as const;

function lastDays(days: number, now: number): string[] {
  const n = Math.min(Math.max(1, Math.floor(days) || 1), 120);
  return Array.from({ length: n }, (_, i) => dayOf(now - i * DAY_MS));
}

function top(map: Map<string, number>, n = 10): [string, number][] {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function addInto(target: Map<string, number>, source: Record<string, number | string> | Map<string, number> | undefined): void {
  if (!source) return;
  const entries = source instanceof Map ? [...source.entries()] : Object.entries(source);
  for (const [k, v] of entries) target.set(k, (target.get(k) || 0) + (Number(v) || 0));
}

export class MemoryStats implements UsageStats {
  private counters = new Map<string, number>();
  private sets = new Map<string, Set<string>>();
  private hashes = new Map<string, Map<string, number>>();
  private first = new Map<string, string>();
  private once = new Set<string>();
  private notes: FeedbackEntry[] = [];

  private inc(key: string, by = 1): void {
    this.counters.set(key, (this.counters.get(key) || 0) + by);
  }

  private add(key: string, member: string): void {
    const s = this.sets.get(key) || new Set<string>();
    s.add(member);
    this.sets.set(key, s);
  }

  private hinc(key: string, field: string): void {
    const h = this.hashes.get(key) || new Map<string, number>();
    h.set(field, (h.get(field) || 0) + 1);
    this.hashes.set(key, h);
  }

  async record(e: UsageEvent): Promise<void> {
    const day = dayOf(e.now ?? Date.now());
    const id = hashInstall(e.install);
    this.inc(`${day}:${e.kind === 'explain' ? 'lookups' : 'followUps'}`);
    if (e.repeat && e.kind === 'explain') this.inc(`${day}:repeat`);
    this.add(`${day}:active`, id);
    if (e.lexicon >= 10) this.add(`${day}:lex10`, id);
    const first = this.first.get(id);
    if (!first) {
      this.first.set(id, day);
      this.inc(`${day}:new`);
      return;
    }
    const gap = daysBetween(first, day);
    for (const [n, tag] of [[7, 'r7'], [30, 'r30']] as const) {
      if (gap >= n && !this.once.has(`${tag}:${id}`)) {
        this.once.add(`${tag}:${id}`);
        this.inc(`${first}:${tag}`);
      }
    }
  }

  async hit(h: PageHit): Promise<void> {
    const day = dayOf(h.now ?? Date.now());
    this.inc(`${day}:pageviews`);
    this.add(`${day}:visitors`, h.visitor);
    this.hinc(`${day}:pages`, h.path);
    if (h.ref) this.hinc(`${day}:refs`, h.ref);
    if (h.country) this.hinc(`${day}:countries`, h.country);
  }

  async event(name: FunnelEvent, id?: string, now = Date.now()): Promise<void> {
    if (id) {
      const key = `${name}:${hashInstall(id)}`;
      if (this.once.has(key)) return;
      this.once.add(key);
    }
    this.inc(`${dayOf(now)}:${FUNNEL_KEY[name]}`);
  }

  async feedback(f: FeedbackEntry): Promise<void> {
    this.notes.unshift(f);
    this.notes.length = Math.min(this.notes.length, 500);
  }

  async report(days: number, now = Date.now()): Promise<DayRow[]> {
    const c = (k: string) => this.counters.get(k) || 0;
    return lastDays(days, now).map((day) => ({
      day,
      lookups: c(`${day}:lookups`),
      followUps: c(`${day}:followUps`),
      repeatLookups: c(`${day}:repeat`),
      activeInstalls: this.sets.get(`${day}:active`)?.size || 0,
      newInstalls: c(`${day}:new`),
      installsWithWordList10: this.sets.get(`${day}:lex10`)?.size || 0,
      retainedD7: c(`${day}:r7`),
      retainedD30: c(`${day}:r30`),
      pageviews: c(`${day}:pageviews`),
      visitors: this.sets.get(`${day}:visitors`)?.size || 0,
      downloads: c(`${day}:downloads`),
      installs: c(`${day}:installs`),
      uninstalls: c(`${day}:uninstalls`),
    }));
  }

  async summary(days: number, now = Date.now()): Promise<Summary> {
    const list = lastDays(days, now);
    const union = (kind: string) => new Set(list.flatMap((d) => [...(this.sets.get(`${d}:${kind}`) || [])])).size;
    const merged = (kind: string) => {
      const m = new Map<string, number>();
      for (const d of list) addInto(m, this.hashes.get(`${d}:${kind}`));
      return m;
    };
    return {
      days: await this.report(days, now),
      uniqueVisitors: union('visitors'),
      uniqueActiveInstalls: union('active'),
      topPages: top(merged('pages')),
      topReferrers: top(merged('refs')),
      countries: top(merged('countries'), 15),
      feedback: this.notes.slice(0, 50),
      store: 'memory',
    };
  }
}

/** Same counts in Upstash Redis (REST), shared across serverless instances. */
export class RedisStats implements UsageStats {
  constructor(private url: string, private token: string) {}

  private async pipeline(cmds: (string | number)[][]): Promise<unknown[]> {
    const res = await fetch(`${this.url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`stats store ${res.status}`);
    return ((await res.json()) as { result?: unknown }[]).map((r) => r.result);
  }

  private static TTL = 130 * 86400;
  private k = (day: string, s: string) => `glossa:s:${day}:${s}`;

  async record(e: UsageEvent): Promise<void> {
    const day = dayOf(e.now ?? Date.now());
    const id = hashInstall(e.install);
    const ttl = RedisStats.TTL;
    const firstKey = `glossa:s:first:${id}`;
    const metric = e.kind === 'explain' ? 'lookups' : 'followUps';
    const cmds: (string | number)[][] = [
      ['INCR', this.k(day, metric)],
      ['EXPIRE', this.k(day, metric), ttl],
      ['PFADD', this.k(day, 'active'), id],
      ['EXPIRE', this.k(day, 'active'), ttl],
      ['SET', firstKey, day, 'NX', 'EX', 400 * 86400],
      ['GET', firstKey],
    ];
    if (e.repeat && e.kind === 'explain') cmds.push(['INCR', this.k(day, 'repeat')], ['EXPIRE', this.k(day, 'repeat'), ttl]);
    if (e.lexicon >= 10) cmds.push(['PFADD', this.k(day, 'lex10'), id], ['EXPIRE', this.k(day, 'lex10'), ttl]);
    const out = await this.pipeline(cmds);
    const first = String(out[5] || day);
    if (out[4] === 'OK') {
      await this.pipeline([['INCR', this.k(day, 'new')], ['EXPIRE', this.k(day, 'new'), ttl]]);
      return;
    }
    const gap = daysBetween(first, day);
    const marks = ([[7, 'r7'], [30, 'r30']] as const).filter(([n]) => gap >= n);
    if (!marks.length) return;
    const set = await this.pipeline(marks.map(([, tag]) => ['SET', `glossa:s:${tag}:${id}`, '1', 'NX', 'EX', 400 * 86400]));
    const incs = marks.filter((_, i) => set[i] === 'OK').map(([, tag]) => ['INCR', this.k(first, tag)]);
    if (incs.length) await this.pipeline(incs);
  }

  async hit(h: PageHit): Promise<void> {
    const day = dayOf(h.now ?? Date.now());
    const ttl = RedisStats.TTL;
    const cmds: (string | number)[][] = [
      ['INCR', this.k(day, 'pageviews')],
      ['EXPIRE', this.k(day, 'pageviews'), ttl],
      ['PFADD', this.k(day, 'visitors'), h.visitor],
      ['EXPIRE', this.k(day, 'visitors'), ttl],
      ['HINCRBY', this.k(day, 'pages'), h.path, 1],
      ['EXPIRE', this.k(day, 'pages'), ttl],
    ];
    if (h.ref) cmds.push(['HINCRBY', this.k(day, 'refs'), h.ref, 1], ['EXPIRE', this.k(day, 'refs'), ttl]);
    if (h.country) cmds.push(['HINCRBY', this.k(day, 'countries'), h.country, 1], ['EXPIRE', this.k(day, 'countries'), ttl]);
    await this.pipeline(cmds);
  }

  async event(name: FunnelEvent, id?: string, now = Date.now()): Promise<void> {
    if (id) {
      const [set] = await this.pipeline([['SET', `glossa:s:${name}:${hashInstall(id)}`, '1', 'NX', 'EX', 400 * 86400]]);
      if (set !== 'OK') return;
    }
    const key = this.k(dayOf(now), FUNNEL_KEY[name]);
    await this.pipeline([['INCR', key], ['EXPIRE', key, RedisStats.TTL]]);
  }

  async feedback(f: FeedbackEntry): Promise<void> {
    await this.pipeline([['LPUSH', 'glossa:feedback', JSON.stringify(f)], ['LTRIM', 'glossa:feedback', 0, 499]]);
  }

  async report(days: number, now = Date.now()): Promise<DayRow[]> {
    const list = lastDays(days, now);
    const cmds = list.flatMap((day) => [
      ...COUNTERS.map((f) => ['GET', this.k(day, f)]),
      ['PFCOUNT', this.k(day, 'active')],
      ['PFCOUNT', this.k(day, 'lex10')],
      ['PFCOUNT', this.k(day, 'visitors')],
    ]);
    const out = (await this.pipeline(cmds)).map((v) => Number(v) || 0);
    const per = COUNTERS.length + 3;
    return list.map((day, i) => {
      const v = out.slice(i * per, i * per + per);
      const [lookups, followUps, repeatLookups, newInstalls, retainedD7, retainedD30, pageviews, downloads, installs, uninstalls, activeInstalls, installsWithWordList10, visitors] = v;
      return { day, lookups, followUps, repeatLookups, activeInstalls, newInstalls, installsWithWordList10, retainedD7, retainedD30, pageviews, visitors, downloads, installs, uninstalls };
    });
  }

  async summary(days: number, now = Date.now()): Promise<Summary> {
    const list = lastDays(days, now);
    const out = await this.pipeline([
      ['PFCOUNT', ...list.map((d) => this.k(d, 'visitors'))],
      ['PFCOUNT', ...list.map((d) => this.k(d, 'active'))],
      ...list.flatMap((d) => [['HGETALL', this.k(d, 'pages')], ['HGETALL', this.k(d, 'refs')], ['HGETALL', this.k(d, 'countries')]]),
      ['LRANGE', 'glossa:feedback', 0, 49],
    ]);
    // Upstash returns HGETALL as a flat [field, value, ...] array.
    const asMap = (v: unknown) => {
      const m = new Map<string, number>();
      if (Array.isArray(v)) for (let i = 0; i < v.length; i += 2) m.set(String(v[i]), Number(v[i + 1]) || 0);
      return m;
    };
    const pages = new Map<string, number>();
    const refs = new Map<string, number>();
    const countries = new Map<string, number>();
    list.forEach((_, i) => {
      addInto(pages, asMap(out[2 + i * 3]));
      addInto(refs, asMap(out[3 + i * 3]));
      addInto(countries, asMap(out[4 + i * 3]));
    });
    const feedback = ((out[out.length - 1] as string[]) || []).flatMap((s) => {
      try {
        return [JSON.parse(s) as FeedbackEntry];
      } catch {
        return [];
      }
    });
    return {
      days: await this.report(days, now),
      uniqueVisitors: Number(out[0]) || 0,
      uniqueActiveInstalls: Number(out[1]) || 0,
      topPages: top(pages),
      topReferrers: top(refs),
      countries: top(countries, 15),
      feedback,
      store: 'shared',
    };
  }
}

/** Uses the shared store, falling back to memory if it's unreachable. Never throws. */
export function resilientStats(primary: UsageStats | null, backup: UsageStats, log: boolean): UsageStats {
  const target = primary || backup;
  const write =
    <A extends unknown[]>(fn: (s: UsageStats, ...a: A) => Promise<void>) =>
    async (...a: A): Promise<void> => {
      try {
        await fn(target, ...a);
      } catch (err) {
        if (log) console.warn('[stats] store unavailable:', (err as Error).message);
        await fn(backup, ...a).catch(() => undefined);
      }
    };
  return {
    record: write((s, e: UsageEvent) => s.record(e)),
    hit: write((s, h: PageHit) => s.hit(h)),
    event: write((s, n: FunnelEvent, id?: string, now?: number) => s.event(n, id, now)),
    feedback: write((s, f: FeedbackEntry) => s.feedback(f)),
    async report(days, now) {
      try {
        return await target.report(days, now);
      } catch {
        return backup.report(days, now);
      }
    },
    async summary(days, now) {
      try {
        return await target.summary(days, now);
      } catch {
        return backup.summary(days, now);
      }
    },
  };
}
