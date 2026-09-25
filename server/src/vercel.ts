/**
 * Vercel serverless entry. Bundled by scripts/build.js into .vercel/output/functions/api.func.
 * Reuses the exact same handler as the standalone server; config comes from Vercel env vars.
 */
import type http from 'node:http';
import { configFromEnv, createHandler } from './app';

const handler = createHandler(configFromEnv(process.env, ''));

export default async function vercelHandler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // Routes rewrite /v1/* and /health here with the original path in ?__path=.
  const url = new URL(req.url || '/', 'http://local');
  const original = url.searchParams.get('__path');
  if (original) {
    url.searchParams.delete('__path');
    const rest = url.searchParams.toString();
    req.url = `${original}${rest ? `?${rest}` : ''}`;
  }
  await handler(req, res);
}
