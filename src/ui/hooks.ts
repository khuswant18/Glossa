import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, KEYS, getSettings, mergeSettings, saveSettings } from '../shared/storage';
import type { Settings } from '../shared/types';

/** Settings that stay in sync across popup, panel and welcome page. */
export function useSettings(): [Settings, (patch: Partial<Settings>) => Promise<Settings>, boolean] {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    getSettings().then((s) => {
      if (alive) {
        setSettings(s);
        setLoaded(true);
      }
    });
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[KEYS.settings]) setSettings(mergeSettings(changes[KEYS.settings].newValue));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  const update = useCallback(async (patch: Partial<Settings>) => {
    const next = await saveSettings(patch);
    setSettings(next);
    return next;
  }, []);

  return [settings, update, loaded];
}

/** Applies theme + text scale to <html>. */
export function useApplyTheme(settings: Settings): void {
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const theme = settings.theme === 'system' ? (media.matches ? 'light' : 'dark') : settings.theme;
      root.setAttribute('data-theme', theme);
    };
    apply();
    root.style.setProperty('--scale', String(settings.textScale || 1));
    if (settings.theme === 'system') {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
  }, [settings.theme, settings.textScale]);
}

/** The shortcut currently bound to "explain selection" ('' if the user removed it). */
export function useShortcut(): string | null {
  const [shortcut, setShortcut] = useState<string | null>(null);
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.commands?.getAll) {
      setShortcut(/Mac/.test(navigator.platform) ? '⌥E' : 'Alt+E');
      return;
    }
    chrome.commands.getAll().then(
      (cmds) => setShortcut(cmds.find((c) => c.name === 'explain-selection')?.shortcut || ''),
      () => setShortcut('')
    );
  }, []);
  return shortcut;
}

export function openShortcutSettings(): void {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(() => undefined);
}
