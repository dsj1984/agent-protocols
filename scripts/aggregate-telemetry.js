/**
 * aggregate-telemetry.js
 * 
 * Macroscopic telemetry aggregation tool for Agent Protocols.
 * Parses agent-friction-log.json files across a range of sprints and generates
 * a structured Markdown report highlighting trends and bottlenecks.
 * 
 * Usage:
 *   node .agents/scripts/aggregate-telemetry.js --from 40 --to 42
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger } from './lib/Logger.js';
import { ensureDirSync } from './lib/fs-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let fromSprint = 1;
let toSprint = 999;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--from') fromSprint = parseInt(args[++i], 10);
  if (args[i] === '--to') toSprint = parseInt(args[++i], 10);
}

const PROJECT_ROOT = process.cwd();
const SPRINTS_ROOT = path.join(PROJECT_ROOT, 'docs', 'sprints');
const REPORT_OUTPUT = path.join(PROJECT_ROOT, 'docs', 'telemetry', 'observer-report.md');

function getPaddedSprint(n) {
  return String(n).padStart(3, '0');
}

function parseFrictionLog(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  return content.split('\n')
    .filter(line => line.trim())
    .map(line => {
      try { return JSON.parse(line); } 
      catch (e) { return null; }
    })
    .filter(Boolean);
}

function generateReport() {
  console.log(`[Telemetry Observer] Aggregating sprints ${fromSprint} to ${toSprint}...`);
  
  const stats = {
    totalSprints: 0,
    totalFrictionPoints: 0,
    toolFailures: {},
    tokenUsage: { total: 0 },
    sprintData: []
  };

  if (!fs.existsSync(SPRINTS_ROOT)) {
    Logger.fatal(`Sprints directory not found: ${SPRINTS_ROOT}`);
    
  }

  const sprintDirs = fs.readdirSync(SPRINTS_ROOT)
    .filter(d => d.startsWith('sprint-'))
    .map(d => parseInt(d.split('-')[1], 10))
    .filter(n => n >= fromSprint && n <= toSprint)
    .sort((a, b) => a - b);

  for (const n of sprintDirs) {
    const padded = getPaddedSprint(n);
    const sprintPath = path.join(SPRINTS_ROOT, `sprint-${padded}`);
    const logPath = path.join(sprintPath, 'agent-friction-log.json');

    const frictionEntries = parseFrictionLog(logPath);
    stats.totalFrictionPoints += frictionEntries.length;
    
    frictionEntries.forEach(entry => {
      if (entry.type === 'friction_point' || entry.type === 'tool_failure') {
        const tool = entry.tool || 'unknown';
        stats.toolFailures[tool] = (stats.toolFailures[tool] || 0) + 1;
      }
      if (entry.type === 'token_usage') {
        stats.tokenUsage.total += (entry.usage || 0);
      }
    });

    stats.sprintData.push({
      number: padded,
      frictionCount: frictionEntries.length
    });
    stats.totalSprints++;
  }

  // Render Markdown
  let md = `# Telemetry Observer Report\n\n`;
  md += `> **Range:** Sprint ${fromSprint} to ${toSprint} | **Generated:** ${new Date().toISOString()}\n\n`;
  
  md += `## 📊 Executive Summary\n\n`;
  md += `| Metric | Value |\n`;
  md += `| :--- | :--- |\n`;
  md += `| **Sprints Analyzed** | ${stats.totalSprints} |\n`;
  md += `| **Total Friction Points** | ${stats.totalFrictionPoints} |\n`;
  md += `| **Total Tokens Consumed** | ${stats.tokenUsage.total.toLocaleString()} |\n`;
  md += `| **Avg Friction per Sprint** | ${(stats.totalFrictionPoints / (stats.totalSprints || 1)).toFixed(2)} |\n\n`;

  md += `## 🛠️ Most Frequent Tool Failures\n\n`;
  const sortedTools = Object.entries(stats.toolFailures).sort((a, b) => b[1] - a[1]);
  if (sortedTools.length > 0) {
    md += `| Tool | Failures |\n`;
    md += `| :--- | :--- |\n`;
    sortedTools.slice(0, 10).forEach(([tool, count]) => {
      md += `| \`${tool}\` | ${count} |\n`;
    });
  } else {
    md += `*No significant tool failures logged in this range.*\n`;
  }
  md += `\n`;

  md += `## 📈 Efficiency Trends\n\n`;
  md += `| Sprint | Friction Count |\n`;
  md += `| :--- | :--- |\n`;
  stats.sprintData.forEach(s => {
    md += `| ${s.number} | ${s.frictionCount} |\n`;
  });
  md += `\n`;

  md += `## 💡 Productivity Bottlenecks\n\n`;
  if (sortedTools.length > 0) {
    const topTool = sortedTools[0][0];
    md += `1. **Top Blocker:** \`${topTool}\` is the primary source of friction. Recommend reviewing the manual instruction set or adding a dedicated \`.agents/skills/\` entry to automate common failure modes for this tool.\n`;
  }
  if (stats.totalFrictionPoints / (stats.totalSprints || 1) > 10) {
    md += `2. **High Friction Warning:** Average friction points are exceeding 10 per sprint. Consider a "Maintenance Sprint" to harden protocols and reduce architectural debt.\n`;
  } else {
    md += `2. **Healthy Velocity:** Overall friction levels are within acceptable thresholds.\n`;
  }

  // Ensure telemetry dir exists
  const reportDir = path.dirname(REPORT_OUTPUT);
  ensureDirSync(reportDir);

  fs.writeFileSync(REPORT_OUTPUT, md, 'utf8');
  console.log(`✅ Telemetry report generated: ${REPORT_OUTPUT}`);
}

generateReport();
