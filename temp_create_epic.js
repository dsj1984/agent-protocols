import fs from 'node:fs';
import { createProvider } from './.agents/scripts/lib/provider-factory.js';
import { resolveConfig } from './.agents/scripts/lib/config-resolver.js';

// Load .env
if (fs.existsSync('.env')) {
  fs.readFileSync('.env', 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && val.length) {
      process.env[key.trim()] = val.join('=').trim().replace(/^"(.*)"$/, '$1');
    }
  });
}

async function main() {
  const { orchestration } = resolveConfig();
  const provider = createProvider(orchestration);

  const ticket = await provider._rest(`/repos/${orchestration.github.owner}/${orchestration.github.repo}/issues`, {
    method: 'POST',
    body: {
      title: 'V5 Foundation Cleanup & Standards Sync',
      body: 'This Epic tracks the final refinement and standardization of the v5.0.0-beta.1 release.\n\nKey goals:\n- Remove all legacy v4 local sprint directories.\n- Sync all `.agents/templates` with the latest v5 standards.\n- Update the system instructions to explicitly reference the v5 two-command UX.\n- Ensure all provider logic correctly handles both fine-grained and classic tokens.',
      labels: ['type::epic']
    }
  });

  console.log(`Created Epic: ${ticket.html_url} (#${ticket.number})`);
}

main().catch(console.error);
