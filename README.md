# Glossa

The explainer that remembers. Select any text on a web page and see what it means in context, grounded in the page, in Chrome's side panel. Every word you look up joins your own word list, and Glossa underlines it when it shows up again.

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

Memory layer (all on-device):
- **Your words**: every word or short phrase you look up, with each sentence and page where you met it and a look-up count. Search, sort (recent / most looked up / A–Z), filter by site, explain again, export for **Anki** (tab-separated with Anki headers), **CSV**, **Markdown** (Obsidian) or **JSON**. Stored as one `chrome.storage.local` key per entry plus a compact `glossa.terms` index.
- **Review**: a capped recall check (10 per session) on a simple spacing schedule (1, 3, 7, 16, 35, 80 days); looking a word up again restarts it; "known" means recalled 3 times in a row.
- **You met this before**: the underline's hover card shows when and where you last met the word, with that sentence. **Show on page** jumps to a quoted sentence (flash in the open tab, or a text-fragment link). **Weekly recap** in Your words, shareable as a 1200×630 image.
- **Seen it before**: terms from the list get a dotted underline on any page (CSS Custom Highlight API, so the page DOM is never modified); hover shows the saved meaning with **Explain here**. Toggle in Settings or per site in the popup.

Private mode and PDFs:
- **On this device**: answers from Chrome's built-in model via the Prompt API (`src/ai/ondevice.ts`), Chrome 138+ on supported hardware; English, Spanish, Japanese output.
- **Glossa reader** (`reader.html`, `src/reader/`): PDF.js canvas + text layer with the normal content script logic, so selection, ⌥E, the Explain button and underlines work in PDFs. Opens `?url=` (asks for that site's permission) or a picked/dropped file.

Grounding:
- The content script finds where the page itself defines the selection (`Net Interest Margin (NIM)`, `NIM (net interest margin)`, `“Services” means …`, `Acme Inc. (the “Company”)`) and sends it as `pageDefinition`.
- Answers can carry `expansion`, `gloss` (one line in the reader's first language), `confidence`, `basis` and `fromPage`, a quote that is kept only if it really occurs in the text that was sent (`verifyQuote` in `src/shared/prompt.ts`, run on the server and in own-key mode).

Also: meaning in context (sentence + nearby text), pronunciation and part of speech for words, follow-ups (simpler, go deeper, examples, translate, free-form questions), 20 answer languages, reading level and length, history with search / saved items / Markdown and JSON export, read-aloud, response caching, works in iframes and text fields, light/dark/system theme, text size, pause, per-site button toggle, privacy toggle for surrounding text.

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
| `ALLOWED_EXTENSION_IDS` | recommended | `ldhjakhcccihmklmpphhdmfneofjenmd` (fixed by `scripts/extension-key.json`) |
| `PUBLIC_ORIGIN` | recommended | `https://<your-project>.vercel.app` |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | strongly recommended | Shared rate limits across serverless instances (Vercel Marketplace → Upstash). Without them limits are per instance. |
| `DAILY_LIMIT` / `IP_DAILY_LIMIT` / `BURST_PER_MINUTE` | no | Defaults 100 / 400 / 20 |
| `STATS_TOKEN` | no | Long random string. Enables `GET /v1/stats?days=30` (send `Authorization: Bearer <token>`): anonymous daily lookups, follow-ups, repeat lookups, active/new installs, installs with 10+ words, D7/D30 retention per cohort. Counts live in Upstash when configured. |
| `GLOSSA_API_BASE` | no | Only if you use a custom domain: `https://glossa.example.com`. Defaults to the project's production URL. |

Users install from the website: download the zip, unzip, `chrome://extensions` → Developer mode → Load unpacked. Chrome only allows one-click installs from the Chrome Web Store; to publish there, upload `release/glossa-extension-<version>.zip` (remove the `key` field first; the store assigns its own id, then update `ALLOWED_EXTENSION_IDS`).

Self-hosting instead: `npm run build && npm run server` runs the same API and site on one port (behind a proxy, set `TRUST_PROXY=1`).

## Tests

```bash
npm test          # 167 unit + integration tests (capture, page definitions, prompts + quote checks, word list + exports + review, underline matcher, on-device mode, client, storage, server + usage counts)
npm run e2e       # 55 browser tests: loads dist/ into Chromium and drives the real side panel, popup, pages, word list, review, underlines, PDF reader, website playground, and checks Chrome's extension error log
npm run e2e:live  # + real hosted model and real provider key from server/.env
```

The E2E run writes screenshots to `e2e/.artifacts/`.

## Project layout

```
src/
  background/   service worker: shortcut, context menu, capture routing, iframe tracking
  content/      selection capture + page definitions, floating button/toast/saved-meaning card (shadow DOM), "seen it before" underlines
  sidepanel/    main UI: result, follow-ups, your words, history, settings
  popup/        toolbar popup
  welcome/      first-run page with a practice paragraph
  ai/           hosted client, OpenAI-compatible client, Anthropic SDK client, error mapping
  shared/       types, prompts + response normalisation (shared with server), word list logic + exports, storage, catalog
  ui/           design tokens (from DESIGN.md), hooks, markdown renderer
server/src/     API + static site server, anonymous usage counts (stats.ts)
scripts/        build.js, site.mjs (website), icons.mjs
e2e/run.mjs     end-to-end runner
.archive/       the previous circle-gesture version (backup)
```
