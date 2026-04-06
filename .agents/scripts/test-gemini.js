import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLMClient } from './lib/llm-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// Simple zero-dependency .env loader
function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach((line) => {
      const [key, ...val] = line.split('=');
      if (key && val.length > 0) {
        process.env[key.trim()] = val.join('=').trim();
      }
    });
  }
}

async function testGemini() {
  console.log('[Test] Loading environment...');
  loadEnv();

  if (!process.env.GEMINI_API_KEY) {
    console.error('[Error] GEMINI_API_KEY not found in .env or environment.');
    process.exit(1);
  }

  console.log('[Test] Initialising LLMClient with Gemini...');
  const client = new LLMClient({
    orchestration: {
      llm: { provider: 'gemini', model: 'gemini-1.5-pro' },
    },
  });
  console.log(`[Test] Using Model: ${client.model}`);

  try {
    console.log('[Test] Sending ping to Gemini API...');
    const response = await client.generateText(
      'You are a test assistant.',
      "Respond with exactly one word: 'SUCCESS'",
    );

    console.log(`[Test] Received response: "${response.trim()}"`);
    if (response.trim().toUpperCase().includes('SUCCESS')) {
      console.log('[Test] ✅ Gemini API connection verified successfully!');
    } else {
      console.warn(
        '[Test] ⚠️ Gemini API responded, but not with the expected word.',
      );
    }
  } catch (err) {
    console.error('[Test] ❌ Gemini API connection failed:');
    console.error(err.message);
    process.exit(1);
  }
}

testGemini();
