import * as claudeProvider from './claudeProvider.js';
import * as openaiProvider from './openaiProvider.js';
import * as deepseekProvider from './deepseekProvider.js';
import * as geminiProvider from './geminiProvider.js';

// Registry of every supported AI provider. Each module exposes:
//   - generate(prompt: string): Promise<string>
//   - providerName: string   (human-readable label)
//   - defaultModel: string   (model id actually in use)
const providers = {
  claude:   claudeProvider,
  openai:   openaiProvider,
  chatgpt:  openaiProvider, // alias, in case AI_PROVIDER=chatgpt is set
  deepseek: deepseekProvider,
  gemini:   geminiProvider,
};

/**
 * Reads AI_PROVIDER from .env (defaults to "claude") and returns the
 * matching provider module. Throws a clear error for unknown values.
 */
export function getActiveProvider() {
  const key = (process.env.AI_PROVIDER ?? 'claude').trim().toLowerCase();
  const provider = providers[key];

  if (!provider) {
    const known = [...new Set(Object.keys(providers))].join(', ');
    throw new Error(
      `Unknown AI_PROVIDER "${key}" in .env. Supported values: ${known}.`
    );
  }
  return provider;
}

/**
 * Convenience helper: generates text using whichever provider is
 * configured via AI_PROVIDER in .env.
 * @param {string} prompt
 * @returns {Promise<{ text: string, providerName: string, model: string }>}
 */
export async function generateWithActiveProvider(prompt) {
  const provider = getActiveProvider();
  const text = await provider.generate(prompt);
  return {
    text,
    providerName: provider.providerName,
    model: provider.defaultModel,
  };
}
