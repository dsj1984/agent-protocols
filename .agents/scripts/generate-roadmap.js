#!/usr/bin/env node
/**
 * generate-roadmap.js — v5 Roadmap Artifact Generator
 *
 * This script is responsible for generating the `roadmap.md` file in the
 * repository root. It serves as a read-only, auto-generated artifact that
 * mirrors the state of GitHub Issues (the Single Source of Truth).
 *
 * Usage:
 *   node generate-roadmap.js
 *
 * @see docs/v5-implementation-plan.md Sprint 3F
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveConfig, PROJECT_ROOT } from './lib/config-resolver.js';
import { createProvider } from './lib/provider-factory.js';

async function main() {
  console.log('Generating roadmap.md artifact...');

  const config = await resolveConfig();
  const provider = createProvider(config.techStack.ticketing, config.agentSettings);

  // 1. Fetch all Epics (Open and Closed)
  const allEpics = await provider.getEpics({ state: 'all' });

  // Sort: Open first, then by ID descending (newest first)
  const sortedEpics = allEpics.sort((a, b) => {
    if (a.state === 'open' && b.state === 'closed') return -1;
    if (a.state === 'closed' && b.state === 'open') return 1;
    return b.id - a.id;
  });

  const openEpics = sortedEpics.filter(e => e.state === 'open');
  const closedEpics = sortedEpics.filter(e => e.state === 'closed');

  // 2. Build Markdown
  const lines = [
    '# Project Roadmap',
    '',
    '> [!NOTE]',
    '> This file is a **READ-ONLY**, auto-generated artifact from GitHub Issues.',
    '> Issues serve as the absolute Single Source of Truth (SSOT).',
    '',
    `*Last Updated: ${new Date().toISOString().split('T')[0]}*`,
    '',
  ];

  if (openEpics.length > 0) {
    lines.push('## 🚀 Active Epics');
    lines.push('');
    for (const epic of openEpics) {
      lines.push(`- [ ] **#${epic.id}** — ${epic.title}`);
      
      // Optionally fetch sub-tickets for more detail
      try {
        const subTickets = await provider.getTickets(epic.id);
        const done = subTickets.filter(t => t.labels.includes('agent::done')).length;
        const total = subTickets.length;
        if (total > 0) {
          const percent = Math.round((done / total) * 100);
          lines.push(`  - Progress: ${percent}% (${done}/${total} tasks)`);
        }
      } catch (err) {
        // Fallback for epics without child tickets or API issues
      }
    }
    lines.push('');
  }

  if (closedEpics.length > 0) {
    lines.push('## ✅ Completed Epics');
    lines.push('');
    for (const epic of closedEpics) {
      lines.push(`- [x] **#${epic.id}** — ${epic.title}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('Manage this roadmap by interacting with the Epic issues on GitHub.');

  const content = lines.join('\n');

  // 3. Write to root
  const outputPath = path.join(PROJECT_ROOT, 'roadmap.md');
  fs.writeFileSync(outputPath, content, 'utf8');

  console.log(`Successfully generated roadmap.md at ${outputPath}`);
}

main().catch(err => {
  console.error('Failed to generate roadmap:', err);
  process.exit(1);
});
