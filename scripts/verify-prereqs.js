import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveConfig } from './lib/config-resolver.js';
import { Logger } from './lib/Logger.js';

const playbookPath = process.argv[2];
const targetTask = process.argv[3];
if (!playbookPath || !targetTask) {
  Logger.fatal('Usage: node verify-prereqs.js <playbook-path> <task-number> [task-state-root]');
}

// 1. Resolve taskStateRoot + security options via unified config resolver
const { settings: agentConfig } = resolveConfig();
let taskStateRoot = process.argv[4] ?? agentConfig.taskStateRoot ?? 'temp/task-state';
let keysRoot = agentConfig.keysRoot ?? '.agents/keys';
let requireCryptographicProvenance = agentConfig.securityOptions?.requireCryptographicProvenance ?? false;

if (!fs.existsSync(playbookPath)) {
  Logger.fatal(`Playbook not found: ${playbookPath}`);
}

const content = fs.readFileSync(playbookPath, 'utf8');

// Parse task headers and their positions
const taskStatus = new Map();
const taskHeaders = [];
const headerRegex = /^\s*(?:-\s*)?\[([ xX])\] \*\*([\d\.]+)\*\*/gm;
let match;
while ((match = headerRegex.exec(content)) !== null) {
  taskStatus.set(match[2], match[1].toLowerCase() === 'x' ? 'COMPLETED' : 'INCOMPLETE');
  taskHeaders.push({ id: match[2], index: match.index });
}

if (!taskStatus.has(targetTask)) {
  Logger.fatal(`Task ${targetTask} not found in the playbook.`);
}

// Find the block of text specifically for targetTask
const targetHeaderIdx = taskHeaders.findIndex(h => h.id === targetTask);
const blockStart = taskHeaders[targetHeaderIdx].index;
const blockEnd = (targetHeaderIdx + 1 < taskHeaders.length)
  ? taskHeaders[targetHeaderIdx + 1].index
  : content.length;
const block = content.substring(blockStart, blockEnd);

const dependencies = new Set();
const depsRegex = /\s*- \*\*Dependencies\*\*: (.*)/;
const depsMatch = depsRegex.exec(block);
if (depsMatch) {
  const depsString = depsMatch[1];
  const depIds = [...depsString.matchAll(/`([\d\.]+)`/g)].map((m) => m[1]);
  depIds.forEach((dep) => dependencies.add(dep));
}

// Intra-chat predecessors (numerically preceding steps in the same chat)
const parts = targetTask.split('.');
if (parts.length === 3) {
  const sprintNum = parts[0];
  const chatNum = parts[1];
  const stepNum = parseInt(parts[2], 10);
  for (let i = 1; i < stepNum; i++) {
    const prevTask = `${sprintNum}.${chatNum}.${i}`;
    dependencies.add(prevTask);
  }
}

function getDecoupledStatus(taskId) {
  const stateFile = path.resolve(process.cwd(), taskStateRoot, `${taskId}-test-receipt.json`);
  const committedStateFile = path.resolve(process.cwd(), taskStateRoot, `${taskId}.json`);

  let targetFile = null;
  if (fs.existsSync(stateFile)) targetFile = stateFile;
  else if (fs.existsSync(committedStateFile)) targetFile = committedStateFile;
  else return 'INCOMPLETE';

  try {
    const stat = fs.statSync(targetFile);
    if (stat.size > 1024 * 1024) {
      console.error(`❌ CRITICAL SECURITY ERROR: Payload for ${taskId} exceeds 1MB max limit. Aborting parse to prevent memory exhaustion.`);
      process.exit(1);
    }
    const stateData = JSON.parse(fs.readFileSync(targetFile, 'utf8'));

    // Check Cryptographic Provenance if present
    if (stateData.signature && stateData.payload) {
      const pubKeyPath = path.resolve(process.cwd(), keysRoot, 'public.pem');
      if (fs.existsSync(pubKeyPath)) {
        const pubKey = fs.readFileSync(pubKeyPath, 'utf8');
        const payloadStr = JSON.stringify(stateData.payload);

        if (!crypto.verify(null, Buffer.from(payloadStr), pubKey, Buffer.from(stateData.signature, 'base64'))) {
          console.error(`❌ CRITICAL SECURITY ERROR: Invalid Cryptographic Provenance signature for ${taskId}!`);
          return 'INCOMPLETE';
        }
      }
      if (stateData.payload.status === 'passed') return 'COMPLETED';
    }

    if (requireCryptographicProvenance && !stateData.signature) {
      console.error(`❌ CRITICAL SECURITY ERROR: Cryptographic Provenance is required but missing for ${taskId}!`);
      return 'INCOMPLETE';
    }

    if (stateData.status === 'committed' || stateData.status === 'passed') return 'COMPLETED';
    return 'INCOMPLETE';
  } catch (err) {
    return 'INCOMPLETE';
  }
}

// Evaluate dependencies
let hasFailedDeps = false;
for (const dep of dependencies) {
  let status = taskStatus.get(dep);

  if (!status) {
    console.error(`❌ ERROR: Dependency ${dep} is missing from the playbook.`);
    hasFailedDeps = true;
    continue;
  }

  // If not complete in playbook, check decoupled state
  if (status === 'INCOMPLETE') {
    status = getDecoupledStatus(dep);
  }

  if (status === 'INCOMPLETE') {
    console.error(`❌ ERROR: Prerequisite task ${dep} is not complete or committed.`);
    hasFailedDeps = true;
  } else {
    console.log(`✅ Prerequisite ${dep} is satisfied.`);
  }
}

if (hasFailedDeps) {
  Logger.fatal(`\n❌ VERIFICATION FAILED: Task ${targetTask} is blocked by incomplete prerequisites.`);
} else {
  console.log(`\n✅ VERIFICATION PASSED: All prerequisites for task ${targetTask} are satisfied.`);
  process.exit(0);
}
