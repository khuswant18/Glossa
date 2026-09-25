import { useMemo, useState } from 'react';
import { Bookmark, BookmarkCheck, Search, Trash2 } from 'lucide-react';
import { clearHistory, deleteLookup, upsertLookup } from '../shared/storage';
import type { Lookup } from '../shared/types';
import { dayLabel, download, hostOf, lookupToMarkdown } from '../ui/util';

export function HistoryView({
  history,
  setHistory,
  onOpen,
  savedCount,
}: {
  history: Lookup[];
  setHistory: (h: Lookup[]) => void;
  onOpen: (l: Lookup) => void;
  savedCount: number;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'saved'>('all');
  const [confirming, setConfirming] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return history.filter((l) => {
      if (filter === 'saved' && !l.saved) return false;
      if (!q) return true;
      return (
        l.result.headword.toLowerCase().includes(q) ||
        l.result.meaning.toLowerCase().includes(q) ||
        l.selection.text.toLowerCase().includes(q) ||
        (l.selection.pageTitle || '').toLowerCase().includes(q) ||
        hostOf(l.selection.pageUrl).includes(q)
      );
    });
  }, [history, query, filter]);

  const groups = useMemo(() => {
    const out: { label: string; items: Lookup[] }[] = [];
    for (const l of filtered) {
      const label = dayLabel(l.createdAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(l);
      else out.push({ label, items: [l] });
    }
    return out;
  }, [filtered]);

  const exportAs = (kind: 'md' | 'json') => {
    const list = filtered.length ? filtered : history;
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === 'json') {
      download(`glossa-${stamp}.json`, JSON.stringify(list, null, 2), 'application/json');
    } else {
      download(`glossa-${stamp}.md`, `# Glossa lookups\n\n${list.map(lookupToMarkdown).join('\n\n---\n\n')}\n`, 'text/markdown');
    }
  };

  return (
    <>
      <div className="toolbar">
        <div className="lookup">
          <Search className="lead" size={15} />
          <input
            className="input"
            placeholder="Search history"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search history"
            data-testid="history-search"
          />
        </div>
      </div>
      <div className="seg" role="group" aria-label="Filter">
        <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          All <span className="num muted">{history.length}</span>
        </button>
        <button aria-pressed={filter === 'saved'} onClick={() => setFilter('saved')} data-testid="filter-saved">
          Saved <span className="num muted">{savedCount}</span>
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="empty" data-testid="history-empty">
          {history.length === 0
            ? 'Nothing here yet. Your lookups will appear here.'
            : filter === 'saved' && !query
            ? 'Nothing saved yet. Use the bookmark on any answer to keep it.'
            : `No matches for “${query}”.`}
        </div>
      ) : (
        <div data-testid="history-list">
          {groups.map((g) => (
            <section key={g.label}>
              <div className="group-label">{g.label}</div>
              <div className="rows">
                {g.items.map((l) => (
                  <div key={l.id} className="row" role="button" tabIndex={0} onClick={() => onOpen(l)} onKeyDown={(e) => e.key === 'Enter' && onOpen(l)}>
                    <span style={{ minWidth: 0 }}>
                      <span className="row-title" style={{ display: 'block' }}>
                        {l.result.headword}
                      </span>
                      <span className="row-sub" style={{ display: 'block' }}>
                        {l.result.meaning}
                      </span>
                      <span className="row-meta" style={{ display: 'block', marginTop: 2 }}>
                        {hostOf(l.selection.pageUrl) || 'Typed lookup'} ·{' '}
                        {new Date(l.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </span>
                    <span className="row-actions">
                      <button
                        className="icon-btn"
                        aria-pressed={l.saved}
                        aria-label={l.saved ? 'Unsave' : 'Save'}
                        title={l.saved ? 'Unsave' : 'Save'}
                        onClick={async (e) => {
                          e.stopPropagation();
                          setHistory(await upsertLookup({ ...l, saved: !l.saved }));
                        }}
                      >
                        {l.saved ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
                      </button>
                      <button
                        className="icon-btn del"
                        aria-label="Delete"
                        title="Delete"
                        data-testid="history-delete"
                        onClick={async (e) => {
                          e.stopPropagation();
                          setHistory(await deleteLookup(l.id));
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div className="footer-actions">
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => exportAs('md')}>
              Export Markdown
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => exportAs('json')}>
              JSON
            </button>
          </div>
          {confirming ? (
            <span className="confirm">
              {savedCount ? 'Clear all except saved?' : 'Clear all history?'}
              <button
                className="btn btn-primary btn-sm"
                data-testid="confirm-clear"
                onClick={async () => {
                  setHistory(await clearHistory(true));
                  setConfirming(false);
                }}
              >
                Clear
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)} data-testid="clear-history">
              Clear history
            </button>
          )}
        </div>
      )}
    </>
  );
}
