/**
 * Single entry point for every AI call the extension makes.
 * Routes to the hosted Glossa API or to the user's own provider key.
 */

import { BRAND, LIMITS } from '../shared/brand';
import { getProvider } from '../shared/catalog';
import {
  buildExplainPrompt,
  buildFollowUpPrompt,
  normalizeExplanation,
  normalizeFollowUp,
} from '../shared/prompt';
import { cacheGet, cachePut } from '../shared/storage';
import { checkQuestion, guardExplanation, scrubExplanation, scrubText } from '../shared/guard';
import type { Explanation, ExplainRequest, FollowUpRequest, Settings } from '../shared/types';
import { anthropicChat } from './anthropic';
import { AiError, toAiError } from './errors';
import { hostedCall } from './hosted';
import { onDeviceChat } from './ondevice';
import { openAiCompatibleChat } from './openai-compatible';

export interface ExplainOutcome {
  result: Explanation;
  source: string;
  cached: boolean;
}

export function sourceLabel(settings: Settings): string {
  if (settings.aiSource === 'hosted') return BRAND.hostedModelLabel;
  if (settings.aiSource === 'on-device') return 'On this device';
  const provider = getProvider(settings.provider);
  return `${provider.label} · ${resolveModel(settings)}`;
}

export function resolveModel(settings: Settings): string {
  const provider = getProvider(settings.provider);
  return (settings.models[settings.provider] || provider.models[0]?.id || '').trim();
}

function resolveEndpoint(settings: Settings): string {
  if (settings.provider === 'custom') {
    const base = settings.customBaseUrl.trim().replace(/\/+$/, '');
    if (!base) return '';
    return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
  }
  return getProvider(settings.provider).endpoint;
}

/** Anonymous signals sent with hosted requests; just "off" when the user opted out. Never text. */
export interface StatsHint {
  repeat?: boolean;
  lexicon?: number;
}

function statsHeaders(settings: Settings, hint: StatsHint = {}): Record<string, string> {
  if (!settings.shareStats) return { 'X-Glossa-Stats': 'off' };
  return { 'X-Glossa-Repeat': hint.repeat ? '1' : '0', 'X-Glossa-Lexicon': String(Math.max(0, Math.floor(hint.lexicon || 0))) };
}

function whoLabel(settings: Settings): string {
  if (settings.aiSource === 'hosted') return 'the Glossa service';
  if (settings.aiSource === 'on-device') return 'The on-device model';
  return getProvider(settings.provider).label;
}

