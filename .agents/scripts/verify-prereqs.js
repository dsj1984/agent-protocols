const fs = require('fs');

const playbookPath = process.argv[2];
const targetTask = process.argv[3];

if (!playbookPath || !targetTask) {
  console.error('Usage: node verify-prereqs.js <playbook-path> <task-number>');
  process.exit(1);
}

if (!fs.existsSync(playbookPath)) {
  console.error(`Playbook not found: ${playbookPath}`);
  process.exit(1);
}

const content = fs.readFileSync(playbookPath, 'utf8');

// Parse task statuses
const taskStatus = new Map();
// Matches lines like: - [ ] **040.1.2 Task Title**  or - [/] **040.1.2**
const taskRegex = /^- \[([ xX~\/])\] \*\*([\d\.]+)\s/gm;
let match;
while ((match = taskRegex.exec(content)) !== null) {
  const statusMark = match[1];
  const taskId = match[2];
  let status = 'INCOMPLETE';
  if (statusMark === '/' || statusMark.toLowerCase() === 'x') {
    status = 'COMPLETED'; // "/" is committed, "x" is complete
  }
  taskStatus.set(taskId, status);
}

if (!taskStatus.has(targetTask)) {
  console.error(`Task ${targetTask} not found in the playbook.`);
  process.exit(1);
}

// Find explicit dependencies for targetTask
// 1. Isolate the block of text for this specific task
const escapedTask = targetTask.replace(/\./g, '\\.');
const taskBlockRegex = new RegExp(`- \\[[ xX~/\\]\\] \\*\\*${escapedTask}[\\s\\S]*?(?=- \\[[ xX~/\\]\\] \\*\\*\\d|\\Z)`, 'g');
const taskBlockMatch = taskBlockRegex.exec(content);

const dependencies = new Set();

if (taskBlockMatch) {
  const block = taskBlockMatch[0];
  const depsRegex = /- \*\*Dependencies\*\*: (.*)/;
  const depsMatch = depsRegex.exec(block);
  if (depsMatch) {
    const depsString = depsMatch[1];
    // extract `040.1.1`, `040.1.2`
    const depIds = [...depsString.matchAll(/`([\d\.]+)`/g)].map((m) => m[1]);
    depIds.forEach((dep) => dependencies.add(dep));
  }
}

// Also find intra-chat predecessors (numerically preceding steps in the same chat)
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

// Evaluate dependencies
let hasFailedDeps = false;
for (const dep of dependencies) {
  const status = taskStatus.get(dep);
  if (!status) {
    console.error(`❌ ERROR: Dependency ${dep} is missing from the playbook.`);
    hasFailedDeps = true;
  } else if (status === 'INCOMPLETE') {
    console.error(`❌ ERROR: Prerequisite task ${dep} is not complete (marked as [ ] or [~]).`);
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
