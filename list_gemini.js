import fs from 'node:fs';

async function listModels() {
  const env = fs.readFileSync('.env', 'utf8');
  const line = env.split('\n').find(l => l.includes('GEMINI_API_KEY'));
  if (!line) {
    console.error('No GEMINI_API_KEY found');
    return;
  }
  const key = line.split('=')[1].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
  const data = await res.json();
  if (data.models) {
    console.log(data.models.map(m => m.name));
  } else {
    console.error('Error fetching models:', JSON.stringify(data, null, 2));
  }
}

listModels().catch(console.error);
