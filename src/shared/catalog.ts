import type { ProviderId } from './types';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  endpoint: string;
  models: { id: string; label: string }[];
  keyPrefix?: string;
  keyUrl: string;
  /** Host permission pattern needed to call this provider from the extension. */
  origin?: string;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
    ],
    keyPrefix: 'sk-',
    keyUrl: 'https://platform.openai.com/api-keys',
    origin: 'https://api.openai.com/*',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    endpoint: 'https://api.anthropic.com',
    models: [
      { id: 'claude-opus-5', label: 'Claude Opus 5' },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    ],
    keyPrefix: 'sk-ant-',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    origin: 'https://api.anthropic.com/*',
  },
  {
    id: 'groq',
    label: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    models: [
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (fastest)' },
    ],
    keyPrefix: 'gsk_',
    keyUrl: 'https://console.groq.com/keys',
    origin: 'https://api.groq.com/*',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    ],
    keyUrl: 'https://aistudio.google.com/apikey',
    origin: 'https://generativelanguage.googleapis.com/*',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    models: [
      { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini' },
      { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5' },
      { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
    ],
    keyPrefix: 'sk-or-',
    keyUrl: 'https://openrouter.ai/keys',
    origin: 'https://openrouter.ai/*',
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    endpoint: '',
    models: [],
    keyUrl: '',
  },
];

export function getProvider(id: ProviderId): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
}

export const LANGUAGES = [
  'English',
  'Hindi',
  'Spanish',
  'French',
  'German',
  'Portuguese',
  'Italian',
  'Dutch',
  'Russian',
  'Japanese',
  'Korean',
  'Chinese (Simplified)',
  'Arabic',
  'Turkish',
  'Indonesian',
  'Bengali',
  'Punjabi',
  'Tamil',
  'Urdu',
  'Vietnamese',
];
