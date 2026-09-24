export type AiErrorCode =
  | 'no-key'
  | 'bad-key'
  | 'quota'
  | 'rate-limit'
  | 'network'
  | 'timeout'
  | 'server'
  | 'bad-request'
  | 'bad-response'
  | 'aborted'
  | 'permission'
  | 'refused';

export class AiError extends Error {
  code: AiErrorCode;
  retryAfterSec?: number;

  constructor(code: AiErrorCode, message: string, retryAfterSec?: number) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

export function toAiError(err: unknown, who: string): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof DOMException && err.name === 'AbortError') {
    return new AiError('aborted', 'Request cancelled.');
  }
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return new AiError('timeout', `${who} took too long to answer. Try again.`);
  }
  if (err instanceof TypeError) {
    // fetch() network failures surface as TypeError.
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    return new AiError(
      'network',
      offline ? 'You appear to be offline. Check your connection and try again.' : `Could not reach ${who}. Check your connection and try again.`
    );
  }
  if (err instanceof Error && err.name === 'MalformedResponseError') {
    return new AiError('bad-response', err.message);
  }
  return new AiError('server', err instanceof Error ? err.message : String(err));
}

/** Maps an HTTP status from a provider to a user-facing error. */
export function httpError(status: number, who: string, detail?: string, retryAfter?: string | null): AiError {
  const retry = retryAfter ? Number(retryAfter) || undefined : undefined;
  if (status === 401 || status === 403) {
    return new AiError('bad-key', `${who} rejected the API key. Check it in Settings.`);
  }
  if (status === 402) return new AiError('quota', `${who} says this key has no credit left.`);
  if (status === 404) return new AiError('bad-request', `${who} could not find that model. Pick a different model in Settings.`);
  if (status === 429) {
    return new AiError('rate-limit', `${who} is rate limiting this key. Wait a moment and try again.`, retry);
  }
  if (status === 400 || status === 422) {
    return new AiError('bad-request', `${who} rejected the request${detail ? `: ${detail}` : '.'}`);
  }
  return new AiError('server', `${who} is having trouble right now (${status}). Try again shortly.`);
}
