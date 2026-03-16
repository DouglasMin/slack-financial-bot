import OpenAI from 'openai';

const client = new OpenAI({ timeout: 60_000 }); // 60s timeout

/**
 * General chat completion using gpt-5-mini by default.
 * @param {Array<{role: string, content: string}>} messages
 * @param {Object} options
 * @param {string} [options.model='gpt-5-mini']
 * @param {number} [options.maxTokens=1000]
 * @returns {Promise<string>} The assistant's response content.
 */
export async function chat(messages, options = {}) {
  const model = options.model || 'gpt-5-mini';
  const maxTokens = options.maxTokens || 4096;

  try {
    const response = await client.chat.completions.create({
      model,
      messages,
      max_completion_tokens: maxTokens,
    });

    const choice = response.choices[0];
    console.log('[openai.chat] finish_reason:', choice.finish_reason, 'refusal:', choice.message.refusal);
    return choice.message.content || choice.message.refusal || '';
  } catch (error) {
    console.error('[openai.chat] Error:', error.message);
    throw error;
  }
}

/**
 * Deep analysis for scheduled briefings using gpt-5.
 * @param {Object} data - Market data / news payload to analyze.
 * @param {string} instruction - System-level instruction for the analysis.
 * @returns {Promise<string>} The analysis content.
 */
export async function analyze(data, instruction) {
  try {
    const response = await client.chat.completions.create({
      model: 'gpt-5',
      messages: [
        { role: 'system', content: instruction },
        { role: 'user', content: JSON.stringify(data) },
      ],
      max_completion_tokens: 8192,
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('[openai.analyze] Error:', error.message);
    throw error;
  }
}
