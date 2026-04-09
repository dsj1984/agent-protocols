import { LLMClient } from './llm-client.js';
import { Logger } from './Logger.js';

export class RefinementAgent {
  /**
   * @param {LLMClient} llmClient
   */
  constructor(llmClient) {
    this.llm = llmClient || new LLMClient();
  }

  /**
   * Generates a protocol change suggestion based on a friction pattern.
   *
   * @param {Object} pattern The identified friction pattern (from friction-service)
   * @param {string} fileContent The current content of the protocol file
   * @returns {Promise<{ explanation: string, newContent: string }>}
   */
  async generateSuggestion(pattern, fileContent) {
    Logger.info(
      `[RefinementAgent] Generating suggestion for pattern: ${pattern.patternId}`,
    );

    if (!fileContent) {
      throw new Error(
        '[RefinementAgent] fileContent is required to generate a suggestion.',
      );
    }

    const systemPrompt = `You are a Protocol Engineer specializing in AI coding assistant systems.
Your goal is to refine agent protocols based on observed friction logs to make the agent more autonomous, compliant, and less likely to encounter the same friction again.
You will be provided with:
1. The category of friction.
2. A summary of the pattern and a list of specific friction events.
3. The current content of the relevant protocol file.

Your output MUST be a valid JSON object with the following structure:
{
  "explanation": "A short, concise explanation of why this change is being made.",
  "newContent": "The complete, updated content of the protocol file."
}`;

    const userPrompt = `Friction Category: ${pattern.category}
Summary: ${pattern.summary}
Number of events: ${pattern.eventCount}
Events Details:
${pattern.events.map((e) => `- Task #${e.taskId}: ${e.details}`).join('\n')}

Current Protocol File Content:
\`\`\`
${fileContent}
\`\`\`

Generate the JSON object containing the explanation and the updated protocol file content. Only output the JSON object without any other text.`;

    try {
      const response = await this.llm.generateText(systemPrompt, userPrompt);

      const jsonMatch = response.match(/```(?:json)?\s*\n([\s\S]+?)\n```/) || [
        null,
        response,
      ];
      let jsonStr = jsonMatch[1].trim();

      // Sometimes it outputs JSON without markdown if prompted to only output JSON
      if (!jsonStr.startsWith('{')) {
        const start = response.indexOf('{');
        const end = response.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
          jsonStr = response.substring(start, end + 1);
        }
      }

      return JSON.parse(jsonStr);
    } catch (err) {
      Logger.error(
        `[RefinementAgent] Failed to generate suggestion: ${err.message}`,
      );
      throw err;
    }
  }
}
