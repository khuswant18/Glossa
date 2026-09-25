/**
 * Website playground: the real Glossa pipeline running on the landing page.
 * Select text in the sample paragraph (or type a word) and get an explanation from
 * the free Glossa service, or from the visitor's own provider key.
 */

import { explain, followUp, resolveModel, testConnection } from '../ai/client';
import { toAiError } from '../ai/errors';
import { captureSelection, selectionRect } from '../content/capture';
import { PROVIDERS, getProvider } from '../shared/catalog';
import { DEFAULT_SETTINGS, mergeSettings } from '../shared/storage';
import type { CapturedSelection, Explanation, ProviderId, Settings } from '../shared/types';

const KEY_STORE = 'glossa.site.key';
// The website can only reach providers allowed by its Content-Security-Policy.
const WEB_PROVIDERS = PROVIDERS.filter((p) => p.id !== 'custom');

interface KeyState {
  provider: ProviderId;
  key: string;
  model: string;
  remember: boolean;
}

// Error text is shared with the extension, where "Settings" exists; reword it for the website.
const forWeb = (msg: string) =>
  msg
    .replace('Check it in Settings.', 'Check the key and try again.')
    .replace('Pick a different model in Settings.', 'Pick a different model.')
    .replace(/ in Settings/g, ' here');

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) if (c) node.append(c);
  return node;
}

function loadKey(): KeyState {
  const empty: KeyState = { provider: 'openai', key: '', model: '', remember: false };
  for (const store of [sessionStorage, localStorage]) {
    try {
      const raw = store.getItem(KEY_STORE);
      if (raw) return { ...empty, ...JSON.parse(raw) };
    } catch {
      // storage blocked
    }
  }
  return empty;
}

function saveKey(state: KeyState): void {
  try {
    sessionStorage.removeItem(KEY_STORE);
    localStorage.removeItem(KEY_STORE);
    if (!state.key) return;
    (state.remember ? localStorage : sessionStorage).setItem(KEY_STORE, JSON.stringify(state));
  } catch {
    // storage blocked; key lives in memory for this page only
  }
}

