/**
 * Builds the Chrome extension into dist/ and the server into server/dist/.
 *
 *   GLOSSA_API_BASE      hosted API origin baked into the extension (default http://localhost:7717)
 *   GLOSSA_WEBSITE_URL   marketing site origin (default = API base)
 *   GLOSSA_OUT           output folder for the extension (default dist)
 *
 * On Vercel (VERCEL=1) or with --vercel it also writes .vercel/output (Build Output API):
 * the static site plus the API as a serverless function. The extension zip is then built
 * against https://$VERCEL_PROJECT_PRODUCTION_URL unless GLOSSA_API_BASE is set.
 */

import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { build as esbuild } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { zipDirectory } from './zip.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const onVercel = !!process.env.VERCEL || process.argv.includes('--vercel');
const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
const apiBase = (process.env.GLOSSA_API_BASE || (onVercel && vercelUrl ? `https://${vercelUrl}` : 'http://localhost:7717')).replace(/\/+$/, '');
// Public key only: pins the extension id so the API can be locked to it (ALLOWED_EXTENSION_IDS).
const extensionKey = JSON.parse(fs.readFileSync(path.join(root, 'scripts/extension-key.json'), 'utf8'));
const websiteUrl = (process.env.GLOSSA_WEBSITE_URL || apiBase).replace(/\/+$/, '');
const outDir = path.resolve(root, process.env.GLOSSA_OUT || 'dist');

const define = {
  __API_BASE__: JSON.stringify(apiBase),
  __WEBSITE_URL__: JSON.stringify(websiteUrl),
  __VERSION__: JSON.stringify(pkg.version),
};

const quiet = { logLevel: 'warn' };

