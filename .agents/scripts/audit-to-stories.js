/**
 * audit-to-stories.js — Convert audit-* report findings into actionable
 * GitHub Story proposals.
 *
 * The CLI exposes three deterministic sub-commands the host workflow
 * (`/audit-to-stories`) invokes between HITL gates:
 *
 *   --scan [--glob <pattern>] [--severity <threshold>]
 *     Parse every audit-*-results.md under the glob, normalise findings,
 *     stamp fingerprints, group cross-audit, and (when a provider is
 *     available) classify each group as create / skip-open / skip-reoccurring.
 *     Emits a single `audit-to-stories-plan.json` envelope to --out (or
 *     stdout when --json is set).
 *
 *   --emit-plan-seed --plan <plan.json> --out <path>
 *     Read the plan envelope from disk, render the `/plan --seed`
 *     seed markdown, persist to --out.
 *
 *   --emit-stories --plan <plan.json>
 *     Read the plan envelope from disk, render the per-group `{ title,
 *     body, labels }` objects. The host LLM consumes the JSON and calls
 *     the GitHub provider (gh / mcp__github__issue_write) to open one
 *     Issue per group.
 *
 * Per .agents/rules/orchestration-error-handling.md, this CLI throws on
 * unrecoverable failure rather than calling Logger.fatal so runAsCli's
 * exit-code boundary stays robust under mocked process.exit.
 */

import fs from 'node:fs';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { buildStoryBody } from './lib/audit-to-stories/build-story-body.js';
import { classifyGroupsAgainstGitHub } from './lib/audit-to-stories/dedupe-against-github.js';
import { withFingerprints } from './lib/audit-to-stories/finding-adapter.js';
import { groupFindings } from './lib/audit-to-stories/group-findings.js';
import {
  DEFAULT_LEDGER_PATH,
  readLedger,
  reconcileLedger,
  writeLedger,
} from './lib/audit-to-stories/ledger.js';
import { parseAuditReports } from './lib/audit-to-stories/parse-audit-md.js';
import { buildPlanSeedMarkdown } from './lib/audit-to-stories/seed-from-findings.js';
import { wireAuditStoryEdges } from './lib/audit-to-stories/wire-dependencies.js';
import { runAsCli } from './lib/cli-utils.js';
import { searchSemanticCandidates } from './lib/findings/semantic-issue-search.js';
import { SEVERITIES, SEVERITY_RANK } from './lib/findings/severity.js';
import { Logger } from './lib/Logger.js';
import { parse as parseStoryBody } from './lib/story-body/story-body.js';

const DEFAULT_GLOB = 'temp/audits/audit-*-results.md';
const FAN_OUT_REPORT = 'audit-fan-out-results.md';

/**
 * Does `finding` clear the `threshold` severity floor?
 *
 * `SEVERITY_RANK` is imported from the canonical scale rather than declared
 * here (Story #4877). The local copy this replaces ranked only four levels
 * (`critical|high|medium|low`), so `info` — the canonical floor — ranked `0`,
 * below even `--severity low`, and every informational finding was silently
 * dropped from every filtered run. Sourcing the ranking from the SSOT means a
 * level cannot exist in the vocabulary and be invisible to the filter.
 *
 * An unrecognised or absent severity still ranks below every real floor: it
 * failed to parse, so it is not evidence that a threshold was met.
 *
 * @param {{ severity?: string }} finding
 * @param {string} [threshold] — a canonical level, `'all'`, or falsy for no floor.
 * @returns {boolean}
 */
function meetsSeverity(finding, threshold) {
  if (!threshold || threshold === 'all') return true;
  const minRank = SEVERITY_RANK[threshold] ?? 0;
  const fRank = SEVERITY_RANK[finding.severity] ?? -1;
  return fRank >= minRank;
}

async function collectReportPaths(pattern) {
  const matches = [];
  for await (const entry of glob(pattern)) {
    if (path.basename(entry) === FAN_OUT_REPORT) continue;
    matches.push(entry);
  }
  return matches.sort();
}

function readReports(paths) {
  return paths.map((p) => ({
    sourceReport: p,
    markdown: fs.readFileSync(p, 'utf8'),
  }));
}

