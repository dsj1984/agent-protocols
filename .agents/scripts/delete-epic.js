#!/usr/bin/env node

/**
 * delete-epic.js — Recursively delete an Epic and all child issues from GitHub.
 *
 * Uses the GitHub GraphQL API (sub-issues + deleteIssue mutation).
 * Token resolution: GITHUB_TOKEN / GH_TOKEN env var → `gh auth token` fallback.
 *
 * Usage:
 *   node .agents/scripts/delete-epic.js <epic_number> [--dry-run]
 *
 * Options:
 *   --dry-run   List all issues that would be deleted without actually deleting.
 *
 * Environment:
 *   GITHUB_TOKEN or GH_TOKEN — A PAT with `repo` scope (required for deletion).
 *
 * The owner/repo is resolved from the git remote origin URL automatically.
 */

import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const GITHUB_GRAPHQL = 'https://api.github.com/graphql';

/**
 * Resolve GitHub token from environment or gh CLI.
 * @returns {string}
 */
function resolveToken() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) return token;

  try {
    const ghToken = execSync('gh auth token', {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (ghToken) return ghToken;
  } catch {
    // gh CLI not available or not authenticated
  }

  console.error(
    [
      'ERROR: No GitHub token found.',
      '',
      'Set GITHUB_TOKEN or GH_TOKEN environment variable, or run `gh auth login`.',
      'The token requires `repo` scope for issue deletion.',
    ].join('\n'),
  );
  process.exit(1);
}

/**
 * Resolve owner/repo from the git remote origin URL.
 * @returns {{ owner: string, repo: string }}
 */
function resolveRepo() {
  try {
    const url = execSync('git remote get-url origin', {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // Handles: https://github.com/owner/repo.git, git@github.com:owner/repo.git
    const match =
      url.match(/github\.com[:/]([^/]+)\/([^/.]+)/) ||
      url.match(/github\.com[:/]([^/]+)\/([^/.]+)\.git/);

    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  } catch {
    // git not available or not in a repo
  }

  console.error('ERROR: Could not resolve owner/repo from git remote origin.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// GraphQL Helpers
// ---------------------------------------------------------------------------

const TOKEN = resolveToken();

/**
 * Execute a GraphQL query/mutation against the GitHub API.
 * @param {string} query
 * @param {object} variables
 * @returns {Promise<object>}
 */
async function graphql(query, variables = {}) {
  const res = await fetch(GITHUB_GRAPHQL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'delete-epic-script',
      'GraphQL-Features': 'sub_issues',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GraphQL HTTP ${res.status}: ${body}`);
  }

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors, null, 2)}`);
  }

  return json.data;
}

// ---------------------------------------------------------------------------
// Core Logic
// ---------------------------------------------------------------------------

/**
 * Fetch an issue's node ID and sub-issues (recursive children).
 * @param {string} owner
 * @param {string} repo
 * @param {number} issueNumber
 * @returns {Promise<{ nodeId: string, title: string, subIssues: number[] }>}
 */
async function getIssueWithSubIssues(owner, repo, issueNumber) {
  const data = await graphql(
    `
    query($owner: String!, $repo: String!, $num: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $num) {
          id
          title
          subIssues(first: 100) {
            nodes {
              number
            }
          }
        }
      }
    }`,
    { owner, repo, num: issueNumber },
  );

  const issue = data.repository.issue;
  if (!issue) {
    throw new Error(`Issue #${issueNumber} not found in ${owner}/${repo}.`);
  }

  return {
    nodeId: issue.id,
    title: issue.title,
    subIssues: issue.subIssues.nodes.map((n) => n.number),
  };
}

/**
 * Delete a single issue by its GraphQL node ID.
 * @param {string} nodeId
 */
async function deleteIssue(nodeId) {
  await graphql(
    `
    mutation($issueId: ID!) {
      deleteIssue(input: { issueId: $issueId }) {
        repository { name }
      }
    }`,
    { issueId: nodeId },
  );
}

/**
 * Recursively collect all issues in the sub-issue tree (depth-first).
 * Returns them in deletion order (leaves first, root last).
 *
 * @param {string} owner
 * @param {string} repo
 * @param {number} issueNumber
 * @param {Set<number>} visited - Cycle guard.
 * @returns {Promise<Array<{ number: number, nodeId: string, title: string }>>}
 */
async function collectTree(owner, repo, issueNumber, visited = new Set()) {
  if (visited.has(issueNumber)) return [];
  visited.add(issueNumber);

  const issue = await getIssueWithSubIssues(owner, repo, issueNumber);
  const results = [];

  // Depth-first: process children before parent
  for (const childNumber of issue.subIssues) {
    const childResults = await collectTree(owner, repo, childNumber, visited);
    results.push(...childResults);
  }

  // Add the current issue last (after all children)
  results.push({
    number: issueNumber,
    nodeId: issue.nodeId,
    title: issue.title,
  });

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const excludeRoot = args.includes('--exclude-root');
  const epicNumber = parseInt(
    args.find((a) => !a.startsWith('--')),
    10,
  );

  if (!epicNumber || Number.isNaN(epicNumber)) {
    console.error(
      'Usage: node delete-epic.js <epic_number> [--dry-run] [--exclude-root]',
    );
    process.exit(1);
  }

  const { owner, repo } = resolveRepo();
  console.log(`\nTarget: ${owner}/${repo} Epic #${epicNumber}`);
  console.log(`Mode:   ${dryRun ? 'DRY RUN (no deletions)' : 'LIVE'}`);
  if (excludeRoot) {
    console.log('Option: --exclude-root (Keeping the Epic issue itself)\n');
  } else {
    console.log('\n');
  }

  // 1. Collect the full issue tree
  console.log('Collecting issue tree...');
  let tree;
  try {
    tree = await collectTree(owner, repo, epicNumber);
    if (excludeRoot) {
      // The root issue (epicNumber) is always the LAST element in the depth-first result
      tree = tree.filter((issue) => issue.number !== epicNumber);
    }
  } catch (err) {
    console.error(`Failed to collect issue tree: ${err.message}`);
    process.exit(1);
  }

  console.log(`Found ${tree.length} issue(s) to delete:\n`);
  for (const issue of tree) {
    console.log(`  #${issue.number} — ${issue.title}`);
  }

  if (dryRun) {
    console.log('\n✅ Dry run complete. No issues were deleted.');
    return;
  }

  // 2. Delete in order (children first)
  console.log('\nDeleting issues...\n');
  let deleted = 0;
  let failed = 0;

  for (const issue of tree) {
    try {
      await deleteIssue(issue.nodeId);
      deleted++;
      console.log(`  ✓ Deleted #${issue.number} — ${issue.title}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ Failed #${issue.number}: ${err.message}`);
    }
  }

  console.log(
    `\n✅ Recursive deletion complete. Deleted: ${deleted}, Failed: ${failed}`,
  );
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
