/**
 * tests/story-plan.test.js — Story #2293.
 *
 * Covers the pure helpers behind `/plan`:
 *   - rankDuplicateCandidates: Jaccard-overlap ranking + size cap.
 *   - shouldRefine: heuristic + operator override.
 *   - validateStoryBody: required sections, Epic-ref guard, and the
 *     acceptance/verify contract resolvable from the top level (#4874).
 *   - buildContextEnvelope: shape contract the host LLM consumes.
 *   - extractTitle: H1 → Issue title round-trip.
 *
 * The CLI side is exercised through a single integration check that
 * shells the script with `--dry-run --body <file>` and asserts:
 *   (a) Exit code 0.
 *   (b) Required envelope fields present.
 *   (c) No `Epic:` reference in the rendered body.
 *   (d) The synthesized acceptance/verify sections.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createGh } from '../.agents/scripts/lib/gh-exec.js';
import { routeAllOutputToStderr } from '../.agents/scripts/lib/Logger.js';
import {
  buildContextEnvelope,
  DEFAULT_REFINE_THRESHOLD,
  REQUIRED_SECTIONS,
  rankDuplicateCandidates,
  readTechStackSummary,
  shouldRefine,
  validateStoryBody,
} from '../.agents/scripts/lib/story-plan.js';
import { makeTempDir } from '../.agents/scripts/lib/test-temp.js';
import { TicketGateway } from '../.agents/scripts/providers/github/tickets.js';
import {
  extractTitle,
  resolveSeed,
  runEmitContext,
  runPersist,
} from '../.agents/scripts/story-plan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(PROJECT_ROOT, '.agents', 'scripts', 'story-plan.js');

const VALID_BODY = `# Test standalone story

## Goal

Some context about the work.

## Changes

- {"path": "src/app.js", "assumption": "refactors-existing"}

## Non-Goals

- Things not in scope.
`;

/**
 * The ticket's top-level contract arrays. Story #4874: these are authored
 * once, here — never mirrored into VALID_BODY by hand — and persist
 * synthesizes the `## Acceptance` / `## Verify` sections from them.
 */
const CONTRACT = {
  acceptance: ['First criterion', 'Second criterion'],
  verify: ['npm run lint (validate)'],
};

/**
 * Write the body plus its top-level contract files into `dir` and return the
 * `--body` / `--acceptance` / `--verify` paths.
 */
function writeStoryInputs(dir, body = VALID_BODY) {
  const bodyPath = path.join(dir, 'draft.md');
  const acceptancePath = path.join(dir, 'acceptance.json');
  const verifyPath = path.join(dir, 'verify.json');
  writeFileSync(bodyPath, body);
  writeFileSync(acceptancePath, JSON.stringify(CONTRACT.acceptance));
  writeFileSync(verifyPath, JSON.stringify(CONTRACT.verify));
  return { bodyPath, acceptancePath, verifyPath };
}

describe('rankDuplicateCandidates', () => {
  it('returns [] when no candidate clears minScore', () => {
    const ranked = rankDuplicateCandidates({
      seed: 'rip out unused task body migrator export',
      openStories: [{ id: 1, title: 'completely unrelated database refactor' }],
    });
    assert.deepEqual(ranked, []);
  });

  it('ranks higher-overlap titles first', () => {
    const ranked = rankDuplicateCandidates({
      seed: 'add /plan workflow to author standalone Story drafts',
      openStories: [
        { id: 10, title: 'unrelated', url: 'u1' },
        {
          id: 20,
          title: 'author standalone Story drafts via /plan',
          url: 'u2',
        },
        {
          id: 30,
          title: 'standalone Story drafts workflow planning',
          url: 'u3',
        },
      ],
    });
    assert.ok(ranked.length >= 2);
    assert.ok(ranked[0].score >= ranked[1].score);
    assert.equal(ranked[0].id, 20);
  });

  it('caps the result list at maxResults', () => {
    const openStories = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      title: `standalone Story draft helper ${i}`,
    }));
    const ranked = rankDuplicateCandidates({
      seed: 'standalone Story draft helper workflow',
      openStories,
      maxResults: 3,
    });
    assert.equal(ranked.length, 3);
  });

  it('throws on missing seed', () => {
    assert.throws(
      () => rankDuplicateCandidates({ seed: '', openStories: [] }),
      /seed must be a non-empty string/,
    );
  });
});