function withTimeout(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(LIMITS.requestTimeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** Calls the user's configured provider with a system+user prompt; returns raw model text. */
async function ownKeyChat(settings: Settings, system: string, user: string, signal: AbortSignal): Promise<string> {
  const provider = getProvider(settings.provider);
  const apiKey = (settings.apiKeys[settings.provider] || '').trim();
  const model = resolveModel(settings);
  if (!apiKey && settings.provider !== 'custom') {
    throw new AiError('no-key', `Add your ${provider.label} API key in Settings, or switch back to the free Glossa service.`);
  }
  if (!model) throw new AiError('bad-request', 'Choose a model in Settings.');

  if (settings.provider === 'anthropic') {
    return anthropicChat({ apiKey, model, system, user, signal });
  }

  const endpoint = resolveEndpoint(settings);
  if (!endpoint) throw new AiError('bad-request', 'Enter the base URL of your custom endpoint in Settings.');

  const extraHeaders: Record<string, string> =
    settings.provider === 'openrouter' ? { 'X-Title': BRAND.name } : {};
  return openAiCompatibleChat({
    endpoint,
    apiKey,
    model,
    system,
    user,
    label: provider.id === 'custom' ? 'Your endpoint' : provider.label,
    signal,
    extraHeaders,
  });
}

function cacheKey(kind: string, settings: Settings, payload: unknown): string {
  const who = settings.aiSource === 'own-key' ? `${settings.provider}:${resolveModel(settings)}` : settings.aiSource;
  return `${kind}:${who}:${fnv1a(JSON.stringify(payload))}`;
}

export async function explain(
  request: ExplainRequest,
  settings: Settings,
  opts: { signal?: AbortSignal; bypassCache?: boolean; stats?: StatsHint } = {}
): Promise<ExplainOutcome> {
  const req: ExplainRequest = {
    ...request,
    text: request.text.slice(0, LIMITS.maxSelectionChars),
    context: settings.includeContext ? request.context?.slice(0, LIMITS.maxContextChars) : undefined,
    sentence: settings.includeContext ? request.sentence?.slice(0, 600) : undefined,
    pageTitle: settings.includeContext ? request.pageTitle?.slice(0, 200) : undefined,
    pageUrl: settings.includeContext ? request.pageUrl : undefined,
    pageDefinition: settings.includeContext ? request.pageDefinition?.slice(0, 300) : undefined,
    nativeLanguage: request.nativeLanguage || undefined,
  };
  if (!req.text.trim()) throw new AiError('bad-request', 'Select some text first.');

  // Typed lookups (no page sentence around them) can be questions aimed at Glossa itself.
  if (!request.sentence && !request.context) {
    const verdict = checkQuestion(req.text);
    if (verdict.blocked) return { result: guardExplanation(verdict.reason), source: sourceLabel(settings), cached: false };
  }

  const key = cacheKey('explain', settings, req);
  if (!opts.bypassCache) {
    const hit = await cacheGet<Explanation>(key);
    if (hit) return { result: hit, source: sourceLabel(settings), cached: true };
  }

  const signal = withTimeout(opts.signal);
  let result: Explanation;
  try {
    if (settings.aiSource === 'hosted') {
      const body = await hostedCall<{ result: Explanation }>('/v1/explain', opts.bypassCache ? { ...req, fresh: true } : req, {
        signal,
        serverUrl: settings.serverUrl,
        headers: statsHeaders(settings, opts.stats),
      });
      if (!body?.result?.meaning) throw new AiError('bad-response', 'The Glossa service returned an empty answer.');
      result = body.result;
    } else {
      const { system, user } = buildExplainPrompt(req);
      const raw =
        settings.aiSource === 'on-device'
          ? await onDeviceChat(system, user, req.language, signal)
          : await ownKeyChat(settings, system, user, signal);
      result = normalizeExplanation(raw, req.text, [req.sentence, req.context, req.pageDefinition].filter(Boolean).join('\n'));
    }
    const userText = [req.text, req.sentence, req.context, req.pageTitle, req.pageDefinition].filter(Boolean).join(' ');
    const ownKey = settings.aiSource === 'own-key' ? [settings.apiKeys[settings.provider] || ''] : [];
    result = scrubExplanation(result, { userText, secrets: ownKey }) || guardExplanation();
  } catch (err) {
    throw toAiError(err, whoLabel(settings));
  }

  await cachePut(key, result);
  return { result, source: sourceLabel(settings), cached: false };
}

export async function followUp(
  request: FollowUpRequest,
  settings: Settings,
  opts: { signal?: AbortSignal; stats?: StatsHint } = {}
): Promise<{ answer: string; source: string }> {
  const req: FollowUpRequest = {
    ...request,
    text: request.text.slice(0, LIMITS.maxSelectionChars),
    context: settings.includeContext ? request.context?.slice(0, LIMITS.maxContextChars) : undefined,
    question: request.question?.slice(0, LIMITS.maxQuestionChars),
  };
  const verdict = checkQuestion(req.question);
  if (verdict.blocked) return { answer: verdict.reply, source: sourceLabel(settings) };
  const userText = [req.text, req.context, req.question].filter(Boolean).join(' ');
  const ownKey = settings.aiSource === 'own-key' ? [settings.apiKeys[settings.provider] || ''] : [];

  const signal = withTimeout(opts.signal);
  try {
    if (settings.aiSource === 'hosted') {
      const body = await hostedCall<{ answer: string }>('/v1/follow-up', req, {
        signal,
        serverUrl: settings.serverUrl,
        headers: statsHeaders(settings, opts.stats),
      });
      if (!body?.answer) throw new AiError('bad-response', 'The Glossa service returned an empty answer.');
      return { answer: scrubText(body.answer, { userText }), source: sourceLabel(settings) };
    }
    const { system, user } = buildFollowUpPrompt(req);
    const raw =
      settings.aiSource === 'on-device'
        ? await onDeviceChat(system, user, req.language, signal)
        : await ownKeyChat(settings, system, user, signal);
    return { answer: scrubText(normalizeFollowUp(raw), { userText, secrets: ownKey }), source: sourceLabel(settings) };
  } catch (err) {
    throw toAiError(err, whoLabel(settings));
  }
}

/** Sends a tiny real request to confirm the key/model/endpoint work. */
export async function testConnection(settings: Settings): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  try {
    const out = await explain(
      { text: 'serendipity', level: 'standard', length: 'brief', language: 'English' },
      settings,
      { bypassCache: true }
    );
    return { ok: true, message: `Connected. ${out.source} answered: “${truncate(out.result.meaning, 90)}”` };
  } catch (err) {
    return { ok: false, message: toAiError(err, 'provider').message };
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + input.length.toString(36);
}