/**
 * Count findings per severity bucket. The buckets are the canonical levels plus
 * `unknown` for a finding whose severity did not parse — kept as a visible
 * bucket so an unparseable severity is reported rather than absorbed into a
 * real level. Derived from `SEVERITIES` so a new level appears in the tally
 * automatically instead of falling into `unknown` (Story #4877).
 *
 * @param {Array<{ severity?: string }>} findings
 * @returns {Record<string, number>}
 */
function tallyBySeverity(findings) {
  const t = {
    ...Object.fromEntries(SEVERITIES.map((s) => [s, 0])),
    unknown: 0,
  };
  for (const f of findings) {
    if (Object.hasOwn(t, f.severity)) t[f.severity] += 1;
    else t.unknown += 1;
  }
  return t;
}

/**
 * Test-only seam: when `AUDIT_TO_STORIES_PROVIDER_FIXTURE` names a module, load
 * its default export as the dedup provider (ports) instead of the live GitHub
 * provider. This lets the soft-fail contract be exercised end-to-end through
 * the real `--scan` CLI with a search port that fails for a subset of groups
 * (Story #4678, AC-8), with no network. Returns null when the env var is unset.
 *
 * @returns {Promise<object|null>}
 */
async function loadFixtureProvider() {
  const fixturePath = process.env.AUDIT_TO_STORIES_PROVIDER_FIXTURE;
  if (!fixturePath) return null;
  const mod = await import(pathToFileURL(fixturePath).href);
  return mod.default ?? null;
}

async function loadProvider({ createProviderImpl, resolveConfigImpl } = {}) {
  // The provider is optional — when missing, the dedupe step emits a
  // create-only classification and the workflow operator is informed. The
  // `createProviderImpl` / `resolveConfigImpl` seams let a contract test drive
  // this exact adapter (fingerprint + semantic-candidate ports) with an
  // in-memory issue store instead of the live GitHub provider.
  const fixture = await loadFixtureProvider();
  if (fixture) return fixture;
  try {
    const resolveConfig =
      resolveConfigImpl ??
      (await import('./lib/config-resolver.js')).resolveConfig;
    const createProvider =
      createProviderImpl ??
      (await import('./lib/provider-factory.js')).createProvider;
    const config = resolveConfig();
    const provider = createProvider(config ?? {});
    // The existing provider exposes higher-level ticket I/O. The dedupe
    // module needs `findIssuesByFingerprint(sha)` for the exact-fingerprint
    // pass and — since Story #4626 — a `searchCandidates(finding)` port for
    // the meaning-first Stage-1 pass. Adapt both here so we don't bake
    // provider-shape knowledge into the dedupe module.
    if (typeof provider.searchIssues === 'function') {
      const owner = config?.github?.owner;
      const repo = config?.github?.repo;
      const normalise = (h) => ({
        number: h.number,
        state: (h.state ?? h.state_reason ?? 'open')
          .toString()
          .toLowerCase()
          .includes('closed')
          ? 'closed'
          : 'open',
        title: h.title ?? '',
        body: h.body ?? '',
      });
      return {
        async findIssuesByFingerprint(sha) {
          const hits = await provider.searchIssues({ query: sha, owner, repo });
          return (hits ?? []).map(normalise);
        },
        async searchCandidates(finding) {
          // Wire the shared semantic search onto the provider's full-text
          // issue search (open + closed) so route-finding's Stage-1 pass runs.
          const search = async (query) => {
            if (!query || query.trim().length === 0) return [];
            const hits = await provider.searchIssues({ query, owner, repo });
            return (hits ?? []).map(normalise);
          };
          return searchSemanticCandidates(finding, { search });
        },
      };
    }
    return null;
  } catch (_) {
    return null;
  }
}

