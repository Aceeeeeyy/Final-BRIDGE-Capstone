import { GoogleGenAI } from '@google/genai';

let client;
function getClient() {
  if (!client) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set in .env');
    }
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

/**
 * Sends a single user-turn prompt to Gemini and returns the plain text reply.
 * @param {string} prompt
 * @returns {Promise<string>}
 */
export async function generate(prompt) {
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

  const response = await getClient().models.generateContent({
    model,
    contents: prompt,
  });

  return response.text ?? '';
}

export const providerName = 'Gemini';
export const defaultModel = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
