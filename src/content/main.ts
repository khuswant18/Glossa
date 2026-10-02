/**
 * Content script: watches selections, shows the floating button, handles the
 * in-page ⌥E fallback, and answers capture requests from the background worker.
 */

import { captureSelection, selectionRect } from './capture';
import { findTextRange } from './locate';
import { PageUi } from './page-ui';
import { SeenHighlighter } from './seen';
import { DEFAULT_SETTINGS, KEYS, mergeSettings, siteKey } from '../shared/storage';
import type { TermIndexItem } from '../shared/lexicon';
import type { Message, Settings, Trigger } from '../shared/types';

declare global {
  interface Window {
    __glossaContentLoaded?: boolean;
  }
}

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const DEFAULT_SHORTCUT = IS_MAC ? '⌥E' : 'Alt+E';

function sameDocument(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname === y.pathname && x.search === y.search;
  } catch {
    return false;
  }
}

export function initContent(): void {
  if (window.__glossaContentLoaded) return;
  window.__glossaContentLoaded = true;

  let settings: Settings = DEFAULT_SETTINGS;
  let shortcutLabel = DEFAULT_SHORTCUT;
  let dismissedFor = '';
  let lastSent = { text: '', at: 0 };

  const ui = new PageUi({
    onChipClick: () => {
      ui.hideChip();
      trigger('chip');
    },
    onChipDismiss: () => {
      dismissedFor = window.getSelection()?.toString() || '';
      ui.hideChip();
    },
    // Pointing at Explain is a strong sign a lookup is coming; plain selecting/copying is not.
    onChipHover: () => send({ type: 'WARM_UP' }),
  });

  const runtimeOk = () => {
    try {
      return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };

  const send = (msg: Message) => {
    if (!runtimeOk()) return;
    try {
      chrome.runtime.sendMessage(msg).catch(() => {
        /* no receiver (e.g. worker restarting) */
      });
    } catch {
      // Extension was reloaded; this orphaned script can no longer talk to it.
    }
  };

  const chipAllowed = () =>
    settings.showChip && !settings.paused && !settings.disabledSites.includes(siteKey(location.href));

  // ---- "seen it before" underlines -------------------------------------------
  let terms: TermIndexItem[] = [];
  const seen = new SeenHighlighter(ui, (range) => {
    // Explain the underlined word in this page's context: select it, then run the normal path.
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    trigger('chip');
  });
  const seenAllowed = () =>
    settings.showSeen && !settings.paused && !settings.disabledSites.includes(siteKey(location.href));
  const refreshSeen = () => seen.update(terms, seenAllowed());

  function trigger(source: Trigger): void {
    if (settings.paused) {
      ui.toast('Glossa is paused. Resume it from the toolbar icon.', 'warn');
      return;
    }
    const selection = captureSelection();
    if (!selection) {
      ui.toast(`Select a word or sentence first, then press ${shortcutLabel}.`, 'warn');
      return;
    }
    // The browser shortcut and this in-page fallback can both fire; send once.
    const now = Date.now();
    if (selection.text === lastSent.text && now - lastSent.at < 600) return;
    lastSent = { text: selection.text, at: now };
    if (!runtimeOk()) {
      ui.toast('Glossa was updated. Reload this page to keep using it.', 'warn', 5000);
      return;
    }
    send({ type: 'EXPLAIN_SELECTION', selection, trigger: source });
  }

  // ---- settings ------------------------------------------------------------
  if (runtimeOk()) {
    chrome.storage.local.get([KEYS.settings, KEYS.terms]).then(
      (data) => {
        settings = mergeSettings(data[KEYS.settings]);
        terms = Array.isArray(data[KEYS.terms]) ? data[KEYS.terms] : [];
        refreshSeen();
      },
      () => undefined
    );
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[KEYS.settings]) {
        settings = mergeSettings(changes[KEYS.settings].newValue);
        if (!chipAllowed()) ui.hideChip();
      }
      if (changes[KEYS.terms]) {
        const next = changes[KEYS.terms].newValue;
        terms = Array.isArray(next) ? next : [];
      }
      if (changes[KEYS.settings] || changes[KEYS.terms]) refreshSeen();
    });
    chrome.runtime
      .sendMessage({ type: 'GET_SHORTCUT' })
      .then((res: { shortcut?: string } | undefined) => {
        if (res && typeof res.shortcut === 'string') shortcutLabel = res.shortcut || '';
      })
      .catch(() => undefined);
  }

  // ---- floating button -----------------------------------------------------
  let chipTimer: number | undefined;
  let reportTimer: number | undefined;

  const refreshChip = () => {
    window.clearTimeout(chipTimer);
    chipTimer = window.setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() || '';
      // Areas that run their own Explain button (the playground on Glossa's website) opt out with data-glossa-native.
      const anchor = sel?.anchorNode instanceof Element ? sel.anchorNode : sel?.anchorNode?.parentElement;
      if (!text || !chipAllowed() || text === dismissedFor.trim() || anchor?.closest('[data-glossa-native]')) {
        ui.hideChip();
        return;
      }
      const rect = selectionRect();
      if (!rect) {
        ui.hideChip();
        return;
      }
      ui.showChip(rect, shortcutLabel);
    }, 120);
  };

  document.addEventListener('mouseup', (e) => {
    if (ui.contains(e.target)) return;
    refreshChip();
  });
  document.addEventListener('keyup', (e) => {
    if (e.shiftKey || e.key === 'Shift' || (e.key === 'a' && (e.metaKey || e.ctrlKey))) refreshChip();
  });
  document.addEventListener('mousedown', (e) => {
    if (!ui.contains(e.target)) {
      ui.hideChip();
      ui.hideSeenCard();
    }
  });
  document.addEventListener('selectionchange', () => {
    const has = !!window.getSelection()?.toString().trim();
    if (!has) ui.hideChip();
    // Tell the worker which frame holds the latest selection (matters for iframes).
    window.clearTimeout(reportTimer);
    if (has) reportTimer = window.setTimeout(() => send({ type: 'SELECTION_STATE', hasSelection: true }), 200);
  });
  window.addEventListener('scroll', () => ui.isChipVisible() && refreshChip(), { passive: true, capture: true });
  window.addEventListener('resize', () => ui.isChipVisible() && refreshChip(), { passive: true });

  // ---- keyboard fallback (⌥E / Alt+E) --------------------------------------
  // Chrome normally consumes the shortcut as an extension command before the page
  // sees it. This handler covers the case where the command is unassigned.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && (ui.isChipVisible() || ui.isSeenCardVisible())) {
        ui.hideChip();
        ui.hideSeenCard();
        return;
      }
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || e.code !== 'KeyE' || e.repeat) return;
      const target = e.target as HTMLElement | null;
      const editable =
        !!target && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (editable && !captureSelection()) return; // let the user type ´ / é
      e.preventDefault();
      e.stopPropagation();
      ui.hideChip();
      trigger('shortcut');
    },
    true
  );

  // ---- messages from the worker ------------------------------------------
  if (runtimeOk()) {
    chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
      if (msg.type === 'CAPTURE_SELECTION') {
        const selection = captureSelection();
        // Extension pages (welcome, reader) all hear this broadcast; only the one holding a selection answers.
        if (!selection && location.protocol === 'chrome-extension:') return false;
        ui.hideChip();
        sendResponse({ selection });
        return false;
      }
      if (msg.type === 'SHOW_ON_PAGE') {
        // Every frame (and every extension page) hears this; only the document that has the page answers.
        if (!sameDocument(msg.url, location.href)) return false;
        const range = findTextRange(msg.quote);
        if (range) ui.flashRange(range);
        sendResponse({ found: !!range });
        return false;
      }
      if (msg.type === 'TOAST') {
        // Only the top frame shows toasts so iframes don't duplicate them.
        if (window.top === window) ui.toast(msg.message, msg.tone);
        return false;
      }
      return false;
    });
  }
}
