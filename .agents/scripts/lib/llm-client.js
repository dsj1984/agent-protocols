/**
 * llm-client.js
 *
 * A lightweight, zero-dependency LLM client using native fetch() (Node 20+).
 * Automatically resolves the provider based on orchestration config or
 * available environment variables (GEMINI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY).
 */

import { resolveConfig } from './config-resolver.js';

export class LLMClient {
  constructor(config = {}) {
    // 1. Check local config override
    // 2. Check global .agentrc.json orchestration block
    // 3. Fallback to API key presence
    const orchestration = config.orchestration ?? resolveConfig().orchestration ?? {};
    const llmConfig = orchestration.llm ?? {};

    this.provider = llmConfig.provider || this._detectProvider();
    this.model = llmConfig.model || this._defaultModel(this.provider);
    this.maxInputTokens = llmConfig.maxInputTokens || 64000;
    this.maxOutputTokens = llmConfig.maxOutputTokens || 8192;
  }

  _detectProvider() {
    if (process.env.GEMINI_API_KEY) return 'gemini';
    if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
    if (process.env.OPENAI_API_KEY) return 'openai';
    throw new Error('[LLMClient] No API key found in environment for Gemini, Anthropic, or OpenAI.');
  }

  _defaultModel(provider) {
    if (provider === 'gemini') return 'gemini-2.5-pro';
    if (provider === 'anthropic') return 'claude-3-7-sonnet-20250219';
    if (provider === 'openai') return 'gpt-4o';
    return 'default-model';
  }

  async generateText(systemPrompt, userPrompt) {
    const inputLength = systemPrompt.length + userPrompt.length;
    // rough heuristic: 1 token ~= 4 chars
    const estimatedTokens = Math.ceil(inputLength / 4);
    if (estimatedTokens > this.maxInputTokens) {
      throw new Error(`[LLMClient] Estimated input tokens (${estimatedTokens}) exceeds configured maxInputTokens (${this.maxInputTokens}). Remove excessive context or increase the threshold.`);
    }

    switch (this.provider) {
      case 'gemini':
        return this._callGemini(systemPrompt, userPrompt);
      case 'anthropic':
        return this._callAnthropic(systemPrompt, userPrompt);
      case 'openai':
        return this._callOpenAI(systemPrompt, userPrompt);
      default:
        throw new Error(`[LLMClient] Unsupported provider: ${this.provider}`);
    }
  }

  async _callGemini(systemPrompt, userPrompt) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY missing');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
    const payload = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { maxOutputTokens: this.maxOutputTokens }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`[Gemini API Error] ${res.status}: ${err}`);
    }

    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }

  async _callAnthropic(systemPrompt, userPrompt) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY missing');

    const url = 'https://api.anthropic.com/v1/messages';
    const payload = {
      model: this.model,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: this.maxOutputTokens
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`[Anthropic API Error] ${res.status}: ${err}`);
    }

    const data = await res.json();
    return data.content?.[0]?.text ?? '';
  }

  async _callOpenAI(systemPrompt, userPrompt) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY missing');

    const url = 'https://api.openai.com/v1/chat/completions';
    const payload = {
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: this.maxOutputTokens
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`[OpenAI API Error] ${res.status}: ${err}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }
}
