import { useEffect, useState } from 'react';
import { WEBSITE_URL } from '../shared/brand';
import { openShortcutSettings, useApplyTheme, useSettings, useShortcut } from '../ui/hooks';
import { Wordmark } from '../ui/Logo';

export function Welcome() {
  const [settings] = useSettings();
  useApplyTheme(settings);
  const shortcut = useShortcut();
  const [windowId, setWindowId] = useState<number | undefined>();

  useEffect(() => {
    chrome.windows?.getCurrent().then((w) => setWindowId(w.id)).catch(() => undefined);
  }, []);

  const openPanel = (route?: 'settings') => {
    if (windowId !== undefined) chrome.sidePanel.open({ windowId }).catch(() => undefined);
    if (route) chrome.storage.session.set({ 'glossa.route': { view: route, at: Date.now() } }).catch(() => undefined);
  };

  return (
    <div className="welcome">
      <header className="w-top">
        <Wordmark size={22} />
        <a href={WEBSITE_URL} target="_blank" rel="noreferrer">
          Website
        </a>
      </header>

      <main className="w-main">
        <p className="w-kicker">Installed</p>
        <h1>Try it on this paragraph.</h1>
        <p className="w-lede">
          Highlight any word or phrase below, then {shortcut ? <>press <kbd>{shortcut}</kbd> or </> : null}click the{' '}
          <b>Explain</b> button that appears. The meaning opens in the side panel.
        </p>

        <article className="w-practice" data-testid="practice">
          <p>
            The central bank&apos;s decision was mostly <span className="hint">performative</span>: with a rate cut already{' '}
            <span className="hint">priced in</span>, traders shrugged, and the yield curve stayed stubbornly{' '}
            <span className="hint">inverted</span>. Analysts called the statement a masterclass in{' '}
            <span className="hint">forward guidance</span>, which is a polite way of saying nothing happened.
          </p>
        </article>

        {shortcut === '' && (
          <div className="w-warn" role="alert">
            <div>
              <b>The keyboard shortcut isn&apos;t assigned.</b> Another extension may already use Alt+E. You can still use
              the Explain button or right-click menu, or pick a new shortcut.
            </div>
            <button className="btn btn-secondary btn-sm" onClick={openShortcutSettings}>
              Set shortcut
            </button>
          </div>
        )}

        <section className="w-grid">
          <div className="w-cell">
            <span className="w-n">01</span>
            <h3>Pin it</h3>
            <p>Click the puzzle-piece icon in Chrome&apos;s toolbar, then the pin next to Glossa, for one-click lookups.</p>
          </div>
          <div className="w-cell">
            <span className="w-n">02</span>
            <h3>Free to start</h3>
            <p>
              A daily allowance of free explanations, no account needed. Need more? Use your own OpenAI, Anthropic, Groq, Gemini
              or OpenRouter key.
            </p>
            <button className="btn btn-secondary btn-sm" onClick={() => openPanel('settings')}>
              Open settings
            </button>
          </div>
          <div className="w-cell">
            <span className="w-n">03</span>
            <h3>Private by design</h3>
            <p>Only the text you select and a little of the text around it is sent. History stays in this browser.</p>
            <a href={`${WEBSITE_URL}/privacy`} target="_blank" rel="noreferrer">
              Privacy policy
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
