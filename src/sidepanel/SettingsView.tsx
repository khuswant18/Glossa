import { useEffect, useState } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { testConnection } from '../ai/client';
import { BRAND, VERSION, WEBSITE_URL } from '../shared/brand';
import { LANGUAGES, PROVIDERS, getProvider } from '../shared/catalog';
import { KEYS, clearCache, clearHistory, getInstallId } from '../shared/storage';
import type { ProviderId, Settings } from '../shared/types';
import { openShortcutSettings, useShortcut } from '../ui/hooks';
import { UsageMeter } from './HomeView';

function Switch({ checked, onChange, label, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      onClick={() => onChange(!checked)}
    />
  );
}

function Seg<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function originPattern(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

export function SettingsView({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => Promise<Settings> }) {
  const shortcut = useShortcut();
  const [provider, setProvider] = useState<ProviderId>(settings.provider);
  const [keyDraft, setKeyDraft] = useState(settings.apiKeys[settings.provider] || '');
  const [modelDraft, setModelDraft] = useState(settings.models[settings.provider] || '');
  const [baseDraft, setBaseDraft] = useState(settings.customBaseUrl);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [done, setDone] = useState('');
  const [installId, setInstallId] = useState('');

  useEffect(() => {
    getInstallId().then((id) => setInstallId(id.slice(0, 8)));
  }, []);

  // Keep drafts in sync when the provider changes.
  useEffect(() => {
    setKeyDraft(settings.apiKeys[provider] || '');
    setModelDraft(settings.models[provider] || '');
    setTestResult(null);
  }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps

  const info = getProvider(provider);
  const modelValue = modelDraft || info.models[0]?.id || '';
  const isCustomModel = provider !== 'custom' && !!modelDraft && !info.models.some((m) => m.id === modelDraft);
  const keyLooksWrong = !!keyDraft && !!info.keyPrefix && !keyDraft.trim().startsWith(info.keyPrefix);
  const dirty =
    provider !== settings.provider ||
    (keyDraft || '') !== (settings.apiKeys[provider] || '') ||
    (modelDraft || '') !== (settings.models[provider] || '') ||
    (provider === 'custom' && baseDraft !== settings.customBaseUrl);

  const flash = (msg: string) => {
    setDone(msg);
    setTimeout(() => setDone(''), 1800);
  };

  const saveAndTest = async () => {
    // permissions.request must run first, inside the click gesture.
    if (provider === 'custom') {
      const pattern = originPattern(baseDraft.trim());
      if (!pattern) {
        setTestResult({ ok: false, message: 'Enter a full base URL, e.g. https://my-server.example.com/v1' });
        return;
      }
      const granted = await chrome.permissions.request({ origins: [pattern] }).catch(() => false);
      if (!granted) {
        setTestResult({ ok: false, message: `Glossa needs permission to contact ${new URL(baseDraft).hostname}.` });
        return;
      }
    }
    const next = await update({
      aiSource: 'own-key',
      provider,
      apiKeys: { ...settings.apiKeys, [provider]: keyDraft.trim() },
      models: { ...settings.models, [provider]: modelDraft.trim() },
      customBaseUrl: provider === 'custom' ? baseDraft.trim() : settings.customBaseUrl,
    });
    setTesting(true);
    setTestResult(null);
    const res = await testConnection(next);
    setTesting(false);
    setTestResult(res);
  };

  const removeKey = async () => {
    const apiKeys = { ...settings.apiKeys };
    delete apiKeys[provider];
    setKeyDraft('');
    setTestResult(null);
    await update({ apiKeys, aiSource: provider === settings.provider ? 'hosted' : settings.aiSource });
    flash('Key removed');
  };

  return (
    <div className="settings">
      {/* ---------------- AI ---------------- */}
      <section className="group">
        <h3>Answers come from</h3>
        <div className="box">
          <div className="set col">
            <Seg
              label="AI source"
              value={settings.aiSource}
              onChange={(v) => update({ aiSource: v })}
              options={[
                { value: 'hosted', label: `${BRAND.name} (free)` },
                { value: 'own-key', label: 'My own API key' },
              ]}
            />
            <div className="set-help">
              {settings.aiSource === 'hosted'
                ? 'No setup needed. A daily allowance of free explanations, served by Glossa.'
                : 'Unlimited use, billed by your provider. Your key is stored only in this browser and sent only to that provider.'}
            </div>
          </div>

          {settings.aiSource === 'hosted' && (
            <div className="set col">
              <UsageMeter settings={settings} />
            </div>
          )}

          {settings.aiSource === 'own-key' && (
            <>
              <div className="set col">
                <label className="set-label" htmlFor="provider">
                  Provider
                </label>
                <select
                  id="provider"
                  className="select"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as ProviderId)}
                  data-testid="provider"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              {provider === 'custom' && (
                <div className="set col">
                  <label className="set-label" htmlFor="base">
                    Base URL
                  </label>
                  <input
                    id="base"
                    className="input mono"
                    placeholder="https://my-server.example.com/v1"
                    value={baseDraft}
                    onChange={(e) => {
                      setBaseDraft(e.target.value);
                      setTestResult(null);
                    }}
                    spellCheck={false}
                  />
                  <div className="set-help">Any OpenAI-compatible server: LM Studio, Ollama, vLLM, Together, Azure and more.</div>
                </div>
              )}

              <div className="set col">
                <label className="set-label" htmlFor="apikey">
                  API key {provider === 'custom' && <span className="muted">(optional)</span>}
                </label>
                <div className="keyfield">
                  <input
                    id="apikey"
                    className="input"
                    type={showKey ? 'text' : 'password'}
                    placeholder={info.keyPrefix ? `${info.keyPrefix}…` : 'Paste key'}
                    value={keyDraft}
                    onChange={(e) => {
                      setKeyDraft(e.target.value);
                      setTestResult(null);
                    }}
                    autoComplete="off"
                    spellCheck={false}
                    data-testid="api-key"
                  />
                  <button className="icon-btn" type="button" onClick={() => setShowKey(!showKey)} aria-label={showKey ? 'Hide key' : 'Show key'}>
                    {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {keyLooksWrong && <div className="set-help">{info.label} keys usually start with “{info.keyPrefix}”.</div>}
                {info.keyUrl && (
                  <div className="set-help">
                    <a href={info.keyUrl} target="_blank" rel="noreferrer">
                      Get a {info.label} key
                    </a>
                    {settings.apiKeys[provider] && (
                      <>
                        {' · '}
                        <a href="#" onClick={(e) => { e.preventDefault(); void removeKey(); }}>
                          Remove saved key
                        </a>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="set col">
                <label className="set-label" htmlFor="model">
                  Model
                </label>
                {provider === 'custom' ? (
                  <input
                    id="model"
                    className="input mono"
                    placeholder="e.g. llama3.1:8b"
                    value={modelDraft}
                    onChange={(e) => setModelDraft(e.target.value)}
                    spellCheck={false}
                  />
                ) : (
                  <>
                    <select
                      id="model"
                      className="select"
                      value={isCustomModel ? '__other' : modelValue}
                      onChange={(e) => {
                        setModelDraft(e.target.value === '__other' ? ' ' : e.target.value);
                        setTestResult(null);
                      }}
                      data-testid="model"
                    >
                      {info.models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                      <option value="__other">Other model id…</option>
                    </select>
                    {isCustomModel && (
                      <input
                        className="input mono"
                        placeholder="model id"
                        value={modelDraft.trim()}
                        onChange={(e) => setModelDraft(e.target.value || ' ')}
                        spellCheck={false}
                      />
                    )}
                  </>
                )}
              </div>

              <div className="set col">
                <button
                  className="btn btn-primary"
                  onClick={saveAndTest}
                  disabled={testing || (provider !== 'custom' && !keyDraft.trim()) || (provider === 'custom' && (!baseDraft.trim() || !modelDraft.trim()))}
                  data-testid="save-test"
                >
                  {testing ? 'Testing…' : dirty ? 'Save and test' : 'Test connection'}
                </button>
                {testResult && (
                  <div className={`result-line ${testResult.ok ? 'ok' : 'fail'}`} role="status" data-testid="test-result">
                    {testResult.message}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      {/* ---------------- Answers ---------------- */}
      <section className="group">
        <h3>Answer style</h3>
        <div className="box">
          <div className="set col">
            <span className="set-label">Reading level</span>
            <Seg
              label="Reading level"
              value={settings.level}
              onChange={(v) => update({ level: v })}
              options={[
                { value: 'simple', label: 'Simple' },
                { value: 'standard', label: 'Standard' },
                { value: 'expert', label: 'Expert' },
              ]}
            />
          </div>
          <div className="set col">
            <span className="set-label">Length</span>
            <Seg
              label="Length"
              value={settings.length}
              onChange={(v) => update({ length: v })}
              options={[
                { value: 'brief', label: 'Brief' },
                { value: 'normal', label: 'Normal' },
                { value: 'detailed', label: 'Detailed' },
              ]}
            />
          </div>
          <div className="set">
            <label className="set-label" htmlFor="lang">
              Explain in
            </label>
            <select
              id="lang"
              className="select"
              style={{ width: 180 }}
              value={settings.language}
              onChange={(e) => update({ language: e.target.value })}
              data-testid="language"
            >
              {LANGUAGES.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* ---------------- On pages ---------------- */}
      <section className="group">
        <h3>On web pages</h3>
        <div className="box">
          <div className="set">
            <div>
              <div className="set-label">Show Explain button on selection</div>
              <div className="set-help">A small button appears next to text you highlight.</div>
            </div>
            <Switch checked={settings.showChip} onChange={(v) => update({ showChip: v })} label="Show Explain button" testId="toggle-chip" />
          </div>
          <div className="set">
            <div>
              <div className="set-label">Use surrounding text</div>
              <div className="set-help">Sends the sentence and nearby paragraph so the meaning fits the page. Turn off to send only the selection.</div>
            </div>
            <Switch checked={settings.includeContext} onChange={(v) => update({ includeContext: v })} label="Use surrounding text" />
          </div>
          <div className="set">
            <div>
              <div className="set-label">Keyboard shortcut</div>
              <div className="set-help">{shortcut ? 'Explains the current selection.' : 'Not assigned. Chrome may have given it to another extension.'}</div>
            </div>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {shortcut && <kbd>{shortcut}</kbd>}
              <button className="btn btn-secondary btn-sm" onClick={openShortcutSettings}>
                Change
              </button>
            </span>
          </div>
          {settings.disabledSites.length > 0 && (
            <div className="set col">
              <span className="set-label">Explain button hidden on</span>
              <div className="sites">
                {settings.disabledSites.map((site) => (
                  <span key={site} className="site-tag">
                    {site}
                    <button
                      aria-label={`Re-enable on ${site}`}
                      onClick={() => update({ disabledSites: settings.disabledSites.filter((s) => s !== site) })}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ---------------- Appearance ---------------- */}
      <section className="group">
        <h3>Appearance</h3>
        <div className="box">
          <div className="set col">
            <span className="set-label">Theme</span>
            <Seg
              label="Theme"
              value={settings.theme}
              onChange={(v) => update({ theme: v })}
              options={[
                { value: 'system', label: 'System' },
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
              ]}
            />
          </div>
          <div className="set col">
            <span className="set-label">Text size</span>
            <Seg
              label="Text size"
              value={settings.textScale}
              onChange={(v) => update({ textScale: v })}
              options={[
                { value: 0.9, label: 'Small' },
                { value: 1, label: 'Default' },
                { value: 1.15, label: 'Large' },
              ]}
            />
          </div>
        </div>
      </section>

      {/* ---------------- Privacy ---------------- */}
      <section className="group">
        <h3>Privacy and data</h3>
        <div className="box">
          <div className="set">
            <div>
              <div className="set-label">Keep history</div>
              <div className="set-help">Stored only in this browser. Saved items are always kept.</div>
            </div>
            <Switch checked={settings.saveHistory} onChange={(v) => update({ saveHistory: v })} label="Keep history" testId="toggle-history" />
          </div>
          <div className="set">
            <div className="set-label">Cached answers</div>
            <button className="btn btn-secondary btn-sm" onClick={async () => { await clearCache(); flash('Cache cleared'); }}>
              Clear cache
            </button>
          </div>
          <div className="set">
            <div className="set-label">Delete everything</div>
            {confirmWipe ? (
              <span className="confirm">
                Remove history, keys and settings?
                <button
                  className="btn btn-primary btn-sm"
                  onClick={async () => {
                    const id = await getInstallId();
                    await clearHistory(false);
                    await chrome.storage.local.clear();
                    await chrome.storage.local.set({ [KEYS.installId]: id });
                    await update({});
                    setConfirmWipe(false);
                    setKeyDraft('');
                    flash('All data deleted');
                  }}
                >
                  Delete
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setConfirmWipe(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button className="btn btn-secondary btn-sm" onClick={() => setConfirmWipe(true)}>
                Delete…
              </button>
            )}
          </div>
        </div>
        {done && (
          <div className="result-line ok" role="status" style={{ marginTop: 8 }}>
            {done}
          </div>
        )}
      </section>

      <div className="about">
        <span>
          {BRAND.name} <span className="num">{VERSION}</span>
        </span>
        <a href={WEBSITE_URL} target="_blank" rel="noreferrer">
          Website
        </a>
        <a href={`${WEBSITE_URL}/privacy`} target="_blank" rel="noreferrer">
          Privacy
        </a>
        <a href={`${WEBSITE_URL}/terms`} target="_blank" rel="noreferrer">
          Terms
        </a>
        <span className="num" title="Anonymous install id">
          id {installId}
        </span>
      </div>
    </div>
  );
}