/**
 * Render the loud, operator-visible warning emitted when the Phase 6 dedup
 * does NOT run against real GitHub issues. Two distinct reasons:
 *
 *   - `'no-provider-port'` — the configured provider resolved but exposes no
 *     `searchIssues` port (or `loadProvider()` threw). This is the
 *     silent-no-op the workflow's "Never open a duplicate Issue" contract
 *     was failing on: every group classifies `create` and the operator gets
 *     zero automated dedup signal. Surfacing it loudly is the whole point.
 *   - `'disabled'` — the operator passed `--no-provider`, intentionally
 *     skipping dedup. Still warned (so a re-run that opens duplicates is
 *     never a surprise), but framed as a deliberate choice.
 *
 * Pure: returns the message string so `buildPlan` owns the single
 * `Logger.warn` write site and the text stays unit-testable.
 *
 * @param {'no-provider-port'|'disabled'} reason
 * @returns {string}
 */
function dedupSkippedWarning(reason) {
  if (reason === 'disabled') {
    return (
      'dedup skipped (--no-provider): every group is classified "create" ' +
      'without checking GitHub for existing issues. A re-run may open ' +
      'duplicates of already-tracked or already-closed findings. Drop ' +
      '--no-provider to enable fingerprint dedup against real issues.'
    );
  }
  return (
    'dedup skipped (no provider port): the configured provider exposes no ' +
    'searchIssues() port, so Phase 6 dedup did NOT run. Every group is ' +
    'classified "create" and existing/closed issues are NOT checked — a run ' +
    'that creates Stories from this plan WILL open duplicates of ' +
    'already-tracked work. Verify `gh auth status` and the github.{owner,repo} ' +
    'config so a real provider resolves.'
  );
}

/**
 * Render the loud, operator-visible warning emitted when Phase 6 dedup ran but
 * one or more groups' lookups could not complete (an HTTP 422, or a rate limit
 * still exhausted after the endpoint budget's cooldown). Those groups degrade
 * to `create` rather than aborting the whole scan (Story #4678); this warning
 * names each affected group so the operator knows exactly which to check by
 * hand. Mirrors the `dedupSkippedWarning` shape so a partially-checked plan
 * reads as clearly as a wholly-unchecked one.
 *
 * Pure: returns the message string so `buildPlan` owns the single `Logger.warn`
 * write site (stderr) and the text stays unit-testable.
 *
 * @param {Array<{ group: string, reason: string }>} entries
 * @returns {string}
 */
function dedupDegradedWarning(entries) {
  const lines = (entries ?? []).map((e) => `  - ${e.group}: ${e.reason}`);
  return (
    `dedup degraded for ${lines.length} group(s): their GitHub lookup could ` +
    'not complete, so they are classified "create" WITHOUT a dedup check. A ' +
    'run that creates Stories from this plan may open duplicates of these ' +
    `groups — verify each by hand before opening:\n${lines.join('\n')}`
  );
}

/**
 * Scan → group → dedup → (optionally) reconcile the cross-run ledger, and
 * return the plan envelope.
 *
 * Every seam on the optional final `deps` parameter defaults to the real
 * implementation (`.agents/rules/test-seams.md` rules 1-2, 4), so `main`,
 * `runAuto`, and every production caller are unchanged.
 *
 * @param {{ glob?: string, severity?: string, useProvider?: boolean, ledger?: object }} params
 * @param {{
 *   collectReportPathsImpl?: typeof collectReportPaths,
 *   readReportsImpl?: typeof readReports,
 *   loadProviderImpl?: typeof loadProvider,
 *   classifyGroupsImpl?: typeof classifyGroupsAgainstGitHub,
 *   reconcileScanLedgerImpl?: typeof reconcileScanLedger,
 *   logger?: { warn: Function },
 * }} [deps]
 * @returns {Promise<object>} the plan envelope.
 */
