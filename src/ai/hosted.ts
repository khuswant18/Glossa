import { API_BASE, VERSION } from '../shared/brand';
import { getInstallId, setQuota } from '../shared/storage';
import type { Quota } from '../shared/types';
import { AiError, toAiError } from './errors';

const WHO = 'the Glossa service';

export function hostedBase(serverUrlOverride?: string): string {
  const base = (serverUrlOverride || API_BASE).trim().replace(/\/+$/, '');
  return base;
}

/** POST to the hosted API. The server owns the model choice and credentials. */
export async function hostedCall<T>(
  path: '/v1/explain' | '/v1/follow-up',
  payload: unknown,
  opts: { signal?: AbortSignal; serverUrl?: string }
): Promise<T> {
  const installId = await getInstallId();
  let res: Response;
  try {
    res = await fetch(`${hostedBase(opts.serverUrl)}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Glossa-Install': installId,
        'X-Glossa-Version': VERSION,
      },
      body: JSON.stringify(payload),
      signal: opts.signal,
    });
  } catch (err) {
    throw toAiError(err, WHO);
  }

  const quota = readQuota(res.headers);
  if (quota) await setQuota(quota);

  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    // Something else is listening at this address (another local app, a captive portal, a proxy page).
    throw new AiError(
      'network',
      `${hostedBase(opts.serverUrl)} isn’t the Glossa service (it answered with a web page). Start the Glossa server, or add your own API key in Settings.`
    );
  }
  let body: { error?: { code?: string; message?: string } } & Record<string, unknown>;
  try {
    body = await res.json();
  } catch {
    throw new AiError('server', `${WHO} sent a response we could not read. Try again.`);
  }

  if (!res.ok) {
    const code = body?.error?.code;
    const message = body?.error?.message || `Request failed (${res.status}).`;
    const retry = Number(res.headers.get('retry-after')) || undefined;
    if (code === 'quota_exceeded') throw new AiError('quota', message, retry);
    if (code === 'rate_limited') throw new AiError('rate-limit', message, retry);
    if (code === 'invalid_request') throw new AiError('bad-request', message);
    if (code === 'timeout') throw new AiError('timeout', message);
    throw new AiError('server', message);
  }
  return body as T;
}

export async function fetchUsage(serverUrl?: string): Promise<Quota | undefined> {
  try {
    const installId = await getInstallId();
    const res = await fetch(`${hostedBase(serverUrl)}/v1/usage`, {
      headers: { 'X-Glossa-Install': installId },
    });
    if (!res.ok) return undefined;
    const quota = readQuota(res.headers);
    if (quota) await setQuota(quota);
    return quota;
  } catch {
    return undefined;
  }
}

function readQuota(headers: Headers): Quota | undefined {
  const limit = Number(headers.get('x-quota-limit'));
  const remaining = Number(headers.get('x-quota-remaining'));
  const reset = Number(headers.get('x-quota-reset'));
  if (!Number.isFinite(limit) || !headers.has('x-quota-limit')) return undefined;
  return { limit, remaining: Math.max(0, remaining), resetAt: reset * 1000 };
}