describe('shouldRefine', () => {
  it('refines when seed is shorter than the threshold', () => {
    const r = shouldRefine({ seed: 'short idea' });
    assert.equal(r.refine, true);
  });

  it('does not refine when seed is long enough', () => {
    const seed = 'x'.repeat(DEFAULT_REFINE_THRESHOLD + 10);
    const r = shouldRefine({ seed });
    assert.equal(r.refine, false);
  });

  it('honours --refine override', () => {
    const seed = 'x'.repeat(DEFAULT_REFINE_THRESHOLD + 10);
    const r = shouldRefine({ seed, override: 'on' });
    assert.equal(r.refine, true);
    assert.equal(r.reason, 'operator-forced-on');
  });

  it('honours --no-refine override', () => {
    const r = shouldRefine({ seed: 'tiny', override: 'off' });
    assert.equal(r.refine, false);
    assert.equal(r.reason, 'operator-forced-off');
  });

  it('refines empty seed', () => {
    const r = shouldRefine({ seed: '   ' });
    assert.equal(r.refine, true);
    assert.equal(r.reason, 'empty-seed');
  });
});

describe('validateStoryBody', () => {
  it('accepts a well-formed body', () => {
    const r = validateStoryBody(VALID_BODY, CONTRACT);
    assert.deepEqual(r, { ok: true, errors: [] });
  });

  it('accepts a body with no acceptance/verify sections — the prompt-faithful shape (#4874)', () => {
    // The story-author prompt says to author acceptance[] / verify[] once at
    // the ticket's top level and omit the body sections. Demanding those
    // sections here is what cost every author a re-persist round.
    assert.ok(!/^##\s+(Acceptance|Verify)\s*$/m.test(VALID_BODY));
    assert.deepEqual(validateStoryBody(VALID_BODY, CONTRACT), {
      ok: true,
      errors: [],
    });
  });

  it('reports acceptance and verify when neither the body nor the top level carries them', () => {
    const r = validateStoryBody(VALID_BODY);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.startsWith('acceptance must list')));
    assert.ok(r.errors.some((e) => e.startsWith('verify must list')));
  });

  it('fails closed when a body section disagrees with the top-level array', () => {
    const body = `${VALID_BODY}\n## Verify\n- npm test (unit)\n`;
    const r = validateStoryBody(body, CONTRACT);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('verify disagrees')));
  });

  it('reports every missing required section', () => {
    const r = validateStoryBody('# Title only\n\n## Changes\n', CONTRACT);
    assert.equal(r.ok, false);
    for (const section of REQUIRED_SECTIONS) {
      assert.ok(
        r.errors.some((e) => e.includes(section)),
        `expected an error referencing "${section}"`,
      );
    }
  });

  it('rejects bodies that contain an Epic: reference', () => {
    const body = VALID_BODY.replace('## Goal\n', '## Goal\n\nEpic: #1234\n');
    const r = validateStoryBody(body, CONTRACT);
    assert.equal(r.ok, false);
    assert.ok(
      r.errors.some((e) => e.includes('Epic: #N')),
      'expected an Epic-ref error',
    );
  });

  it('accepts a body containing an "Epic #<id>" prose citation (not a line-leading "Epic:" ref)', () => {
    // EPIC_REF_PATTERN only flags a line-*leading* "Epic:" reference
    // (the standalone-Story parent-link field). A prose citation like
    // "Epic #4324 retired the separate context tickets" — no colon,
    // and/or not at the start of the line — must not trip the guard.
    const body = VALID_BODY.replace(
      'Some context about the work.',
      'Some context about the work. See Epic #4324 for prior art; ' +
        'Epic #4432 covers the related corpus lookup.',
    );
    const r = validateStoryBody(body, CONTRACT);
    assert.deepEqual(r, { ok: true, errors: [] });
  });

  it('rejects empty body', () => {
    const r = validateStoryBody('');
    assert.deepEqual(r, { ok: false, errors: ['body is empty'] });
  });
});

