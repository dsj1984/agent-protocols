import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AGENTS_DIR = path.join(REPO_ROOT, '.agents');
const README_PATH = path.join(AGENTS_DIR, 'README.md');
const VERSION_PATH = path.join(AGENTS_DIR, 'VERSION');

function readVersion() {
  return fs.readFileSync(VERSION_PATH, 'utf8').trim();
}

function countMarkdownFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.md')).length;
}

function countSubdirs(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory()).length;
}

function countStackSkills(stackRoot) {
  let total = 0;
  for (const entry of fs.readdirSync(stackRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    total += countSubdirs(path.join(stackRoot, entry.name));
  }
  return total;
}

function scanReadmeVersionClaims(content, actualVersion) {
  const offenses = [];
  const re = /VERSION[^\n]*?\((\d+\.\d+\.\d+)\)/g;
  for (const m of content.matchAll(re)) {
    if (m[1] !== actualVersion) {
      offenses.push({ found: m[1], expected: actualVersion, snippet: m[0] });
    }
  }
  return offenses;
}

function scanReadmeCount(content, regex) {
  const m = content.match(regex);
  if (!m) return null;
  return Number(m[1]);
}

test('scanReadmeVersionClaims: flags stale literal next to VERSION', () => {
  const offenses = scanReadmeVersionClaims(
    '├── VERSION                  # Current version (1.2.3)',
    '5.29.0',
  );
  assert.strictEqual(offenses.length, 1);
  assert.strictEqual(offenses[0].found, '1.2.3');
});

test('scanReadmeVersionClaims: matching literal passes', () => {
  const offenses = scanReadmeVersionClaims(
    '├── VERSION                  # Current version (5.29.0)',
    '5.29.0',
  );
  assert.deepStrictEqual(offenses, []);
});

test('scanReadmeVersionClaims: no literal next to VERSION passes', () => {
  const offenses = scanReadmeVersionClaims(
    '├── VERSION                  # Framework version (read this file)',
    '5.29.0',
  );
  assert.deepStrictEqual(offenses, []);
});

test('.agents/README.md inline VERSION literal matches .agents/VERSION', () => {
  const content = fs.readFileSync(README_PATH, 'utf8');
  const actual = readVersion();
  const offenses = scanReadmeVersionClaims(content, actual);
  assert.deepStrictEqual(
    offenses,
    [],
    `README inline VERSION literal is stale. ` +
      `Either remove the parenthetical or sync it with .agents/VERSION (${actual}). ` +
      `Offenses: ${JSON.stringify(offenses)}`,
  );
});

test('.agents/README.md persona count matches personas/ directory', () => {
  const content = fs.readFileSync(README_PATH, 'utf8');
  const actual = countMarkdownFiles(path.join(AGENTS_DIR, 'personas'));
  const claimed = scanReadmeCount(
    content,
    /personas\/[^\n]*?(\d+)\s+role-specific/,
  );
  assert.ok(
    claimed !== null,
    'expected README directory layout to claim a persona count',
  );
  assert.strictEqual(
    claimed,
    actual,
    `README claims ${claimed} personas; .agents/personas/ has ${actual} .md files`,
  );
});

test('.agents/README.md rule count matches rules/ directory', () => {
  const content = fs.readFileSync(README_PATH, 'utf8');
  const actual = countMarkdownFiles(path.join(AGENTS_DIR, 'rules'));
  const claimed = scanReadmeCount(
    content,
    /rules\/[^\n]*?(\d+)\s+domain-agnostic/,
  );
  assert.ok(
    claimed !== null,
    'expected README directory layout to claim a rules count',
  );
  assert.strictEqual(
    claimed,
    actual,
    `README claims ${claimed} rules; .agents/rules/ has ${actual} .md files`,
  );
});

test('.agents/README.md core skill count matches skills/core/ directory', () => {
  const content = fs.readFileSync(README_PATH, 'utf8');
  const actual = countSubdirs(path.join(AGENTS_DIR, 'skills', 'core'));
  const claimed = scanReadmeCount(
    content,
    /Universal process skills \((\d+)\s+skills\)/,
  );
  assert.ok(claimed !== null, 'expected README to claim a core-skill count');
  assert.strictEqual(
    claimed,
    actual,
    `README claims ${claimed} core skills; .agents/skills/core/ has ${actual} subdirs`,
  );
});

test('.agents/README.md stack skill count matches skills/stack/ directory', () => {
  const content = fs.readFileSync(README_PATH, 'utf8');
  const actual = countStackSkills(path.join(AGENTS_DIR, 'skills', 'stack'));
  const claimed = scanReadmeCount(
    content,
    /Tech-stack-specific guardrails \((\d+)\s+skills\)/,
  );
  assert.ok(claimed !== null, 'expected README to claim a stack-skill count');
  assert.strictEqual(
    claimed,
    actual,
    `README claims ${claimed} stack skills; .agents/skills/stack/ has ${actual} skill subdirs`,
  );
});

export {
  countMarkdownFiles,
  countStackSkills,
  countSubdirs,
  scanReadmeCount,
  scanReadmeVersionClaims,
};