async function buildPlan(
  { glob: pattern, severity, useProvider, ledger },
  deps = {},
) {
  const {
    collectReportPathsImpl = collectReportPaths,
    readReportsImpl = readReports,
    loadProviderImpl = loadProvider,
    classifyGroupsImpl = classifyGroupsAgainstGitHub,
    reconcileScanLedgerImpl = reconcileScanLedger,
    logger = Logger,
  } = deps;
  const reportPaths = await collectReportPathsImpl(pattern ?? DEFAULT_GLOB);
  if (reportPaths.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      sourceReports: [],
      severityThreshold: severity ?? 'all',
      findings: [],
      groups: [],
      edges: [],
      classifications: [],
      summary: {
        totalFindings: 0,
        filtered: 0,
        create: 0,
        skipOpen: 0,
        skipReoccurring: 0,
      },
    };
  }

  const reports = readReportsImpl(reportPaths);
  const allFindings = parseAuditReports(reports, { repoRoot: process.cwd() });
  const filtered = allFindings.filter((f) => meetsSeverity(f, severity));
  const stamped = withFingerprints(filtered);
  const { groups, edges } = groupFindings(stamped);

  let classifications = groups.map((g) => ({
    group: g,
    action: 'create',
    matchedIssues: [],
    matchedFingerprints: [],
  }));
  let summary = { create: groups.length, skipOpen: 0, skipReoccurring: 0 };
  let dedupApplied = false;

  if (useProvider) {
    const provider = await loadProviderImpl();
    if (provider) {
      const result = await classifyGroupsImpl({
        groups,
        provider,
        searchCandidates: provider.searchCandidates,
      });
      classifications = result.classifications;
      summary = result.summary;
      dedupApplied = true;
      // A partially-checked plan is a useful result — warn loudly (stderr, so
      // the --scan JSON on stdout stays clean) naming the groups that degraded
      // to create because their lookup could not complete (Story #4678).
      if (summary.dedupDegraded?.count > 0) {
        logger.warn(dedupDegradedWarning(summary.dedupDegraded.groups));
      }
    } else {
      // The provider could not resolve a searchIssues port — the dedup gate
      // is silently a no-op without this. Surface it loudly (stderr, so the
      // --scan JSON on stdout stays clean) so the operator does not read a
      // create-only plan as "no duplicates found".
      logger.warn(dedupSkippedWarning('no-provider-port'));
    }
  } else {
    // Operator explicitly opted out via --no-provider. Still warn so a
    // duplicate-opening re-run is never a surprise.
    logger.warn(dedupSkippedWarning('disabled'));
  }

  // Cross-run ledger (Story #4626): fold this scan onto the committed memory,
  // suppress findings a prior run recorded as accepted-risk, and (unless the
  // caller asked not to write) persist the updated ledger. Opt-in — the plain
  // --scan path leaves it untouched so it never mutates a committed file.
  let ledgerSummary;
  if (ledger) {
    const suppressed = reconcileScanLedgerImpl({
      ledgerPath: ledger.path ?? DEFAULT_LEDGER_PATH,
      findings: stamped,
      classifications,
      write: ledger.write !== false,
    });
    if (suppressed.size > 0) {
      for (const c of classifications) {
        const findings = c.group?.findings ?? [];
        if (
          findings.length > 0 &&
          findings.every((f) => suppressed.has(f?.fingerprint?.full))
        ) {
          c.action = 'skip-accepted-risk';
        }
      }
    }
    ledgerSummary = {
      path: ledger.path ?? DEFAULT_LEDGER_PATH,
      suppressed: suppressed.size,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceReports: reportPaths,
    severityThreshold: severity ?? 'all',
    findings: stamped,
    groups,
    edges,
    classifications,
    summary: {
      totalFindings: allFindings.length,
      filtered: filtered.length,
      tally: tallyBySeverity(filtered),
      dedupApplied,
      ...(ledgerSummary ? { ledger: ledgerSummary } : {}),
      ...summary,
    },
  };
}

/**
 * Fold the current scan onto the committed cross-run ledger and persist it.
 * Returns the set of finding fingerprints the ledger says are accepted-risk
 * (deliberately rejected) so the caller can suppress them.
 *
 * @param {object} params
 * @param {string} params.ledgerPath
 * @param {Array<object>} params.findings — stamped scan findings.
 * @param {Array<{ group?: object, matchedIssues?: Array<{ number: number, state: string }>, matchedFingerprints?: string[] }>} params.classifications
 * @param {boolean} [params.write=true]
 * @returns {Set<string>}
 */
