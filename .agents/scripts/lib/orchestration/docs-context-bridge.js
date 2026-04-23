/**
 * DocsContextBridge — Per-Story docs-context-bridge friction checkpoint.
 *
 * Runs at `sprint-story-close` after the Story's changed-file list is known.
 * Loads `agentSettings.release.docs` + `agentSettings.docsContextFiles` from
 * `.agentrc.json`, heuristically matches changed-file path segments against
 * each doc's `##` section headings, and emits a single `friction` structured
 * comment per Story when any match is found.
 *
 * Tech Spec #443 §3.3. Advisory-only — does not block Story close.
 */

import fs from 'node:fs';
import path from 'node:path';
import { gitSpawn } from '../git-utils.js';
import { postStructuredComment } from './ticketing.js';

export const DOCS_CONTEXT_BRIDGE_MARKER = '<!-- ap:docs-context-bridge -->';
export const DOCS_CONTEXT_BRIDGE_TYPE = 'friction';

const STOPWORD_MIN_LEN = 4;

/**
 * Collect the Story's changed-file paths via merge-base against the Epic
 * branch. Runs a pair of `git` reads; returns `[]` on any error.
 *
 * @param {{ cwd: string, storyBranch: string, epicBranch: string }} args
 * @returns {string[]}
 */
export function getStoryChangedFiles({ cwd, storyBranch, epicBranch }) {
  const base = gitSpawn(cwd, 'merge-base', epicBranch, storyBranch);
  if (base.status !== 0) return [];
  const mergeBase = (base.stdout || '').trim();
  if (!mergeBase) return [];
  const diff = gitSpawn(
    cwd,
    'diff',
    '--name-only',
    `${mergeBase}..${storyBranch}`,
  );
  if (diff.status !== 0) return [];
  return (diff.stdout || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Extract `## <heading>` lines from a markdown doc. */
export function extractDocHeadings(docPath) {
  if (!fs.existsSync(docPath)) return [];
  const text = fs.readFileSync(docPath, 'utf8');
  const headings = [];
  // Lift the regex out of the `for...of` head — typhonjs-escomplex's parser
  // fails on a regex literal inside a for-of head and assigns the enclosing
  // module a maintainability score of 0, hiding real complexity signal.
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) headings.push(m[1].trim());
  }
  return headings;
}

function headingTokens(heading) {
  return heading
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= STOPWORD_MIN_LEN);
}

function pathSegments(p) {
  return p
    .split(/[/\\]/)
    .flatMap((seg) => seg.split(/[.\-_]+/))
    .map((s) => s.toLowerCase())
    .filter((s) => s.length >= STOPWORD_MIN_LEN);
}

/**
 * Substring match of changed-file path segments against each doc's `##`
 * section headings. Returns at most one (path, doc) match entry — the first
 * heading that matches wins — so a file listed in many sections of the same
 * doc only contributes one row.
 *
 * @param {{
 *   changedFiles: string[],
 *   docs: Array<{ docPath: string, headings: string[] }>,
 * }} args
 * @returns {Array<{ path: string, doc: string, heading: string }>}
 */
export function matchChangedFilesToDocs({ changedFiles, docs }) {
  const matches = [];
  for (const changed of changedFiles) {
    const segs = new Set(pathSegments(changed));
    if (segs.size === 0) continue;
    for (const { docPath, headings } of docs) {
      for (const heading of headings) {
        const tokens = headingTokens(heading);
        if (tokens.length === 0) continue;
        if (tokens.some((t) => segs.has(t))) {
          matches.push({ path: changed, doc: docPath, heading });
          break;
        }
      }
    }
  }
  return matches;
}

/**
 * Resolve absolute paths of docs from `agentSettings`. Both the `release.docs`
 * list (repo-root-relative) and `docsContextFiles` (relative to `docsRoot`)
 * contribute entries.
 *
 * @param {{ cwd: string, agentSettings: object }} args
 * @returns {string[]}
 */
