import assert from 'node:assert/strict';
import test from 'node:test';
import { LLMClient } from '../../.agents/scripts/lib/llm-client.js';

test('LLMClient: constructor and provider detection', () => {
  process.env.GEMINI_API_KEY = 'mock-key';
  const client = new LLMClient();
  assert.strictEqual(client.provider, 'gemini');
  delete process.env.GEMINI_API_KEY;
});

test('LLMClient: _decodeHtmlEntities', () => {
  const client = new LLMClient({
    orchestration: { llm: { provider: 'openai' } },
  });
  const input = 'a &lt; b &amp; c &gt; d';
  assert.strictEqual(client._decodeHtmlEntities(input), 'a < b & c > d');
});

test('LLMClient: generateText (Gemini mock)', async () => {
  process.env.GEMINI_API_KEY = 'mock-key';
  const client = new LLMClient();

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: 'Gemini Response' }] } }],
    }),
  });

  try {
    const result = await client.generateText('system', 'user');
    assert.strictEqual(result, 'Gemini Response');
  } finally {
    global.fetch = originalFetch;
    delete process.env.GEMINI_API_KEY;
  }
});

test('LLMClient: generateText retry logic (Gemini mock)', async () => {
  process.env.GEMINI_API_KEY = 'mock-key';
  const client = new LLMClient();

  let attempts = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    attempts++;
    if (attempts === 1) {
      return {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => 'Rate limit',
      };
    }
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Success after retry' }] } }],
      }),
    };
  };

  // We need to bypass setTimeout to speed up the test
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (cb) => cb();

  try {
    const result = await client.generateText('system', 'user');
    assert.strictEqual(result, 'Success after retry');
    assert.strictEqual(attempts, 2);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    delete process.env.GEMINI_API_KEY;
  }
});
test('LLMClient: generateText (Anthropic mock)', async () => {
  process.env.ANTHROPIC_API_KEY = 'mock-key';
  const client = new LLMClient({
    orchestration: { llm: { provider: 'anthropic' } },
  });

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      content: [{ text: 'Anthropic Response' }],
    }),
  });

  try {
    const result = await client.generateText('system', 'user');
    assert.strictEqual(result, 'Anthropic Response');
  } finally {
    global.fetch = originalFetch;
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test('LLMClient: generateText (OpenAI mock)', async () => {
  process.env.OPENAI_API_KEY = 'mock-key';
  const client = new LLMClient({
    orchestration: { llm: { provider: 'openai' } },
  });

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: 'OpenAI Response' } }],
    }),
  });

  try {
    const result = await client.generateText('system', 'user');
    assert.strictEqual(result, 'OpenAI Response');
  } finally {
    global.fetch = originalFetch;
    delete process.env.OPENAI_API_KEY;
  }
});