function reconcileScanLedger({ ledgerPath, findings, classifications, write }) {
  const prior = readLedger(ledgerPath);
  const issueStates = issueStatesFromClassifications(classifications);
  const { ledger: next } = reconcileLedger({
    ledger: prior,
    findings,
    issueStates,
  });
  if (write !== false) writeLedger(ledgerPath, next);
  return new Set(
    next.entries
      .filter((e) => e.status === 'accepted-risk')
      .map((e) => e.fingerprint),
  );
}

/**
 * Derive a `{ fingerprint → issueState }` map from dedupe classifications so
 * the ledger reconcile sees the live open/closed state of matched Issues.
 * @param {Array<object>} classifications
 * @returns {Record<string, { state: string, number: number|null }>}
 */
function issueStatesFromClassifications(classifications) {
  const states = {};
  for (const c of classifications ?? []) {
    const issue = (c.matchedIssues ?? [])[0];
    if (!issue) continue;
    const state = String(issue.state ?? '')
      .toLowerCase()
      .includes('closed')
      ? 'closed'
      : 'open';
    for (const fp of c.matchedFingerprints ?? []) {
      states[fp] = { state, number: issue.number ?? null };
    }
  }
  return states;
}

function loadPlan(planPath) {
  if (!planPath) throw new Error('--plan <path> is required');
  return JSON.parse(fs.readFileSync(planPath, 'utf8'));
}

const DEFAULT_SEVERITY_FLOOR = 'high';

/**
 * Resolve the unattended-sweep severity floor: an explicit `--severity` wins,
 * else `delivery.auditToStories.severityFloor` from config, else the built-in
 * default (`high`). Reads config defensively so a missing/failed resolve never
 * breaks the run.
 *
 * @param {string|undefined} explicit
 * @returns {Promise<string>}
 */
async function resolveSeverityFloor(explicit) {
  if (explicit) return explicit;
  try {
    const { resolveConfig } = await import('./lib/config-resolver.js');
    const config = resolveConfig();
    const floor = config?.delivery?.auditToStories?.severityFloor;
    if (typeof floor === 'string' && floor.length > 0) return floor;
  } catch (_) {
    // fall through to default
  }
  return DEFAULT_SEVERITY_FLOOR;
}

/**
 * Unattended `--auto` sweep. No interactive gates: it resolves the severity
 * floor from config, builds the plan (with cross-run ledger reconciliation),
 * and reports a run summary. Under `--dry-run` it performs zero GitHub writes
 * and emits the summary only; otherwise it returns the create-eligible Story
 * payloads for the caller to open. Always resolves — never prompts.
 *
 * @param {object} params
 * @param {string} [params.glob]
 * @param {string} [params.severity] — explicit floor override.
 * @param {boolean} [params.dryRun]
 * @param {boolean} [params.useProvider]
 * @param {string} [params.ledgerPath]
 * @returns {Promise<{ summary: object, stories: Array<object> }>}
 */
async function runAuto({ glob, severity, dryRun, useProvider, ledgerPath }) {
  const floor = await resolveSeverityFloor(severity);
  const plan = await buildPlan({
    glob,
    severity: floor,
    useProvider,
    ledger: { path: ledgerPath ?? DEFAULT_LEDGER_PATH, write: !dryRun },
  });

  const byAction = {
    create: [],
    skipOpen: [],
    skipReoccurring: [],
    suppressed: [],
  };
  for (const c of plan.classifications ?? []) {
    if (c.action === 'create') byAction.create.push(c);
    else if (c.action === 'skip-open') byAction.skipOpen.push(c);
    else if (c.action === 'skip-reoccurring') byAction.skipReoccurring.push(c);
    else if (c.action === 'skip-accepted-risk') byAction.suppressed.push(c);
  }

  const eligible = byAction.create.map((c) => c.group);
  const stories = dryRun ? [] : buildAndGateStories(eligible, plan.edges ?? []);

  const summary = {
    mode: 'auto',
    dryRun: Boolean(dryRun),
    severityFloor: floor,
    sourceReports: plan.sourceReports ?? [],
    totals: {
      findings: plan.summary?.totalFindings ?? 0,
      filtered: plan.summary?.filtered ?? 0,
      groups: (plan.groups ?? []).length,
      create: byAction.create.length,
      skipOpen: byAction.skipOpen.length,
      skipReoccurring: byAction.skipReoccurring.length,
      suppressedByLedger: byAction.suppressed.length,
    },
    // Re-detected open Issues the operator may want a "re-detected" comment on.
    reDetected: byAction.skipOpen
      .flatMap((c) => c.matchedIssues ?? [])
      .map((i) => i.number)
      .filter((n) => typeof n === 'number'),
    ledger: plan.summary?.ledger ?? null,
  };

  return { summary, stories };
}

