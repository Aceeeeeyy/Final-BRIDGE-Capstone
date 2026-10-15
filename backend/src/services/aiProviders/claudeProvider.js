import Anthropic from '@anthropic-ai/sdk';

let client;
function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set in .env');
    }
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * Sends a single user-turn prompt to Claude and returns the plain text reply.
 * @param {string} prompt
 * @returns {Promise<string>}
 */
export async function generate(prompt) {
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

  const message = await getClient().messages.create({
    model,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  return message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

export const providerName = 'Claude';
export const defaultModel = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
