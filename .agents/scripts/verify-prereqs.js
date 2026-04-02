import fs from 'node:fs';
import path from 'node:path';

const playbookPath = process.argv[2];
const targetTask = process.argv[3];
const taskStateRoot = process.argv[4] || 'temp/task-state';

if (!playbookPath || !targetTask) {
  console.error('Usage: node verify-prereqs.js <playbook-path> <task-number> [task-state-root]');
  process.exit(1);
}

if (!fs.existsSync(playbookPath)) {
  console.error(`Playbook not found: ${playbookPath}`);
  process.exit(1);
}

const content = fs.readFileSync(playbookPath, 'utf8');

// Parse task statuses from playbook (only [x] is considered COMPLETE here)
const taskStatus = new Map();
const taskRegex = /^- \[([ xX])\] \*\*([\d\.]+)\*\*\s/gm;
let match;
while ((match = taskRegex.exec(content)) !== null) {
  const statusMark = match[1];
  const taskId = match[2];
  let status = 'INCOMPLETE';
  if (statusMark.toLowerCase() === 'x') {
    status = 'COMPLETED'; // "x" is complete in the playbook
  }
  taskStatus.set(taskId, status);
}

if (!taskStatus.has(targetTask)) {
  console.error(`Task ${targetTask} not found in the playbook.`);
  process.exit(1);
}

// Find explicit dependencies for targetTask
const escapedTask = targetTask.replace(/\./g, '\\.');
const taskBlockRegex = new RegExp(`- \\[[ xX]\\] \\*\\*${escapedTask}\\*\\*[\\s\\S]*?(?=- \\[[ xX]\\] \\*\\*\\d|$)`, 'g');
const taskBlockMatch = taskBlockRegex.exec(content);

const dependencies = new Set();

if (taskBlockMatch) {
  const block = taskBlockMatch[0];
  const depsRegex = /\s*- \*\*Dependencies\*\*: (.*)/;
  const depsMatch = depsRegex.exec(block);
  if (depsMatch) {
    const depsString = depsMatch[1];
    const depIds = [...depsString.matchAll(/`([\d\.]+)`/g)].map((m) => m[1]);
    depIds.forEach((dep) => dependencies.add(dep));
  }
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
    if (stateData.status === 'committed') return 'COMPLETED'; // committed counts as satisfied for prereqs
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