/**
 * Build every eligible group into a `{ title, body, labels }` Story object and
 * gate the batch against the inline-contract bar BEFORE any issue is opened.
 *
 * The `--emit-stories` path opens GitHub issues directly (no decomposer
 * round-trip), so `assertEveryStoryHasInlineContract` never runs against these
 * bodies. This gate restores that guarantee at the standalone seam: each
 * emitted body is re-parsed through the canonical `story-body` parser and must
 * carry a non-empty `acceptance[]` AND a non-empty `verify[]`. A body that
 * fails throws, surfacing the gap instead of opening an ungated Story
 * (Story #4270).
 *
 * @param {Array<{ group: object }>} eligible — classifications eligible to create.
 * @param {Array<{ fromGroupKey: string, toGroupKey: string }>} edges — sequencing edges.
 * @returns {Array<{ title: string, body: string, labels: string[] }>}
 */
function buildAndGateStories(eligible, edges) {
  const built = eligible.map((g) => buildStoryBody({ group: g, edges }));
  const offenders = [];
  for (const story of built) {
    const { body } = parseStoryBody(story.body);
    const ok =
      Array.isArray(body.acceptance) &&
      body.acceptance.length > 0 &&
      Array.isArray(body.verify) &&
      body.verify.length > 0;
    if (!ok) offenders.push(story.title);
  }
  if (offenders.length > 0) {
    throw new Error(
      `inline-contract gate failed: ${offenders.length} generated audit Story/Stories lack a non-empty acceptance[] + verify[] contract: ${offenders
        .map((t) => `"${t}"`)
        .join(
          ', ',
        )}. No issues were opened. Every emitted Story must carry both arrays.`,
    );
  }
  return built;
}

/**
 * The `--wire-edges` pass: hand the opened issue numbers back so the cohort's
 * detected group edges become declared ordering (Story #5044).
 *
 * This is the second half of the two-pass crossing `--emit-stories` starts. The
 * host opens one Issue per group from the emitted drafts, then replays the
 * `groupKey → issueNumber` map here; each Story whose blockers now exist is
 * re-rendered with a canonical `blocked by #N` footer and the same edges are
 * mirrored as native `blocked_by` relations.
 *
 * @param {object} params
 * @param {object} params.plan   A `--scan` plan envelope.
 * @param {Record<string, number>} params.issueByGroupKey
 * @param {object} [deps]
 * @param {Function} [deps.loadProviderImpl]
 * @param {Function} [deps.wireImpl]
 * @returns {Promise<object>} the wiring summary.
 */
async function wireEdges({ plan, issueByGroupKey }, deps = {}) {
  const { loadProviderImpl = loadProvider, wireImpl = wireAuditStoryEdges } =
    deps;
  const groups = (plan.classifications ?? [])
    .filter((c) => c.action === 'create')
    .map((c) => c.group);
  const provider = await loadProviderImpl();
  if (typeof provider?.updateTicket !== 'function') {
    throw new Error(
      '--wire-edges needs a provider exposing updateTicket to rewrite the ' +
        'Story bodies with their `blocked by #N` footers. Configure ' +
        'github.owner/repo (and auth), or wire the edges by hand.',
    );
  }
  return wireImpl({
    groups,
    edges: plan.edges ?? [],
    issueByGroupKey,
    provider,
    updateBody: (issueNumber, body) =>
      provider.updateTicket(issueNumber, { body }),
  });
}

/**
 * Parse the `--ids` argument: a JSON object mapping group key → issue number,
 * or a path to a file containing one.
 *
 * @param {string|undefined} raw
 * @returns {Record<string, number>}
 */
