import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Clock, Settings as Gear } from 'lucide-react';
import { explain, followUp } from '../ai/client';
import { AiError, toAiError } from '../ai/errors';
import {
  KEYS,
  bumpStats,
  getHistory,
  getNotice,
  getPending,
  getSettings,
  randomId,
  upsertLookup,
} from '../shared/storage';
import type { CapturedSelection, FollowUpKind, Lookup, PanelNotice, PendingRequest, Trigger } from '../shared/types';
import { useApplyTheme, useSettings } from '../ui/hooks';
import { Wordmark } from '../ui/Logo';
import { HomeView } from './HomeView';
import { ResultView, LoadingView, ErrorView, NoticeView } from './ResultView';
import { HistoryView } from './HistoryView';
import { SettingsView } from './SettingsView';

export type View = 'explain' | 'history' | 'settings';

export type Current =
  | { status: 'idle' }
  | { status: 'loading'; selection: CapturedSelection; trigger: Trigger }
  | { status: 'done'; lookup: Lookup; cached: boolean }
  | { status: 'error'; selection: CapturedSelection; trigger: Trigger; error: AiError }
  | { status: 'notice'; notice: PanelNotice };

const FOLLOW_LABEL: Record<Exclude<FollowUpKind, 'ask' | 'translate'>, string> = {
  simpler: 'Simpler',
  deeper: 'Go deeper',
  example: 'More examples',
};

export function manualSelection(text: string): CapturedSelection {
  return { text: text.trim(), sentence: '', context: '', pageTitle: '', pageUrl: '', truncated: false };
}

