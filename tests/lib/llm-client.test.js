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

  let requestedUrl, requestOptions;
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    requestedUrl = url;
    requestOptions = options;
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Gemini Response' }] } }],
      }),
    };
  };

  try {
    const result = await client.generateText(
      'system prompt text',
      'user message text',
    );
    assert.strictEqual(result, 'Gemini Response');
    assert.ok(requestedUrl.includes('gemini'));
    assert.strictEqual(
      requestOptions.headers['Content-Type'],
      'application/json',
    );
    assert.strictEqual(requestOptions.headers['x-goog-api-key'], 'mock-key');

    const body = JSON.parse(requestOptions.body);
    assert.strictEqual(
      body.systemInstruction.parts[0].text,
      'system prompt text',
    );
    assert.strictEqual(body.contents[0].role, 'user');
    assert.strictEqual(body.contents[0].parts[0].text, 'user message text');
    assert.strictEqual(body.generationConfig.maxOutputTokens, 8192);
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

  let requestedUrl, requestOptions;
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    requestedUrl = url;
    requestOptions = options;
    return {
      ok: true,
      json: async () => ({
        content: [{ text: 'Anthropic Response' }],
      }),
    };
  };

  try {
    const result = await client.generateText('system prompt', 'user prompt');
    assert.strictEqual(result, 'Anthropic Response');
    assert.ok(requestedUrl.includes('anthropic'));
    assert.strictEqual(requestOptions.headers['x-api-key'], 'mock-key');
    assert.strictEqual(
      requestOptions.headers['anthropic-version'],
      '2023-06-01',
    );

    const body = JSON.parse(requestOptions.body);
    assert.strictEqual(body.model, 'claude-3-7-sonnet-20250219');
    assert.strictEqual(body.system, 'system prompt');
    assert.strictEqual(body.messages[0].role, 'user');
    assert.strictEqual(body.messages[0].content, 'user prompt');
    assert.strictEqual(body.max_tokens, 8192);
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

  let requestedUrl, requestOptions;
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    requestedUrl = url;
    requestOptions = options;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'OpenAI Response' } }],
      }),
    };
  };

  try {
    const result = await client.generateText('system prompt', 'user prompt');
    assert.strictEqual(result, 'OpenAI Response');
    assert.ok(requestedUrl.includes('openai'));
    assert.strictEqual(requestOptions.headers.Authorization, 'Bearer mock-key');

    const body = JSON.parse(requestOptions.body);
    assert.strictEqual(body.model, 'gpt-4o');
    assert.strictEqual(body.messages[0].role, 'system');
    assert.strictEqual(body.messages[0].content, 'system prompt');
    assert.strictEqual(body.messages[1].role, 'user');
    assert.strictEqual(body.messages[1].content, 'user prompt');
    assert.strictEqual(body.max_tokens, 8192);
  } finally {
    global.fetch = originalFetch;
    delete process.env.OPENAI_API_KEY;
  }
});