function parseIssueMap(raw) {
  if (!raw) {
    throw new Error(
      '--wire-edges requires --ids \'{"<groupKey>": <issueNumber>, ...}\' ' +
        '(or a path to a JSON file with that shape) — the issue numbers the ' +
        'create pass opened. Without them there is nothing to resolve the ' +
        'group edges against.',
    );
  }
  const text = raw.trimStart().startsWith('{')
    ? raw
    : fs.readFileSync(raw, 'utf8');
  const parsed = JSON.parse(text);
  const out = {};
  for (const [key, value] of Object.entries(parsed)) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(
        `--ids: "${key}" maps to ${JSON.stringify(value)}, which is not a positive issue number.`,
      );
    }
    out[key] = n;
  }
  return out;
}

function persist(text, outPath) {
  if (!outPath) {
    process.stdout.write(text);
    return;
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, text);
}

export const __testing = {
  meetsSeverity,
  collectReportPaths,
  buildPlan,
  loadProvider,
  dedupSkippedWarning,
  dedupDegradedWarning,
  buildAndGateStories,
  runAuto,
  resolveSeverityFloor,
  reconcileScanLedger,
  issueStatesFromClassifications,
  wireEdges,
  parseIssueMap,
};

/**
 * The CLI core: dispatch one of the four sub-commands and persist its output.
 * Extracted from the `main` shell so the whole sub-command table (including
 * the no-sub-command usage throw) is reachable without spawning the CLI.
 *
 * Every seam on the optional final `deps` parameter defaults to the real
 * implementation (`.agents/rules/test-seams.md` rules 1-2, 4), so `main` and
 * every production invocation are unchanged.
 *
 * @param {string[]} [argv]
 * @param {{
 *   buildPlanImpl?: typeof buildPlan,
 *   runAutoImpl?: typeof runAuto,
 *   loadPlanImpl?: typeof loadPlan,
 *   buildAndGateStoriesImpl?: typeof buildAndGateStories,
 *   buildPlanSeedMarkdownImpl?: typeof buildPlanSeedMarkdown,
 *   persistImpl?: typeof persist,
 *   stdout?: { write: (s: string) => void },
 * }} [deps]
 * @returns {Promise<void>}
 */
export async function runAuditToStories(
  argv = process.argv.slice(2),
  deps = {},
) {
  const {
    buildPlanImpl = buildPlan,
    runAutoImpl = runAuto,
    loadPlanImpl = loadPlan,
    buildAndGateStoriesImpl = buildAndGateStories,
    buildPlanSeedMarkdownImpl = buildPlanSeedMarkdown,
    wireEdgesImpl = wireEdges,
    parseIssueMapImpl = parseIssueMap,
    persistImpl = persist,
    stdout = process.stdout,
  } = deps;
  const { values } = parseArgs({
    args: argv,
    options: {
      scan: { type: 'boolean' },
      auto: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      'emit-plan-seed': { type: 'boolean' },
      'emit-stories': { type: 'boolean' },
      'wire-edges': { type: 'boolean' },
      ids: { type: 'string' },
      glob: { type: 'string' },
      severity: { type: 'string' },
      ledger: { type: 'string' },
      plan: { type: 'string' },
      out: { type: 'string' },
      'no-provider': { type: 'boolean' },
      json: { type: 'boolean' },
    },
    strict: false,
  });

  const json = (value) => JSON.stringify(value, null, 2);

  const runAutoSummary = async () =>
    (
      await runAutoImpl({
        glob: values.glob,
        severity: values.severity,
        dryRun: values['dry-run'],
        useProvider: !values['no-provider'],
        ledgerPath: values.ledger,
      })
    ).summary;

  const scanPlan = () =>
    buildPlanImpl({
      glob: values.glob,
      severity: values.severity,
      useProvider: !values['no-provider'],
    });

  const seedMarkdown = () => {
    const plan = loadPlanImpl(values.plan);
    return buildPlanSeedMarkdownImpl({
      groups: plan.groups ?? [],
      findings: plan.findings ?? [],
      sourceReports: plan.sourceReports ?? [],
    });
  };

  const emittedStories = () => {
    const plan = loadPlanImpl(values.plan);
    const eligible = (plan.classifications ?? [])
      .filter((c) => c.action === 'create')
      .map((c) => c.group);
    const built = buildAndGateStoriesImpl(eligible, plan.edges ?? []);
    return values.json ? json(built) : renderStoryDrafts(built);
  };

  const wiredEdges = () =>
    wireEdgesImpl({
      plan: loadPlanImpl(values.plan),
      issueByGroupKey: parseIssueMapImpl(values.ids),
    });

  // One table, not a chain of `if (values.X) { …; return; }`. Each entry
  // renders its sub-command's output; persisting it — and the stdout newline a
  // piped run needs — happens once, below. The chain restated that tail in
  // every arm, so each new sub-command paid for it twice: once in the branch
  // and once in the complexity budget.
  const subcommands = [
    ['auto', async () => json(await runAutoSummary()), true],
    ['scan', async () => json(await scanPlan()), true],
    ['emit-plan-seed', () => seedMarkdown(), false],
    ['emit-stories', () => emittedStories(), true],
    ['wire-edges', async () => json(await wiredEdges()), true],
  ];

  const entry = subcommands.find(([flag]) => values[flag]);
  if (!entry) {
    throw new Error(
      'Usage: node audit-to-stories.js (--scan | --emit-plan-seed | --emit-stories | --wire-edges) [options]',
    );
  }
  const [, render, newlineOnStdout] = entry;
  persistImpl(await render(), values.out);
  if (newlineOnStdout && !values.out) stdout.write('\n');
}

