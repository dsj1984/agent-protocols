import fs from 'node:fs';
import path from 'node:path';

const playbookPath = process.argv[2];
const targetTask = process.argv[3];
if (!playbookPath || !targetTask) {
  console.error('Usage: node verify-prereqs.js <playbook-path> <task-number> [task-state-root]');
  process.exit(1);
}

// 1. Resolve taskStateRoot from config.json if not provided as argument
let taskStateRoot = process.argv[4];
if (!taskStateRoot) {
  taskStateRoot = 'temp/task-state';
  const configPath = path.resolve(process.cwd(), '.agents/config/config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config?.properties?.taskStateRoot?.default) {
        taskStateRoot = config.properties.taskStateRoot.default;
      }
    } catch (err) {
      console.warn(`Could not parse config.json, using default: ${taskStateRoot}`);
    }
  }
}

if (!fs.existsSync(playbookPath)) {
  console.error(`Playbook not found: ${playbookPath}`);
  process.exit(1);
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
  console.error(`Task ${targetTask} not found in the playbook.`);
  process.exit(1);
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
  const stateFile = path.resolve(process.cwd(), taskStateRoot, `${taskId}.json`);
  if (!fs.existsSync(stateFile)) return 'INCOMPLETE';
  try {
    const stateData = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (stateData.status === 'committed' || stateData.status === 'passed') return 'COMPLETED'; // both count as satisfied
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
  console.error(`\n❌ VERIFICATION FAILED: Task ${targetTask} is blocked by incomplete prerequisites.`);
  process.exit(1);
} else {
  console.log(`\n✅ VERIFICATION PASSED: All prerequisites for task ${targetTask} are satisfied.`);
  process.exit(0);
}

