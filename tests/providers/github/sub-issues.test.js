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

const { SubIssueGateway } = subIssuesMod;
const { createInlineTicketCache } = cacheMod;

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