describe('buildContextEnvelope', () => {
  it('emits the canonical shape contract', () => {
    const envelope = buildContextEnvelope({
      seed: 'seed text',
      refine: { refine: true, reason: 'seed-shorter-than-200-chars' },
      bodyTemplate: '# {{title}}\n',
      duplicateCandidates: [{ id: 1, title: 't', score: 0.42 }],
      techStack: '## Tech Stack\nNode 22',
      corpusContext: {
        docsDigest: '## architecture.md\nSome outline',
        relevantSections: [{ epicId: 42, epicTitle: 't', score: 0.5 }],
      },
    });

    assert.equal(envelope.kind, 'story-plan-context');
    assert.equal(envelope.version, 1);
    assert.equal(envelope.seed, 'seed text');
    assert.equal(envelope.persona, undefined);
    assert.deepEqual(envelope.requiredSections, REQUIRED_SECTIONS);
    assert.equal(envelope.duplicateCandidates.candidates.length, 1);
    assert.equal(envelope.techStack, '## Tech Stack\nNode 22');
    assert.deepEqual(envelope.corpusContext, {
      docsDigest: '## architecture.md\nSome outline',
      relevantSections: [{ epicId: 42, epicTitle: 't', score: 0.5 }],
    });
    assert.equal(
      envelope.deliverContract.workflow,
      '.agents/workflows/helpers/deliver-story.md',
    );
    assert.deepEqual(envelope.deliverContract.requiredLabels, ['type::story']);
  });

  it('passes through a null techStack', () => {
    const envelope = buildContextEnvelope({
      seed: 'x',
      refine: { refine: false, reason: 'x' },
      bodyTemplate: '',
      duplicateCandidates: [],
    });
    assert.equal(envelope.techStack, null);
  });

  it('defaults corpusContext to null when not passed', () => {
    const envelope = buildContextEnvelope({
      seed: 'x',
      refine: { refine: false, reason: 'x' },
      bodyTemplate: '',
      duplicateCandidates: [],
    });
    assert.equal(envelope.corpusContext, null);
  });
});

describe('extractTitle', () => {
  it('returns the first H1', () => {
    assert.equal(extractTitle('# Hello world\n\nbody'), 'Hello world');
  });

  it('falls back to a default when no H1 exists', () => {
    assert.equal(
      extractTitle('## Context\n\nbody'),
      'Untitled standalone Story',
    );
  });
});

