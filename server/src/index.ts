import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configFromEnv, createServer } from './app';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');

// Minimal .env loader (KEY=VALUE per line); real environment variables win.
const envFile = path.join(serverRoot, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const cfg = configFromEnv(process.env, path.resolve(serverRoot, '..', 'website'));
if (!cfg.upstreamKey) {
  console.warn('UPSTREAM_API_KEY is not set. /v1/explain will return 503 until it is.');
}

const server = createServer(cfg);
server.listen(cfg.port, () => {
  console.log(`Glossa server on http://localhost:${cfg.port}  (daily limit ${cfg.dailyLimit}/install)`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