/**
 * Render the Story drafts as the human-readable `--emit-stories` transcript
 * (the `--json` form is the machine one). `dependsOn` is surfaced because the
 * group edges no longer ride the body at emit time — the blockers have no issue
 * numbers yet — so this is where a human driving the create pass by hand sees
 * the ordering they will replay through `--wire-edges` (Story #5044).
 *
 * @param {Array<{ title: string, labels: string[], body: string, groupKey?: string, dependsOn?: string[] }>} built
 * @returns {string}
 */
function renderStoryDrafts(built) {
  return built
    .map((s, i) => {
      const deps = (s.dependsOn ?? []).length
        ? `\nDepends on group(s): ${s.dependsOn.join(', ')}`
        : '';
      return `--- story ${i + 1} ---\nTitle: ${s.title}\nLabels: ${s.labels.join(', ')}\nGroup key: ${s.groupKey}${deps}\n\n${s.body}\n`;
    })
    .join('\n');
}

async function main() {
  await runAuditToStories();
}

runAsCli(import.meta.url, main, {
  source: 'audit-to-stories',
  usage: {
    invocation:
      'node .agents/scripts/audit-to-stories.js (--scan | --auto | --emit-plan-seed | --emit-stories | --wire-edges) [options]',
    summary:
      'Turn audit-lens findings under temp/audits/ into a dedup-checked plan seed or standalone Stories.',
    flags: [
      ['--scan', 'Print the grouped, deduplicated plan as JSON.'],
      ['--auto', 'Run the full scan → file pipeline and print the summary.'],
      ['--emit-plan-seed', 'Emit a /plan --seed-file document.'],
      ['--emit-stories', 'Emit the Story drafts as JSON.'],
      [
        '--wire-edges',
        'Second pass: resolve the detected group edges to blocked by #N footers plus native blocked_by relations. Needs --plan and --ids.',
      ],
      [
        '--ids <json|path>',
        'Group key → opened issue number, as JSON or a path to a JSON file. Required by --wire-edges.',
      ],
      ['--glob <pattern>', 'Override the audit-results glob.'],
      ['--severity <level>', 'Lowest severity to include (high|medium|low).'],
      ['--ledger <path>', 'Path to the dedup ledger.'],
      [
        '--plan <path>',
        'Read a previously emitted plan instead of re-scanning.',
      ],
      ['--out <path>', 'Write output to a file instead of stdout.'],
      ['--no-provider', 'Skip live GitHub dedup lookups (offline).'],
      ['--json', 'Force JSON output.'],
      ['--dry-run', 'Report what would be filed; create nothing.'],
    ],
  },
});
