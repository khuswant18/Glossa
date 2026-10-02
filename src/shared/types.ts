export type ReadingLevel = 'simple' | 'standard' | 'expert';
export type AnswerLength = 'brief' | 'normal' | 'detailed';
export type ThemePreference = 'system' | 'dark' | 'light';
export type ProviderId = 'groq' | 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'custom';
export type AiSource = 'hosted' | 'own-key' | 'on-device';
export type FollowUpKind = 'simpler' | 'deeper' | 'example' | 'translate' | 'ask';
export type Trigger = 'shortcut' | 'context-menu' | 'chip' | 'panel' | 'popup' | 'lookup';

/** What the content script captures from the page. */
export interface CapturedSelection {
  text: string;
  /** The sentence the selection sits in. */
  sentence: string;
  /** Nearby paragraph text plus section heading, trimmed. */
  context: string;
  pageTitle: string;
  pageUrl: string;
  truncated: boolean;
  /** Where the page itself spells the term out, e.g. "Net Interest Margin (NIM)" or "“Services” means …". */
  pageDefinition?: string;
}

export interface ExplainRequest {
  text: string;
  sentence?: string;
  context?: string;
  pageTitle?: string;
  pageUrl?: string;
  pageDefinition?: string;
  level: ReadingLevel;
  length: AnswerLength;
  language: string;
  /** Reader's first language: adds a one-line gloss in it when it differs from `language`. */
  nativeLanguage?: string;
}

export interface FollowUpRequest {
  kind: FollowUpKind;
  text: string;
  meaning: string;
  context?: string;
  question?: string;
  level: ReadingLevel;
  language: string;
  /** Previous follow-up exchanges so "ask" can hold a short conversation. */
  thread?: { q: string; a: string }[];
}

export interface KeyTerm {
  term: string;
  definition: string;
}

export interface Explanation {
  kind: 'word' | 'phrase' | 'passage';
  headword: string;
  pronunciation?: string;
  partOfSpeech?: string;
  /** Core answer: what it means here. */
  meaning: string;
  /** Plain-language elaboration. */
  explanation?: string;
  /** General/dictionary sense when it differs from the in-context meaning. */
  definition?: string;
  example?: string;
  synonyms?: string[];
  keyTerms?: KeyTerm[];
  note?: string;
  /** Full form when the selection is an abbreviation or acronym. */
  expansion?: string;
  /** Short exact quote from the page that supports the meaning (verified to exist in what was sent). */
  fromPage?: string;
  /** "page" when the page itself states or defines the meaning, else general knowledge. */
  basis?: 'page' | 'general';
  confidence?: 'high' | 'medium' | 'low';
  /** One-line meaning in the reader's first language. */
  gloss?: string;
}

export interface FollowUpEntry {
  id: string;
  kind: FollowUpKind;
  label: string;
  answer: string;
  createdAt: number;
}

export interface Lookup {
  id: string;
  selection: CapturedSelection;
  result: Explanation;
  followUps: FollowUpEntry[];
  createdAt: number;
  saved: boolean;
  trigger: Trigger;
  language: string;
  level: ReadingLevel;
  source: string;
}

export interface Settings {
  aiSource: AiSource;
  provider: ProviderId;
  apiKeys: Partial<Record<ProviderId, string>>;
  models: Partial<Record<ProviderId, string>>;
  customBaseUrl: string;
  level: ReadingLevel;
  length: AnswerLength;
  language: string;
  /** Reader's first language for a short gloss; '' means none. */
  nativeLanguage: string;
  theme: ThemePreference;
  textScale: number;
  showChip: boolean;
  /** Underline terms already in the word list when they appear on new pages. */
  showSeen: boolean;
  includeContext: boolean;
  saveHistory: boolean;
  paused: boolean;
  disabledSites: string[];
  serverUrl: string;
  /** Send anonymous usage counts (never text) with hosted requests. */
  shareStats: boolean;
}

export interface Quota {
  limit: number;
  remaining: number;
  resetAt: number;
}

/** A request queued by the background worker for the side panel to pick up. */
export interface PendingRequest {
  id: string;
  selection: CapturedSelection;
  trigger: Trigger;
  createdAt: number;
  /** Window whose side panel should handle this (each window has its own panel). */
  windowId?: number;
}

export interface PanelNotice {
  id: string;
  windowId?: number;
  kind: 'no-selection' | 'restricted' | 'error' | 'pdf';
  message: string;
  /** For "pdf": the document to open in the Glossa reader. */
  url?: string;
  createdAt: number;
}

export type Message =
  | { type: 'CAPTURE_SELECTION' }
  | { type: 'SELECTION_STATE'; hasSelection: boolean }
  | { type: 'EXPLAIN_SELECTION'; selection: CapturedSelection; trigger: Trigger }
  | { type: 'EXPLAIN_ACTIVE_TAB'; trigger: Trigger }
  | { type: 'GET_SHORTCUT' }
  | { type: 'WARM_UP' }
  /** Scroll the page that has `url` open to `quote` and flash it. */
  | { type: 'SHOW_ON_PAGE'; url: string; quote: string }
  | { type: 'TOAST'; message: string; tone?: 'info' | 'warn' };
