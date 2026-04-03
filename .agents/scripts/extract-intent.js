import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { instance as CacheManager } from './lib/CacheManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// Usage: node extract-intent.js <sprint-number> <task-id>
const sprintArg = process.argv[2];
const taskId = process.argv[3];

if (!sprintArg || !taskId) {
  console.error('Usage: node extract-intent.js <sprint-number> <task-id>');
  process.exit(1);
}

// 1. Resolve Config
const configPath = path.join(PROJECT_ROOT, '.agents/config/config.json');
let sprintDocsRoot = 'docs/sprints';
let sprintNumberPadding = 3;
if (fs.existsSync(configPath)) {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config?.properties?.sprintDocsRoot?.default) sprintDocsRoot = config.properties.sprintDocsRoot.default;
    if (config?.properties?.sprintNumberPadding?.default) sprintNumberPadding = config.properties.sprintNumberPadding.default;
  } catch (e) {}
}

const paddedSprint = String(sprintArg).padStart(sprintNumberPadding, '0');
let sprintDir = path.join(PROJECT_ROOT, sprintDocsRoot, `sprint-${paddedSprint}`);
if (sprintArg === '000') {
    // Find the latest sprint directory
    const rootSprintDir = path.join(PROJECT_ROOT, sprintDocsRoot);
    if (fs.existsSync(rootSprintDir)) {
        const dirs = fs.readdirSync(rootSprintDir).filter(d => d.startsWith('sprint-')).sort();
        if (dirs.length > 0) {
            sprintDir = path.join(rootSprintDir, dirs[dirs.length - 1]);
        }
    }
} else if (!fs.existsSync(sprintDir)) {
    sprintDir = path.join(PROJECT_ROOT, sprintDocsRoot, `sprint-${sprintArg}`);
}

const manifestPath = path.join(sprintDir, 'task-manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`Manifest not found: ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const task = manifest.tasks.find(t => t.id === taskId);

if (!task) {
  console.error(`Task ${taskId} not found in manifest.`);
  process.exit(1);
}

// 2. Extract Intent and Parameterize diff
// For APC, if it's a known structural task (e.g. standard file creation), 
// we record the intent payload. In a real environment, we'd capture git diffs.
// Here we mock the abstracted structural template extraction.
const intentVector = CacheManager.computeHash(task.instructions, task.focusAreas, task.scope);

const payload = {
    originalTask: {
        id: task.id,
        instructions: task.instructions,
        focusAreas: task.focusAreas,
        scope: task.scope
    },
    // Mock parameterized payload: In v4, this would be computed by diffing against AST
    parameterizedDiff: {
        files: task.focusAreas || [],
        action: "Hydrate Standard Skeleton",
        timestamp: new Date().toISOString()
    }
};

CacheManager.setCache(intentVector, payload);
console.log(`✅ APC Intent extracted for task ${taskId}: Cache Key [${intentVector}]`);
