/**
 * Anonymous product counts for the hosted service. Never stores text, URLs or raw install ids:
 * only per-day counters, HyperLogLog sets of hashed install ids, and each hashed install's first day.
 *
 * What it answers: lookups per day, how often people look up a term they already have,
 * how many installs are active, how many have a real word list (10+), and D7/D30 retention by cohort.
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
}

export interface UsageStats {
  record(e: UsageEvent): Promise<void>;
  report(days: number, now?: number): Promise<DayRow[]>;
}

const DAY_MS = 86_400_000;
const dayOf = (ts: number) => new Date(ts).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
export const hashInstall = (id: string) => crypto.createHash('sha256').update(`glossa:${id}`).digest('hex').slice(0, 20);

function lastDays(days: number, now: number): string[] {
  const n = Math.min(Math.max(1, Math.floor(days) || 1), 120);
  return Array.from({ length: n }, (_, i) => dayOf(now - i * DAY_MS));
}

export class MemoryStats implements UsageStats {
  private counters = new Map<string, number>();
  private sets = new Map<string, Set<string>>();
  private first = new Map<string, string>();
  private retained = new Set<string>();

  private inc(key: string): void {
    this.counters.set(key, (this.counters.get(key) || 0) + 1);
  }

  private add(key: string, member: string): void {
    const s = this.sets.get(key) || new Set<string>();
    s.add(member);
    this.sets.set(key, s);
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
      if (gap >= n && !this.retained.has(`${tag}:${id}`)) {
        this.retained.add(`${tag}:${id}`);
        this.inc(`${first}:${tag}`);
      }
    }
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
    }));
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

  async record(e: UsageEvent): Promise<void> {
    const day = dayOf(e.now ?? Date.now());
    const id = hashInstall(e.install);
    const k = (s: string) => `glossa:s:${day}:${s}`;
    const ttl = 130 * 86400;
    const firstKey = `glossa:s:first:${id}`;
    const cmds: (string | number)[][] = [
      ['INCR', k(e.kind === 'explain' ? 'lookups' : 'followUps')],
      ['EXPIRE', k(e.kind === 'explain' ? 'lookups' : 'followUps'), ttl],
      ['PFADD', k('active'), id],
      ['EXPIRE', k('active'), ttl],
      ['SET', firstKey, day, 'NX', 'EX', 400 * 86400],
      ['GET', firstKey],
    ];
    if (e.repeat && e.kind === 'explain') cmds.push(['INCR', k('repeat')], ['EXPIRE', k('repeat'), ttl]);
    if (e.lexicon >= 10) cmds.push(['PFADD', k('lex10'), id], ['EXPIRE', k('lex10'), ttl]);
    const out = await this.pipeline(cmds);
    const created = out[4] === 'OK';
    const first = String(out[5] || day);
    if (created) {
      await this.pipeline([['INCR', k('new')], ['EXPIRE', k('new'), ttl]]);
      return;
    }
    const gap = daysBetween(first, day);
    const marks = ([[7, 'r7'], [30, 'r30']] as const).filter(([n]) => gap >= n);
    if (!marks.length) return;
    const set = await this.pipeline(marks.map(([, tag]) => ['SET', `glossa:s:${tag}:${id}`, '1', 'NX', 'EX', 400 * 86400]));
    const incs = marks.filter((_, i) => set[i] === 'OK').map(([, tag]) => ['INCR', `glossa:s:${first}:${tag}`]);
    if (incs.length) await this.pipeline(incs);
  }

  async report(days: number, now = Date.now()): Promise<DayRow[]> {
    const list = lastDays(days, now);
    const fields = ['lookups', 'followUps', 'repeat', 'new', 'r7', 'r30'] as const;
    const cmds = list.flatMap((day) => [
      ...fields.map((f) => ['GET', `glossa:s:${day}:${f}`]),
      ['PFCOUNT', `glossa:s:${day}:active`],
      ['PFCOUNT', `glossa:s:${day}:lex10`],
    ]);
    const out = (await this.pipeline(cmds)).map((v) => Number(v) || 0);
    const per = fields.length + 2;
    return list.map((day, i) => {
      const [lookups, followUps, repeatLookups, newInstalls, retainedD7, retainedD30, activeInstalls, installsWithWordList10] = out.slice(i * per, i * per + per);
      return { day, lookups, followUps, repeatLookups, activeInstalls, newInstalls, installsWithWordList10, retainedD7, retainedD30 };
    });
  }
}

/** Uses the shared store, falling back to memory if it's unreachable. Never throws. */
export function resilientStats(primary: UsageStats | null, backup: UsageStats, log: boolean): UsageStats {
  return {
    async record(e) {
      try {
        await (primary || backup).record(e);
      } catch (err) {
        if (log) console.warn('[stats] store unavailable:', (err as Error).message);
        await backup.record(e).catch(() => undefined);
      }
    },
    async report(days, now) {
      try {
        return await (primary || backup).report(days, now);
      } catch {
        return backup.report(days, now);
      }
    },
  };
}
