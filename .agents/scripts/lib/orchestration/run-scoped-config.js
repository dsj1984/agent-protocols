/**
 * run-scoped-config.js — pin the config values a delivery run was seeded
 * from, and fail closed when the file they came from changed underneath it.
 *
 * The problem this exists for: `single-story-init.js` resolves config and
 * seeds `story-<id>` from `project.baseBranch`; `single-story-close` used to
 * re-resolve the SAME key and run close-validation, format-autofix, the gate
 * baseline and base-sync against its own second answer. Nothing pinned the
 * first value and nothing checked the two agreed — and the window between
 * them is however long implementation takes. A concurrent session editing
 * `.agentrc.json` / `.agentrc.local.json` mid-run therefore base-synced a
 * Story against a base it was never seeded from, which surfaced only as an
 * ordinary content conflict with nothing pointing at config.
 *
 * The base a Story was seeded from is a property of **that run**, not of
 * whatever the config file says later. So init pins it and close reads the
 * pin back.
 *
 * ## Where the pin lives
 *
 * The `story-init` structured comment, not a temp log: the post-land tail
 * purges the temp tree, while the ticket comment survives every close re-run
 * and every recovery path. `single-story-init.js` already upserts that
 * comment; `pinRunScopedConfig` supplies the block it records, and
 * `resolveRunScopedConfig` reads it back through the existing
 * `findStructuredComment` seam.
 *
 * ## Adding another run-scoped key
 *
 * Add one row to `RUN_SCOPED_CONFIG_KEYS`. Both halves — the pin init writes
 * and the comparison close makes — enumerate that registry, so a new key
 * needs no second mechanism, no reader change and no writer change. Only
 * `baseBranch` is enforced today because only its corruption is destructive
 * (a wrong base merged into the Story branch permanently contaminates the
 * branch and its PR diff); ceremony profile, quality floors and the
 * concurrency cap are deliberately NOT pinned here.
 */

import { parseFencedJsonComment } from './structured-comment-parser.js';
import { findStructuredComment } from './ticketing.js';

/**
 * The run-scoped config registry. One row per key whose value belongs to the
 * run that seeded the Story rather than to the current contents of the config
 * file. `read` resolves the key from a resolved config (including its
 * default); `label` is the dotted config path the operator has to go fix.
 *
 * @type {Record<string, { read: (config: object) => unknown, label: string }>}
 */
const RUN_SCOPED_CONFIG_KEYS = {
  baseBranch: {
    read: (config) => config?.project?.baseBranch ?? 'main',
    label: 'project.baseBranch',
  },
};

/**
 * Snapshot the run-scoped config values from a resolved config. This is the
 * write half of the pin: `single-story-init.js` records the returned object
 * in the `story-init` receipt so close can compare against it later.
 *
 * @param {object} config Resolved config (`resolveConfig` output).
 * @param {typeof RUN_SCOPED_CONFIG_KEYS} [keys] Registry override — the
 *   default is the module registry; supplying one is how a caller (or a test)
 *   exercises the registry-driven property without a second mechanism.
 * @returns {Record<string, unknown>} the pinned values, keyed by config key.
 */
export function pinRunScopedConfig(config, keys = RUN_SCOPED_CONFIG_KEYS) {
  const pinned = {};
  for (const [key, spec] of Object.entries(keys)) {
    pinned[key] = spec.read(config);
  }
  return pinned;
}

/**
 * Read the pinned block out of the run's `story-init` receipt.
 *
 * Three distinct non-success states, all reported rather than collapsed —
 * the whole point of this module is that a fallback is never silent:
 *   - `absent`: no `story-init` comment on the ticket. Real and expected —
 *     the upsert is best-effort (init logs and continues on failure), and a
 *     recovery path may close a Story whose init predates this receipt.
 *   - `unreadable`: the comment exists but carries no parseable JSON payload.
 *   - `provider-error`: the comment read itself failed.
 *
 * @param {{
 *   provider: object,
 *   storyId: number,
 *   findCommentFn?: typeof findStructuredComment,
 * }} args
 * @returns {Promise<{ status: string, values: Record<string, unknown>|null, detail: string|null }>}
 */
async function readRunScopedConfigReceipt({
  provider,
  storyId,
  findCommentFn = findStructuredComment,
}) {
  let comment;
  try {
    comment = await findCommentFn(provider, Number(storyId), 'story-init');
  } catch (err) {
    return {
      status: 'provider-error',
      values: null,
      detail: `story-init comment could not be read (${err?.message ?? err})`,
    };
  }
  if (!comment) {
    return {
      status: 'absent',
      values: null,
      detail: 'no story-init comment on the ticket',
    };
  }
  const payload = parseFencedJsonComment(comment);
  if (!payload || typeof payload !== 'object') {
    return {
      status: 'unreadable',
      values: null,
      detail: 'story-init comment carries no parseable JSON payload',
    };
  }
  // Receipts written before the `runScopedConfig` block existed carry the
  // pinned values as top-level payload fields (`baseBranch` has been recorded
  // there since Story #831). Reading the payload itself as the fallback block
  // is what lets a Story initialized by an older init still close against its
  // own pinned base instead of degrading to the fallback warning.
  const block =
    payload.runScopedConfig && typeof payload.runScopedConfig === 'object'
      ? payload.runScopedConfig
      : payload;
  return { status: 'found', values: block, detail: null };
}