export function resolveConfiguredDocs({ cwd, agentSettings }) {
  const out = [];
  const releaseDocs = agentSettings?.release?.docs ?? [];
  for (const rel of releaseDocs) {
    if (typeof rel === 'string' && rel.length > 0) {
      out.push(path.resolve(cwd, rel));
    }
  }
  const docsRoot = agentSettings?.docsRoot ?? 'docs';
  const contextDocs = agentSettings?.docsContextFiles ?? [];
  for (const name of contextDocs) {
    if (typeof name === 'string' && name.length > 0) {
      out.push(path.resolve(cwd, docsRoot, name));
    }
  }
  return out;
}

/**
 * Build the friction comment body listing (path, doc, heading) matches.
 */
export function buildFrictionBody({ storyId, matches }) {
  const lines = [
    DOCS_CONTEXT_BRIDGE_MARKER,
    '',
    '### 📚 Docs-context-bridge: Story touches documented code paths',
    '',
    `Story #${storyId} modified files whose path segments match section ` +
      'headings in the configured docs. Review these docs for accuracy ' +
      'before the Epic closes:',
    '',
    '| Changed path | Doc | Likely section |',
    '| --- | --- | --- |',
  ];
  for (const m of matches) {
    lines.push(`| \`${m.path}\` | \`${m.doc}\` | ${m.heading} |`);
  }
  lines.push('', '_Advisory — does not block Story close._');
  return lines.join('\n');
}

/**
 * Story-close checkpoint entry point. Runs the matcher and emits one
 * `friction` structured comment per Story on match, deduped on the marker
 * so re-runs don't spam the ticket.
 *
 * @param {{
 *   provider: import('../ITicketingProvider.js').ITicketingProvider,
 *   storyId: number,
 *   changedFiles: string[],
 *   cwd: string,
 *   agentSettings: object,
 *   logger?: { warn?: Function, info?: Function },
 * }} args
 * @returns {Promise<{
 *   checked: boolean,
 *   matched: boolean,
 *   emitted: boolean,
 *   matches: Array<{ path: string, doc: string, heading: string }>,
 * }>}
 */
export async function checkDocsContextBridge({
  provider,
  storyId,
  changedFiles,
  cwd,
  agentSettings,
  logger,
}) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
    return { checked: true, matched: false, emitted: false, matches: [] };
  }
  const absDocPaths = resolveConfiguredDocs({ cwd, agentSettings });
  if (absDocPaths.length === 0) {
    return { checked: true, matched: false, emitted: false, matches: [] };
  }

  const docs = [];
  for (const abs of absDocPaths) {
    const headings = extractDocHeadings(abs);
    if (headings.length === 0) continue;
    docs.push({
      docPath: path.relative(cwd, abs).replace(/\\/g, '/'),
      headings,
    });
  }
  if (docs.length === 0) {
    return { checked: true, matched: false, emitted: false, matches: [] };
  }

  const matches = matchChangedFilesToDocs({ changedFiles, docs });
  if (matches.length === 0) {
    return { checked: true, matched: false, emitted: false, matches: [] };
  }

  const comments = (await provider.getTicketComments?.(storyId)) ?? [];
  const alreadyEmitted = comments.some(
    (c) =>
      typeof c?.body === 'string' &&
      c.body.includes(DOCS_CONTEXT_BRIDGE_MARKER),
  );
  if (alreadyEmitted) {
    return { checked: true, matched: true, emitted: false, matches };
  }

  const body = buildFrictionBody({ storyId, matches });
  try {
    await postStructuredComment(
      provider,
      storyId,
      DOCS_CONTEXT_BRIDGE_TYPE,
      body,
    );
    return { checked: true, matched: true, emitted: true, matches };
  } catch (err) {
    logger?.warn?.(
      `[DocsContextBridge] friction emission failed: ${err?.message ?? err}`,
    );
    return { checked: true, matched: true, emitted: false, matches };
  }
}
