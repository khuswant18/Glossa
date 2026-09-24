import { AiError, httpError, toAiError } from './errors';

export interface ChatCall {
  endpoint: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  label: string;
  signal?: AbortSignal;
  maxTokens?: number;
  extraHeaders?: Record<string, string>;
}

/** One chat completion against any OpenAI-compatible endpoint. Returns the raw text content. */
export async function openAiCompatibleChat(call: ChatCall): Promise<string> {
  const body: Record<string, unknown> = {
    model: call.model,
    messages: [
      { role: 'system', content: call.system },
      { role: 'user', content: call.user },
    ],
    temperature: 0.2,
    max_tokens: call.maxTokens ?? 900,
    response_format: { type: 'json_object' },
  };

  let res: Response;
  try {
    res = await fetch(call.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${call.apiKey.trim()}`,
        ...(call.extraHeaders || {}),
      },
      body: JSON.stringify(body),
      signal: call.signal,
    });
  } catch (err) {
    throw toAiError(err, call.label);
  }

  // Some OpenAI-compatible servers don't support response_format; retry once without it.
  if (res.status === 400) {
    const detail = await readError(res);
    if (/response_format|json_object|json mode/i.test(detail)) {
      delete body.response_format;
      try {
        res = await fetch(call.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${call.apiKey.trim()}`,
            ...(call.extraHeaders || {}),
          },
          body: JSON.stringify(body),
          signal: call.signal,
        });
      } catch (err) {
        throw toAiError(err, call.label);
      }
    } else {
      throw httpError(400, call.label, detail);
    }
  }

  if (!res.ok) {
    throw httpError(res.status, call.label, await readError(res), res.headers.get('retry-after'));
  }

  let data: { choices?: { message?: { content?: string } }[] };
  try {
    data = await res.json();
  } catch {
    throw new AiError('bad-response', `${call.label} sent a response we could not read.`);
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content || !content.trim()) {
    throw new AiError('bad-response', `${call.label} returned an empty answer. Try again.`);
  }
  return content;
}

async function readError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      return String(json?.error?.message || json?.message || '').slice(0, 200);
    } catch {
      return text.slice(0, 200);
    }
  } catch {
    return '';
  }
}
