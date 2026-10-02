/**
 * Generates the static marketing site in website/.
 * Hand-written: website/site.css. Built separately: website/assets/playground.js (see build.js).
 * Run automatically by scripts/build.js; alone with: node scripts/site.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'website');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const YEAR = new Date().getFullYear();
// Absolute site URL for the sitemap (same rule as build.js: explicit setting, then the Vercel production domain).
const SITE_URL = (
  process.env.GLOSSA_WEBSITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:7717')
).replace(/\/+$/, '');
const TODAY = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

const MARK = (size = 28) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="5" fill="#dceeb1"/><rect x="5" y="6" width="14" height="2.2" rx="1.1" fill="#000" opacity=".35"/><rect x="5" y="10.9" width="14" height="2.2" rx="1.1" fill="#000"/><rect x="5" y="15.8" width="9" height="2.2" rx="1.1" fill="#000" opacity=".35"/></svg>`;

const icon = (d) =>
  `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const ICONS = {
  context: icon('<path d="M4 6h16M4 12h10M4 18h7"/><path d="M17 15l3 3-3 3"/>'),
  lang: icon('<path d="M4 5h8M8 3v2M5.5 5c1 3.5 3.5 6 7 7.5M11 5c-.8 4-3.2 7-6.5 8.5"/><path d="M13 21l4-9 4 9M14.5 18h5"/>'),
  follow: icon('<path d="M21 12a8 8 0 1 1-3.1-6.3"/><path d="M21 4v5h-5"/>'),
  sound: icon('<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
  history: icon('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'),
  export: icon('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),
  byok: icon('<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M16 7l3 3M14 9l2 2"/>'),
  frame: icon('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 9v11"/>'),
  seen: icon('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M5 21h14" stroke-dasharray="1.5 2.5"/>'),
  book: icon('<path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M8 7h7M8 11h5"/>'),
  quote: icon('<path d="M7 7h4v4c0 3-2 5-4 6M15 7h4v4c0 3-2 5-4 6"/>'),
  keyboard: icon('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
  x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  coffee: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 3.5c-.6.8-.6 1.7 0 2.5M12 3.5c-.6.8-.6 1.7 0 2.5"/></svg>',
  menu: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
};

// The playground calls providers straight from the visitor's browser; CSP in server/src/app.ts allows these.
const head = (title, description, { playground = false } = {}) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="theme-color" content="#ffffff">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:image" content="/icon128.png">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300..700&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/site.css">
<script src="/boot.js"></script>
<script src="/site.js" defer></script>
<script src="/assets/analytics.js" type="module"></script>
${playground ? '<script src="/assets/playground.js" type="module"></script>\n' : ''}</head>
<body>`;

const TWITTER_URL = 'https://x.com/KhuswantRa45688';
const COFFEE_URL = 'https://buymeacoffee.com/khuswant18';
const ext = 'target="_blank" rel="noopener noreferrer"';

const nav = `
<header class="nav" id="nav">
  <div class="wrap">
    <a class="brand" href="/">${MARK()}<span>Glossa</span></a>
    <nav class="nav-links" id="nav-links" aria-label="Main">
      <a href="/#how">How it works</a>
      <a href="/#try">Try it</a>
      <a href="/#features">Features</a>
      <a href="/#pricing">Pricing</a>
      <a href="/#faq">FAQ</a>
      <a class="nav-extra" href="${TWITTER_URL}" ${ext}>Follow on X</a>
      <a class="nav-extra" href="${COFFEE_URL}" ${ext}>Buy me a coffee</a>
    </nav>
    <span class="spacer"></span>
    <div class="nav-ctas">
      <a class="icon-btn nav-x" href="${TWITTER_URL}" ${ext} aria-label="Follow me on X" title="Follow me on X">${ICONS.x}</a>
      <a class="pill pill-coffee nav-coffee" href="${COFFEE_URL}" ${ext} aria-label="Buy me a coffee" title="Buy me a coffee">${ICONS.coffee}<span>Buy me a coffee</span></a>
      <a class="pill pill-white" href="/#try">Try it live</a>
      <a class="pill pill-black" href="/install">Add to Chrome</a>
    </div>
    <button class="nav-toggle" id="nav-toggle" aria-label="Open menu" aria-expanded="false" aria-controls="nav-links">${ICONS.menu}</button>
  </div>
</header>`;

const footer = `
<footer class="footer">
  <div class="wrap">
    <div class="support">
      <div>
        <p class="support-title">Glossa is built by one person.</p>
        <p class="support-sub">If it saves you a few tabs, a coffee keeps it going. Questions or ideas? Message me on X.</p>
      </div>
      <div class="support-ctas">
        <a class="pill pill-coffee" href="${COFFEE_URL}" ${ext}>${ICONS.coffee}<span>Buy me a coffee</span></a>
        <a class="pill pill-black" href="${TWITTER_URL}" ${ext}>${ICONS.x}<span>Follow on X</span></a>
      </div>
    </div>
    <div class="cols">
      <div>
        <p class="wordmark">Glossa</p>
        <p class="blurb">The explainer that remembers. Select any text on the web, understand it in context, keep every word.</p>
      </div>
      <div>
        <h4>Product</h4>
        <ul>
          <li><a href="/#features">Features</a></li>
          <li><a href="/#try">Try it live</a></li>
          <li><a href="/#pricing">Pricing</a></li>
          <li><a href="/install">Install</a></li>
        </ul>
      </div>
      <div>
        <h4>Help</h4>
        <ul>
          <li><a href="/#faq">FAQ</a></li>
          <li><a href="/install#shortcut">Keyboard shortcut</a></li>
          <li><a href="/install#own-key">Use your own key</a></li>
          <li><a href="/demo">Practice page</a></li>
          <li><a href="/goodbye">Send feedback</a></li>
        </ul>
      </div>
      <div>
        <h4>Legal</h4>
        <ul>
          <li><a href="/privacy">Privacy policy</a></li>
          <li><a href="/terms">Terms of use</a></li>
        </ul>
      </div>
      <div>
        <h4>Connect</h4>
        <ul>
          <li><a href="${TWITTER_URL}" ${ext}>X (Twitter)</a></li>
          <li><a href="${COFFEE_URL}" ${ext}>Buy me a coffee</a></li>
        </ul>
      </div>
    </div>
    <div class="legal">
      <span>© ${YEAR} Glossa</span>
      <span>Version ${pkg.version}</span>
    </div>
  </div>
</footer>
</body>
</html>
`;

const page = (title, description, body, opts) => head(title, description, opts) + nav + body + footer;

const MARQUEE_WORDS = [
  'idempotent', 'priced in', 'Schadenfreude', 'force majeure', 'bioavailability', 'yield curve', 'jitter',
  'indemnification', 'backpropagation', 'pro rata', 'zeitgeist', 'thundering herd', 'estoppel', 'quantitative easing',
];
const marquee = `<div class="marquee" aria-hidden="true"><div class="marquee-track">${[...MARQUEE_WORDS, ...MARQUEE_WORDS]
  .map((w) => `<span>${w}</span>`)
  .join('')}</div></div>`;

// ---------------------------------------------------------------------------

const index = page(
  'Glossa · The explainer that remembers',
  'A Chrome extension that explains any word, acronym or passage you select, grounded in the page, and keeps every word you look up in your own word list. Free, no API key needed.',
  `
<main>
<section class="hero">
  <div class="wrap">
    <p class="eyebrow">Chrome extension · The explainer that remembers</p>
    <h1>Select any text.<br>Understand it. Keep it.</h1>
    <p class="lede">Glossa explains a word, an acronym or a whole passage using the page around it, and shows you the line it’s based on. Every word you look up joins your own word list, and the next time it shows up, anywhere, it’s already underlined.</p>
    <div class="cta-row">
      <a class="pill pill-black" href="/install">Add to Chrome, it’s free</a>
      <a class="pill pill-outline" href="#try">Try it without installing</a>
    </div>
    <p class="cta-note">No API key needed · No account · Chrome, Edge, Brave, Arc</p>

    <div class="stage reveal" aria-label="Animation: a phrase is selected, the Explain button appears, and the side panel shows its meaning">
      <div class="browser">
        <div class="browser-bar"><i></i><i></i><i></i><span class="url">finance-weekly.com/rate-day</span></div>
        <div class="mk-page">
          <p class="caption">Markets · 4 min read</p>
          <h4>Why markets barely moved on rate day</h4>
          <p>With a quarter-point cut already <span class="mk-hl">priced in</span>, traders shrugged at the announcement and bond yields held steady into the close.</p>
          <span class="mk-chip">Explain <kbd>⌥E</kbd></span>
        </div>
        <div class="mk-panel">
          <div class="caption"><span>Glossa</span><span>Side panel</span></div>
          <div class="mk-card">
            <h5>priced in</h5>
            <span class="tag">Phrase</span>
            <p>Traders already expected the rate cut, so it was reflected in prices before it was announced.</p>
            <p class="mk-from"><span>From the page</span>“a quarter-point cut already priced in”</p>
          </div>
          <div class="mk-chips"><span>Simpler</span><span>Go deeper</span><span>Examples</span><span>Translate</span></div>
        </div>
      </div>
    </div>
  </div>
  ${marquee}
</section>

<section class="section" id="how">
  <div class="wrap">
    <div class="section-head reveal">
      <p class="eyebrow">How it works</p>
      <h2>Select. Understand. Remember.</h2>
      <p class="sub">Glossa lives in Chrome’s side panel, so the page you’re reading never moves.</p>
    </div>
    <div class="steps">
      <div class="tile reveal"><span class="caption">01 · Select</span><h3>Highlight anything</h3><p>One word, an acronym, a line of code, a legal clause, a whole paragraph. Then press one key or click Explain.</p><div class="keys"><kbd>⌥ Option</kbd> + <kbd>E</kbd> on Mac · <kbd>Alt</kbd> + <kbd>E</kbd> on Windows</div></div>
      <div class="tile reveal"><span class="caption">02 · Understand</span><h3>Grounded in the page</h3><p>The meaning that fits this sentence, in your language and level. If the page defines the term, Glossa uses that and quotes it.</p></div>
      <div class="tile reveal"><span class="caption">03 · Remember</span><h3>It’s in your words</h3><p>Every lookup is saved with its sentence and page. When the word appears again, it gets a quiet underline. Hover to recall.</p></div>
    </div>
  </div>
</section>

<section class="section" id="try">
  <div class="wrap">
    <div class="block block-lime reveal">
      <div class="pg" id="pg">
        <div>
          <p class="eyebrow">Try it right here</p>
          <h2>Select any word below.</h2>
          <div class="pg-text" id="pg-text" data-glossa-native>
            <p>After the merger, the board adopted a <b>poison pill</b> to deter a hostile bid, and the stock rallied on hopes of a white knight.</p>
            <p>Our API retries are idempotent, so a flaky network can’t double-charge anyone.</p>
            <p>She felt a quiet Schadenfreude watching the rival’s launch stall.</p>
          </div>
          <form class="pg-form" id="pg-form">
            <input id="pg-input" type="text" placeholder="Or type a word or phrase" maxlength="200" aria-label="Word or phrase to explain" autocomplete="off">
            <button class="pill pill-black" type="submit">Explain</button>
          </form>
        </div>
        <div class="pg-side">
          <div class="tabs" role="tablist" aria-label="Where answers come from">
            <button type="button" role="tab" data-mode="hosted" aria-selected="true">Glossa free</button>
            <button type="button" role="tab" data-mode="own-key" aria-selected="false">Your own key</button>
          </div>
          <div class="pg-key" id="pg-key" hidden>
            <div class="pg-row">
              <label class="pg-field">Provider<select id="pg-provider"></select></label>
              <label class="pg-field">Model<select id="pg-model"></select></label>
            </div>
            <label class="pg-field">API key<input id="pg-apikey" type="password" autocomplete="off" spellcheck="false"></label>
            <div class="pg-key-actions">
              <button class="pill pill-black pill-sm" type="button" id="pg-test">Save and test</button>
              <label><input type="checkbox" id="pg-remember"> Remember on this device</label>
              <button class="linkbtn" type="button" id="pg-forget" hidden>Forget key</button>
            </div>
            <div id="pg-key-status" role="status"></div>
            <p class="pg-key-note">Your key goes straight from this browser to the provider, never to our servers. <a id="pg-keylink" href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">Get a key</a></p>
          </div>
          <label class="pg-field" style="max-width:240px">Explain in
            <select id="pg-lang">
              <option>English</option><option>Hindi</option><option>Spanish</option><option>French</option><option>German</option><option>Portuguese</option><option>Japanese</option><option>Korean</option><option>Chinese (Simplified)</option><option>Arabic</option>
            </select>
          </label>
          <div class="pg-result" id="pg-result" aria-live="polite"></div>
        </div>
        <button class="pg-chip" id="pg-chip" type="button" hidden>Explain <kbd>⌥E</kbd></button>
      </div>
    </div>
  </div>
</section>

<section class="section" id="context">
  <div class="wrap">
    <div class="block block-navy reveal">
      <p class="eyebrow">Context is the whole point</p>
      <h2>Same word. Different page. Different meaning.</h2>
      <p class="sub">Dictionaries list every sense. Glossa reads the sentence you’re in and gives you the one that fits.</p>
      <div class="contrast">
        <div class="contrast-card">
          <p class="quote">The rower pulled the boat onto the <mark>bank</mark> and watched the river rise.</p>
          <span class="caption">Glossa says</span>
          <p class="ans">The sloping land along the edge of a river.</p>
        </div>
        <div class="contrast-card">
          <p class="quote">The <mark>bank</mark> raised its fees after the merger closed.</p>
          <span class="caption">Glossa says</span>
          <p class="ans">A financial company that holds money and makes loans.</p>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="section" id="features">
  <div class="wrap">
    <div class="section-head reveal">
      <p class="eyebrow">Features</p>
      <h2>Built for people who read a lot.</h2>
      <p class="sub">Engineers reading English docs, researchers, students, lawyers, new hires, and anyone reading in a second language.</p>
    </div>
    <div class="features">
      <div class="feature reveal">${ICONS.quote}<h3>Grounded in the page</h3><p>Uses the page’s own definitions and spelled-out acronyms, and quotes the line it relied on. Click “Show on page” to jump to it.</p></div>
      <div class="feature reveal">${ICONS.book}<h3>Your word list</h3><p>Every word you look up, with the sentence and page where you met it. Search it, sort it, filter it by site.</p></div>
      <div class="feature reveal">${ICONS.seen}<h3>Seen it before</h3><p>Words from your list get a dotted underline on any page. Hover to see your meaning, and when and where you met it. Runs on the page; nothing is sent.</p></div>
      <div class="feature reveal">${ICONS.lang}<h3>Your language, your level</h3><p>Explanations in 20 languages, at Simple, Standard or Expert level, plus a one-line meaning in your first language.</p></div>
      <div class="feature reveal">${ICONS.follow}<h3>Follow-ups on tap</h3><p>Simpler, deeper, more examples, a translation, or your own question about the selection.</p></div>
      <div class="feature reveal">${ICONS.export}<h3>Export to Anki and Obsidian</h3><p>Download your words as an Anki deck file, CSV, Markdown or JSON. Your data, in open formats.</p></div>
      <div class="feature reveal">${ICONS.byok}<h3>Private or unlimited</h3><p>Run it on the AI built into Chrome so text never leaves your computer, or bring your own OpenAI, Anthropic, Groq, Gemini or OpenRouter key.</p></div>
      <div class="feature reveal">${ICONS.frame}<h3>Works where text lives</h3><p>Articles, docs, embedded frames, text you’ve typed, and PDFs in the built-in Glossa reader.</p></div>
      <div class="feature reveal">${ICONS.keyboard}<h3>Keyboard first</h3><p>One shortcut to explain, one to open the panel. Remap them in Chrome anytime.</p></div>
    </div>
  </div>
</section>

<section class="section" id="privacy">
  <div class="wrap">
    <div class="block block-coral reveal">
      <div class="privacy-grid">
        <div>
          <p class="eyebrow">Privacy</p>
          <h2>Only what you select leaves the page.</h2>
          <p class="sub">No account, no tracking, no full-page scraping.</p>
        </div>
        <ul class="checklist">
          <li>Nothing is sent until you ask for an explanation.</li>
          <li>Only your selection and a little nearby text are sent, and you can switch the nearby text off.</li>
          <li>Your word list, history and settings stay in your browser.</li>
          <li>The “seen it before” underline runs inside the page against your local list. Nothing about the pages you read is sent.</li>
          <li>With the free service, anonymous counts (never text) help us improve it. Switch them off in Settings.</li>
          <li>Your own API key is sent only to the provider you chose.</li>
          <li>Pause Glossa everywhere, or hide the button on any site.</li>
        </ul>
      </div>
    </div>
  </div>
</section>

<section class="section" id="pricing">
  <div class="wrap">
    <div class="section-head reveal">
      <p class="eyebrow">Pricing</p>
      <h2>Free to start. Unlimited with your key.</h2>
    </div>
    <div class="plans">
      <div class="plan reveal">
        <div class="plan-top"><h3>Free</h3><span class="badge">Most people</span></div>
        <div class="price">$0<small>forever</small></div>
        <p class="sub">A daily allowance of explanations, on us.</p>
        <ul>
          <li>No API key needed: install and it just works</li>
          <li>Every feature: word list, underlines, follow-ups, export, 20 languages</li>
          <li>No account, no card</li>
          <li>Allowance resets every day</li>
        </ul>
        <a class="pill pill-black" href="/install">Add to Chrome</a>
      </div>
      <div class="plan reveal">
        <div class="plan-top"><h3>Your own key</h3></div>
        <div class="price">$0<small>+ provider usage</small></div>
        <p class="sub">Unlimited lookups, billed by your AI provider.</p>
        <ul>
          <li>OpenAI, Anthropic, Groq, Gemini, OpenRouter or custom</li>
          <li>Pick the exact model you want</li>
          <li>Key stays in your browser</li>
        </ul>
        <a class="pill pill-outline" href="/install#own-key">Set up your key</a>
      </div>
    </div>
  </div>
</section>

<section class="section" id="faq">
  <div class="wrap">
    <div class="block block-cream reveal">
      <p class="eyebrow">FAQ</p>
      <h2>Questions, answered.</h2>
      <div class="faq">
        <details><summary>Do I need an API key?</summary><div class="answer"><p>No. Install the extension and it works right away on Glossa’s free service, with a daily allowance of explanations. An API key is only for people who want unlimited use or a specific model: add one in Settings and Glossa uses your provider instead.</p></div></details>
        <details><summary>What is “Your words”?</summary><div class="answer"><p>Every word or phrase you look up is saved to a word list in your browser, together with the sentence and page where you met it. You can search it, see which words you keep looking up, export it to Anki, Obsidian, CSV or JSON, and Glossa underlines those words when they appear on other pages.</p></div></details>
        <details><summary>Does it work on PDFs?</summary><div class="answer"><p>Yes. Chrome’s own PDF viewer hides your selection from extensions, so Glossa has a PDF reader: click the toolbar icon on a PDF and choose “Open this PDF in Glossa reader”, or open a file from your computer. Select text and press <code>⌥E</code> as usual. Files you open are not uploaded.</p></div></details>
        <details><summary>Can it work without sending my text anywhere?</summary><div class="answer"><p>Yes, on computers that support it. In Settings, choose “On this device” and Glossa uses the AI model built into Chrome (Chrome 138 or newer), so the text never leaves your computer. Answers are shorter than the online options and come in English, Spanish or Japanese.</p></div></details>
        <details><summary>Does Glossa read every page I visit?</summary><div class="answer"><p>To underline words you’ve already looked up, Glossa compares the page’s text with your word list inside your browser. Nothing from the page is sent anywhere unless you ask for an explanation. You can turn the underline off in Settings, or for one site from the toolbar icon.</p></div></details>
        <details><summary>What exactly gets sent when I ask for an explanation?</summary><div class="answer"><p>The text you selected, the sentence it sits in, up to about 1,800 characters of nearby text, the page title and the site’s domain. Never the whole page, your history, or anything you didn’t select. You can switch the nearby text off in Settings.</p></div></details>
        <details><summary>Which AI model does the free plan use?</summary><div class="answer"><p>One we choose and tune for fast, accurate definitions, and we upgrade it as better ones appear. Want a specific model? Add your own key and pick it.</p></div></details>
        <details><summary>How do I use my own API key?</summary><div class="answer"><p>In the extension: open the side panel, then Settings, then “My own API key”. Pick a provider, paste the key, press Save and test. You can also try your key in the playground above before installing.</p></div></details>
        <details><summary>The shortcut doesn’t work. What now?</summary><div class="answer"><p>Chrome gives each shortcut to only one extension. If another one already uses Alt+E, open <code>chrome://extensions/shortcuts</code> and pick a new key for Glossa. The Explain button and right-click menu work either way.</p></div></details>
        <details><summary>Does it work on PDFs and Google Docs?</summary><div class="answer"><p>It works wherever the text is real, selectable text. Chrome’s built-in PDF viewer and pages like the Web Store block all extensions; there, type the word into the side panel instead.</p></div></details>
        <details><summary>Is my API key safe?</summary><div class="answer"><p>It’s stored in your browser only and sent directly to the provider you picked. It never passes through Glossa’s servers.</p></div></details>
      </div>
    </div>
  </div>
</section>

<section class="closer">
  <div class="wrap reveal">
    <h2>Stop opening new tabs to look things up.</h2>
    <div class="cta-row">
      <a class="pill pill-black" href="/install">Add to Chrome, it’s free</a>
      <a class="pill pill-outline" href="#try">Try it first</a>
    </div>
  </div>
</section>
</main>`,
  { playground: true }
);

const install = page(
  'Install Glossa',
  'Install the Glossa Chrome extension and set it up in about a minute.',
  `
<main class="doc">
  <p class="eyebrow">Install</p>
  <h1>Get Glossa running in a minute.</h1>
  <p class="lead">Works in Chrome, Edge, Brave and Arc, version 116 or newer.</p>

  <div class="callout">
    <b>No API key needed.</b>
    <p>Glossa works as soon as it’s installed, using our free service with a daily allowance. You don’t need a Groq, OpenAI or any other key. Adding <a href="#own-key">your own key</a> is optional, for unlimited use.</p>
  </div>

  <div class="block block-cream">
    <ol class="install-steps">
      <li><div><b>Download</b><a href="/download/glossa-extension.zip" download>Download Glossa (zip)</a> and unzip it.</div></li>
      <li><div><b>Open extensions</b>Go to <code>chrome://extensions</code> and switch on <b>Developer mode</b> in the top-right corner.</div></li>
      <li><div><b>Load it</b>Click <b>Load unpacked</b> and choose the unzipped folder. A welcome tab opens with a practice paragraph.</div></li>
      <li><div><b>Pin it</b>Open the puzzle-piece menu in the toolbar and pin Glossa so it’s one click away.</div></li>
    </ol>
  </div>

  <h2 id="shortcut">Ways to explain</h2>
  <table>
    <tr><th>Do this</th><th>Result</th></tr>
    <tr><td>Select text, press <kbd>⌥E</kbd> (Mac) or <kbd>Alt</kbd>+<kbd>E</kbd></td><td>The meaning opens in the side panel</td></tr>
    <tr><td>Click <b>Explain</b> next to the selection</td><td>Same, with the mouse</td></tr>
    <tr><td>Right-click the selection → <b>Explain “…”</b></td><td>Same, from the context menu</td></tr>
    <tr><td>Press <kbd>⌥⇧E</kbd> / <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd></td><td>Open the side panel</td></tr>
    <tr><td>Click the toolbar icon</td><td>Quick lookup, pause, per-site settings</td></tr>
  </table>
  <p>Shortcut taken by another extension? Open <code>chrome://extensions/shortcuts</code> and choose a new one for “Explain the selected text”.</p>

  <h2 id="own-key">Use your own API key</h2>
  <p><b>Optional.</b> The free plan needs no key and no setup. For unlimited use, open the side panel → Settings → <b>My own API key</b>, pick a provider, paste your key and press <b>Save and test</b>. You can also <a href="/#try">try your key on the homepage</a> first.</p>
  <table>
    <tr><th>Provider</th><th>Where to get a key</th></tr>
    <tr><td>OpenAI</td><td><a href="https://platform.openai.com/api-keys" rel="noreferrer">platform.openai.com/api-keys</a></td></tr>
    <tr><td>Anthropic</td><td><a href="https://console.anthropic.com/settings/keys" rel="noreferrer">console.anthropic.com</a></td></tr>
    <tr><td>Groq</td><td><a href="https://console.groq.com/keys" rel="noreferrer">console.groq.com/keys</a></td></tr>
    <tr><td>Google Gemini</td><td><a href="https://aistudio.google.com/apikey" rel="noreferrer">aistudio.google.com/apikey</a></td></tr>
    <tr><td>OpenRouter</td><td><a href="https://openrouter.ai/keys" rel="noreferrer">openrouter.ai/keys</a></td></tr>
    <tr><td>Custom</td><td>Any OpenAI-compatible server (Ollama, LM Studio, vLLM…). Enter its base URL in the extension.</td></tr>
  </table>
  <p>Your key is stored only in your browser and sent only to that provider.</p>
</main>`
);

const privacy = page(
  'Privacy policy · Glossa',
  'What Glossa sends, when, and to whom.',
  `
<main class="doc">
  <p class="eyebrow">Last updated ${TODAY}</p>
  <h1>Privacy policy</h1>
  <p class="lead">Glossa explains text you choose to select. This page lists everything that leaves your browser, and when.</p>

  <h2>What we send, and only when you ask</h2>
  <p>Nothing is sent until you trigger an explanation (shortcut, Explain button, right-click, or the lookup box). Then Glossa sends:</p>
  <ul>
    <li>the text you selected (up to 4,000 characters);</li>
    <li>the sentence it appears in and up to about 1,800 characters of nearby text, unless you turn off “Use surrounding text”;</li>
    <li>the page title and domain;</li>
    <li>if the page itself defines the term or spells out the acronym, that short definition (up to 300 characters);</li>
    <li>your answer settings (reading level, length, language, and your first language if you set one);</li>
    <li>a random install ID, used only to apply the daily free allowance;</li>
    <li>with the free service only, two anonymous numbers: whether the term was already in your word list, and how many words the list has. Never the words themselves. Turn this off in Settings → Share anonymous usage counts.</li>
  </ul>
  <p>Glossa never sends whole pages, pages you didn’t select text on, form contents you didn’t select, cookies, your word list or your browsing history.</p>
  <p>PDFs you open in the Glossa reader are read inside your browser and never uploaded; only the text you ask about is sent, as above.</p>
  <p>To underline words you’ve already looked up, Glossa compares the text of the page with your word list inside your browser. That comparison never leaves the page, and you can turn it off in Settings or per site.</p>

  <h2>Who receives it</h2>
  <table>
    <tr><th>Mode</th><th>Recipient</th></tr>
    <tr><td>Free plan</td><td>Glossa’s API, which forwards the request to an AI model provider under contract to generate the answer.</td></tr>
    <tr><td>Your own key</td><td>The provider you chose, directly from your browser. Glossa’s servers are not involved.</td></tr>
    <tr><td>On this device</td><td>Nobody. The AI model built into Chrome answers on your computer.</td></tr>
  </table>

  <h2>What our servers keep</h2>
  <p>We don’t store the text you select or the answers. To enforce the free allowance we keep a counter per install ID and per IP address, reset daily. Request logs record method, path, status and timing only, never content. Feedback you send from the feedback page is stored so we can read it.</p>
  <p>Unless you opt out, we also keep anonymous daily totals: how many lookups and follow-ups there were, how many were repeat lookups, how many installs were active, how many have a word list of 10 or more, and how many came back after 7 and 30 days. Installs are counted through a one-way hash of the install ID; no text, URLs or words are stored. Daily totals are kept for about four months, and the hashed first-seen date for about thirteen.</p>
  <p>We use this information only to provide and improve Glossa. We don’t sell it, share it for advertising, or use your text to train models.</p>

  <h2>What stays in your browser</h2>
  <p>Settings, your word list, history, saved items, cached answers and any API key you enter are kept in your browser’s storage on your device. Delete them from Settings → Delete everything, or by removing the extension. Export your word list anytime from Your words.</p>

  <h2>Permissions, explained</h2>
  <table>
    <tr><th>Permission</th><th>Why</th></tr>
    <tr><td>Read page content</td><td>To read your selection and the text around it, show the Explain button, and underline words from your word list.</td></tr>
    <tr><td>Side panel</td><td>To show explanations next to the page.</td></tr>
    <tr><td>Context menus</td><td>For the right-click “Explain” item.</td></tr>
    <tr><td>Storage, unlimited storage</td><td>To keep your settings, history and word list on your device, without a size cap on a long word list.</td></tr>
  </table>

  <h2>Children</h2>
  <p>Glossa is not directed at children under 13 and we don’t knowingly collect their data.</p>

  <h2>Changes</h2>
  <p>If this policy changes in a way that affects what is sent, the extension will say so before the change applies.</p>
</main>`
);

const terms = page(
  'Terms of use · Glossa',
  'The terms for using the Glossa extension and service.',
  `
<main class="doc">
  <p class="eyebrow">Last updated ${TODAY}</p>
  <h1>Terms of use</h1>
  <p class="lead">Short version: use it to read better, don’t abuse the free service, and double-check anything important.</p>
  <h2>Using Glossa</h2>
  <p>You may use Glossa for personal or work reading. Don’t use the free service for automated or bulk requests, resell it, or try to get around its limits.</p>
  <h2>AI answers can be wrong</h2>
  <p>Explanations are generated by AI models and may be incomplete or incorrect. Don’t rely on them for medical, legal, financial or safety decisions without checking a qualified source.</p>
  <h2>Your own API key</h2>
  <p>When you use your own key, your provider’s terms and pricing apply to those requests, and you are responsible for charges on your account.</p>
  <h2>Free allowance</h2>
  <p>The size of the free daily allowance may change. The extension shows how many you have left.</p>
  <h2>No warranty</h2>
  <p>Glossa is provided “as is”, without warranties of any kind. To the extent permitted by law, we are not liable for indirect or consequential damages arising from its use.</p>
</main>`
);

const goodbye = page(
  'Feedback · Glossa',
  'Tell us what to improve.',
  `
<main class="doc">
  <p class="eyebrow">Feedback</p>
  <h1>Tell us what to fix.</h1>
  <p class="lead">Uninstalled, or just have a thought? It goes straight to the people building Glossa. No email needed.</p>
  <div class="block block-lime">
    <form id="feedback" novalidate>
      <div class="field">
        <label for="reason">Main reason</label>
        <select id="reason" name="reason">
          <option value="">Choose one (optional)</option>
          <option>Explanations weren’t accurate</option>
          <option>Too slow</option>
          <option>Hit the free limit</option>
          <option>Shortcut or button didn’t work</option>
          <option>Privacy concerns</option>
          <option>Didn’t need it</option>
          <option>Just sharing feedback</option>
        </select>
      </div>
      <div class="field">
        <label for="message">Anything else</label>
        <textarea id="message" name="message" maxlength="2000" placeholder="What happened, or what would make it better"></textarea>
      </div>
      <button class="pill pill-black" type="submit">Send feedback</button>
      <p class="form-status" id="feedback-status" role="status"></p>
    </form>
  </div>
  <p>Changed your mind? <a href="/install">Reinstall Glossa</a>.</p>
</main>`
);

const notFound = page(
  'Page not found · Glossa',
  'This page does not exist.',
  `
<main class="doc" style="min-height:60vh">
  <p class="eyebrow">404</p>
  <h1>Nothing here.</h1>
  <p class="lead">The page you’re looking for doesn’t exist or has moved.</p>
  <a class="pill pill-black" href="/">Go to the homepage</a>
</main>`
);

// Practice article. Element ids are used by the automated end-to-end tests; keep them stable.
const demo = page(
  'Practice page · Glossa',
  'A page full of jargon to try Glossa on.',
  `
<main class="article" id="article">
  <p class="eyebrow">Practice page · select anything and press <kbd>⌥E</kbd> / <kbd>Alt</kbd>+<kbd>E</kbd></p>
  <h1>Why your app is slow on Mondays</h1>
  <h2 id="caching">Caching, briefly</h2>
  <p id="p-cache">Most teams discover <span id="t-thundering">thundering herd</span> problems the hard way: a popular cache key expires, and thousands of requests stampede the database at once. The usual fix is <span id="t-jitter">jitter</span> on expiry times plus request coalescing, so only one caller rebuilds the value.</p>
  <p id="p-idempotent">Retries make things worse unless every write is <span id="t-idempotent">idempotent</span>, meaning running it twice has the same effect as running it once.</p>
  <h2 id="money">Meanwhile, in finance</h2>
  <p id="p-bank">The rower pulled the boat onto the <span id="t-bank">bank</span> and watched the river rise.</p>
  <p id="p-priced">With a quarter-point cut already <span id="t-priced">priced in</span>, traders shrugged, and the yield curve stayed stubbornly inverted.</p>
  <p id="p-nim">Lenders reported a wider net interest margin (NIM) this quarter as deposit costs eased.</p>
  <p id="p-nim2">Analysts still expect <span id="t-nim">NIM</span> to narrow next year.</p>
  <p id="p-later">Days later another storm came through, and the river burst its bank again.</p>
  <h2 id="multi">A sentence in another language</h2>
  <p id="p-de" lang="de">Das ist ein <span id="t-schaden">Schadenfreude</span>-Moment für die Konkurrenz.</p>
  <h2 id="code">Some code</h2>
  <pre id="p-code"><code>const debounced = useMemo(() => debounce(save, 300), [save]);</code></pre>
  <h2 id="form">Text you typed</h2>
  <label class="caption" for="notes">Notes</label>
  <textarea id="notes">The contract includes an indemnification clause that survives termination.</textarea>
  <h2 id="frame">Inside an embedded frame</h2>
  <iframe id="demo-frame" src="/demo-frame.html" title="Embedded article"></iframe>
</main>`
);

const demoFrame = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Embedded</title>
<style>body{margin:0;padding:20px 24px;background:#f4ecd6;color:#000;font:320 18px/1.6 Inter,system-ui,sans-serif}</style></head>
<body><p id="frame-text">Researchers measured the drug's <span id="t-bio">bioavailability</span> in a double-blind trial.</p></body></html>`;

// Runs in <head>, before first paint, so reveal animations never flash.
const bootJs = `document.documentElement.classList.add('js');\n`;

const siteJs = `// Glossa site: nav, scroll reveal, smooth FAQ, feedback form. No tracking.
(function () {
  var nav = document.getElementById('nav');
  var toggle = document.getElementById('nav-toggle');
  var links = document.getElementById('nav-links');
  function setMenu(open) {
    links.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    document.body.style.overflow = open ? 'hidden' : '';
  }
  if (toggle && links) {
    toggle.addEventListener('click', function () { setMenu(!links.classList.contains('open')); });
    links.addEventListener('click', function (e) { if (e.target.tagName === 'A') setMenu(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
  }
  if (nav) {
    var onScroll = function () { nav.classList.toggle('scrolled', window.scrollY > 8); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // Reveal sections as they scroll into view.
  var items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add('in'); });
  }

  // Smooth open/close for FAQ answers.
  document.querySelectorAll('.faq details').forEach(function (d) {
    var summary = d.querySelector('summary');
    var body = d.querySelector('.answer');
    if (!summary || !body || !body.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    summary.addEventListener('click', function (e) {
      e.preventDefault();
      if (d.open) {
        var a = body.animate([{ height: body.offsetHeight + 'px', opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 220, easing: 'ease-out' });
        a.onfinish = function () { d.open = false; };
      } else {
        d.open = true;
        body.animate([{ height: '0px', opacity: 0 }, { height: body.offsetHeight + 'px', opacity: 1 }], { duration: 280, easing: 'cubic-bezier(.22,1,.36,1)' });
      }
    });
  });

  var form = document.getElementById('feedback');
  if (form) {
    var status = document.getElementById('feedback-status');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var reason = form.reason.value;
      var message = form.message.value.trim();
      if (!reason && !message) { status.textContent = 'Pick a reason or write a note first.'; return; }
      var btn = form.querySelector('button');
      btn.disabled = true;
      status.textContent = 'Sending…';
      fetch('/v1/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason, message: message }) })
        .then(function (r) { if (!r.ok) throw new Error(String(r.status)); })
        .then(function () { form.reset(); status.textContent = 'Thanks. We read every one of these.'; })
        .catch(function () { status.textContent = 'Couldn’t send right now. Please try again in a minute.'; })
        .finally(function () { btn.disabled = false; });
    });
  }
})();
`;

function sitemap() {
  const day = new Date().toISOString().slice(0, 10);
  const pages = [
    ['/', '1.0', 'weekly'],
    ['/install', '0.8', 'monthly'],
    ['/demo', '0.5', 'monthly'],
    ['/privacy', '0.3', 'yearly'],
    ['/terms', '0.3', 'yearly'],
  ];
  const urls = pages
    .map(([p, priority, freq]) => `  <url>\n    <loc>${SITE_URL}${p}</loc>\n    <lastmod>${day}</lastmod>\n    <changefreq>${freq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

const files = {
  'index.html': index,
  'install.html': install,
  'privacy.html': privacy,
  'terms.html': terms,
  'goodbye.html': goodbye,
  '404.html': notFound,
  'demo.html': demo,
  'demo-frame.html': demoFrame,
  'boot.js': bootJs,
  'site.js': siteJs,
  'robots.txt': `User-agent: *\nAllow: /\nDisallow: /goodbye\n\nSitemap: ${SITE_URL}/sitemap.xml\n`,
  'sitemap.xml': sitemap(),
};
fs.mkdirSync(out, { recursive: true });
for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(out, name), content);
console.log(`website: ${Object.keys(files).length} files written`);
