import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolveConfig } from './lib/config-resolver.js';
import { Logger } from './lib/Logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const { settings } = resolveConfig();
const cmdConfig = settings.lintBaselineCommand ?? 'npx eslint . --format json';
const baselinePathRel = settings.lintBaselinePath ?? 'temp/lint-baseline.json';
const baselinePath = path.resolve(PROJECT_ROOT, baselinePathRel);
const executionTimeoutMs = settings.executionTimeoutMs ?? 300000;
const executionMaxBuffer = settings.executionMaxBuffer ?? 10485760;

const mode = process.argv[2];
if (mode !== 'capture' && mode !== 'check') {
  Logger.fatal('Usage: node lint-baseline.js <capture|check>');
}

function runLintCommand() {
  const result = spawnSync(cmdConfig, {
    cwd: PROJECT_ROOT,
    encoding: 'utf-8',
    timeout: executionTimeoutMs,
    maxBuffer: executionMaxBuffer,
    shell: true
  });
  
  try {
    const jsonStr = result.stdout.trim();
    // Parse the JSON array. Find start and end to avoid extraneous shell output
    const startIndex = jsonStr.indexOf('[');
    const endIndex = jsonStr.lastIndexOf(']');
    if (startIndex === -1 || endIndex === -1) {
      if (jsonStr === '') return { errorCount: 0, warningCount: 0 };
      throw new Error("Could not find JSON array in output. Output: " + jsonStr.substring(0, 100));
    }
    const cleanJson = jsonStr.substring(startIndex, endIndex + 1);
    const output = JSON.parse(cleanJson);
    let totalErrors = 0;
    let totalWarnings = 0;
    for (const file of output) {
      totalErrors += file.errorCount || 0;
      totalWarnings += file.warningCount || 0;
    }
    return { errorCount: totalErrors, warningCount: totalWarnings };
  } catch (err) {
    Logger.fatal(`Lint baseline parse error: ${err.message}\nCommand: ${cmdConfig}`);
  }
}

if (mode === 'capture') {
  console.log(`▶ [lint-baseline] Capturing lint baseline...`);
  const totals = runLintCommand();
  const dir = path.dirname(baselinePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(baselinePath, JSON.stringify(totals, null, 2), 'utf8');
  console.log(`✅ Baseline captured: ${totals.errorCount} errors, ${totals.warningCount} warnings.`);
  console.log(`   Saved to: ${baselinePathRel}`);
  process.exit(0);
}

if (mode === 'check') {
  console.log(`▶ [lint-baseline] Checking lint against baseline...`);
  const current = runLintCommand();
  
  let baseline = { errorCount: 0, warningCount: 0 };
  if (fs.existsSync(baselinePath)) {
    baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  } else {
    console.warn(`⚠️ No baseline found at ${baselinePathRel}. Assuming 0 baseline.`);
  }

  console.log(`   Baseline: ${baseline.errorCount} errors, ${baseline.warningCount} warnings`);
  console.log(`   Current:  ${current.errorCount} errors, ${current.warningCount} warnings`);

  if (current.errorCount > baseline.errorCount || current.warningCount > baseline.warningCount) {
    console.error(`\n🚨 LINT DEGRADATION DETECTED!`);
    console.error(`You have introduced new lint issues compared to the baseline.`);
    console.error(`Please fix them before continuing.`);
    process.exit(1);
  }

  // Ratchet (shrink baseline) if better
  if (current.errorCount < baseline.errorCount || current.warningCount < baseline.warningCount) {
     fs.writeFileSync(baselinePath, JSON.stringify(current, null, 2), 'utf8');
     console.log(`🎉 Lint health improved! Ratcheted baseline down to current levels.`);
  }

  console.log(`✅ Lint check passed.`);
  process.exit(0);
}