async function main() {
  const t0 = Date.now();
  fs.rmSync(outDir, { recursive: true, force: true });

  // 1. Extension pages (React)
  await build({
    ...quiet,
    configFile: false,
    root,
    base: './',
    plugins: [react()],
    define,
    build: {
      outDir,
      emptyOutDir: false,
      target: 'chrome116',
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        input: {
          sidepanel: path.join(root, 'sidepanel.html'),
          popup: path.join(root, 'popup.html'),
          welcome: path.join(root, 'welcome.html'),
        },
      },
    },
  });

  // 2. Content script: one self-contained classic script
  await build({
    ...quiet,
    configFile: false,
    root,
    define,
    build: {
      outDir,
      emptyOutDir: false,
      target: 'chrome116',
      lib: { entry: path.join(root, 'src/content/index.ts'), name: 'GlossaContent', formats: ['iife'], fileName: () => 'content.js' },
    },
  });

  // 3. Background service worker (ES module)
  await build({
    ...quiet,
    configFile: false,
    root,
    define,
    build: {
      outDir,
      emptyOutDir: false,
      target: 'chrome116',
      lib: { entry: path.join(root, 'src/background/index.ts'), formats: ['es'], fileName: () => 'background.js' },
    },
  });

  // 4. Icons
  fs.cpSync(path.join(root, 'public/icons'), path.join(outDir, 'icons'), { recursive: true });

  // 5. Manifest
  const apiOrigin = new URL(apiBase).origin;
  const manifest = {
    manifest_version: 3,
    key: extensionKey.key,
    name: 'Glossa: explain any text',
    short_name: 'Glossa',
    version: pkg.version,
    description: 'Select any word or passage on a web page and see what it means in context, in your side panel.',
    minimum_chrome_version: '116',
    icons: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
    action: {
      default_popup: 'popup.html',
      default_title: 'Glossa',
      default_icon: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png' },
    },
    side_panel: { default_path: 'sidepanel.html' },
    background: { service_worker: 'background.js', type: 'module' },
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['content.js'],
        run_at: 'document_idle',
        all_frames: true,
        match_about_blank: true,
      },
    ],
    permissions: ['sidePanel', 'storage', 'activeTab', 'scripting', 'contextMenus', 'favicon'],
    host_permissions: [
      `${apiOrigin}/*`,
      'https://api.openai.com/*',
      'https://api.anthropic.com/*',
      'https://api.groq.com/*',
      'https://generativelanguage.googleapis.com/*',
      'https://openrouter.ai/*',
    ],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    commands: {
      'explain-selection': {
        suggested_key: { default: 'Alt+E', mac: 'Alt+E' },
        description: 'Explain the selected text',
      },
      'open-panel': {
        suggested_key: { default: 'Alt+Shift+E', mac: 'Alt+Shift+E' },
        description: 'Open the Glossa side panel',
      },
    },
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  // 6. Server bundle (single file, no runtime deps)
  await esbuild({
    entryPoints: [path.join(root, 'server/src/index.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: path.join(root, 'server/dist/server.mjs'),
    logLevel: 'warning',
  });

  // 7. Static website + its playground bundle (same-origin API, so the base is empty)
  execFileSync(process.execPath, [path.join(root, 'scripts/site.mjs')], { stdio: 'inherit' });
  await esbuild({
    entryPoints: [path.join(root, 'src/site/playground.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    outfile: path.join(root, 'website/assets/playground.js'),
    define: { __API_BASE__: '""', __WEBSITE_URL__: '""', __VERSION__: JSON.stringify(pkg.version) },
    logLevel: 'warning',
  });
  await esbuild({
    entryPoints: [path.join(root, 'src/site/analytics.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    outfile: path.join(root, 'website/assets/analytics.js'),
    logLevel: 'warning',
  });

  // 8. Release zip (for the Web Store upload and the website's download link)
  if (!process.env.GLOSSA_OUT) {
    const zipPath = path.join(root, 'release', `glossa-extension-${pkg.version}.zip`);
    zipDirectory(outDir, zipPath);
    fs.mkdirSync(path.join(root, 'website/download'), { recursive: true });
    fs.copyFileSync(zipPath, path.join(root, 'website/download/glossa-extension.zip'));
  }

  // 9. Vercel Build Output API: static site + API function
  if (onVercel) await writeVercelOutput();

  console.log(`Built extension → ${path.relative(root, outDir)}/  (API ${apiBase})  in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

async function writeVercelOutput() {
  const out = path.join(root, '.vercel/output');
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(path.join(root, 'website'), path.join(out, 'static'), { recursive: true });

  const fn = path.join(out, 'functions/api.func');
  await esbuild({
    entryPoints: [path.join(root, 'server/src/vercel.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: path.join(fn, 'index.mjs'),
    logLevel: 'warning',
  });
  fs.writeFileSync(
    path.join(fn, '.vc-config.json'),
    JSON.stringify({ runtime: 'nodejs20.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 30 }, null, 2)
  );
  fs.writeFileSync(path.join(fn, 'package.json'), JSON.stringify({ type: 'module' }));

  const csp =
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self' https://api.openai.com https://api.anthropic.com https://api.groq.com https://generativelanguage.googleapis.com https://openrouter.ai; frame-ancestors 'self'";
  const config = {
    version: 3,
    routes: [
      {
        src: '/(.*)',
        headers: {
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'X-Frame-Options': 'SAMEORIGIN',
          'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
          'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
          'Content-Security-Policy': csp,
        },
        continue: true,
      },
      { src: '/assets/(.*)', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
      { src: '/download/(.*)', headers: { 'Cache-Control': 'no-cache', 'Content-Disposition': 'attachment' }, continue: true },
      { src: '/health', dest: '/api?__path=/health' },
      { src: '/v1/(.*)', dest: '/api?__path=/v1/$1' },
      { src: '/api(?:/.*)?', status: 404, dest: '/404.html' },
      { handle: 'filesystem' },
      { src: '/(install|privacy|terms|goodbye|demo)/?', dest: '/$1.html' },
      { handle: 'error' },
      { src: '/.*', status: 404, dest: '/404.html' },
    ],
  };
  fs.writeFileSync(path.join(out, 'config.json'), JSON.stringify(config, null, 2));
  console.log(`Vercel output → .vercel/output (extension points at ${apiBase})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
