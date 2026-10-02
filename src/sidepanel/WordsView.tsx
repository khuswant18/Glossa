import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, RotateCw, Search, Trash2 } from 'lucide-react';
import { dueEntries, hostOfUrl, isKnown, toAnki, toCsv, toJson, toMarkdown, weeklyRecap, type LexiconEntry } from '../shared/lexicon';
import { RecapCard } from './RecapCard';
import { ReviewView } from './ReviewView';
import { textFragmentUrl } from '../shared/fragment';
import { KEYS, clearLexicon, deleteLexiconEntry, getLexicon } from '../shared/storage';
import { download, timeAgo } from '../ui/util';

type Sort = 'recent' | 'count' | 'az';

function useLexicon(): [LexiconEntry[] | null, () => void] {
  const [entries, setEntries] = useState<LexiconEntry[] | null>(null);
  const reload = () => void getLexicon().then(setEntries);
  useEffect(() => {
    reload();
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[KEYS.terms]) reload();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);
  return [entries, reload];
}

function Marked({ text, term }: { text: string; term: string }) {
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (!term || i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + term.length)}</mark>
      {text.slice(i + term.length)}
    </>
  );
}

export function WordsView({ onExplain, initialMode = 'list' }: { onExplain: (e: LexiconEntry) => void; initialMode?: 'list' | 'review' }) {
  const [entries, reload] = useLexicon();
  const [mode, setMode] = useState<'list' | 'review'>(initialMode);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [site, setSite] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const sites = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries || []) {
      for (const h of new Set(e.sightings.map((s) => hostOfUrl(s.url)).filter(Boolean))) counts.set(h, (counts.get(h) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);
  }, [entries]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (entries || []).filter((e) => {
      if (site && !e.sightings.some((s) => hostOfUrl(s.url) === site)) return false;
      if (!q) return true;
      return (
        e.term.toLowerCase().includes(q) ||
        e.headword.toLowerCase().includes(q) ||
        e.meaning.toLowerCase().includes(q) ||
        (e.expansion || '').toLowerCase().includes(q)
      );
    });
    if (sort === 'count') list.sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen);
    else if (sort === 'az') list.sort((a, b) => a.headword.localeCompare(b.headword));
    else list.sort((a, b) => b.lastSeen - a.lastSeen);
    return list;
  }, [entries, query, sort, site]);

  const exportAs = (kind: 'anki' | 'csv' | 'md' | 'json') => {
    const list = shown.length ? shown : entries || [];
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === 'anki') download(`glossa-anki-${stamp}.txt`, toAnki(list), 'text/plain');
    if (kind === 'csv') download(`glossa-words-${stamp}.csv`, toCsv(list), 'text/csv');
    if (kind === 'md') download(`glossa-words-${stamp}.md`, toMarkdown(list), 'text/markdown');
    if (kind === 'json') download(`glossa-words-${stamp}.json`, toJson(list), 'application/json');
  };

  if (!entries) return null;
  const repeats = entries.filter((e) => e.count > 1).length;
  const known = entries.filter(isKnown).length;
  const due = dueEntries(entries, Date.now(), Infinity).length;
  const recap = weeklyRecap(entries);

  const tabs = (
    <div className="seg words-tabs" role="tablist" aria-label="Your words">
      <button role="tab" aria-pressed={mode === 'list'} aria-selected={mode === 'list'} onClick={() => setMode('list')}>
        List
      </button>
      <button role="tab" aria-pressed={mode === 'review'} aria-selected={mode === 'review'} onClick={() => setMode('review')} data-testid="tab-review">
        Review{due > 0 && <span className="count">{due}</span>}
      </button>
    </div>
  );

  if (mode === 'review') {
    return (
      <>
        {tabs}
        <ReviewView entries={entries} onChanged={reload} />
      </>
    );
  }

  return (
    <>
      {tabs}
      <div className="toolbar">
        <div className="lookup">
          <Search className="lead" size={15} />
          <input
            className="input"
            placeholder="Search your words"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search your words"
            data-testid="words-search"
          />
        </div>
      </div>
      <div className="words-controls">
        <div className="seg" role="group" aria-label="Sort">
          <button aria-pressed={sort === 'recent'} onClick={() => setSort('recent')}>
            Recent
          </button>
          <button aria-pressed={sort === 'count'} onClick={() => setSort('count')} data-testid="sort-count">
            Most looked up
          </button>
          <button aria-pressed={sort === 'az'} onClick={() => setSort('az')}>
            A–Z
          </button>
        </div>
        {sites.length > 1 && (
          <select className="select" value={site} onChange={(e) => setSite(e.target.value)} aria-label="Filter by site" data-testid="words-site">
            <option value="">All sites</option>
            {sites.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        )}
      </div>

      {entries.length > 0 && (
        <div className="words-summary" data-testid="words-summary">
          <span className="num">{entries.length}</span> word{entries.length === 1 ? '' : 's'}
          {repeats > 0 && (
            <>
              {' '}
              · <span className="num">{repeats}</span> looked up more than once
            </>
          )}
          {known > 0 && (
            <>
              {' '}
              · <span className="num">{known}</span> known
            </>
          )}
        </div>
      )}

      {recap.lookups > 0 && !query && !site && <RecapCard recap={recap} />}

      {shown.length === 0 ? (
        <div className="empty" data-testid="words-empty">
          {entries.length === 0
            ? 'Words and phrases you look up collect here, with the sentence and page where you met them. Glossa underlines them when they show up again.'
            : `No matches for “${query || site}”.`}
        </div>
      ) : (
        <div className="rows" data-testid="words-list">
          {shown.map((e) => {
            const isOpen = open === e.key;
            const hosts = [...new Set(e.sightings.map((s) => hostOfUrl(s.url)).filter(Boolean))];
            return (
              <div key={e.key} className={`word${isOpen ? ' open' : ''}`} data-testid="word-row">
                <div
                  className="row"
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : e.key)}
                  onKeyDown={(ev) => ev.key === 'Enter' && setOpen(isOpen ? null : e.key)}
                >
                  <span style={{ minWidth: 0 }}>
                    <span className="row-title" style={{ display: 'block' }}>
                      {e.headword}
                      {e.count > 1 && (
                        <span className="count" title={`Looked up ${e.count} times`} data-testid="word-count">
                          ×{e.count}
                        </span>
                      )}
                    </span>
                    <span className="row-sub" style={{ display: 'block' }}>
                      {e.meaning}
                    </span>
                    <span className="row-meta" style={{ display: 'block', marginTop: 2 }}>
                      {hosts.slice(0, 2).join(', ') || 'Typed lookup'}
                      {hosts.length > 2 ? ` +${hosts.length - 2}` : ''} · {timeAgo(e.lastSeen)}
                    </span>
                  </span>
                </div>
                {isOpen && (
                  <div className="word-detail" data-testid="word-detail">
                    {e.expansion && <div className="expansion">{e.expansion}</div>}
                    <p className="word-meaning">{e.meaning}</p>
                    {e.gloss && <p className="gloss">{e.gloss}</p>}
                    {e.sightings.length > 0 && (
                      <ul className="sightings">
                        {e.sightings.map((s) => (
                          <li key={s.lookupId}>
                            {s.sentence && (
                              <span className="sighting-text">
                                <Marked text={s.sentence} term={e.term} />
                              </span>
                            )}
                            <a href={s.sentence ? textFragmentUrl(s.url, s.sentence) : s.url} target="_blank" rel="noreferrer" className="sighting-src" title="Open the page at this sentence">
                              {s.title || hostOfUrl(s.url)} <ExternalLink size={11} />
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="word-actions">
                      <button className="btn btn-secondary btn-sm" onClick={() => onExplain(e)} data-testid="word-explain">
                        <RotateCw size={13} /> Explain again
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={async () => {
                          await deleteLexiconEntry(e.key);
                          reload();
                        }}
                        data-testid="word-delete"
                      >
                        <Trash2 size={13} /> Remove
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {entries.length > 0 && (
        <div className="footer-actions">
          <div className="export" role="group" aria-label="Export">
            <span className="muted">Export</span>
            <button className="btn btn-secondary btn-sm" onClick={() => exportAs('anki')} data-testid="export-anki">
              Anki
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => exportAs('csv')} data-testid="export-csv">
              CSV
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => exportAs('md')}>
              Markdown
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => exportAs('json')}>
              JSON
            </button>
          </div>
          {confirming ? (
            <span className="confirm">
              Remove all words?
              <button
                className="btn btn-primary btn-sm"
                onClick={async () => {
                  await clearLexicon();
                  setConfirming(false);
                  reload();
                }}
              >
                Remove
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)}>
              Clear list
            </button>
          )}
        </div>
      )}
    </>
  );
}
