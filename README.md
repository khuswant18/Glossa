# Glossa

Select any text on a web page and see what it means in context, in Chrome's side panel.

Three parts live in this repo:

| Part | Where | What it is |
|---|---|---|
| Extension | `src/`, built to `dist/` | Manifest V3 Chrome extension: content script, service worker, side panel, popup, welcome page |
| Server | `server/src/`, built to `server/dist/server.mjs` | Zero-dependency Node server: hosted AI API (free tier) + the website |
| Website | generated into `website/` by `scripts/site.mjs` (+ `src/site/playground.ts`) | Landing page with a live playground (free or your own key), install, privacy, terms, feedback, practice page |

## Quick start

```bash
npm install
cp server/.env.example server/.env   # add UPSTREAM_API_KEY
npm run build                        # typecheck + build extension, server, website, release zip
npm run server                       # http://localhost:7717 (API + website)
```

The server defaults to port 7717 (8787 is often taken by other local apps). Load the extension: `chrome://extensions` → Developer mode → **Load unpacked** → choose `dist/`.

## Using it

- Select text, then press **⌥E** (Mac) / **Alt+E**: the side panel opens with the meaning.
- Or click the small **Explain** button that appears next to a selection, or right-click → **Explain “…”**.
- **⌥⇧E** / **Alt+Shift+E** opens the side panel. The toolbar popup does quick lookups, pause, and per-site toggles.

Features: meaning in context (sentence + nearby text), pronunciation and part of speech for words, follow-ups (simpler, go deeper, examples, translate, free-form questions), 20 answer languages, reading level and length, history with search / saved items / Markdown and JSON export, read-aloud, response caching, works in iframes and text fields, light/dark/system theme, text size, pause, per-site button toggle, privacy toggle for surrounding text.

## AI modes

- **Glossa (free)**: the extension calls `POST /v1/explain` and `/v1/follow-up` on the Glossa server. The upstream provider, model and key live only in `server/.env`; responses never name them. Limits: `DAILY_LIMIT` per install, `IP_DAILY_LIMIT` per IP, `BURST_PER_MINUTE`. Failed answers don't count against quota.
- **Own key**: OpenAI, Anthropic, Groq, Gemini, OpenRouter or any OpenAI-compatible endpoint. The key stays in `chrome.storage.local` and goes straight to that provider.

## Deploying to Vercel

The whole product deploys as one Vercel project: the website is static, `/v1/*` runs as a serverless function, and the build puts a ready-to-load extension zip at `/download/glossa-extension.zip`, already pointed at your deployment.

1. Import this repo in Vercel. `vercel.json` sets the install and build commands; leave Framework as "Other".
2. Add the environment variables below (Production), then deploy.
3. Open `https://<your-project>.vercel.app/health`: it should return `{"ok":true,"service":"glossa"}`.

| Variable | Required | Example / notes |
|---|---|---|
| `UPSTREAM_URL` | yes | Your provider's OpenAI-compatible `/chat/completions` URL |
| `UPSTREAM_API_KEY` | yes | Your provider key. Server-only. |
| `UPSTREAM_MODEL` | yes | Main model id |
| `UPSTREAM_FALLBACK_MODEL` | no | Used when the main model is busy |
| `ALLOWED_EXTENSION_IDS` | recommended | `ldhjakhcccihmklmpphhdmfneofjenmd` (fixed by `public/extension-key.json`) |
| `PUBLIC_ORIGIN` | recommended | `https://<your-project>.vercel.app` |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | strongly recommended | Shared rate limits across serverless instances (Vercel Marketplace → Upstash). Without them limits are per instance. |
| `DAILY_LIMIT` / `IP_DAILY_LIMIT` / `BURST_PER_MINUTE` | no | Defaults 100 / 400 / 20 |
| `GLOSSA_API_BASE` | no | Only if you use a custom domain: `https://glossa.example.com`. Defaults to the project's production URL. |

Users install from the website: download the zip, unzip, `chrome://extensions` → Developer mode → Load unpacked. Chrome only allows one-click installs from the Chrome Web Store; to publish there, upload `release/glossa-extension-<version>.zip` (remove the `key` field first; the store assigns its own id, then update `ALLOWED_EXTENSION_IDS`).

Self-hosting instead: `npm run build && npm run server` runs the same API and site on one port (behind a proxy, set `TRUST_PROXY=1`).

## Tests

```bash
npm test          # 125 unit + integration tests (capture, prompts, client, storage, server)
npm run e2e       # 43 browser tests: loads dist/ into Chromium and drives the real side panel, popup, pages, website playground, and checks Chrome's extension error log
npm run e2e:live  # + real hosted model and real provider key from server/.env
```

The E2E run writes screenshots to `e2e/.artifacts/`.

## Project layout

```
src/
  background/   service worker: shortcut, context menu, capture routing, iframe tracking
  content/      selection capture (exact Range/Selection) + floating button/toast (shadow DOM)
  sidepanel/    main UI: result, follow-ups, history, settings
  popup/        toolbar popup
  welcome/      first-run page with a practice paragraph
  ai/           hosted client, OpenAI-compatible client, Anthropic SDK client, error mapping
  shared/       types, prompts + response normalisation (shared with server), storage, catalog
  ui/           design tokens (from DESIGN.md), hooks, markdown renderer
server/src/     API + static site server
scripts/        build.js, site.mjs (website), icons.mjs
e2e/run.mjs     end-to-end runner
.archive/       the previous circle-gesture version (backup)
```