describe('resolveSeed', () => {
  it('returns the --seed seed verbatim', async () => {
    const seed = await resolveSeed({
      seed: 'a seed idea',
      seedFile: undefined,
    });
    assert.equal(seed, 'a seed idea');
  });

  it('reads and trims the --seed-file file', async () => {
    const tmp = makeTempDir('story-plan-seed-');
    try {
      const notesPath = path.join(tmp, 'notes.md');
      writeFileSync(notesPath, '  seed from a file  \n');
      const seed = await resolveSeed({ seed: undefined, seedFile: notesPath });
      assert.equal(seed, 'seed from a file');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('throws when both --seed and --seed-file are passed', async () => {
    await assert.rejects(
      () => resolveSeed({ seed: 'x', seedFile: 'y.md' }),
      /Pass either --seed or --seed-file, not both/,
    );
  });

  it('throws when neither --seed nor --seed-file is passed', async () => {
    await assert.rejects(
      () => resolveSeed({ seed: undefined, seedFile: undefined }),
      /requires --seed .* or --seed-file/,
    );
  });
});

describe('runEmitContext', () => {
  it('threads corpusContext into the emitted JSON envelope', async () => {
    let captured = '';
    const stubProvider = {}; // no listIssuesByLabel / getEpics surfaces
    const stubConfig = {
      raw: { project: {} },
      project: { paths: {} },
    };

    await runEmitContext({
      values: { seed: 'a small standalone change', pretty: false },
      provider: stubProvider,
      projectRoot: PROJECT_ROOT,
      config: stubConfig,
      write: (s) => {
        captured += s;
      },
    });

    const envelope = JSON.parse(captured);
    assert.equal(envelope.kind, 'story-plan-context');
    assert.ok(
      Object.hasOwn(envelope, 'corpusContext'),
      'envelope should carry a corpusContext field',
    );
    assert.deepEqual(envelope.corpusContext, {
      docsDigest: null,
      relevantSections: [],
    });
  });

  it('resolves docsRoot against PROJECT_ROOT, not process.cwd() (audit-quality finding, Epic #4454)', async () => {
    let captured = '';
    const stubProvider = {};
    const stubConfig = {
      raw: { project: { docsContextFiles: ['CHANGELOG.md'] } },
      project: { paths: { docsRoot: 'docs' } },
    };

    const originalCwd = process.cwd();
    const tmpCwd = makeTempDir('story-plan-cwd-');
    process.chdir(tmpCwd);
    try {
      await runEmitContext({
        values: { seed: 'a small standalone change', pretty: false },
        provider: stubProvider,
        projectRoot: PROJECT_ROOT,
        config: stubConfig,
        write: (s) => {
          captured += s;
        },
      });
    } finally {
      process.chdir(originalCwd);
      rmSync(tmpCwd, { recursive: true, force: true });
    }

    const envelope = JSON.parse(captured);
    // docs/CHANGELOG.md lives under the real repo root. If docsRoot were
    // resolved relative to process.cwd() (the regression this guards
    // against) instead of PROJECT_ROOT, the digest read would silently
    // find nothing from the tmp cwd and docsDigest would stay null.
    assert.notEqual(
      envelope.corpusContext.docsDigest,
      null,
      'docsDigest should be non-null: docsRoot must resolve against PROJECT_ROOT regardless of process.cwd()',
    );
  });
});

describe('story-plan.js CLI: --help', () => {
  it('prints usage and exits 0', () => {
    const r = spawnSync('node', [CLI, '--help'], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /plan\.js/);
    assert.match(r.stdout, /--emit-context/);
    assert.match(r.stdout, /--body/);
    assert.match(r.stdout, /--dry-run/);
  });
});

describe('story-plan.js CLI: --dry-run --body', () => {
  let tmp;
  beforeEach(() => {
    tmp = makeTempDir('story-plan-');
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('prints the gh argv it would have run, never touches GitHub', () => {
    const { bodyPath, acceptancePath, verifyPath } = writeStoryInputs(tmp);
    const r = spawnSync(
      'node',
      [
        CLI,
        '--body',
        bodyPath,
        '--acceptance',
        acceptancePath,
        '--verify',
        verifyPath,
        '--dry-run',
      ],
      { cwd: PROJECT_ROOT, encoding: 'utf8' },
    );
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    // The persist-mode summary lands on stdout as JSON.
    const lines = r.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const jsonLine = lines.findLast((l) => l.startsWith('{'));
    assert.ok(jsonLine, `expected a trailing JSON line in stdout: ${r.stdout}`);
    // The rendered body itself contains `{` (the `## Changes` path entries),
    // so anchor on the summary object's own first key.
    const parsed = JSON.parse(
      r.stdout.slice(r.stdout.lastIndexOf('{\n  "dryRun"')),
    );
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.title, 'Test standalone story');
    assert.deepEqual(parsed.labels, ['type::story']);
    // The argv shape must match what gh-exec would receive. Persist
    // synthesized the contract sections, so the created body is passed
    // inline rather than streamed from the authored file (Story #4874).
    assert.deepEqual(parsed.argv.slice(0, 4), [
      'issue',
      'create',
      '--title',
      'Test standalone story',
    ]);
    assert.equal(parsed.argv[4], '--body');
    assert.match(
      parsed.argv[5],
      /## Acceptance\n- \[ \] AC-1: First criterion/,
    );
    assert.match(parsed.argv[5], /## Verify\n- npm run lint \(validate\)/);
    assert.deepEqual(parsed.argv.slice(6), ['--label', 'type::story']);
  });

  it('rejects a body that carries an Epic: reference', () => {
    const { bodyPath, acceptancePath, verifyPath } = writeStoryInputs(
      tmp,
      VALID_BODY.replace('## Goal\n', '## Goal\n\nEpic: #99\n'),
    );
    const r = spawnSync(
      'node',
      [
        CLI,
        '--body',
        bodyPath,
        '--acceptance',
        acceptancePath,
        '--verify',
        verifyPath,
        '--dry-run',
      ],
      { cwd: PROJECT_ROOT, encoding: 'utf8' },
    );
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Epic: #N/);
  });
});

/**
 * Story #3822 — /plan persist-path board membership regression.
 *
 * Drives `runPersist` with a provider whose `createIssue` is the real
 * `TicketGateway.createIssue` (fake gh facade, recording hooks) and
 * proves the created Story is added to the Projects V2 board via the
 * shared board-add helper with the new issue's `node_id` when a project
 * number is configured, and that the add is skipped cleanly when it is
 * not.
 */
describe('story-plan.js runPersist: Projects V2 board membership (Story #3822)', () => {
  // runPersist logs progress via Logger (stdout by default); route it to
  // stderr so log lines cannot interleave with the runner's report stream.
  routeAllOutputToStderr();

  let tmp;
  beforeEach(() => {
    tmp = makeTempDir('story-plan-board-');
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function makeProvider({ projectNumber }) {
    const projectCalls = [];
    const exec = async ({ args, input }) => {
      const method = args[2] ?? 'GET';
      if (method === 'POST') {
        const posted = JSON.parse(input);
        return {
          stdout: JSON.stringify({
            number: 8181,
            id: 81810,
            node_id: 'node_8181',
            html_url: 'https://example/8181',
            title: posted.title,
          }),
          stderr: '',
          code: 0,
        };
      }
      return { stdout: '{}', stderr: '', code: 0 };
    };
    const gateway = new TicketGateway({
      gh: createGh(exec),
      owner: 'o',
      repo: 'r',
      hooks: {
        addItemToProject: async (nodeId) => {
          projectCalls.push(nodeId);
        },
        getProjectNumber: () => projectNumber,
      },
    });
    const provider = {
      createIssue: (payload) => gateway.createIssue(payload),
    };
    return { provider, projectCalls };
  }

  it('adds the created Story to the board with its node_id when a project number is set', async () => {
    const { bodyPath, acceptancePath, verifyPath } = writeStoryInputs(tmp);
    const { provider, projectCalls } = makeProvider({ projectNumber: 1 });
    const summaries = [];

    await runPersist({
      values: {
        body: bodyPath,
        acceptance: acceptancePath,
        verify: verifyPath,
      },
      provider,
      dryRun: false,
      // Capture the summary JSON via the injectable stdout port so raw
      // writes cannot interleave with the test runner's report stream.
      write: (s) => summaries.push(s),
    });

    assert.deepEqual(projectCalls, ['node_8181']);
    const summary = JSON.parse(summaries.join(''));
    assert.equal(summary.issueNumber, 8181);
  });

  it('skips the board add cleanly when no project number is configured', async () => {
    const { bodyPath, acceptancePath, verifyPath } = writeStoryInputs(tmp);
    const { provider, projectCalls } = makeProvider({ projectNumber: null });
    const summaries = [];

    await runPersist({
      values: {
        body: bodyPath,
        acceptance: acceptancePath,
        verify: verifyPath,
      },
      provider,
      dryRun: false,
      write: (s) => summaries.push(s),
    });

    assert.deepEqual(projectCalls, []);
    const summary = JSON.parse(summaries.join(''));
    assert.equal(summary.issueNumber, 8181);
  });
});

describe('readTechStackSummary (Story #4228)', () => {
  let tmp;

  beforeEach(() => {
    tmp = makeTempDir('tech-stack-');
    mkdirSync(path.join(tmp, 'docs'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('prefers a dedicated docs/tech-stack.md when present', async () => {
    writeFileSync(
      path.join(tmp, 'docs', 'tech-stack.md'),
      '# Tech Stack\n\nNode 22, React 19, Postgres.\n',
    );
    // architecture.md is also present, but the dedicated file wins.
    writeFileSync(
      path.join(tmp, 'docs', 'architecture.md'),
      '## Tech Stack\n\nStale pointer-stub: see tech-stack.md\n',
    );

    const summary = await readTechStackSummary(tmp);
    assert.equal(summary, '# Tech Stack\n\nNode 22, React 19, Postgres.');
  });

  it('falls back to architecture.md when no dedicated file exists', async () => {
    writeFileSync(
      path.join(tmp, 'docs', 'architecture.md'),
      '# Architecture\n\n## Tech Stack\n\nNode 22\n\n## Decisions\n\nfoo\n',
    );

    const summary = await readTechStackSummary(tmp);
    assert.equal(summary, '## Tech Stack\nNode 22');
  });

  it('resolves a numbered heading (## 1. Tech Stack)', async () => {
    writeFileSync(
      path.join(tmp, 'docs', 'architecture.md'),
      '# Architecture\n\n## 1. Tech Stack\n\nNode 22\n\n## 2. Decisions\n\nfoo\n',
    );

    const summary = await readTechStackSummary(tmp);
    assert.equal(summary, '## Tech Stack\nNode 22');
  });

  it('resolves a Tech Stack section that is the final ## in the file', async () => {
    writeFileSync(
      path.join(tmp, 'docs', 'architecture.md'),
      '# Architecture\n\n## Overview\n\nbar\n\n## Tech Stack\n\nNode 22\nReact 19\n',
    );

    const summary = await readTechStackSummary(tmp);
    assert.equal(summary, '## Tech Stack\nNode 22\nReact 19');
  });

  it('returns null when neither source is present', async () => {
    const summary = await readTechStackSummary(tmp);
    assert.equal(summary, null);
  });

  it('returns null when architecture.md lacks a Tech Stack heading', async () => {
    writeFileSync(
      path.join(tmp, 'docs', 'architecture.md'),
      '# Architecture\n\n## Overview\n\nNo stack section here.\n',
    );

    const summary = await readTechStackSummary(tmp);
    assert.equal(summary, null);
  });
});
