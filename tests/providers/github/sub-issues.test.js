/**
 * Unit tests for `.agents/scripts/providers/github/sub-issues.js`.
 *
 * Covers the native GitHub Sub-Issues read walk. Uses a fake `ghGraphql`
 * hook that routes on query identity so no subprocess fires.
 *
 * Story #2462 / Task #2480 — SubIssueGateway is the third slice of the
 * seven-gateway split. Story #5008 removed the add / remove / reconcile
 * write surface, leaving the paginated read.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');

const subIssuesMod = await import(
  pathToFileURL(
    path.join(
      ROOT,
      '.agents',
      'scripts',
      'providers',
      'github',
      'sub-issues.js',
    ),
  ).href
);
const cacheMod = await import(
  pathToFileURL(
    path.join(ROOT, '.agents', 'scripts', 'providers', 'github', 'cache.js'),
  ).href
);

const loggerMod = await import(
  pathToFileURL(path.join(ROOT, '.agents', 'scripts', 'lib', 'Logger.js')).href
);

const { SubIssueGateway } = subIssuesMod;
const { createInlineTicketCache } = cacheMod;
const { Logger } = loggerMod;

/**
 * Run `fn` with `Logger.error` captured. Swapping the method rather than
 * raising the level keeps the assertion independent of `AGENT_LOG_LEVEL`.
 *
 * @param {() => Promise<unknown>} fn
 * @returns {Promise<string[]>}
 */
async function captureErrors(fn) {
  const lines = [];
  const original = Logger.error;
  Logger.error = (message) => lines.push(String(message));
  try {
    await fn();
  } finally {
    Logger.error = original;
  }
  return lines;
}

describe('providers/github/sub-issues.js — SubIssueGateway', () => {
  it('getNativeSubIssues: paginates and primes the cache', async () => {
    const seen = [];
    const pages = [
      {
        node: {
          subIssues: {
            nodes: [
              { number: 10, title: 'T10', labels: { nodes: [] } },
              { number: 11, title: 'T11', labels: { nodes: [] } },
            ],
            pageInfo: { hasNextPage: true, endCursor: 'c1' },
          },
        },
      },
      {
        node: {
          subIssues: {
            nodes: [{ number: 12, title: 'T12', labels: { nodes: [] } }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    ];
    let page = 0;
    const ghGraphql = async () => pages[page++];
    const cache = createInlineTicketCache();
    const gateway = new SubIssueGateway({
      ghGraphql,
      cache,
    });
    const ids = await gateway.getNativeSubIssues('parent_node', 1);
    seen.push(...ids);
    assert.deepEqual(seen, [10, 11, 12]);
    assert.equal(cache.has(10), true);
    assert.equal(cache.has(12), true);
  });

  it("getNativeSubIssues: names gh's own reason, not just the exit code (Story #5210)", async () => {
    const err = Object.assign(new Error('gh-exec: gh exited with code 1'), {
      stderr:
        'HTTP 403: You have exceeded a secondary rate limit\nhttps://api.github.com/graphql',
    });
    const gateway = new SubIssueGateway({
      ghGraphql: async () => {
        throw err;
      },
      // Pin the category so this test asserts the RENDERING, not the
      // classification (which `errors.test.js` owns).
      classifyGithubError: () => 'permanent',
    });

    const lines = await captureErrors(async () => {
      await assert.rejects(() =>
        gateway.getNativeSubIssues('parent_node', 1891),
      );
    });

    assert.equal(lines.length, 1);
    assert.match(lines[0], /parent #1891/);
    assert.match(
      lines[0],
      /https:\/\/api\.github\.com\/graphql/,
      "describeGhFailure appends the LAST stderr line, gh's actionable one",
    );
  });

  it('getNativeSubIssues: degrades to the bare message when no stderr was captured', async () => {
    const gateway = new SubIssueGateway({
      ghGraphql: async () => {
        throw new Error('something opaque');
      },
      classifyGithubError: () => 'permanent',
    });

    const lines = await captureErrors(async () => {
      await assert.rejects(() => gateway.getNativeSubIssues('parent_node', 7));
    });

    assert.match(lines[0], /something opaque/);
  });

  it('getNativeSubIssues: returns [] when the feature is disabled', async () => {
    const ghGraphql = async () => {
      const err = new Error('feature off');
      err.feature = 'sub_issues';
      throw err;
    };
    const classify = () => 'feature-disabled';
    const gateway = new SubIssueGateway({
      ghGraphql,
      classifyGithubError: classify,
    });
    const ids = await gateway.getNativeSubIssues('parent_node', 1);
    assert.deepEqual(ids, []);
  });
});
