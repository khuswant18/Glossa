import Anthropic from '@anthropic-ai/sdk';
import { AiError, toAiError } from './errors';

// Models that accept output_config.effort; Haiku 4.5 rejects it.
const EFFORT_MODELS = /^claude-(opus-5|sonnet-5|fable-5)/;
// Models where Anthropic recommends opting into server-side refusal fallbacks.
const FALLBACK_MODELS = /^claude-(opus-5|fable-5)/;

export async function anthropicChat(opts: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  signal?: AbortSignal;
}): Promise<string> {
  const client = new Anthropic({
    apiKey: opts.apiKey.trim(),
    // The key belongs to the person running the extension and never leaves their browser.
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
  });

  const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
    model: opts.model,
    max_tokens: 16000,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
  };
  if (EFFORT_MODELS.test(opts.model)) {
    // Looking up a meaning is a simple task; low effort keeps answers fast.
    params.output_config = { effort: 'low' };
  }
  if (FALLBACK_MODELS.test(opts.model)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }

  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await client.beta.messages.create(params, { signal: opts.signal });
  } catch (err) {
    throw mapAnthropicError(err);
  }

  if (response.stop_reason === 'refusal') {
    throw new AiError('refused', 'Claude declined to explain this selection.');
  }

  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (!text.trim()) {
    throw new AiError('bad-response', 'Anthropic returned an empty answer. Try again.');
  }
  return text;
}

function mapAnthropicError(err: unknown): AiError {
  const who = 'Anthropic';
  if (err instanceof Anthropic.APIUserAbortError) return new AiError('aborted', 'Request cancelled.');
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiError('timeout', `${who} took too long to answer. Try again.`);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AiError('network', `Could not reach ${who}. Check your connection and try again.`);
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AiError('bad-key', `${who} rejected the API key. Check it in Settings.`);
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new AiError('bad-request', `${who} could not find that model. Pick a different model in Settings.`);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AiError('rate-limit', `${who} is rate limiting this key. Wait a moment and try again.`);
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new AiError('bad-request', `${who} rejected the request: ${err.message.slice(0, 160)}`);
  }
  if (err instanceof Anthropic.APIError) {
    return new AiError('server', `${who} is having trouble right now (${err.status ?? 'error'}). Try again shortly.`);
  }
  return toAiError(err, who);
}
