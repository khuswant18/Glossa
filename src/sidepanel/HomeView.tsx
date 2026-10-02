import { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, Search, Star } from 'lucide-react';
import { fetchUsage } from '../ai/hosted';
import { resolveModel } from '../ai/client';
import { getProvider } from '../shared/catalog';
import { KEYS, getLexicon, getQuota } from '../shared/storage';
import { dueEntries } from '../shared/lexicon';
import { openInReader } from '../shared/pdf';
import type { Lookup, Quota, Settings } from '../shared/types';
import { useShortcut } from '../ui/hooks';
import { hostOf, timeAgo } from '../ui/util';

export function LookupBox({
  onSubmit,
  placeholder = 'Look up a word or phrase',
  autoFocus = false,
}: {
  onSubmit: (text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState('');
  const submit = () => {
    const v = value.trim();
    if (!v) return;
    onSubmit(v.slice(0, 4000));
    setValue('');
  };
  return (
    <form
      className="lookup"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Search className="lead" size={15} />
      <input
        className="input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus={autoFocus}
        maxLength={4000}
        data-testid="lookup-input"
      />
      {value.trim() ? (
        <button type="submit" className="btn btn-primary btn-sm go" aria-label="Look up">
          <ArrowRight size={14} />
        </button>
      ) : (
        <kbd aria-hidden="true">↵</kbd>
      )}
    </form>
  );
}

export function UsageMeter({ settings }: { settings: Settings }) {
  const [quota, setQuota] = useState<Quota | undefined>();

  useEffect(() => {
    if (settings.aiSource !== 'hosted') return;
    getQuota().then(setQuota);
    fetchUsage(settings.serverUrl).then((q) => q && setQuota(q));
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes['glossa.quota']?.newValue) setQuota(changes['glossa.quota'].newValue as Quota);
    };
    chrome.storage?.onChanged.addListener(listener);
    return () => chrome.storage?.onChanged.removeListener(listener);
  }, [settings.aiSource, settings.serverUrl]);

  if (settings.aiSource !== 'hosted') {
    const p = getProvider(settings.provider);
    const hasKey = !!settings.apiKeys[settings.provider] || settings.provider === 'custom';
    return (
      <div className="usage" data-testid="usage">
        {hasKey ? (
          <>
            Using your {p.label} key · <span className="mono">{resolveModel(settings)}</span>
          </>
        ) : (
          <>No {p.label} key saved yet. Add one in Settings.</>
        )}
      </div>
    );
  }

  if (!quota) {
    return (
      <div className="usage" data-testid="usage">
        Free plan · explanations are on us
      </div>
    );
  }
  const used = quota.limit - quota.remaining;
  const reset = new Date(quota.resetAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return (
    <div className="usage" data-testid="usage">
      <span className="num">{quota.remaining}</span> of <span className="num">{quota.limit}</span> free explanations left
      today · resets {reset}
      <div className="bar" aria-hidden="true">
        <span style={{ width: `${Math.min(100, (used / Math.max(1, quota.limit)) * 100)}%` }} />
      </div>
    </div>
  );
}

export function HomeView({
  settings,
  history,
  onLookup,
  onExplainTab,
  onOpen,
  onSeeAll,
  onReview,
}: {
  settings: Settings;
  history: Lookup[];
  onLookup: (text: string) => void;
  onExplainTab: () => void;
  onOpen: (l: Lookup) => void;
  onSeeAll: () => void;
  onReview: () => void;
}) {
  const shortcut = useShortcut();
  const recent = history.slice(0, 5);
  const [due, setDue] = useState(0);

  useEffect(() => {
    const load = () => void getLexicon().then((list) => setDue(dueEntries(list, Date.now(), Infinity).length));
    load();
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[KEYS.terms]) load();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  return (
    <>
      <LookupBox onSubmit={onLookup} />

      <section className="hero-card">
        <h2>Select text. Get the meaning.</h2>
        <p>Works on articles, docs, papers, forums and chat, in any language.</p>
        <ol className="steps">
          <li>
            <span className="n">01</span>
            <span>Highlight a word, phrase or paragraph on the page.</span>
          </li>
          <li>
            <span className="n">02</span>
            <span>
              {shortcut ? (
                <>
                  Press <kbd>{shortcut}</kbd>, click <b>Explain</b> next to it, or right-click.
                </>
              ) : (
                <>
                  Click <b>Explain</b> next to it or right-click. <span className="muted">(Shortcut is unassigned.)</span>
                </>
              )}
            </span>
          </li>
          <li>
            <span className="n">03</span>
            <span>Read what it means in context, right here.</span>
          </li>
        </ol>
        <button className="btn btn-primary btn-block" onClick={onExplainTab} data-testid="explain-selection">
          Explain current selection
        </button>
        <button className="linkish home-pdf" onClick={() => void openInReader()} data-testid="open-reader">
          Reading a PDF? Open it in the Glossa reader
        </button>
      </section>

      {due > 0 && (
        <button className="review-nudge" onClick={onReview} data-testid="review-nudge">
          <span className="nudge-icon">
            <BookOpen size={15} />
          </span>
          <span>
            <b>
              {due} word{due === 1 ? '' : 's'} to review
            </b>
            <span className="muted"> · about {Math.max(1, Math.round(Math.min(due, 10) / 4))} min</span>
          </span>
          <ArrowRight size={14} />
        </button>
      )}

      {recent.length > 0 && (
        <section>
          <div className="section-label">
            <span>Recent</span>
            <button onClick={onSeeAll}>See all</button>
          </div>
          <div className="rows">
            {recent.map((l) => (
              <button key={l.id} className="row" onClick={() => onOpen(l)}>
                <span style={{ minWidth: 0 }}>
                  <span className="row-title" style={{ display: 'block' }}>
                    {l.result.headword}
                  </span>
                  <span className="row-sub" style={{ display: 'block' }}>
                    {l.result.meaning}
                  </span>
                </span>
                <span className="row-meta">
                  {l.saved && <Star size={11} style={{ verticalAlign: -1, marginRight: 4, color: 'var(--primary)' }} />}
                  {hostOf(l.selection.pageUrl) || 'Lookup'} · {timeAgo(l.createdAt)}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <UsageMeter settings={settings} />
    </>
  );
}
