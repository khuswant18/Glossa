/**
 * Background service worker.
 * Every trigger (shortcut, context menu, floating button, panel/popup button) ends in
 * dispatch(): the selection is queued in storage.session and the side panel picks it up.
 */

import { warmUp } from '../ai/hosted';
import { WEBSITE_URL } from '../shared/brand';
import { DEFAULT_SETTINGS, KEYS, mergeSettings, randomId, setNotice, setPending } from '../shared/storage';
import type { CapturedSelection, Message, PanelNotice, Settings, Trigger } from '../shared/types';

const MENU_ID = 'glossa-explain';
let settings: Settings = DEFAULT_SETTINGS;
let settingsLoaded = false;
const lastSelectionFrame = new Map<number, number>();

const settingsReady = chrome.storage.local.get(KEYS.settings).then((data) => {
  settings = mergeSettings(data[KEYS.settings]);
  settingsLoaded = true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[KEYS.settings]) settings = mergeSettings(changes[KEYS.settings].newValue);
});

// ---- install / startup -------------------------------------------------------

chrome.runtime.onInstalled.addListener(async (details) => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => undefined);
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Explain “%s”',
      contexts: ['selection'],
    });
  });
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') }).catch(() => undefined);
  }
  if (/^https:\/\//.test(WEBSITE_URL)) {
    chrome.runtime.setUninstallURL(`${WEBSITE_URL}/goodbye`);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => lastSelectionFrame.delete(tabId));

// ---- side panel --------------------------------------------------------------

/** Must run synchronously inside the user-gesture turn, before any await. */
function openPanel(tab?: chrome.tabs.Tab): void {
  if (!tab || !chrome.sidePanel?.open) return;
  const target = tab.id !== undefined ? { tabId: tab.id } : { windowId: tab.windowId };
  chrome.sidePanel.open(target as chrome.sidePanel.OpenOptions).catch(() => {
    if (tab.windowId !== undefined) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
  });
}

// ---- capture -----------------------------------------------------------------

const RESTRICTED = [
  /^chrome:/, /^edge:/, /^brave:/, /^about:/, /^devtools:/, /^view-source:/, /^chrome-search:/,
  /^https:\/\/chromewebstore\.google\.com/, /^https:\/\/chrome\.google\.com\/webstore/,
  /^https:\/\/microsoftedge\.microsoft\.com\/addons/,
];

function isRestricted(url?: string): boolean {
  if (!url) return false;
  if (url.startsWith('chrome-extension:')) return !url.startsWith(chrome.runtime.getURL(''));
  return RESTRICTED.some((r) => r.test(url));
}

function isOwnPage(url?: string): boolean {
  return !!url && url.startsWith(chrome.runtime.getURL(''));
}

type CaptureResult = { kind: 'ok'; selection: CapturedSelection } | { kind: 'empty' } | { kind: 'restricted' };

async function askFrame(tabId: number, frameId: number): Promise<CapturedSelection | null | undefined> {
  try {
    const res = (await chrome.tabs.sendMessage(tabId, { type: 'CAPTURE_SELECTION' } satisfies Message, { frameId })) as
      | { selection: CapturedSelection | null }
      | undefined;
    return res ? res.selection : undefined;
  } catch {
    return undefined; // no content script in that frame
  }
}

async function captureFromTab(tab: chrome.tabs.Tab, frameHint?: number): Promise<CaptureResult> {
  if (tab.id === undefined) return { kind: 'empty' };
  if (isRestricted(tab.url)) return { kind: 'restricted' };

  if (isOwnPage(tab.url)) {
    try {
      const res = (await chrome.runtime.sendMessage({ type: 'CAPTURE_SELECTION' })) as
        | { selection: CapturedSelection | null }
        | undefined;
      return res?.selection ? { kind: 'ok', selection: res.selection } : { kind: 'empty' };
    } catch {
      return { kind: 'empty' };
    }
  }

  const frames = [frameHint, lastSelectionFrame.get(tab.id), 0].filter(
    (f, i, arr): f is number => typeof f === 'number' && arr.indexOf(f) === i
  );

  let reachedAny = false;
  for (const frameId of frames) {
    const sel = await askFrame(tab.id, frameId);
    if (sel !== undefined) reachedAny = true;
    if (sel) return { kind: 'ok', selection: sel };
  }
  if (reachedAny) return { kind: 'empty' };

  // Tab was open before install/update: inject the content script and ask again.
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content.js'] });
  } catch {
    return { kind: 'restricted' };
  }
  const sel = await askFrame(tab.id, frameHint ?? 0);
  if (sel === undefined) return { kind: 'restricted' };
  return sel ? { kind: 'ok', selection: sel } : { kind: 'empty' };
}

