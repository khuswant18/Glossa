/**
 * Glossa API + website server. Zero runtime dependencies (Node >= 20).
 *
 * The extension talks only to this server in "Glossa (free)" mode. The upstream provider,
 * model and API key live in environment variables and never reach the client.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  buildExplainPrompt,
  buildFollowUpPrompt,
  normalizeExplanation,
  normalizeFollowUp,
} from '../../src/shared/prompt';
import type { ExplainRequest, FollowUpRequest } from '../../src/shared/types';
import { checkQuestion, guardExplanation, scrubExplanation, scrubText, secretsFor } from '../../src/shared/guard';
import { MemoryStats, RedisStats, resilientStats } from './stats';
import { clearedCookie, credentialsMatch, makeSession, renderDashboard, renderLogin, sessionCookie, validSession } from './admin';

export interface ServerConfig {
  port: number;
  upstreamUrl: string;
  upstreamKey: string;
  upstreamModel: string;
  upstreamFallbackModel: string;
  dailyLimit: number;
  ipDailyLimit: number;
  burstPerMinute: number;
  allowedExtensionIds: string[];
  websiteDir: string;
  publicOrigin: string;
  upstreamTimeoutMs: number;
  /** Sent as reasoning_effort to reasoning models (gpt-oss): "low" is ~3x faster with the same answers. */
  upstreamReasoningEffort: string;
  feedbackFile: string;
  redisUrl: string;
  redisToken: string;
  trustProxy: boolean;
  log: boolean;
  /** Bearer token for GET /v1/stats; empty disables the endpoint. */
  statsToken: string;
  /** Private dashboard at /admin. Disabled (404) when no password is set. */
  adminUser: string;
  adminPassword: string;
  /** Signs admin sessions; derived from the other secrets when not set. */
  adminSecret: string;
}

export function configFromEnv(env: NodeJS.ProcessEnv, websiteDir: string): ServerConfig {
  const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    port: num(env.PORT, 7717),
    // No provider defaults on purpose: which upstream Glossa uses lives only in the environment.
    upstreamUrl: env.UPSTREAM_URL || '',
    upstreamKey: env.UPSTREAM_API_KEY || '',
    upstreamModel: env.UPSTREAM_MODEL || '',
    upstreamFallbackModel: env.UPSTREAM_FALLBACK_MODEL || '',
    dailyLimit: num(env.DAILY_LIMIT, 100),
    ipDailyLimit: num(env.IP_DAILY_LIMIT, 400),
    burstPerMinute: num(env.BURST_PER_MINUTE, 20),
    allowedExtensionIds: (env.ALLOWED_EXTENSION_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
    websiteDir: env.WEBSITE_DIR || websiteDir,
    publicOrigin: (env.PUBLIC_ORIGIN || '').replace(/\/+$/, ''),
    // Total time for primary + fallback model; stays under the Vercel function's 30s maxDuration.
    upstreamTimeoutMs: num(env.UPSTREAM_TIMEOUT_MS, 24000),
    upstreamReasoningEffort: env.UPSTREAM_REASONING_EFFORT ?? 'low',
    // Serverless file systems are read-only; there feedback goes to the function logs instead.
    feedbackFile: env.FEEDBACK_FILE || (env.VERCEL ? '' : path.resolve(websiteDir, '..', 'server', 'data', 'feedback.jsonl')),
    redisUrl: (env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || '').replace(/\/+$/, ''),
    redisToken: env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || '',
    trustProxy: !!env.VERCEL || env.TRUST_PROXY === '1',
    log: env.LOG !== '0',
    statsToken: env.STATS_TOKEN || '',
    adminUser: env.ADMIN_USER || 'admin',
    adminPassword: env.ADMIN_PASSWORD || '',
    adminSecret: env.ADMIN_SECRET || '',
  };
}

// ---------------------------------------------------------------------------
// Rate limiting. In memory for a single long-running server; Upstash Redis (REST) when
// configured, which is required on serverless hosts where every instance has its own memory.
// ---------------------------------------------------------------------------

interface Counter {
  count: number;
  resetAt: number;
}

