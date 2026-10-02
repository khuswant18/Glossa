import { useEffect, useState } from 'react';
import { applyReview, dueAt, dueEntries, hostOfUrl, isKnown, type LexiconEntry } from '../shared/lexicon';
import { saveLexiconEntry } from '../shared/storage';

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

/**
 * A short recall check: see the word in the sentence where you met it, try to recall the meaning,
 * then reveal and say whether you knew it. Capped at a handful of cards so it never piles up.
 */
export function ReviewView({ entries, onChanged }: { entries: LexiconEntry[]; onChanged: () => void }) {
  const [queue] = useState(() => dueEntries(entries, Date.now()));
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [got, setGot] = useState(0);

  const card = queue[idx];

  const grade = async (g: 'again' | 'good') => {
    if (!card) return;
    await saveLexiconEntry(applyReview(card, g, Date.now()));
    if (g === 'good') setGot((n) => n + 1);
    setRevealed(false);
    setIdx((i) => i + 1);
    onChanged();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && e.key === '1') void grade('again');
      else if (revealed && e.key === '2') void grade('good');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const known = entries.filter(isKnown).length;
  const next = entries.length ? Math.min(...entries.map(dueAt)) : 0;

  if (!queue.length || !card) {
    const finished = queue.length > 0;
    return (
      <div className="review-empty" data-testid="review-done">
        <h3>{finished ? 'Done for now' : 'Nothing to review right now'}</h3>
        <p>
          {finished
            ? `You reviewed ${queue.length} word${queue.length === 1 ? '' : 's'} and knew ${got}.`
            : entries.length
            ? 'Words come up a day after you look them up, then less and less often as you remember them.'
            : 'Look a few words up first. They come up here a day later.'}
        </p>
        {entries.length > 0 && (
          <p className="muted">
            <span className="num">{known}</span> of <span className="num">{entries.length}</span> words recalled three times in a row
            {next > Date.now() ? ` · next review ${new Date(next).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}
          </p>
        )}
      </div>
    );
  }

  const s = card.sightings[0];
  return (
    <div className="review" data-testid="review-card">
      <div className="review-progress">
        <span className="num">
          {idx + 1} / {queue.length}
        </span>
        <span className="bar" aria-hidden="true">
          <span style={{ width: `${(idx / queue.length) * 100}%` }} />
        </span>
      </div>
      <div className="card review-card">
        <p className="review-ask">What does this mean here?</p>
        <h1 data-testid="review-term">{card.headword}</h1>
        {s?.sentence && (
          <p className="review-sentence">
            <Marked text={s.sentence} term={card.term} />
          </p>
        )}
        {s?.url && <div className="row-meta">{s.title || hostOfUrl(s.url)}</div>}
        {revealed ? (
          <div className="review-answer" data-testid="review-answer">
            {card.expansion && <div className="expansion">{card.expansion}</div>}
            <p className="meaning">{card.meaning}</p>
            {card.gloss && <p className="gloss">{card.gloss}</p>}
          </div>
        ) : null}
      </div>
      {revealed ? (
        <div className="review-grade">
          <button className="btn btn-secondary" onClick={() => void grade('again')} data-testid="review-again">
            Still learning <kbd>1</kbd>
          </button>
          <button className="btn btn-primary" onClick={() => void grade('good')} data-testid="review-good">
            I knew it <kbd>2</kbd>
          </button>
        </div>
      ) : (
        <button className="btn btn-primary btn-block" onClick={() => setRevealed(true)} data-testid="review-reveal">
          Show meaning <kbd>Space</kbd>
        </button>
      )}
    </div>
  );
}