// ---- dispatch ----------------------------------------------------------------

let lastDispatch = { text: '', at: 0 };

async function dispatch(selection: CapturedSelection, trigger: Trigger, windowId?: number): Promise<void> {
  const now = Date.now();
  if (selection.text === lastDispatch.text && now - lastDispatch.at < 600) return;
  lastDispatch = { text: selection.text, at: now };
  await setPending({ id: randomId(), selection, trigger, createdAt: now, windowId });
}

async function notify(kind: PanelNotice['kind'], message: string, tabId?: number, windowId?: number): Promise<void> {
  await setNotice({ id: randomId(), kind, message, createdAt: Date.now(), windowId });
  if (tabId !== undefined && kind === 'no-selection') {
    chrome.tabs.sendMessage(tabId, { type: 'TOAST', message, tone: 'warn' } satisfies Message).catch(() => undefined);
  }
}

async function shortcutLabel(): Promise<string> {
  try {
    const cmds = await chrome.commands.getAll();
    return cmds.find((c) => c.name === 'explain-selection')?.shortcut || '';
  } catch {
    return '';
  }
}

async function explainFromTab(tab: chrome.tabs.Tab | undefined, trigger: Trigger, frameHint?: number, fallbackText?: string) {
  if (!tab) return;
  if (!settingsLoaded) await settingsReady;
  if (settings.paused && trigger !== 'panel' && trigger !== 'popup') {
    if (tab.id !== undefined) {
      chrome.tabs
        .sendMessage(tab.id, { type: 'TOAST', message: 'Glossa is paused. Resume it from the toolbar icon.', tone: 'warn' })
        .catch(() => undefined);
    }
    return;
  }

  const result = await captureFromTab(tab, frameHint);
  if (result.kind === 'ok') return dispatch(result.selection, trigger, tab.windowId);

  if (fallbackText && fallbackText.trim()) {
    // Context menu gives us the text even where we can't read the page.
    return dispatch(
      {
        text: fallbackText.trim().slice(0, 4000),
        sentence: '',
        context: '',
        pageTitle: tab.title || '',
        pageUrl: tab.url || '',
        truncated: fallbackText.length > 4000,
      },
      trigger,
      tab.windowId
    );
  }

  if (result.kind === 'restricted') {
    return notify(
      'restricted',
      'Chrome doesn’t let extensions read this page (browser pages, the Web Store and the built-in PDF viewer). Type the word into the box above instead.',
      undefined,
      tab.windowId
    );
  }
  const key = await shortcutLabel();
  return notify(
    'no-selection',
    key ? `Select a word or sentence on the page, then press ${key}.` : 'Select a word or sentence on the page first.',
    tab.id,
    tab.windowId
  );
}

// ---- triggers ----------------------------------------------------------------

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'explain-selection' && command !== 'open-panel') return;
  if (settings.paused && command === 'explain-selection') {
    void explainFromTab(tab, 'shortcut');
    return;
  }
  openPanel(tab);
  if (command === 'explain-selection') {
    if (tab) void explainFromTab(tab, 'shortcut');
    else chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([t]) => explainFromTab(t, 'shortcut'));
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  openPanel(tab);
  void explainFromTab(tab, 'context-menu', info.frameId, info.selectionText);
});

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  const msg = raw as Message;

  if (msg.type === 'GET_SHORTCUT') {
    shortcutLabel().then((shortcut) => sendResponse({ shortcut }));
    return true;
  }

  if (msg.type === 'SELECTION_STATE') {
    if (sender.tab?.id !== undefined && sender.frameId !== undefined) {
      lastSelectionFrame.set(sender.tab.id, sender.frameId);
    }
    return false;
  }

  if (msg.type === 'WARM_UP') {
    if (settings.aiSource === 'hosted' && !settings.paused) warmUp(settings.serverUrl);
    return false;
  }

  if (msg.type === 'EXPLAIN_SELECTION') {
    openPanel(sender.tab);
    void dispatch(msg.selection, msg.trigger, sender.tab?.windowId);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'EXPLAIN_ACTIVE_TAB') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
      if (!tab) return notify('error', 'No active tab found.');
      return explainFromTab(tab, msg.trigger);
    });
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

// Exposed for automated end-to-end tests only (service worker scope is not reachable from web pages).
(globalThis as unknown as { __glossa: unknown }).__glossa = { explainFromTab, dispatch, captureFromTab };