export function App() {
  const [settings, updateSettings] = useSettings();
  useApplyTheme(settings);

  const [view, setView] = useState<View>('explain');
  const [current, setCurrent] = useState<Current>({ status: 'idle' });
  const [history, setHistory] = useState<Lookup[]>([]);
  const [followBusy, setFollowBusy] = useState<string | null>(null);
  const [followError, setFollowError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const followAbortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  const handledRef = useRef(new Set<string>());
  // Each browser window has its own side panel; only handle requests aimed at ours.
  const windowIdRef = useRef<number | undefined>(undefined);
  const forUs = (w?: number) => w === undefined || windowIdRef.current === undefined || w === windowIdRef.current;

  useEffect(() => {
    getHistory().then(setHistory);
  }, []);

  const run = useCallback(
    async (selection: CapturedSelection, trigger: Trigger, bypassCache = false, replace?: Lookup) => {
    abortRef.current?.abort();
    followAbortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const seq = ++seqRef.current;

    setView('explain');
    setFollowBusy(null);
    setFollowError(null);
    setCurrent({ status: 'loading', selection, trigger });

    const s = await getSettings();
    try {
      const out = await explain(
        {
          text: selection.text,
          sentence: selection.sentence,
          context: selection.context,
          pageTitle: selection.pageTitle,
          pageUrl: selection.pageUrl,
          level: s.level,
          length: s.length,
          language: s.language,
        },
        s,
        { signal: ac.signal, bypassCache }
      );
      if (seq !== seqRef.current) return;
      const lookup: Lookup = {
        id: replace?.id || randomId(),
        selection,
        result: out.result,
        followUps: [],
        createdAt: Date.now(),
        saved: replace?.saved || false,
        trigger,
        language: s.language,
        level: s.level,
        source: out.source,
      };
      setCurrent({ status: 'done', lookup, cached: out.cached });
      if (s.saveHistory || lookup.saved) setHistory(await upsertLookup(lookup));
      await bumpStats();
    } catch (err) {
      if (seq !== seqRef.current) return;
      const e = toAiError(err, 'Glossa');
      if (e.code === 'aborted') {
        setCurrent({ status: 'idle' });
        return;
      }
      setCurrent({ status: 'error', selection, trigger, error: e });
    }
  },
    []
  );

  const cancel = useCallback(() => {
    seqRef.current++;
    abortRef.current?.abort();
    setCurrent({ status: 'idle' });
  }, []);

  // ---- hand-off from background (shortcut, context menu, floating button) ----
  const consumePending = useCallback(
    (p: PendingRequest | undefined) => {
      if (!p || handledRef.current.has(p.id) || Date.now() - p.createdAt > 120000 || !forUs(p.windowId)) return;
      handledRef.current.add(p.id);
      chrome.storage?.session?.remove(KEYS.pending).catch(() => undefined);
      void run(p.selection, p.trigger);
    },
    [run]
  );

  const showNotice = useCallback((n: PanelNotice | undefined) => {
    if (!n || handledRef.current.has(n.id) || Date.now() - n.createdAt > 15000 || !forUs(n.windowId)) return;
    handledRef.current.add(n.id);
    chrome.storage?.session?.remove(KEYS.notice).catch(() => undefined);
    seqRef.current++;
    abortRef.current?.abort();
    setView('explain');
    setCurrent({ status: 'notice', notice: n });
  }, []);

  useEffect(() => {
    const ready = (chrome.windows?.getCurrent?.() ?? Promise.resolve(undefined))
      .then((w) => {
        windowIdRef.current = w?.id;
      })
      .catch(() => undefined);
    ready.then(() => {
      getPending().then(consumePending);
      getNotice().then(showNotice);
    });
    chrome.storage?.session?.get('glossa.route').then((d) => {
      const r = d?.['glossa.route'] as { view: View; at: number } | undefined;
      if (r && Date.now() - r.at < 10000) setView(r.view);
    });
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session') {
        if (changes[KEYS.pending]?.newValue) consumePending(changes[KEYS.pending].newValue as PendingRequest);
        if (changes[KEYS.notice]?.newValue) showNotice(changes[KEYS.notice].newValue as PanelNotice);
        const route = changes['glossa.route']?.newValue as { view: View } | undefined;
        if (route) setView(route.view);
      }
      if (area === 'local' && changes[KEYS.history]) {
        setHistory(Array.isArray(changes[KEYS.history].newValue) ? changes[KEYS.history].newValue : []);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [consumePending, showNotice]);

  // ---- lookup mutations -------------------------------------------------------
  const updateLookup = useCallback(async (next: Lookup, persist: boolean) => {
    setCurrent((c) => (c.status === 'done' && c.lookup.id === next.id ? { ...c, lookup: next } : c));
    if (persist) setHistory(await upsertLookup(next));
  }, []);

  const toggleSave = useCallback(
    (l: Lookup) => updateLookup({ ...l, saved: !l.saved }, true),
    [updateLookup]
  );

  const askFollowUp = useCallback(
    async (kind: FollowUpKind, opts: { question?: string; language?: string } = {}) => {
      if (current.status !== 'done') return;
      const l = current.lookup;
      const s = await getSettings();
      const language = opts.language || s.language;
      const label =
        kind === 'ask' ? (opts.question || '').trim() : kind === 'translate' ? `In ${language}` : FOLLOW_LABEL[kind];
      if (!label) return;

      followAbortRef.current?.abort();
      const ac = new AbortController();
      followAbortRef.current = ac;
      setFollowBusy(label);
      setFollowError(null);
      try {
        const out = await followUp(
          {
            kind,
            text: l.selection.text,
            meaning: l.result.meaning,
            context: l.selection.context,
            question: opts.question,
            level: s.level,
            language,
            thread: l.followUps.filter((f) => f.kind === 'ask').map((f) => ({ q: f.label, a: f.answer })),
          },
          s,
          { signal: ac.signal }
        );
        const entry = { id: randomId(), kind, label, answer: out.answer, createdAt: Date.now() };
        // Drop the pending row in the same render that adds the answer, so it never shows twice.
        if (followAbortRef.current === ac) setFollowBusy(null);
        await updateLookup({ ...l, followUps: [...l.followUps, entry] }, s.saveHistory || l.saved);
      } catch (err) {
        const e = toAiError(err, 'Glossa');
        if (e.code !== 'aborted') setFollowError(e.message);
      } finally {
        if (followAbortRef.current === ac) setFollowBusy(null);
      }
    },
    [current, updateLookup]
  );

  const removeFollowUp = useCallback(
    async (id: string) => {
      if (current.status !== 'done') return;
      const l = current.lookup;
      const s = await getSettings();
      await updateLookup({ ...l, followUps: l.followUps.filter((f) => f.id !== id) }, s.saveHistory || l.saved);
    },
    [current, updateLookup]
  );

  const openLookup = useCallback((l: Lookup) => {
    seqRef.current++;
    abortRef.current?.abort();
    setFollowBusy(null);
    setFollowError(null);
    setCurrent({ status: 'done', lookup: l, cached: true });
    setView('explain');
  }, []);

  const explainActiveTab = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'EXPLAIN_ACTIVE_TAB', trigger: 'panel' }).catch(() => undefined);
  }, []);

  const lookupText = useCallback((text: string) => run(manualSelection(text), 'lookup'), [run]);

  // ---- render -----------------------------------------------------------------
  const savedCount = history.filter((h) => h.saved).length;

  return (
    <div className="app">
      <header className="topbar">
        {view === 'explain' ? (
          <button
            className="brand-btn"
            onClick={() => setCurrent({ status: 'idle' })}
            aria-label="Home"
            title="Home"
          >
            <Wordmark size={20} />
          </button>
        ) : (
          <>
            <button className="icon-btn" onClick={() => setView('explain')} aria-label="Back" style={{ marginLeft: -8 }}>
              <ArrowLeft size={18} />
            </button>
            <span className="title">{view === 'history' ? 'History' : 'Settings'}</span>
          </>
        )}
        <span className="spacer" />
        <button
          className="icon-btn badge-dot"
          aria-label="History"
          title="History"
          aria-pressed={view === 'history'}
          onClick={() => setView(view === 'history' ? 'explain' : 'history')}
        >
          <Clock size={17} />
        </button>
        <button
          className="icon-btn"
          aria-label="Settings"
          title="Settings"
          aria-pressed={view === 'settings'}
          onClick={() => setView(view === 'settings' ? 'explain' : 'settings')}
        >
          <Gear size={17} />
        </button>
      </header>

      <main className="page">
        {view === 'history' && (
          <HistoryView history={history} setHistory={setHistory} onOpen={openLookup} savedCount={savedCount} />
        )}
        {view === 'settings' && <SettingsView settings={settings} update={updateSettings} />}
        {view === 'explain' && (
          <>
            {current.status === 'idle' && (
              <HomeView
                settings={settings}
                history={history}
                onLookup={lookupText}
                onExplainTab={explainActiveTab}
                onOpen={openLookup}
                onSeeAll={() => setView('history')}
              />
            )}
            {current.status === 'loading' && <LoadingView selection={current.selection} onCancel={cancel} />}
            {current.status === 'error' && (
              <ErrorView
                current={current}
                settings={settings}
                onRetry={() => run(current.selection, current.trigger, true)}
                onSettings={() => setView('settings')}
                onUseHosted={async () => {
                  await updateSettings({ aiSource: 'hosted' });
                  void run(current.selection, current.trigger, true);
                }}
                onHome={() => setCurrent({ status: 'idle' })}
              />
            )}
            {current.status === 'notice' && (
              <NoticeView notice={current.notice} onLookup={lookupText} onHome={() => setCurrent({ status: 'idle' })} />
            )}
            {current.status === 'done' && (
              <ResultView
                lookup={current.lookup}
                cached={current.cached}
                settings={settings}
                followBusy={followBusy}
                followError={followError}
                onFollowUp={askFollowUp}
                onRemoveFollowUp={removeFollowUp}
                onToggleSave={toggleSave}
                onRegenerate={() => run(current.lookup.selection, current.lookup.trigger, true, current.lookup)}
                onLookup={lookupText}
                onHome={() => setCurrent({ status: 'idle' })}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
