import { useEffect, useRef, useState } from 'react';
import { ArrowRight, PanelRight, Settings as Gear } from 'lucide-react';
import { explain } from '../ai/client';
import { toAiError } from '../ai/errors';
import { bumpStats, dayKey, getStats, randomId, setPending, siteKey, upsertLookup } from '../shared/storage';
import type { Explanation, Lookup } from '../shared/types';
import { useApplyTheme, useSettings, useShortcut } from '../ui/hooks';
import { Wordmark } from '../ui/Logo';
import { UsageMeter } from '../sidepanel/HomeView';

function Switch({ checked, onChange, label, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; testId?: string }) {
  return <button type="button" role="switch" className="switch" aria-checked={checked} aria-label={label} data-testid={testId} onClick={() => onChange(!checked)} />;
}

export function Popup() {
  const [settings, update] = useSettings();
  useApplyTheme(settings);
  const shortcut = useShortcut();

  const [windowId, setWindowId] = useState<number | undefined>();
  const [site, setSite] = useState('');
  const [weekCount, setWeekCount] = useState(0);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ text: string; result: Explanation } | null>(null);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    chrome.windows?.getCurrent().then((w) => setWindowId(w.id)).catch(() => undefined);
    chrome.tabs
      ?.query({ active: true, currentWindow: true })
      .then(([tab]) => setSite(tab?.url && /^https?:/.test(tab.url) ? siteKey(tab.url) : ''))
      .catch(() => undefined);
    getStats().then((s) => {
      let n = 0;
      for (let i = 0; i < 7; i++) n += s.days[dayKey(Date.now() - i * 86400000)] || 0;
      setWeekCount(n);
    });
    return () => abortRef.current?.abort();
  }, []);

  // sidePanel.open must be called synchronously inside the click handler.
  const openPanel = () => {
    if (windowId !== undefined) chrome.sidePanel.open({ windowId }).catch(() => undefined);
  };

  const explainSelection = () => {
    openPanel();
    chrome.runtime
      .sendMessage({ type: 'EXPLAIN_ACTIVE_TAB', trigger: 'popup' })
      .catch(() => undefined)
      .finally(() => window.close());
  };

  const openSettings = () => {
    openPanel();
    chrome.storage.session
      .set({ 'glossa.route': { view: 'settings', at: Date.now() } })
      .catch(() => undefined)
      .finally(() => window.close());
  };

  const lookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = query.trim();
    if (!text || busy) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setError('');
    setAnswer(null);
    try {
      const out = await explain(
        { text, level: settings.level, length: 'brief', language: settings.language },
        settings,
        { signal: ac.signal }
      );
      setAnswer({ text, result: out.result });
      if (settings.saveHistory) {
        const item: Lookup = {
          id: randomId(),
          selection: { text, sentence: '', context: '', pageTitle: '', pageUrl: '', truncated: false },
          result: out.result,
          followUps: [],
          createdAt: Date.now(),
          saved: false,
          trigger: 'popup',
          language: settings.language,
          level: settings.level,
          source: out.source,
        };
        await upsertLookup(item);
      }
      await bumpStats();
    } catch (err) {
      const ae = toAiError(err, 'Glossa');
      if (ae.code !== 'aborted') setError(ae.message);
    } finally {
      setBusy(false);
    }
  };

  const openAnswerInPanel = () => {
    if (!answer) return;
    openPanel();
    setPending({
      id: randomId(),
      selection: { text: answer.text, sentence: '', context: '', pageTitle: '', pageUrl: '', truncated: false },
      trigger: 'popup',
      createdAt: Date.now(),
      windowId,
    })
      .catch(() => undefined)
      .finally(() => window.close());
  };

  const siteDisabled = !!site && settings.disabledSites.includes(site);

  return (
    <div className="pop">
      <header className="pop-head">
        <Wordmark size={20} />
        <span className={`status ${settings.paused ? 'off' : 'on'}`} data-testid="status">
          {settings.paused ? 'Paused' : 'On'}
        </span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" onClick={openSettings} aria-label="Settings" title="Settings">
          <Gear size={17} />
        </button>
      </header>

      <form className="lookup" onSubmit={lookup}>
        <input
          className="input"
          placeholder="Look up a word or phrase"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={200}
          autoFocus
          aria-label="Look up a word or phrase"
          data-testid="popup-input"
        />
        <button className="btn btn-primary btn-sm go" type="submit" disabled={!query.trim() || busy} aria-label="Look up">
          <ArrowRight size={14} />
        </button>
      </form>

      {busy && (
        <div className="mini" aria-busy="true">
          <div className="sk" style={{ width: '40%', height: 14 }} />
          <div className="sk" style={{ width: '95%', marginTop: 10 }} />
          <div className="sk" style={{ width: '70%', marginTop: 8 }} />
        </div>
      )}
      {error && (
        <div className="mini err" role="alert" data-testid="popup-error">
          {error}
        </div>
      )}
      {answer && (
        <div className="mini" data-testid="popup-answer">
          <div className="mini-head">
            <b>{answer.result.headword}</b>
            {answer.result.pronunciation && <span className="mono muted">{answer.result.pronunciation}</span>}
            {answer.result.partOfSpeech && <span className="tag">{answer.result.partOfSpeech}</span>}
          </div>
          <p>{answer.result.meaning}</p>
          <button className="linkish" onClick={openAnswerInPanel}>
            More in side panel
          </button>
        </div>
      )}

      <div className="pop-actions">
        <button className="btn btn-primary" onClick={explainSelection} data-testid="popup-explain">
          Explain selection {shortcut && <kbd className="on-primary">{shortcut}</kbd>}
        </button>
        <button className="btn btn-secondary" onClick={openPanel} aria-label="Open side panel" title="Open side panel">
          <PanelRight size={15} />
        </button>
      </div>

      <div className="pop-rows">
        {site && (
          <div className="pop-row">
            <span>
              Explain button on <b>{site}</b>
            </span>
            <Switch
              checked={!siteDisabled && settings.showChip}
              label={`Explain button on ${site}`}
              testId="site-toggle"
              onChange={(v) => {
                if (v && !settings.showChip) {
                  void update({ showChip: true, disabledSites: settings.disabledSites.filter((s) => s !== site) });
                } else {
                  void update({
                    disabledSites: v ? settings.disabledSites.filter((s) => s !== site) : [...settings.disabledSites, site],
                  });
                }
              }}
            />
          </div>
        )}
        <div className="pop-row">
          <span>Pause everywhere</span>
          <Switch checked={settings.paused} label="Pause Glossa" testId="pause-toggle" onChange={(v) => update({ paused: v })} />
        </div>
      </div>

      <footer className="pop-foot">
        <UsageMeter settings={settings} />
        <div className="pop-stats">
          <span>
            <span className="num">{weekCount}</span> lookups this week
          </span>
        </div>
      </footer>
    </div>
  );
}
