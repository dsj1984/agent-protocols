import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { resolveConfig } from './lib/config-resolver.js';
import { Logger } from "./lib/Logger.js";
import { ensureDirSync } from './lib/fs-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Automates the harvesting of "Golden Architecture Paths". 
 * Extracts prompts and diffs from tasks that completed with zero friction log entries.
 * Now also updates .agents/instructions.md with the latest examples.
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
let goldenExamplesRoot = agentConfig.goldenExamplesRoot ?? '.agents/golden-examples';
const goldenDir = path.join(process.cwd(), goldenExamplesRoot);

/**
 * Updates .agents/instructions.md with the recent golden examples.
 */
function updateInstructions(goldenDir, agentConfig) {
  const instructionsPath = path.join(process.cwd(), '.agents/instructions.md');
  if (!fs.existsSync(instructionsPath)) return;

  try {
    const files = fs.readdirSync(goldenDir)
      .filter(f => f.endsWith('.md'))
      .sort((a, b) => {
        const statsA = fs.statSync(path.join(goldenDir, a));
        const statsB = fs.statSync(path.join(goldenDir, b));
        return statsB.mtime - statsA.mtime; // Descending mtime
      });

    if (files.length === 0) return;

    // Pick top 3 for the instructions
    const selection = files.slice(0, 3);
    let injection = "\n";
    for (const file of selection) {
      let content = fs.readFileSync(path.join(goldenDir, file), 'utf8');
      // Sanitize backticks
      content = content.replace(/`{4,}/g, '```');
      injection += `---\n\n${content}\n\n`;
    }

    let instructions = fs.readFileSync(instructionsPath, 'utf8');
    const startTag = '<!-- GOLDEN_EXAMPLES_START -->';
    const endTag = '<!-- GOLDEN_EXAMPLES_END -->';
    
    if (instructions.includes(startTag) && instructions.includes(endTag)) {
      const parts = instructions.split(startTag);
      const afterStart = parts[1].split(endTag);
      const newInstructions = parts[0] + startTag + injection + endTag + afterStart[1];
      fs.writeFileSync(instructionsPath, newInstructions);
      console.log(`✅ [Golden-Path] Updated .agents/instructions.md with ${selection.length} recent examples.`);
    }
  } catch (err) {
    console.warn(`⚠️ [Golden-Path] Failed to update instructions.md: ${err.message}`);
  }
}

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
const MAX_DIFF_LINES = agentConfig.maxGoldenExampleLines ?? 200;

try {
  const diff = execFileSync('git', ['diff', `${baseBranch}...HEAD`], { encoding: 'utf8' });
  if (!diff.trim()) {
    console.log(`[Golden-Path Harvesting] Task ${taskId} resulted in no code changes. Skipping harvest.`);
    process.exit(0);
  }

  // Get a compact stat summary for context (always included in full)
  let statSummary = '';
  try {
    statSummary = execFileSync('git', ['diff', '--stat', `${baseBranch}...HEAD`], { encoding: 'utf8' }).trim();
  } catch { /* ignore stat failures */ }

  // Truncate the raw diff to prevent playbook size explosion
  const diffLines = diff.trim().split('\n');
  let truncatedDiff;
  let wasTruncated = false;
  if (diffLines.length > MAX_DIFF_LINES) {
    truncatedDiff = diffLines.slice(0, MAX_DIFF_LINES).join('\n');
    wasTruncated = true;
  } else {
    truncatedDiff = diff.trim();
  }
  
  // 3. Heuristically extract the original task instructions from the playbook
  const playbookPath = path.join(sprintRoot, 'playbook.md');
  let playbookInstructions = "Instructions not found in playbook.md.";
  if (fs.existsSync(playbookPath)) {
    const playbook = fs.readFileSync(playbookPath, 'utf8');
    const taskRegex = new RegExp(`### Task ${taskId.replace('.', '\\\\.')}\\\\b[\\\\s\\\\S]*?\\\\n\\\\-\\\\s\\\\[\\\\s\\\\]\\\\s([\\\\s\\\\S]*?)(?=\\\\n###|$)`, 'i');
    const taskMatch = playbook.match(taskRegex);
    if (taskMatch) {
      playbookInstructions = taskMatch[1].trim();
    }
  }

  // 4. Persistence of the Golden Example
  ensureDirSync(goldenDir);
  
  const truncationNotice = wasTruncated
    ? `\n[...truncated from ${diffLines.length} lines to ${MAX_DIFF_LINES} — full diff available on the task branch]\n`
    : '';

  const goldenOutput = `---
task: "${taskId}"
date: "${new Date().toISOString()}"
---

### Problem (Agent Instructions)
${playbookInstructions}

### Summary (Files Changed)
\`\`\`
${statSummary}
\`\`\`

### Solution (Zero-Friction Git Diff)
\`\`\`diff
${truncatedDiff}${truncationNotice}
\`\`\`
`;
  
  const outPath = path.join(goldenDir, `${taskId}.md`);
  fs.writeFileSync(outPath, goldenOutput);
  console.log(`✅ [Golden-Path Harvesting] Successfully harvested zero-friction execution for Task ${taskId}!`);
  console.log(`Saved to: ${goldenExamplesRoot}/${taskId}.md`);
  if (wasTruncated) {
    console.log(`ℹ️  Diff was truncated from ${diffLines.length} to ${MAX_DIFF_LINES} lines.`);
  }

  // 5. Update instructions.md
  updateInstructions(goldenDir, agentConfig);

} catch (err) {
  console.error(`⚠️ [Golden-Path Harvesting] Failed to extract diff or write example: ${err.message}`);
  console.error(err.stack);
}
