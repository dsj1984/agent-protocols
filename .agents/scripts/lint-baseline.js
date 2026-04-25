import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgsStringToArgv } from 'string-argv';
import { runAsCli } from './lib/cli-utils.js';
import {
  getBaselines,
  getCommands,
  getLimits,
  resolveConfig,
} from './lib/config-resolver.js';
import { Logger } from './lib/Logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

export function parseLintOutput(jsonStr, _cmdConfig) {
  // Parse the JSON array. Find start and end to avoid extraneous shell output
  const startIndex = jsonStr.indexOf('[');
  const endIndex = jsonStr.lastIndexOf(']');
  if (startIndex === -1 || endIndex === -1) {
    if (jsonStr === '') return { errorCount: 0, warningCount: 0 };
    throw new Error(
      'Could not find JSON array in output. Output: ' +
        jsonStr.substring(0, 100),
    );
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
}

export function runLintCommand(
  cmdConfig,
  executionTimeoutMs,
  executionMaxBuffer,
) {
  const parsedArgs = parseArgsStringToArgv(cmdConfig);
  if (parsedArgs.length === 0) {
    console.warn(`⚠️ [lint-baseline] Empty command configuration provided.`);
    return { errorCount: 0, warningCount: 0 };
  }
  const cmd = parsedArgs.shift();
  const cmdArgs = parsedArgs;
  const result = spawnSync(cmd, cmdArgs, {
    cwd: PROJECT_ROOT,
    encoding: 'utf-8',
    timeout: executionTimeoutMs,
    maxBuffer: executionMaxBuffer,
    shell: false,
  });

  try {
    const jsonStr = result.stdout.trim();
    return parseLintOutput(jsonStr, cmdConfig);
  } catch (err) {
    console.warn(
      `⚠️ [lint-baseline] Failed to parse JSON from command output. Falling back to 0 errors.\n` +
        `   Command: ${cmdConfig}\n` +
        `   Error: ${err.message}`,
    );
    return { errorCount: 0, warningCount: 0 };
  }
}

export function captureBaseline(
  cmdConfig,
  executionTimeoutMs,
  executionMaxBuffer,
  baselinePath,
  baselinePathRel,
) {
  console.log(`▶ [lint-baseline] Capturing lint baseline...`);
  const totals = runLintCommand(
    cmdConfig,
    executionTimeoutMs,
    executionMaxBuffer,
  );
  const dir = path.dirname(baselinePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(baselinePath, JSON.stringify(totals, null, 2), 'utf8');
  console.log(
    `✅ Baseline captured: ${totals.errorCount} errors, ${totals.warningCount} warnings.`,
  );
  console.log(`   Saved to: ${baselinePathRel}`);
}

export function checkBaseline(
  cmdConfig,
  executionTimeoutMs,
  executionMaxBuffer,
  baselinePath,
  baselinePathRel,
) {
  console.log(`▶ [lint-baseline] Checking lint against baseline...`);
  const current = runLintCommand(
    cmdConfig,
    executionTimeoutMs,
    executionMaxBuffer,
  );

  let baseline = { errorCount: 0, warningCount: 0 };
  if (fs.existsSync(baselinePath)) {
    baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  } else {
    console.warn(
      `⚠️ No baseline found at ${baselinePathRel}. Assuming 0 baseline.`,
    );
  }

  console.log(
    `   Baseline: ${baseline.errorCount} errors, ${baseline.warningCount} warnings`,
  );
  console.log(
    `   Current:  ${current.errorCount} errors, ${current.warningCount} warnings`,
  );

  if (
    current.errorCount > baseline.errorCount ||
    current.warningCount > baseline.warningCount
  ) {
    console.error(`\n🚨 LINT DEGRADATION DETECTED!`);
    console.error(
      `You have introduced new lint issues compared to the baseline.`,
    );
    Logger.fatal();
  }

  // Ratchet (shrink baseline) if better
  if (
    current.errorCount < baseline.errorCount ||
    current.warningCount < baseline.warningCount
  ) {
    fs.writeFileSync(baselinePath, JSON.stringify(current, null, 2), 'utf8');
    console.log(
      `🎉 Lint health improved! Ratcheted baseline down to current levels.`,
    );
  }

  console.log(`✅ Lint check passed.`);
}

export async function main(args = process.argv) {
  const mode = args[2];
  if (mode !== 'capture' && mode !== 'check') {
    Logger.fatal('Usage: node lint-baseline.js <capture|check>');
  }

  const { settings } = resolveConfig();
  const cmdConfig = getCommands({ agentSettings: settings }).lintBaseline;
  const baselinePathRel = getBaselines({ agentSettings: settings }).lint.path;
  const baselinePath = path.resolve(PROJECT_ROOT, baselinePathRel);
  const limits = getLimits({ agentSettings: settings });
  const executionTimeoutMs = limits.executionTimeoutMs;
  const executionMaxBuffer = limits.executionMaxBuffer;

  if (mode === 'capture') {
    captureBaseline(
      cmdConfig,
      executionTimeoutMs,
      executionMaxBuffer,
      baselinePath,
      baselinePathRel,
    );
    process.exit(0);
  }

  if (mode === 'check') {
    checkBaseline(
      cmdConfig,
      executionTimeoutMs,
      executionMaxBuffer,
      baselinePath,
      baselinePathRel,
    );
    process.exit(0);
  }
}

runAsCli(import.meta.url, main, { source: 'LintBaseline' });
