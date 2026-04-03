import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { resolveConfig } from './lib/config-resolver.js';import { Logger } from "./lib/Logger.js";


/**
 * Automates the harvesting of "Golden Architecture Paths". 
 * Extracts prompts and diffs from tasks that completed with zero friction log entries.
 * 
 * Usage: node .agents/scripts/harvest-golden-path.js --task <id> --sprint <path> --base <branch>
 */

const args = process.argv.slice(2);
let taskId = '';
let sprintRoot = '';

// Load settings via unified configuration resolver
const { settings: agentConfig } = resolveConfig();
let baseBranch = agentConfig.baseBranch ?? 'main';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--task') taskId = args[++i];
  if (args[i] === '--sprint') sprintRoot = args[++i];
  if (args[i] === '--base') baseBranch = args[++i];
}

if (!taskId || !sprintRoot) {
  Logger.fatal("Usage: node .agents/scripts/harvest-golden-path.js --task <id> --sprint <path> [--base <branch>]");
  
}

const frictionLogPath = path.join(sprintRoot, 'agent-friction-log.json');
let goldenExamplesRoot = agentConfig.goldenExamplesRoot ?? 'temp/golden-examples';

const goldenDir = path.join(process.cwd(), goldenExamplesRoot);

// 1. Check for friction associated with this task ID
if (fs.existsSync(frictionLogPath)) {
  const content = fs.readFileSync(frictionLogPath, 'utf8');
  const lines = content.trim().split('\n');
  const hasFriction = lines.some(l => {
    try {
      const entry = JSON.parse(l);
      return entry.task === taskId;
    } catch { return false; }
  });
  
  if (hasFriction) {
    console.log(`[Golden-Path Harvesting] Task ${taskId} encountered friction points. Skipping harvest.`);
    process.exit(0);
  }
}

// 2. Extract the codebase diff for this task branch vs the sprint base
try {
  const diff = execSync(`git diff ${baseBranch}...HEAD`, { encoding: 'utf8' });
  if (!diff.trim()) {
    console.log(`[Golden-Path Harvesting] Task ${taskId} resulted in no code changes. Skipping harvest.`);
    process.exit(0);
  }
  
  // 3. Heuristically extract the original task instructions from the playbook
  const playbookPath = path.join(sprintRoot, 'playbook.md');
  let instructions = "Instructions not found in playbook.md.";
  if (fs.existsSync(playbookPath)) {
    const playbook = fs.readFileSync(playbookPath, 'utf8');
    // Regex matches the task block by ID and grabs the instruction text following the checkbox
    const taskRegex = new RegExp(`### Task ${taskId.replace('.', '\\.')}\\b[\\s\\S]*?\\n\\-\\s\\[\\s\\]\\s([\\s\\S]*?)(?=\\n###|$)`, 'i');
    const taskMatch = playbook.match(taskRegex);
    if (taskMatch) {
      instructions = taskMatch[1].trim();
    }
  }

  // 4. Persistence of the Golden Example
  if (!fs.existsSync(goldenDir)) fs.mkdirSync(goldenDir, { recursive: true });
  
  const goldenOutput = `---
task: "${taskId}"
date: "${new Date().toISOString()}"
---

### Problem (Agent Instructions)
${instructions}

### Solution (Zero-Friction Git Diff)
\`\`\`diff
${diff.trim()}
\`\`\`
`;
  
  const outPath = path.join(goldenDir, `${taskId}.md`);
  fs.writeFileSync(outPath, goldenOutput);
  console.log(`✅ [Golden-Path Harvesting] Successfully harvested zero-friction execution for Task ${taskId}!`);
  console.log(`Saved to: ${goldenExamplesRoot}/${taskId}.md`);
} catch (err) {
  console.error(`⚠️ [Golden-Path Harvesting] Failed to extract diff or write example: ${err.message}`);
}
