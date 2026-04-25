import assert from 'node:assert/strict';
import test from 'node:test';
import { __setGitRunners } from '../.agents/scripts/lib/git-utils.js';
import {
  matchesAnyFilePattern,
  matchesFilePattern,
  selectAudits,
} from '../.agents/scripts/select-audits.js';
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

test('selectAudits: glob filePattern from audit-rules.schema.json selects an audit on a matching changed file', async () => {
  // Regression guard for the behaviour formerly asserted via the deleted
  // MCP-routed tests: selectAudits must apply the `triggers.filePatterns`
  // globs declared in audit-rules.schema.json against the working tree's
  // changed files. We pick `audit-security` (schema declares
  // `**/auth/*.js` under filePatterns) and a ticket whose title/body share
  // no schema keywords, so the audit can only be selected by glob.
  const provider = new MockProvider({
    tickets: {
      400: {
        id: 400,
        title: 'Refactor billing module',
        body: 'No keyword overlap with the security/privacy/a11y audits.',
        labels: [],
      },
    },
  });

  const fakeGitSpawn = async () => ({
    status: 0,
    stdout: 'src/auth/login.js\n',
    stderr: '',
  });

  const { selectedAudits } = await selectAudits({
    ticketId: 400,
    gate: 'gate1',
    provider,
    injectedGitSpawn: fakeGitSpawn,
  });

  assert.ok(
    selectedAudits.includes('audit-security'),
    'changed file matching `**/auth/*.js` must select audit-security via the schema filePatterns rule',
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
