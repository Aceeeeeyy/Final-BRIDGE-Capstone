import OpenAI from 'openai';

let client;
function getClient() {
  if (!client) {
    if (!process.env.DEEPSEEK_API_KEY) {
      throw new Error('DEEPSEEK_API_KEY is not set in .env');
    }
    // DeepSeek exposes an OpenAI-compatible REST API, so the official
    // `openai` SDK works here too — just point it at DeepSeek's base URL.
    client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: 'https://api.deepseek.com',
    });
  }
  return client;
}

/**
 * Sends a single user-turn prompt to DeepSeek and returns the plain text reply.
 * @param {string} prompt
 * @returns {Promise<string>}
 */
export async function generate(prompt) {
  const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';

  const completion = await getClient().chat.completions.create({
    model,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  return completion.choices[0]?.message?.content ?? '';
}

export const providerName = 'DeepSeek';
export const defaultModel = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';
