/**
 * Product identity and deployment endpoints.
 * API_BASE / WEBSITE_URL are injected at build time (see scripts/build.js).
 */

declare const __API_BASE__: string;
declare const __WEBSITE_URL__: string;
declare const __VERSION__: string;

export const BRAND = {
  name: 'Glossa',
  tagline: 'Select any text. Know what it means.',
  hostedModelLabel: 'Glossa Standard',
} as const;

export const API_BASE: string =
  typeof __API_BASE__ !== 'undefined' ? __API_BASE__ : 'http://localhost:7717';

export const WEBSITE_URL: string =
  typeof __WEBSITE_URL__ !== 'undefined' ? __WEBSITE_URL__ : 'http://localhost:7717';

export const VERSION: string = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.0-dev';

export const LIMITS = {
  maxSelectionChars: 4000,
  maxContextChars: 1800,
  maxQuestionChars: 500,
  historyItems: 2000,
  lexiconItems: 20000,
  cacheItems: 200,
  // Covers a cold start, the server's 24s model budget and one retry.
  requestTimeoutMs: 40000,
} as const;