/**
 * Build the refusal message for a mid-run config change. Names BOTH values
 * for every conflicting key — the pinned one and the one config resolves to
 * now — because "which base was this branch actually seeded from" is the
 * question the operator could not previously answer.
 *
 * @param {{ storyId: number, conflicts: Array<{ label: string, pinned: unknown, current: unknown }> }} args
 * @returns {string}
 */
function formatRunScopedConflict({ storyId, conflicts }) {
  const rows = conflicts.map(
    ({ label, pinned, current }) =>
      `${label}: pinned at init = \`${String(pinned)}\`, currently resolves to \`${String(current)}\``,
  );
  return (
    `[single-story-close] Refusing to close Story #${storyId}: run-scoped config changed mid-run. ` +
    `${rows.join('; ')}. ` +
    'The Story branch was seeded from the pinned value, so closing against the current one would ' +
    'base-sync it onto a base it was never seeded from. No base-sync, format-autofix or gate run was ' +
    'performed. A concurrent session most likely edited `.agentrc.json` / `.agentrc.local.json` during ' +
    'the implementation window: restore the pinned value and re-run close, or re-init the Story against ' +
    'the new value deliberately.'
  );
}

/**
 * Resolve the run-scoped config for a close, preferring the run's pin over a
 * fresh resolution of the config file.
 *
 * Throws on disagreement — fail closed, before any gate, format-autofix or
 * base-sync has run, with both values named. Never silently prefers either
 * side: preferring the pin would base-sync correctly but hide a config change
 * the operator needs to know about, and preferring current config is the bug
 * this module exists to close.
 *
 * @param {{
 *   provider: object,
 *   storyId: number,
 *   config: object,
 *   keys?: typeof RUN_SCOPED_CONFIG_KEYS,
 *   findCommentFn?: typeof findStructuredComment,
 *   progress?: (tag: string, msg: string) => void,
 * }} args
 * @returns {Promise<{
 *   values: Record<string, unknown>,
 *   confirmed: boolean,
 *   receiptStatus: string,
 *   warning: string|null,
 * }>} `confirmed` is true only when every key came from the receipt and
 *   agreed with current config — i.e. when downstream remediation may safely
 *   assume the pinned value is the one in play.
 */
export async function resolveRunScopedConfig({
  provider,
  storyId,
  config,
  keys = RUN_SCOPED_CONFIG_KEYS,
  findCommentFn,
  progress,
}) {
  const current = pinRunScopedConfig(config, keys);
  const receipt = await readRunScopedConfigReceipt({
    provider,
    storyId,
    findCommentFn,
  });

  if (receipt.status !== 'found') {
    // A missing receipt is a real state, not an error — but the fallback is
    // announced, because a silent one reintroduces exactly the bug above.
    const warning =
      `Run-scoped config could not be read from the run's init receipt ` +
      `(${receipt.detail}); falling back to the currently-resolved config ` +
      `(${describeValues(current, keys)}). This close cannot confirm the Story ` +
      'was seeded from these values.';
    progress?.('PIN', `⚠️ ${warning}`);
    return {
      values: current,
      confirmed: false,
      receiptStatus: receipt.status,
      warning,
    };
  }

  const values = {};
  const conflicts = [];
  const unpinned = [];
  for (const [key, spec] of Object.entries(keys)) {
    const pinned = receipt.values?.[key];
    if (pinned === undefined || pinned === null) {
      unpinned.push(spec.label);
      values[key] = current[key];
      continue;
    }
    values[key] = pinned;
    if (pinned !== current[key]) {
      conflicts.push({ label: spec.label, pinned, current: current[key] });
    }
  }

  if (conflicts.length > 0) {
    throw new Error(formatRunScopedConflict({ storyId, conflicts }));
  }

  if (unpinned.length > 0) {
    const warning =
      `The run's init receipt pins no value for ${unpinned.join(', ')}; ` +
      `falling back to the currently-resolved config (${describeValues(values, keys)}).`;
    progress?.('PIN', `⚠️ ${warning}`);
    return {
      values,
      confirmed: false,
      receiptStatus: receipt.status,
      warning,
    };
  }

  progress?.(
    'PIN',
    `📌 Run-scoped config pinned by the story-init receipt (${describeValues(values, keys)}).`,
  );
  return {
    values,
    confirmed: true,
    receiptStatus: receipt.status,
    warning: null,
  };
}

/**
 * Render `label=value` pairs for the operator-facing lines above.
 *
 * @param {Record<string, unknown>} values
 * @param {typeof RUN_SCOPED_CONFIG_KEYS} keys
 * @returns {string}
 */
function describeValues(values, keys) {
  return Object.entries(keys)
    .map(([key, spec]) => `${spec.label}=\`${String(values[key])}\``)
    .join(', ');
}
