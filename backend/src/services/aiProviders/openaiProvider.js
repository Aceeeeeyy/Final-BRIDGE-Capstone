import OpenAI from 'openai';

let client;
function getClient() {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set in .env');
    }
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

/**
 * Sends a single user-turn prompt to ChatGPT and returns the plain text reply.
 * @param {string} prompt
 * @returns {Promise<string>}
 */
export async function generate(prompt) {
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o';

  const completion = await getClient().chat.completions.create({
    model,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  return completion.choices[0]?.message?.content ?? '';
}

export const providerName = 'ChatGPT';
export const defaultModel = process.env.OPENAI_MODEL ?? 'gpt-4o';
