import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Parse arguments
// Usage: node diagnose-friction.js [--sprint <path>] --cmd <command...>
const args = process.argv.slice(2);
let sprintRoot = '.';
let cmdArgs = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--sprint') {
    sprintRoot = args[++i] || '.';
  } else if (args[i] === '--cmd') {
    cmdArgs = args.slice(i + 1);
    break;
  }
}

if (cmdArgs.length === 0) {
  console.error("Usage: node diagnose-friction.js [--sprint <path>] --cmd <command with args...>");
  process.exit(1);
}

const commandStr = cmdArgs.join(' ');
console.log(`[Diagnostic Interceptor] Executing: ${commandStr}`);

const result = spawnSync(cmdArgs[0], cmdArgs.slice(1), {
  stdio: 'pipe',
  shell: true,
  encoding: 'utf-8'
});

// Output whatever happened so the agent can still see it
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.status !== 0) {
  console.log('\n--- 🛑 DIAGNOSTIC ANALYSIS Triggered ---');
  console.log('Command failed. Logging friction to telemetry...');
  
  const logPath = path.join(sprintRoot, 'agent-friction-log.json');
  const errorOutput = (result.stderr || result.stdout || 'Unknown exit code ' + result.status).trim();
  
  const logEntry = {
    timestamp: new Date().toISOString(),
    type: "friction_point",
    tool: cmdArgs[0],
    command: commandStr,
    exitCode: result.status,
    errorPreview: errorOutput.substring(0, 500) // Keep the log size manageable
  };

  try {
    fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n');
    console.log(`✅ Friction logged to ${logPath}`);
  } catch (err) {
    console.error(`⚠️ Failed to write to telemetry log: ${err.message}`);
  }

  // Very basic static analysis suggestions
  console.log('\n💡 [Auto-Remediation Suggestions]:');
  if (errorOutput.includes('EADDRINUSE') || errorOutput.includes('address already in use')) {
    console.log(' - Port mapping collision detected. Try finding the zombie process and killing it (e.g. `npx kill-port`).');
  } else if (errorOutput.includes('Cannot find module') || errorOutput.includes('TS2307')) {
    console.log(' - Missing dependency or bad import path. Ensure you are executing from the correct workspace root and have run npm/pnpm install.');
  } else if (errorOutput.includes('SyntaxError')) {
    console.log(' - Syntax/parsing error. Check your recently modified files for missing brackets, quotes, or invalid AST structures.');
  } else if (errorOutput.includes('Astro') || errorOutput.includes('astro')) {
    console.log(' - Framework error: Refer to `.agents/skills/frontend/astro/SKILL.md` for Astro 5 rules.');
  } else {
    console.log(' - Generic failure. Please review the stderr above, refine your approach, or refer to `.agents/instructions.md` before thrashing the CLI.');
  }
  console.log('----------------------------------------\n');
  
  process.exit(result.status);
} else {
  // Graceful exit
  process.exit(0);
}
