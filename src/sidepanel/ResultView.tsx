import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Bookmark,
  BookmarkCheck,
  Check,
  Copy,
  ExternalLink,
  Highlighter,
  KeyRound,
  MousePointerClick,
  RotateCw,
  Send,
  ShieldOff,
  Square,
  Volume2,
  X,
} from 'lucide-react';
import { LANGUAGES } from '../shared/catalog';
import type { CapturedSelection, FollowUpKind, Lookup, PanelNotice, Settings } from '../shared/types';
import { Markdown, toPlain } from '../ui/Markdown';
import { copyText, explanationToText, hostOf, langCode, speak } from '../ui/util';
import type { Current } from './App';
import { LookupBox } from './HomeView';
import { openInReader } from '../shared/pdf';
import { showOnPage } from './showOnPage';

function Favicon({ url }: { url: string }) {
  const [ok, setOk] = useState(true);
  if (!ok || !url || typeof chrome === 'undefined' || !chrome.runtime?.id) return null;
  const src = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=16`;
  return <img src={src} alt="" onError={() => setOk(false)} />;
}

function SourceLine({ selection }: { selection: CapturedSelection }) {
  const host = hostOf(selection.pageUrl);
  if (!host) return null;
  return (
    <div className="source">
      <Favicon url={selection.pageUrl} />
      <a href={selection.pageUrl} target="_blank" rel="noreferrer" title={selection.pageTitle || selection.pageUrl}>
        {selection.pageTitle || host}
      </a>
    </div>
  );
}

function Quote({ text, truncated }: { text: string; truncated?: boolean }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 220 || text.split('\n').length > 4;
  return (
    <div>
      <div className="quote-label">
        <Highlighter size={11} /> You selected
      </div>
      <div className={`quote${long && !open ? ' clamp' : ''}`} data-testid="selected-text">
        <span className="sel">{text}</span>
      </div>
      {long && (
        <button className="quote-more" onClick={() => setOpen(!open)}>
          {open ? 'Show less' : 'Show all'}
        </button>
      )}
      {truncated && <div className="trunc-note">Long selection: only the first 4,000 characters were used.</div>}
    </div>
  );
}

export function LoadingView({ selection, onCancel }: { selection: CapturedSelection; onCancel: () => void }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), 6000);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <>
      <SourceLine selection={selection} />
      <Quote text={selection.text} truncated={selection.truncated} />
      <div className="card loading" aria-busy="true" aria-label="Loading explanation" data-testid="loading">
        <div className="sk" style={{ width: '45%', height: 18 }} />
        <div className="sk" style={{ width: '100%', marginTop: 16 }} />
        <div className="sk" style={{ width: '92%' }} />
        <div className="sk" style={{ width: '70%' }} />
        <div className="loading-foot">
          <span>{slow ? 'Still working. The first lookup after a break can take a few extra seconds…' : 'Reading the context…'}</span>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}

export function ErrorView({
  current,
  settings,
  onRetry,
  onSettings,
  onUseHosted,
  onHome,
}: {
  current: Extract<Current, { status: 'error' }>;
  settings: Settings;
  onRetry: () => void;
  onSettings: () => void;
  onUseHosted: () => void;
  onHome: () => void;
}) {
  const { error, selection } = current;
  const keyProblem = error.code === 'no-key' || error.code === 'bad-key';
  const title =
    error.code === 'quota'
      ? 'Daily free limit reached'
      : keyProblem
      ? 'API key needed'
      : error.code === 'network'
      ? 'Can’t connect'
      : error.code === 'timeout'
      ? 'That took too long'
      : error.code === 'rate-limit'
      ? 'Too many requests'
      : 'Couldn’t explain that';

  return (
    <>
      <Quote text={selection.text} truncated={selection.truncated} />
      <div className="state" role="alert" data-testid="error">
        <div className="glyph">{keyProblem ? <KeyRound size={16} /> : <AlertTriangle size={16} />}</div>
        <h3>{title}</h3>
        <p>{error.message}</p>
        <div className="btns">
          {error.code === 'quota' ? (
            <button className="btn btn-primary" onClick={onSettings}>
              Use my own API key
            </button>
          ) : keyProblem || error.code === 'bad-request' ? (
            <button className="btn btn-primary" onClick={onSettings}>
              Open settings
            </button>
          ) : (
            <button className="btn btn-primary" onClick={onRetry} data-testid="retry">
              <RotateCw size={14} /> Try again
            </button>
          )}
          {settings.aiSource === 'hosted' && (error.code === 'network' || error.code === 'server' || error.code === 'timeout') && (
            <button className="btn btn-secondary" onClick={onSettings}>
              Use my own API key
            </button>
          )}
          {settings.aiSource !== 'hosted' && (keyProblem || error.code === 'bad-request' || error.code === 'quota' || settings.aiSource === 'on-device') && (
            <button className="btn btn-secondary" onClick={onUseHosted}>
              Use Glossa free instead
            </button>
          )}
          <button className="btn btn-ghost" onClick={onHome}>
            Dismiss
          </button>
        </div>
      </div>
    </>
  );
}

export function NoticeView({
  notice,
  onLookup,
  onHome,
}: {
  notice: PanelNotice;
  onLookup: (t: string) => void;
  onHome: () => void;
}) {
  return (
    <>
      <LookupBox onSubmit={onLookup} autoFocus={notice.kind === 'restricted'} />
      <div className="state" data-testid="notice">
        <div className="glyph">{notice.kind === 'restricted' || notice.kind === 'pdf' ? <ShieldOff size={16} /> : <MousePointerClick size={16} />}</div>
        <h3>{notice.kind === 'restricted' ? 'This page is off-limits' : notice.kind === 'pdf' ? 'This is a PDF' : 'Nothing selected'}</h3>
        <p>{notice.message}</p>
        <div className="btns">
          {notice.kind === 'pdf' && (
            <button className="btn btn-primary" onClick={() => void openInReader(notice.url)} data-testid="open-pdf">
              Open in Glossa reader
            </button>
          )}
          <button className="btn btn-secondary" onClick={onHome}>
            OK
          </button>
        </div>
      </div>
    </>
  );
}

export function ResultView({
  lookup,
  cached,
  settings,
  followBusy,
  followError,
  onFollowUp,
  onRemoveFollowUp,
  onToggleSave,
  onRegenerate,
  onLookup,
  onHome,
}: {
  lookup: Lookup;
  cached: boolean;
  settings: Settings;
  followBusy: string | null;
  followError: string | null;
  onFollowUp: (kind: FollowUpKind, opts?: { question?: string; language?: string }) => void;
  onRemoveFollowUp: (id: string) => void;
  onToggleSave: (l: Lookup) => void;
  onRegenerate: () => void;
  onLookup: (text: string) => void;
  onHome: () => void;
}) {
  const e = lookup.result;
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [question, setQuestion] = useState('');
  const [shown, setShown] = useState<'shown' | 'opened' | 'missing' | null>(null);
  const stopRef = useRef<() => void>(() => undefined);
  const threadEnd = useRef<HTMLDivElement>(null);

  useEffect(() => () => stopRef.current(), []);
  useEffect(() => {
    stopRef.current();
    setQuestion('');
    setShown(null);
  }, [lookup.id]);
  useEffect(() => {
    if (followBusy || lookup.followUps.length) threadEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [followBusy, lookup.followUps.length]);

  const showQuote = lookup.selection.text.trim().toLowerCase() !== e.headword.trim().toLowerCase();

  const onCopy = async () => {
    const extra = lookup.followUps.map((f) => `\n\n${f.label}\n${toPlain(f.answer)}`).join('');
    if (await copyText(explanationToText(e, lookup.selection.text) + extra)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  const onSpeak = () => {
    if (speaking) {
      stopRef.current();
      return;
    }
    setSpeaking(true);
    const words = e.kind === 'word' ? `${e.headword}. ${e.meaning}` : e.meaning;
    stopRef.current = speak(words, langCode(lookup.language), () => setSpeaking(false));
  };

  const busy = !!followBusy;

  return (
    <>
      <LookupBox onSubmit={onLookup} />
      <SourceLine selection={lookup.selection} />
      {showQuote && <Quote text={lookup.selection.text} truncated={lookup.selection.truncated} />}

      <article className="card" data-testid="result">
        <div className="headline">
          <div className="grow">
            <h1 data-testid="headword">{e.headword}</h1>
            {e.expansion && (
              <div className="expansion" data-testid="expansion">
                {e.expansion}
              </div>
            )}
            {(e.pronunciation || e.partOfSpeech || e.confidence === 'low') && (
              <div className="pron">
                {e.pronunciation && <span className="ipa">{e.pronunciation}</span>}
                {e.partOfSpeech && <span className="tag">{e.partOfSpeech}</span>}
                {e.confidence === 'low' && (
                  <span className="tag tag-warn" title="The page doesn’t give enough to be sure. Check the source." data-testid="uncertain">
                    Not certain
                  </span>
                )}
              </div>
            )}
          </div>
          <button
            className="icon-btn"
            onClick={() => onToggleSave(lookup)}
            aria-pressed={lookup.saved}
            aria-label={lookup.saved ? 'Remove from saved' : 'Save'}
            title={lookup.saved ? 'Saved' : 'Save'}
            data-testid="save"
          >
            {lookup.saved ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}
          </button>
        </div>

        <p className="meaning" data-testid="meaning">
          {e.meaning}
        </p>
        {e.gloss && (
          <p className="gloss" data-testid="gloss" lang={langCode(settings.nativeLanguage)}>
            {e.gloss}
          </p>
        )}
        {e.fromPage && (
          <figure className="evidence" data-testid="from-page">
            <figcaption>
              <span>{e.basis === 'page' ? 'Defined on this page' : 'From the page'}</span>
              {lookup.selection.pageUrl && (
                <button
                  className="evidence-go"
                  onClick={async () => setShown(await showOnPage(lookup.selection.pageUrl, e.fromPage!))}
                  data-testid="show-on-page"
                >
                  Show on page <ArrowUpRight size={11} />
                </button>
              )}
            </figcaption>
            <blockquote>{e.fromPage}</blockquote>
            {shown === 'missing' && <div className="evidence-miss">That sentence isn’t on the page anymore.</div>}
          </figure>
        )}
        {e.explanation && <p className="explain">{e.explanation}</p>}

        {(e.definition || e.example || e.synonyms || e.keyTerms) && (
          <dl className="facts">
            {e.definition && (
              <div className="fact">
                <dt>In general</dt>
                <dd>{e.definition}</dd>
              </div>
            )}
            {e.example && (
              <div className="fact">
                <dt>Example</dt>
                <dd>
                  <em>{e.example}</em>
                </dd>
              </div>
            )}
            {e.synonyms && (
              <div className="fact">
                <dt>Similar</dt>
                <dd className="syn">
                  {e.synonyms.map((s) => (
                    <button key={s} className="chip" onClick={() => onLookup(s)} title={`Look up “${s}”`}>
                      {s}
                    </button>
                  ))}
                </dd>
              </div>
            )}
            {e.keyTerms && (
              <div className="fact">
                <dt>Terms</dt>
                <dd>
                  <ul className="terms">
                    {e.keyTerms.map((t) => (
                      <li key={t.term}>
                        <b>{t.term}</b> {t.definition}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
          </dl>
        )}

        {e.note && <div className="note">{e.note}</div>}

        <div className="actions">
          <button className="icon-btn" onClick={onCopy} aria-label="Copy" title="Copy" data-testid="copy">
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
          <button
            className="icon-btn"
            onClick={onSpeak}
            aria-label={speaking ? 'Stop reading' : 'Read aloud'}
            title={speaking ? 'Stop' : 'Read aloud'}
          >
            {speaking ? <Square size={14} /> : <Volume2 size={16} />}
          </button>
          <button className="icon-btn" onClick={onRegenerate} aria-label="Regenerate" title="Ask again" data-testid="regenerate">
            <RotateCw size={15} />
          </button>
          {lookup.selection.pageUrl && hostOf(lookup.selection.pageUrl) && (
            <a className="icon-btn" href={lookup.selection.pageUrl} target="_blank" rel="noreferrer" aria-label="Open page" title="Open page">
              <ExternalLink size={15} />
            </a>
          )}
          <span className="spacer" />
          <span className="by" title={lookup.source}>
            {copied ? 'Copied' : `${lookup.source}${cached ? ' · saved answer' : ''}`}
          </span>
        </div>
      </article>

      <div className="followbar" role="group" aria-label="Follow-up">
        <button className="chip" disabled={busy} onClick={() => onFollowUp('simpler')} data-testid="fu-simpler">
          Simpler
        </button>
        <button className="chip" disabled={busy} onClick={() => onFollowUp('deeper')} data-testid="fu-deeper">
          Go deeper
        </button>
        <button className="chip" disabled={busy} onClick={() => onFollowUp('example')} data-testid="fu-example">
          Examples
        </button>
        <select
          className="chip"
          disabled={busy}
          value=""
          aria-label="Translate"
          data-testid="fu-translate"
          onChange={(ev) => ev.target.value && onFollowUp('translate', { language: ev.target.value })}
        >
          <option value="">Translate…</option>
          {LANGUAGES.filter((l) => l !== lookup.language).map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>

      {(lookup.followUps.length > 0 || followBusy || followError) && (
        <div className="thread" data-testid="thread">
          {lookup.followUps.map((f) => (
            <div className="turn" key={f.id}>
              <div className="turn-head">
                <span>{f.label}</span>
                <button className="icon-btn" aria-label="Remove" title="Remove" onClick={() => onRemoveFollowUp(f.id)}>
                  <X size={13} />
                </button>
              </div>
              <Markdown text={f.answer} />
            </div>
          ))}
          {followBusy && (
            <div className="turn pending" aria-busy="true">
              <div className="turn-head">
                <span>{followBusy}</span>
              </div>
              <div className="sk" style={{ width: '95%' }} />
              <div className="sk" style={{ width: '75%' }} />
            </div>
          )}
          {followError && <div className="inline-error" role="alert">{followError}</div>}
          <div ref={threadEnd} />
        </div>
      )}

      <form
        className="ask"
        onSubmit={(ev) => {
          ev.preventDefault();
          const q = question.trim();
          if (!q || busy) return;
          onFollowUp('ask', { question: q });
          setQuestion('');
        }}
      >
        <input
          className="input"
          placeholder="Ask a follow-up question"
          value={question}
          onChange={(ev) => setQuestion(ev.target.value)}
          maxLength={500}
          aria-label="Ask a follow-up question"
          data-testid="ask-input"
        />
        <button className="btn btn-secondary" type="submit" disabled={!question.trim() || busy} aria-label="Send">
          <Send size={14} />
        </button>
      </form>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button className="btn btn-ghost btn-sm" onClick={onHome}>
          Done
        </button>
      </div>
      {settings.language !== lookup.language && (
        <p className="muted" style={{ fontSize: 12, margin: 0, textAlign: 'center' }}>
          Answer language is now {settings.language}. Press ↻ to redo this one.
        </p>
      )}
    </>
  );
}