function nextUtcMidnight(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

interface Limiter {
  peek(key: string, now?: number): Promise<Counter>;
  take(key: string, now?: number): Promise<Counter>;
  refund(key: string, now?: number): Promise<void>;
  burstCount(key: string, now?: number): Promise<number>;
  burstAdd(key: string, now?: number): Promise<void>;
  /** One round trip: the burst count for `burstKey` and the current daily counter for each key. */
  check(burstKey: string, keys: string[], now?: number): Promise<{ burst: number; counters: Counter[] }>;
  /** One round trip: record a burst hit and take one from each daily counter. */
  commit(burstKey: string, keys: string[], now?: number): Promise<Counter[]>;
  /** One round trip: give back one from each daily counter. */
  refundAll(keys: string[], now?: number): Promise<void>;
  sweep(now?: number): void;
}

/** check/commit/refundAll built from the single-key methods (for the in-memory limiter). */
abstract class BatchedFromSingle {
  abstract peek(key: string, now?: number): Promise<Counter>;
  abstract take(key: string, now?: number): Promise<Counter>;
  abstract refund(key: string, now?: number): Promise<void>;
  abstract burstCount(key: string, now?: number): Promise<number>;
  abstract burstAdd(key: string, now?: number): Promise<void>;

  async check(burstKey: string, keys: string[], now = Date.now()) {
    return { burst: await this.burstCount(burstKey, now), counters: await Promise.all(keys.map((k) => this.peek(k, now))) };
  }

  async commit(burstKey: string, keys: string[], now = Date.now()) {
    await this.burstAdd(burstKey, now);
    return Promise.all(keys.map((k) => this.take(k, now)));
  }

  async refundAll(keys: string[], now = Date.now()) {
    await Promise.all(keys.map((k) => this.refund(k, now)));
  }
}

class MemoryLimiter extends BatchedFromSingle implements Limiter {
  private daily = new Map<string, Counter>();
  private burst = new Map<string, number[]>();

  async peek(key: string, now = Date.now()): Promise<Counter> {
    const c = this.daily.get(key);
    if (!c || c.resetAt <= now) return { count: 0, resetAt: nextUtcMidnight(now) };
    return c;
  }

  async take(key: string, now = Date.now()): Promise<Counter> {
    const c = await this.peek(key, now);
    const next = { count: c.count + 1, resetAt: c.resetAt };
    this.daily.set(key, next);
    return next;
  }

  async refund(key: string): Promise<void> {
    const c = this.daily.get(key);
    if (c && c.count > 0) c.count -= 1;
  }

  async burstCount(key: string, now = Date.now()): Promise<number> {
    const list = (this.burst.get(key) || []).filter((t) => now - t < 60000);
    this.burst.set(key, list);
    return list.length;
  }

  async burstAdd(key: string, now = Date.now()): Promise<void> {
    const list = this.burst.get(key) || [];
    list.push(now);
    this.burst.set(key, list);
  }

  sweep(now = Date.now()): void {
    for (const [k, c] of this.daily) if (c.resetAt <= now) this.daily.delete(k);
    for (const [k, l] of this.burst) if (!l.some((t) => now - t < 60000)) this.burst.delete(k);
  }
}

/** Fixed-window counters in Upstash Redis via its REST API (no client library needed). */
class RedisLimiter implements Limiter {
  constructor(private url: string, private token: string) {}

  private async pipeline(cmds: (string | number)[][]): Promise<unknown[]> {
    const res = await fetch(`${this.url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`rate-limit store ${res.status}`);
    const out = (await res.json()) as { result?: unknown; error?: string }[];
    return out.map((r) => r.result);
  }

  private dayKey(key: string, now: number) {
    return `glossa:d:${key}:${new Date(now).toISOString().slice(0, 10)}`;
  }

  private minuteKey(key: string, now: number) {
    return `glossa:m:${key}:${Math.floor(now / 60000)}`;
  }

  async peek(key: string, now = Date.now()): Promise<Counter> {
    const [v] = await this.pipeline([['GET', this.dayKey(key, now)]]);
    return { count: Number(v) || 0, resetAt: nextUtcMidnight(now) };
  }

  async take(key: string, now = Date.now()): Promise<Counter> {
    const k = this.dayKey(key, now);
    const resetAt = nextUtcMidnight(now);
    const [v] = await this.pipeline([
      ['INCR', k],
      ['EXPIREAT', k, Math.floor(resetAt / 1000) + 3600],
    ]);
    return { count: Number(v) || 1, resetAt };
  }

  async refund(key: string, now = Date.now()): Promise<void> {
    await this.pipeline([['DECR', this.dayKey(key, now)]]);
  }

  async burstCount(key: string, now = Date.now()): Promise<number> {
    const [v] = await this.pipeline([['GET', this.minuteKey(key, now)]]);
    return Number(v) || 0;
  }

  async burstAdd(key: string, now = Date.now()): Promise<void> {
    const k = this.minuteKey(key, now);
    await this.pipeline([
      ['INCR', k],
      ['EXPIRE', k, 120],
    ]);
  }

  async check(burstKey: string, keys: string[], now = Date.now()) {
    const out = await this.pipeline([['GET', this.minuteKey(burstKey, now)], ...keys.map((k) => ['GET', this.dayKey(k, now)])]);
    const resetAt = nextUtcMidnight(now);
    return { burst: Number(out[0]) || 0, counters: keys.map((_, i) => ({ count: Number(out[i + 1]) || 0, resetAt })) };
  }

  async commit(burstKey: string, keys: string[], now = Date.now()) {
    const m = this.minuteKey(burstKey, now);
    const resetAt = nextUtcMidnight(now);
    const expireAt = Math.floor(resetAt / 1000) + 3600;
    const out = await this.pipeline([
      ['INCR', m],
      ['EXPIRE', m, 120],
      ...keys.flatMap((k) => [
        ['INCR', this.dayKey(k, now)],
        ['EXPIREAT', this.dayKey(k, now), expireAt],
      ]),
    ]);
    return keys.map((_, i) => ({ count: Number(out[2 + i * 2]) || 1, resetAt }));
  }

  async refundAll(keys: string[], now = Date.now()) {
    await this.pipeline(keys.map((k) => ['DECR', this.dayKey(k, now)]));
  }

  sweep(): void {
    // Redis expires keys itself.
  }
}

/** Uses the shared store, and falls back to per-instance memory if it is unreachable. */
function withFallback(primary: Limiter, backup: Limiter, log: boolean): Limiter {
  const wrap =
    <A extends unknown[], R>(fn: (l: Limiter, ...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
      try {
        return await fn(primary, ...a);
      } catch (err) {
        if (log) console.warn('[limit] shared store unavailable, using memory:', (err as Error).message);
        return fn(backup, ...a);
      }
    };
  return {
    peek: wrap((l, k: string, n?: number) => l.peek(k, n)),
    take: wrap((l, k: string, n?: number) => l.take(k, n)),
    refund: wrap((l, k: string, n?: number) => l.refund(k, n)),
    burstCount: wrap((l, k: string, n?: number) => l.burstCount(k, n)),
    burstAdd: wrap((l, k: string, n?: number) => l.burstAdd(k, n)),
    check: wrap((l, b: string, k: string[], n?: number) => l.check(b, k, n)),
    commit: wrap((l, b: string, k: string[], n?: number) => l.commit(b, k, n)),
    refundAll: wrap((l, k: string[], n?: number) => l.refundAll(k, n)),
    sweep: (n?: number) => backup.sweep(n),
  };
}

// ---------------------------------------------------------------------------
// Small LRU cache for identical explain requests
// ---------------------------------------------------------------------------

class Lru<V> {
  private map = new Map<string, V>();
  constructor(private max: number) {}
  get(k: string): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: string, v: V): void {
    this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter?: number) {
    super(message);
  }
}

const LEVELS = ['simple', 'standard', 'expert'];
const LENGTHS = ['brief', 'normal', 'detailed'];
const FOLLOW_UPS = ['simpler', 'deeper', 'example', 'translate', 'ask'];

function optStr(v: unknown, max: number, field: string): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') throw new HttpError(400, 'invalid_request', `"${field}" must be a string.`);
  return v.slice(0, max);
}

function reqStr(v: unknown, max: number, field: string): string {
  const s = optStr(v, max, field);
  if (!s || !s.trim()) throw new HttpError(400, 'invalid_request', `"${field}" is required.`);
  return s;
}

function language(v: unknown): string {
  const s = optStr(v, 40, 'language') || 'English';
  // Plain language names only; blocks prompt stuffing through this field.
  return /^[\p{L} ()-]{2,40}$/u.test(s) ? s : 'English';
}

export function validateExplain(body: unknown): ExplainRequest {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'invalid_request', 'Expected a JSON object.');
  const b = body as Record<string, unknown>;
  return {
    text: reqStr(b.text, 4000, 'text'),
    sentence: optStr(b.sentence, 600, 'sentence'),
    context: optStr(b.context, 2000, 'context'),
    pageTitle: optStr(b.pageTitle, 200, 'pageTitle'),
    pageUrl: optStr(b.pageUrl, 500, 'pageUrl'),
    pageDefinition: optStr(b.pageDefinition, 300, 'pageDefinition'),
    level: (LEVELS.includes(b.level as string) ? b.level : 'standard') as ExplainRequest['level'],
    length: (LENGTHS.includes(b.length as string) ? b.length : 'normal') as ExplainRequest['length'],
    language: language(b.language),
    nativeLanguage: b.nativeLanguage ? language(b.nativeLanguage) : undefined,
  };
}

export function validateFollowUp(body: unknown): FollowUpRequest {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'invalid_request', 'Expected a JSON object.');
  const b = body as Record<string, unknown>;
  const kind = FOLLOW_UPS.includes(b.kind as string) ? (b.kind as FollowUpRequest['kind']) : null;
  if (!kind) throw new HttpError(400, 'invalid_request', '"kind" is invalid.');
  const thread = Array.isArray(b.thread)
    ? b.thread
        .slice(-4)
        .filter((t): t is { q: string; a: string } => !!t && typeof t === 'object' && typeof t.q === 'string' && typeof t.a === 'string')
        .map((t) => ({ q: t.q.slice(0, 500), a: t.a.slice(0, 1500) }))
    : undefined;
  const question = optStr(b.question, 500, 'question');
  if (kind === 'ask' && !question?.trim()) throw new HttpError(400, 'invalid_request', 'Type a question first.');
  return {
    kind,
    text: reqStr(b.text, 4000, 'text'),
    meaning: reqStr(b.meaning, 2000, 'meaning'),
    context: optStr(b.context, 2000, 'context'),
    question,
    level: (LEVELS.includes(b.level as string) ? b.level : 'standard') as FollowUpRequest['level'],
    language: language(b.language),
    thread,
  };
}

// ---------------------------------------------------------------------------
// Upstream
// ---------------------------------------------------------------------------

async function callUpstream(cfg: ServerConfig, system: string, user: string): Promise<string> {
  if (!cfg.upstreamKey || !cfg.upstreamUrl || !cfg.upstreamModel) {
    throw new HttpError(503, 'upstream_unavailable', 'The Glossa service is not configured yet.');
  }
  const models = [cfg.upstreamModel, cfg.upstreamFallbackModel].filter((m, i, a) => m && a.indexOf(m) === i);
  let lastError: HttpError = new HttpError(503, 'upstream_unavailable', 'The Glossa service is busy. Try again in a moment.');

  const deadline = Date.now() + cfg.upstreamTimeoutMs;
  for (const [i, model] of models.entries()) {
    const left = deadline - Date.now();
    if (i > 0 && left <= 0) break;
    // Leave the fallback model a third of the budget if the primary hangs.
    const budget = i < models.length - 1 ? Math.round(left * 2 / 3) : left;
    try {
      const res = await fetch(cfg.upstreamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.upstreamKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.2,
          max_tokens: 1200,
          response_format: { type: 'json_object' },
          // Only reasoning models accept this; others (e.g. Llama) reject unknown parameters.
          ...(cfg.upstreamReasoningEffort && /gpt-oss/i.test(model) ? { reasoning_effort: cfg.upstreamReasoningEffort } : {}),
        }),
        signal: AbortSignal.timeout(budget),
      });
      if (res.ok) {
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const content = data.choices?.[0]?.message?.content;
        if (content && content.trim()) return content;
        lastError = new HttpError(502, 'upstream_error', 'The model returned an empty answer. Try again.');
        continue;
      }
      // Never forward upstream bodies: they can name the provider or model.
      if (cfg.log) console.warn(`[upstream] ${res.status} on primary=${model === cfg.upstreamModel}`);
      if (res.status === 401 || res.status === 403) {
        return Promise.reject(new HttpError(503, 'upstream_unavailable', 'The Glossa service is temporarily unavailable.'));
      }
      lastError = new HttpError(503, 'upstream_unavailable', 'The Glossa service is busy. Try again in a moment.');
    } catch (err) {
      if (err instanceof HttpError) throw err;
      const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
      lastError = timedOut
        ? new HttpError(504, 'timeout', 'The answer took too long. Try again.')
        : new HttpError(503, 'upstream_unavailable', 'The Glossa service is busy. Try again in a moment.');
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.zip': 'application/zip',
  '.webp': 'image/webp',
};

const PAGES: Record<string, string> = {
  '/': 'index.html',
  '/privacy': 'privacy.html',
  '/terms': 'terms.html',
  '/goodbye': 'goodbye.html',
  '/demo': 'demo.html',
  '/install': 'install.html',
};

function clientIp(req: http.IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const fwd = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket?.remoteAddress || 'unknown';
}

async function readJson(req: http.IncomingMessage, maxBytes = 32 * 1024): Promise<unknown> {
  // Some hosts (Vercel) parse the body before our handler runs.
  const pre = (req as http.IncomingMessage & { body?: unknown }).body;
  if (pre !== undefined && pre !== null && (typeof pre !== 'object' || !Buffer.isBuffer(pre))) {
    const raw = typeof pre === 'string' ? pre : JSON.stringify(pre);
    if (Buffer.byteLength(raw) > maxBytes) throw new HttpError(413, 'invalid_request', 'Request is too large.');
    if (typeof pre !== 'string') return pre;
    try {
      return JSON.parse(pre || 'null');
    } catch {
      throw new HttpError(400, 'invalid_request', 'Body must be valid JSON.');
    }
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new HttpError(413, 'invalid_request', 'Request is too large.');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
  } catch {
    throw new HttpError(400, 'invalid_request', 'Body must be valid JSON.');
  }
}

export type Handler = ((req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>) & { close: () => void };

export function createServer(cfg: ServerConfig): http.Server {
  const handler = createHandler(cfg);
  const server = http.createServer((req, res) => void handler(req, res));
  server.on('close', () => handler.close());
  return server;
}

export function createHandler(cfg: ServerConfig): Handler {
  const memory = new MemoryLimiter();
  const limiter: Limiter = cfg.redisUrl && cfg.redisToken ? withFallback(new RedisLimiter(cfg.redisUrl, cfg.redisToken), memory, cfg.log) : memory;
  // Strings that must never appear in an answer: the key, model ids and the provider's name.
  const secrets = [
    ...secretsFor({ apiKey: cfg.upstreamKey, model: cfg.upstreamModel, url: cfg.upstreamUrl }),
    ...secretsFor({ model: cfg.upstreamFallbackModel }),
  ];
  const stats = resilientStats(cfg.redisUrl && cfg.redisToken ? new RedisStats(cfg.redisUrl, cfg.redisToken) : null, new MemoryStats(), cfg.log);
  const cache = new Lru<unknown>(500);
  const sweep = setInterval(() => limiter.sweep(), 10 * 60 * 1000);
  sweep.unref();

  function corsOrigin(origin: string | undefined, host: string | undefined): string | null {
    if (!origin) return null;
    if (host && (origin === `http://${host}` || origin === `https://${host}`)) return origin;
    const m = origin.match(/^chrome-extension:\/\/([a-p]{32})$/);
    if (m) return cfg.allowedExtensionIds.length === 0 || cfg.allowedExtensionIds.includes(m[1]) ? origin : null;
    if (cfg.publicOrigin && origin === cfg.publicOrigin) return origin;
    if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return origin;
    return null;
  }

  function send(
    res: http.ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string | number> = {}
  ): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(payload),
      ...headers,
    });
    res.end(payload);
  }

  function quotaHeaders(c: Counter): Record<string, string | number> {
    return {
      'X-Quota-Limit': cfg.dailyLimit,
      'X-Quota-Remaining': Math.max(0, cfg.dailyLimit - c.count),
      'X-Quota-Reset': Math.floor(c.resetAt / 1000),
    };
  }

  function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): void {
    const page = PAGES[pathname.replace(/\/+$/, '') || '/'];
    const rel = page || pathname.replace(/^\/+/, '');
    const file = path.normalize(path.join(cfg.websiteDir, rel));
    if (!file.startsWith(path.normalize(cfg.websiteDir + path.sep)) || rel.includes('\0')) {
      res.writeHead(400).end();
      return;
    }
    fs.stat(file, (err, stat) => {
      if (err || !stat.isFile()) {
        const notFound = path.join(cfg.websiteDir, '404.html');
        res.writeHead(404, { 'Content-Type': MIME['.html'], ...securityHeaders(true) });
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(notFound).on('error', () => res.end('Not found')).pipe(res);
        return;
      }
      const ext = path.extname(file).toLowerCase();
      const isHtml = ext === '.html';
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=86400',
        ...securityHeaders(isHtml),
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  function securityHeaders(html: boolean): Record<string, string> {
    const base: Record<string, string> = {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    };
    if (html) {
      base['Content-Security-Policy'] =
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self' https://api.openai.com https://api.anthropic.com https://api.groq.com https://generativelanguage.googleapis.com https://openrouter.ai; frame-ancestors 'self'";
      base['X-Frame-Options'] = 'SAMEORIGIN';
    }
    return base;
  }

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const started = Date.now();
    const url = new URL(req.url || '/', 'http://local');
    const pathname = url.pathname;
    const isApi = pathname.startsWith('/v1/') || pathname === '/health';
    if (cfg.log && isApi) {
      res.on('finish', () => console.log(`${req.method} ${pathname} ${res.statusCode} ${Date.now() - started}ms`));
    }

    if (isApi) {
      const allow = corsOrigin(req.headers.origin, req.headers.host);
      if (allow) {
        res.setHeader('Access-Control-Allow-Origin', allow);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Expose-Headers', 'X-Quota-Limit, X-Quota-Remaining, X-Quota-Reset, Retry-After');
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(allow ? 204 : 403, {
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Glossa-Install, X-Glossa-Version, X-Glossa-Stats, X-Glossa-Repeat, X-Glossa-Lexicon',
          'Access-Control-Max-Age': '86400',
        });
        res.end();
        return;
      }
      // Browsers from origins we don't recognise are refused outright.
      if (req.headers.origin && !allow) {
        send(res, 403, { error: { code: 'forbidden', message: 'Origin not allowed.' } });
        return;
      }
    }

    try {
      if (pathname === '/admin' || pathname.startsWith('/admin/')) {
        await handleAdmin(req, res, url);
        return;
      }
      if (pathname === '/get' && (req.method === 'GET' || req.method === 'HEAD')) {
        // The website's Download button: count it, then hand over the zip.
        if (req.method === 'GET' && !isBot(req)) await stats.event('download');
        res.writeHead(302, { Location: '/download/glossa-extension.zip', 'Cache-Control': 'no-store' }).end();
        return;
      }
      if (pathname === '/health') {
        send(res, 200, { ok: true, service: 'glossa' });
      } else if (pathname === '/v1/usage' && req.method === 'GET') {
        const install = installId(req);
        send(res, 200, { ok: true }, quotaHeaders(await limiter.peek(`i:${install}`)));
      } else if (pathname === '/v1/stats' && req.method === 'GET') {
        await handleStats(req, res, url);
      } else if (pathname === '/v1/feedback' && req.method === 'POST') {
        await handleFeedback(req, res);
      } else if (pathname === '/v1/installed' && req.method === 'POST') {
        // One anonymous ping when the extension is installed; counted once per install.
        await stats.event('install', installId(req));
        send(res, 200, { ok: true });
      } else if (pathname === '/v1/hit' && req.method === 'POST') {
        await handleHit(req, res);
      } else if ((pathname === '/v1/explain' || pathname === '/v1/follow-up') && req.method === 'POST') {
        await handleAi(req, res, pathname);
      } else if (isApi) {
        send(res, 404, { error: { code: 'not_found', message: 'Unknown endpoint.' } });
      } else if (req.method === 'GET' || req.method === 'HEAD') {
        serveStatic(req, res, pathname);
      } else {
        res.writeHead(405).end();
      }
    } catch (err) {
      const e = err instanceof HttpError ? err : new HttpError(500, 'server_error', 'Something went wrong on our side.');
      if (!(err instanceof HttpError) && cfg.log) console.error('[error]', err);
      if (!res.headersSent) {
        send(res, e.status, { error: { code: e.code, message: e.message } }, e.retryAfter ? { 'Retry-After': e.retryAfter } : {});
      }
    }
  };

  function installId(req: http.IncomingMessage): string {
    const id = String(req.headers['x-glossa-install'] || '');
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) {
      throw new HttpError(400, 'invalid_request', 'Missing client id. Update the Glossa extension.');
    }
    return id;
  }

  async function handleAi(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> {
    const install = installId(req);
    const ip = clientIp(req, cfg.trustProxy);
    const body = await readJson(req);
    const isExplain = pathname === '/v1/explain';
    const request = isExplain ? validateExplain(body) : validateFollowUp(body);

    const installKey = `i:${install}`;
    const ipKey = `ip:${ip}`;
    const now = Date.now();

    // Questions about Glossa's internals are answered here, never by the model, and cost no quota.
    const probe = isExplain
      ? !(request as ExplainRequest).sentence && !(request as ExplainRequest).context
        ? (request as ExplainRequest).text
        : ''
      : (request as FollowUpRequest).question;
    const verdict = checkQuestion(probe);
    if (verdict.blocked) {
      if (cfg.log) console.log(`[guard] blocked ${verdict.reason} question`);
      send(res, 200, isExplain ? { result: guardExplanation(verdict.reason) } : { answer: verdict.reply }, quotaHeaders(await limiter.peek(installKey, now)));
      return;
    }

    // Two round trips to the shared store per answer: one read here, one write below.
    const {
      burst,
      counters: [current, ipCount],
    } = await limiter.check(installKey, [installKey, ipKey], now);
    if (burst >= cfg.burstPerMinute) {
      throw new HttpError(429, 'rate_limited', 'Slow down a little. Try again in a few seconds.', 10);
    }
    if (current.count >= cfg.dailyLimit) {
      const retry = Math.ceil((current.resetAt - now) / 1000);
      res.setHeader('X-Quota-Limit', cfg.dailyLimit);
      res.setHeader('X-Quota-Remaining', 0);
      res.setHeader('X-Quota-Reset', Math.floor(current.resetAt / 1000));
      throw new HttpError(
        429,
        'quota_exceeded',
        `You've used all ${cfg.dailyLimit} free explanation${cfg.dailyLimit === 1 ? '' : 's'} for today. Add your own API key in Settings for unlimited use, or come back tomorrow.`,
        retry
      );
    }
    if (ipCount.count >= cfg.ipDailyLimit) {
      throw new HttpError(429, 'quota_exceeded', 'Too many requests from your network today. Add your own API key in Settings to keep going.', 3600);
    }

    const [counted] = await limiter.commit(installKey, [installKey, ipKey], now);

    const cacheKey = crypto.createHash('sha256').update(pathname + JSON.stringify(request)).digest('hex');
    // "Ask again" in the extension sends fresh: true to skip the shared cache.
    const fresh = !!(body && typeof body === 'object' && (body as Record<string, unknown>).fresh === true);
    try {
      let payload = fresh ? undefined : cache.get(cacheKey);
      if (!payload) {
        if (isExplain) {
          const r = request as ExplainRequest;
          const { system, user } = buildExplainPrompt(r);
          const raw = await callUpstream(cfg, system, user);
          const userText = [r.text, r.sentence, r.context, r.pageTitle, r.pageDefinition].filter(Boolean).join(' ');
          const sources = [r.sentence, r.context, r.pageDefinition].filter(Boolean).join('\n');
          const result = scrubExplanation(normalizeExplanation(raw, r.text, sources), { userText, secrets });
          if (!result && cfg.log) console.warn('[guard] replaced a leaking explanation');
          payload = { result: result || guardExplanation() };
        } else {
          const { system, user } = buildFollowUpPrompt(request as FollowUpRequest);
          const f = request as FollowUpRequest;
          const raw = await callUpstream(cfg, system, user);
          const userText = [f.text, f.context, f.question].filter(Boolean).join(' ');
          payload = { answer: scrubText(normalizeFollowUp(raw), { userText, secrets }) };
        }
        cache.set(cacheKey, payload);
      }
      send(res, 200, payload, quotaHeaders(counted));
      // Anonymous counts, after the answer is on its way. The extension sends "off" when the user opted out.
      if (String(req.headers['x-glossa-stats'] || '') !== 'off') {
        await stats.record({
          install,
          kind: isExplain ? 'explain' : 'follow-up',
          repeat: req.headers['x-glossa-repeat'] === '1',
          lexicon: Math.min(Number(req.headers['x-glossa-lexicon']) || 0, 1_000_000),
        });
      }
    } catch (err) {
      if (res.headersSent) return;
      // Failed answers don't count against the user's quota.
      await limiter.refundAll([installKey, ipKey]);
      if (err instanceof Error && err.name === 'MalformedResponseError') {
        throw new HttpError(502, 'upstream_error', err.message);
      }
      throw err;
    }
  }

  async function handleStats(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const ok =
      !!cfg.statsToken &&
      given.length === cfg.statsToken.length &&
      crypto.timingSafeEqual(Buffer.from(given), Buffer.from(cfg.statsToken));
    if (!ok) throw new HttpError(404, 'not_found', 'Unknown endpoint.');
    send(res, 200, { days: await stats.report(Number(url.searchParams.get('days')) || 30) });
  }

  // ---- website traffic ---------------------------------------------------------

  function isBot(req: http.IncomingMessage): boolean {
    const ua = String(req.headers['user-agent'] || '');
    // Real browsers all send "Mozilla/…"; scripts, crawlers and link previewers usually don't or say so.
    return !/Mozilla\//.test(ua) || /bot|crawl|spider|slurp|preview|monitor|headless|lighthouse/i.test(ua);
  }

  // Unique visitors are counted with a hash that changes every day, so nobody can be followed across days.
  const visitorSalt = crypto.createHash('sha256').update(`visitor:${cfg.statsToken}:${cfg.upstreamKey}:${cfg.adminPassword}`).digest('hex');

  async function handleHit(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = (await readJson(req, 2048).catch(() => null)) as Record<string, unknown> | null;
    if (isBot(req) || !body) {
      res.writeHead(204).end();
      return;
    }
    const rawPath = typeof body.p === 'string' ? body.p : '/';
    const pagePath = /^\/[a-z0-9/-]{0,60}$/.test(rawPath) ? rawPath.replace(/\/+$/, '') || '/' : '(other)';
    let ref = '';
    try {
      const host = typeof body.r === 'string' && body.r ? new URL(body.r).hostname.replace(/^www\./, '') : '';
      const own = String(req.headers.host || '').split(':')[0].replace(/^www\./, '');
      if (host && host !== own && /^[a-z0-9.-]{1,80}$/i.test(host)) ref = host.toLowerCase();
    } catch {
      // not a URL
    }
    const cc = String(req.headers['x-vercel-ip-country'] || '').toUpperCase();
    const day = new Date().toISOString().slice(0, 10);
    const visitor = crypto
      .createHash('sha256')
      .update(`${visitorSalt}:${day}:${clientIp(req, cfg.trustProxy)}:${req.headers['user-agent'] || ''}`)
      .digest('hex')
      .slice(0, 20);
    await stats.hit({ path: pagePath, ref: ref || undefined, country: /^[A-Z]{2}$/.test(cc) ? cc : undefined, visitor });
    // The uninstall page opens with ?u=1 (set by the extension).
    if (pagePath === '/goodbye' && body.u) await stats.event('uninstall');
    res.writeHead(204).end();
  }

  // ---- admin dashboard -------------------------------------------------------------

  const adminSecret =
    cfg.adminSecret ||
    crypto.createHash('sha256').update(`admin-session:${cfg.adminUser}:${cfg.adminPassword}:${cfg.statsToken}:${cfg.upstreamKey}`).digest('hex');

  function sendHtml(res: http.ServerResponse, status: number, html: string, headers: Record<string, string> = {}): void {
    res.writeHead(status, {
      'Content-Type': MIME['.html'],
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      'Referrer-Policy': 'no-referrer',
      ...headers,
    });
    res.end(html);
  }

  async function readForm(req: http.IncomingMessage): Promise<URLSearchParams> {
    const pre = (req as http.IncomingMessage & { body?: unknown }).body;
    if (pre && typeof pre === 'object' && !Buffer.isBuffer(pre)) return new URLSearchParams(pre as Record<string, string>);
    if (typeof pre === 'string') return new URLSearchParams(pre);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > 4096) throw new HttpError(413, 'invalid_request', 'Request is too large.');
      chunks.push(chunk as Buffer);
    }
    return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  }

  async function handleAdmin(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    if (!cfg.adminPassword) {
      // Not configured: behave like any unknown page.
      serveStatic(req, res, '/__missing__');
      return;
    }
    const secure = req.headers['x-forwarded-proto'] === 'https' || cfg.publicOrigin.startsWith('https:');
    const signedIn = validSession(req.headers.cookie, adminSecret);
    const pathname = url.pathname.replace(/\/+$/, '') || '/admin';

    if (pathname === '/admin/login' && req.method === 'POST') {
      const ip = clientIp(req, cfg.trustProxy);
      const now = Date.now();
      const bucket = Math.floor(now / (15 * 60 * 1000));
      const ipKey = `adm:${ip}:${bucket}`;
      const allKey = `adm:all:${bucket}`;
      const [ipFails, allFails] = await Promise.all([limiter.peek(ipKey, now), limiter.peek(allKey, now)]);
      if (ipFails.count >= 5 || allFails.count >= 50) {
        sendHtml(res, 429, renderLogin({ error: 'Too many attempts. Try again in 15 minutes.' }), { 'Retry-After': '900' });
        return;
      }
      const form = await readForm(req);
      if (credentialsMatch(cfg.adminUser, cfg.adminPassword, form.get('username') || '', form.get('password') || '')) {
        res.writeHead(303, { Location: '/admin', 'Set-Cookie': sessionCookie(makeSession(adminSecret), secure), 'Cache-Control': 'no-store' }).end();
        return;
      }
      await Promise.all([limiter.take(ipKey, now), limiter.take(allKey, now)]);
      sendHtml(res, 401, renderLogin({ error: 'Wrong username or password.' }));
      return;
    }

    if (pathname === '/admin/logout' && req.method === 'POST') {
      res.writeHead(303, { Location: '/admin', 'Set-Cookie': clearedCookie(secure), 'Cache-Control': 'no-store' }).end();
      return;
    }

    if (pathname === '/admin' && (req.method === 'GET' || req.method === 'HEAD')) {
      if (!signedIn) {
        sendHtml(res, 401, renderLogin());
        return;
      }
      const days = [7, 30, 90].includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 30;
      sendHtml(res, 200, renderDashboard(await stats.summary(days), days));
      return;
    }

    // Anything else under /admin: the login page for strangers, a redirect for the admin.
    if (signedIn) res.writeHead(303, { Location: '/admin' }).end();
    else sendHtml(res, 401, renderLogin());
  }

  async function handleFeedback(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const ipKey = `fb:${clientIp(req, cfg.trustProxy)}`;
    if ((await limiter.peek(ipKey)).count >= 10) {
      throw new HttpError(429, 'rate_limited', 'Thanks, we already have your feedback for today.');
    }
    const body = (await readJson(req, 8 * 1024)) as Record<string, unknown> | null;
    const reason = optStr(body?.reason, 100, 'reason') || '';
    const message = optStr(body?.message, 2000, 'message') || '';
    if (!reason.trim() && !message.trim()) throw new HttpError(400, 'invalid_request', 'Feedback is empty.');
    await limiter.take(ipKey);
    const at = new Date().toISOString();
    await stats.feedback({ at, reason, message });
    const entry = JSON.stringify({ at, reason, message });
    if (cfg.feedbackFile) {
      await fs.promises.mkdir(path.dirname(cfg.feedbackFile), { recursive: true });
      await fs.promises.appendFile(cfg.feedbackFile, entry + '\n');
    } else {
      console.log(`[feedback] ${entry}`);
    }
    send(res, 200, { ok: true });
  }

  return Object.assign(handle, { close: () => clearInterval(sweep) });
}