export function initPlayground(): void {
  const root = $('pg');
  if (!root) return;
  const text = $('pg-text')!;
  const chip = $<HTMLButtonElement>('pg-chip')!;
  const result = $('pg-result')!;
  const form = $<HTMLFormElement>('pg-form')!;
  const input = $<HTMLInputElement>('pg-input')!;
  const lang = $<HTMLSelectElement>('pg-lang')!;
  const keyPanel = $('pg-key')!;
  const providerSel = $<HTMLSelectElement>('pg-provider')!;
  const modelSel = $<HTMLSelectElement>('pg-model')!;
  const keyInput = $<HTMLInputElement>('pg-apikey')!;
  const remember = $<HTMLInputElement>('pg-remember')!;
  const testBtn = $<HTMLButtonElement>('pg-test')!;
  const keyStatus = $('pg-key-status')!;
  const forget = $<HTMLButtonElement>('pg-forget')!;
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-mode]'));

  let mode: 'hosted' | 'own-key' = 'hosted';
  let keyState = loadKey();
  let abort: AbortController | null = null;
  let last: { selection: CapturedSelection; result: Explanation } | null = null;

  // ---- own-key form ----------------------------------------------------------
  for (const p of WEB_PROVIDERS) providerSel.append(el('option', { value: p.id }, p.label));
  const fillModels = () => {
    modelSel.textContent = '';
    for (const m of getProvider(providerSel.value as ProviderId).models) modelSel.append(el('option', { value: m.id }, m.label));
  };
  providerSel.value = WEB_PROVIDERS.some((p) => p.id === keyState.provider) ? keyState.provider : 'openai';
  fillModels();
  if (keyState.model) modelSel.value = keyState.model;
  keyInput.value = keyState.key;
  remember.checked = keyState.remember;
  const updateKeyHint = () => {
    const p = getProvider(providerSel.value as ProviderId);
    keyInput.placeholder = p.keyPrefix ? `${p.keyPrefix}…` : 'Paste your key';
    const link = $<HTMLAnchorElement>('pg-keylink');
    if (link) {
      link.href = p.keyUrl;
      link.textContent = `Get a ${p.label} key`;
    }
    forget.hidden = !keyState.key;
  };
  updateKeyHint();

  const syncKeyState = () => {
    keyState = {
      provider: providerSel.value as ProviderId,
      model: modelSel.value,
      key: keyInput.value.trim(),
      remember: remember.checked,
    };
    saveKey(keyState);
    updateKeyHint();
  };
  providerSel.addEventListener('change', () => {
    fillModels();
    keyInput.value = '';
    keyStatus.textContent = '';
    syncKeyState();
  });
  modelSel.addEventListener('change', syncKeyState);
  keyInput.addEventListener('input', () => {
    keyStatus.textContent = '';
    syncKeyState();
  });
  remember.addEventListener('change', syncKeyState);
  forget.addEventListener('click', () => {
    keyInput.value = '';
    remember.checked = false;
    syncKeyState();
    keyStatus.textContent = 'Key removed from this browser.';
  });

  const settings = (): Settings => {
    const base = { ...DEFAULT_SETTINGS, language: lang.value || 'English', includeContext: true };
    if (mode === 'hosted') return mergeSettings({ ...base, aiSource: 'hosted' });
    return mergeSettings({
      ...base,
      aiSource: 'own-key',
      provider: keyState.provider,
      apiKeys: { [keyState.provider]: keyState.key },
      models: { [keyState.provider]: keyState.model },
    });
  };

  testBtn.addEventListener('click', async () => {
    syncKeyState();
    if (!keyState.key) {
      keyStatus.textContent = 'Paste a key first.';
      return;
    }
    testBtn.disabled = true;
    keyStatus.textContent = 'Testing…';
    const res = await testConnection(settings());
    keyStatus.textContent = forWeb(res.message);
    keyStatus.dataset.ok = String(res.ok);
    testBtn.disabled = false;
  });

  const setMode = (m: typeof mode) => {
    mode = m;
    for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.mode === m));
    keyPanel.hidden = m !== 'own-key';
  };
  for (const t of tabs) t.addEventListener('click', () => setMode(t.dataset.mode as typeof mode));

  // ---- rendering ---------------------------------------------------------------
  const renderEmpty = () => {
    result.textContent = '';
    result.append(
      el('p', { class: 'pg-empty' }, 'Highlight a word in the paragraph, then click ', el('b', {}, 'Explain'), '. Or type one below.')
    );
  };

  const renderLoading = (sel: CapturedSelection) => {
    result.textContent = '';
    result.setAttribute('aria-busy', 'true');
    result.append(
      el('div', { class: 'pg-quote' }, sel.text),
      el('div', { class: 'pg-sk', style: 'width:40%;height:22px' }),
      el('div', { class: 'pg-sk' }),
      el('div', { class: 'pg-sk', style: 'width:80%' })
    );
  };

  const renderError = (message: string, code: string) => {
    result.removeAttribute('aria-busy');
    result.textContent = '';
    const box = el('div', { class: 'pg-error', role: 'alert' }, el('p', {}, forWeb(message)));
    if ((code === 'quota' || code === 'network' || code === 'server') && mode === 'hosted') {
      const b = el('button', { class: 'pill pill-white', type: 'button' }, 'Use my own key');
      b.addEventListener('click', () => {
        setMode('own-key');
        keyInput.focus();
      });
      box.append(b);
    }
    if ((code === 'no-key' || code === 'bad-key') && mode === 'own-key') {
      keyInput.focus();
    }
    result.append(box);
  };

  const renderResult = (sel: CapturedSelection, e: Explanation, source: string) => {
    result.removeAttribute('aria-busy');
    result.textContent = '';
    const card = el('article', { class: 'pg-card', 'data-testid': 'pg-card' });
    if (sel.text.toLowerCase() !== e.headword.toLowerCase()) card.append(el('div', { class: 'pg-quote' }, sel.text));
    const head = el('div', { class: 'pg-head' }, el('h3', { 'data-testid': 'pg-headword' }, e.headword));
    const meta = el('div', { class: 'pg-meta' });
    if (e.pronunciation) meta.append(el('span', { class: 'mono' }, e.pronunciation));
    if (e.partOfSpeech) meta.append(el('span', { class: 'pg-tag' }, e.partOfSpeech));
    if (meta.childNodes.length) head.append(meta);
    card.append(head, el('p', { class: 'pg-meaning', 'data-testid': 'pg-meaning' }, e.meaning));
    if (e.explanation) card.append(el('p', { class: 'pg-explain' }, e.explanation));
    const facts = el('dl', { class: 'pg-facts' });
    if (e.example) facts.append(el('div', {}, el('dt', {}, 'Example'), el('dd', {}, e.example)));
    if (e.synonyms?.length) {
      const dd = el('dd', { class: 'pg-syn' });
      for (const s of e.synonyms) {
        const b = el('button', { type: 'button' }, s);
        b.addEventListener('click', () => run({ text: s, sentence: '', context: '', pageTitle: document.title, pageUrl: location.href, truncated: false }));
        dd.append(b);
      }
      facts.append(el('div', {}, el('dt', {}, 'Similar'), dd));
    }
    if (facts.childNodes.length) card.append(facts);

    const foot = el('div', { class: 'pg-foot' });
    const simpler = el('button', { class: 'pill pill-white pill-sm', type: 'button', 'data-testid': 'pg-simpler' }, 'Explain it simpler');
    simpler.addEventListener('click', async () => {
      simpler.disabled = true;
      simpler.textContent = 'Thinking…';
      try {
        const out = await followUp(
          { kind: 'simpler', text: sel.text, meaning: e.meaning, context: sel.context, level: 'standard', language: lang.value || 'English' },
          settings()
        );
        const answer = el('div', { class: 'pg-follow', 'data-testid': 'pg-follow' }, el('b', {}, 'Simpler: '), out.answer.replace(/\*\*|`/g, ''));
        simpler.replaceWith(answer);
      } catch (err) {
        simpler.disabled = false;
        simpler.textContent = 'Explain it simpler';
        foot.append(el('p', { class: 'pg-inline-err' }, forWeb(toAiError(err, 'Glossa').message)));
      }
    });
    foot.append(simpler, el('span', { class: 'pg-source' }, source));
    card.append(foot);
    result.append(card);
  };

  // ---- run ---------------------------------------------------------------------
  const run = async (sel: CapturedSelection) => {
    abort?.abort();
    const ac = new AbortController();
    abort = ac;
    chip.hidden = true;
    if (mode === 'own-key' && !keyState.key) {
      renderError('Paste your API key on the right first, or switch back to Glossa free.', 'no-key');
      return;
    }
    renderLoading(sel);
    try {
      const s = settings();
      const out = await explain(
        { text: sel.text, sentence: sel.sentence, context: sel.context, pageTitle: sel.pageTitle, pageUrl: sel.pageUrl, level: s.level, length: s.length, language: s.language },
        s,
        { signal: ac.signal }
      );
      if (abort !== ac) return;
      last = { selection: sel, result: out.result };
      renderResult(sel, out.result, mode === 'hosted' ? out.source : `${getProvider(keyState.provider).label} · ${resolveModel(s)}`);
    } catch (err) {
      if (abort !== ac) return;
      const e = toAiError(err, mode === 'hosted' ? 'the Glossa service' : getProvider(keyState.provider).label);
      if (e.code === 'aborted') return;
      renderError(e.message, e.code);
    }
  };

  // ---- selection chip inside the sample text -------------------------------------
  const placeChip = () => {
    const selection = window.getSelection();
    const inside = selection && selection.rangeCount && text.contains(selection.getRangeAt(0).commonAncestorContainer);
    const rect = inside ? selectionRect() : null;
    if (!rect || !selection?.toString().trim()) {
      chip.hidden = true;
      return;
    }
    const box = root.getBoundingClientRect();
    chip.hidden = false;
    const left = Math.min(Math.max(8, rect.right - box.left - chip.offsetWidth / 2), box.width - chip.offsetWidth - 8);
    chip.style.left = `${left}px`;
    chip.style.top = `${rect.bottom - box.top + 8}px`;
  };
  text.addEventListener('mouseup', () => setTimeout(placeChip, 0));
  text.addEventListener('keyup', (e) => e.shiftKey && placeChip());
  document.addEventListener('selectionchange', () => {
    if (!window.getSelection()?.toString().trim()) chip.hidden = true;
  });
  chip.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection
  chip.addEventListener('click', () => {
    const sel = captureSelection();
    if (sel) void run(sel);
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) {
      input.focus();
      return;
    }
    void run({ text: v.slice(0, 200), sentence: '', context: '', pageTitle: document.title, pageUrl: location.href, truncated: false });
  });

  lang.addEventListener('change', () => {
    if (last) void run(last.selection);
  });

  setMode('hosted');
  renderEmpty();
}

initPlayground();
