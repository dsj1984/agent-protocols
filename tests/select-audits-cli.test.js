import assert from 'node:assert/strict';
import test from 'node:test';

import {
  matchesAnyFilePattern,
  matchesFilePattern,
  selectAudits,
} from '../.agents/scripts/select-audits.js';
import { selectAudits as legacySelectAudits } from '../.agents/scripts/mcp/select-audits.js';
import { __setGitRunners } from '../.agents/scripts/lib/git-utils.js';
import { MockProvider } from './fixtures/mock-provider.js';

test('matchesFilePattern: pinned glob behaviour (post-relocation parity)', () => {
  assert.equal(matchesFilePattern('**.js', 'bundlejs'), false);
  assert.equal(matchesFilePattern('**/*.lock', 'yarn.lock'), true);
  assert.equal(matchesFilePattern('**/auth/*.js', 'src/auth/login.js'), true);
  assert.equal(matchesFilePattern('*.md', 'README.md'), true);
});

test('matchesAnyFilePattern: returns true when any pattern matches any file', () => {
  assert.equal(
    matchesAnyFilePattern(['*.ts', 'src/**/*.js'], ['src/lib/foo.js']),
    true,
  );
  assert.equal(matchesAnyFilePattern(['*.ts'], ['foo.js']), false);
  assert.equal(matchesAnyFilePattern([], ['foo.js']), false);
});

test('selectAudits: post-relocation export and legacy mcp/ shim are the same function', () => {
  // The shim re-exports the relocated implementation; identity check
  // guarantees there is no second copy of the rule engine.
  assert.equal(selectAudits, legacySelectAudits);
});

test('selectAudits: keyword matching against ticket title/body still selects the right audit', async () => {
  const provider = new MockProvider({
    tickets: {
      300: {
        id: 300,
        title: 'Improve accessibility of modal dialogs',
        body: 'Screen-reader coverage missing.',
        labels: [],
      },
    },
  });

  __setGitRunners(
    () => '',
    () => ({ status: 0, stdout: '', stderr: '' }),
  );

  const { selectedAudits, ticketId, gate, context } = await selectAudits({
    ticketId: 300,
    gate: 'gate2',
    provider,
  });

  assert.equal(ticketId, 300);
  assert.equal(gate, 'gate2');
  assert.equal(context.ticketTitle, 'Improve accessibility of modal dialogs');
  assert.ok(
    selectedAudits.includes('audit-accessibility'),
    'accessibility keyword should select the accessibility audit',
  );
});

test('selectAudits: ETIMEDOUT fallback returns keyword-only results without throwing', async () => {
  const provider = new MockProvider({
    tickets: {
      301: {
        id: 301,
        title: 'Improve accessibility of dropdown menus',
        body: 'tab key behaviour broken',
        labels: [],
      },
    },
  });

  const neverResolves = () => new Promise(() => {});
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => {
    warnings.push(args.join(' '));
  };

  let result;
  try {
    result = await selectAudits({
      ticketId: 301,
      gate: 'gate2',
      provider,
      injectedGitSpawn: neverResolves,
      gitTimeoutMsOverride: 25,
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.ok(warnings.some((w) => /git-spawn timed out/i.test(w)));
  assert.equal(result.context.changedFilesCount, 0);
  assert.ok(result.selectedAudits.includes('audit-accessibility'));
});
