/**
 * manifest-renderer.js
 *
 * Facade that composes the presentation layer:
 *   - `manifest-formatter.js`    — pure Markdown / CLI rendering.
 *   - `manifest-persistence.js`  — write manifests to `temp/`.
 *   - GitHub comment upserts     — `postManifestEpicComment` / `postParkedFollowOnsComment`.
 *
 * Keeps every export that external callers consume today so the split is
 * internal: dispatcher.js, mcp-orchestration.js, and tests all continue to
 * import from this path.
 */

import { resolveConfig } from '../config-resolver.js';
import {
  classifyStoriesAgainstManifest,
  renderParkedFollowOnsComment,
} from '../orchestration/parked-follow-ons.js';
import { upsertStructuredComment } from '../orchestration/ticketing.js';
import {
  formatManifestMarkdown,
  formatStoryManifestMarkdown,
  printStoryDispatchTable,
  renderManifestMarkdown,
} from './manifest-formatter.js';
import { persistManifest } from './manifest-persistence.js';

export {
  formatManifestMarkdown,
  printStoryDispatchTable,
  renderManifestMarkdown,
  persistManifest,
};

/**
 * Backwards-compatible Markdown renderer for story-execution manifests.
 * Resolves config internally to cite the canonical script paths. The pure
 * variant lives at `manifest-formatter.js::formatStoryManifestMarkdown` — new
 * call-sites should prefer that and inject `settings` explicitly.
 *
 * @param {object} manifest
 * @returns {string}
 */
export function renderStoryManifestMarkdown(manifest) {
  const { settings } = resolveConfig();
  return formatStoryManifestMarkdown(manifest, { settings });
}

/**
 * Persist the Epic's dispatch manifest as a structured comment on the Epic
 * issue. Idempotent — replaces any existing `dispatch-manifest` comment.
 * No-op in dry-run-only story manifests (no epicId).
 *
 * @param {object} manifest
 * @param {import('../ITicketingProvider.js').ITicketingProvider} provider
 * @returns {Promise<{ posted: boolean, reason?: string }>}
 */
export async function postManifestEpicComment(manifest, provider) {
  if (!manifest || manifest.type === 'story-execution' || !manifest.epicId) {
    return { posted: false, reason: 'not-an-epic-manifest' };
  }
  if (!provider || typeof provider.postComment !== 'function') {
    return { posted: false, reason: 'no-provider' };
  }

  const storyManifest = manifest.storyManifest ?? [];
  const waveEligible = storyManifest.filter((s) => s.type !== 'feature');
  const waveSet = new Set(
    waveEligible.map((s) => s.earliestWave).filter((w) => w !== -1),
  );
  const stories = waveEligible
    .filter((s) => s.storyId !== '__ungrouped__')
    .map((s) => ({
      storyId: s.storyId,
      wave: s.earliestWave ?? -1,
      title: s.storyTitle ?? s.storySlug ?? '',
    }));

  const body = [
    `## 📋 Dispatch Manifest — Epic #${manifest.epicId}`,
    '',
    `- **Waves:** ${waveSet.size || 1}`,
    `- **Stories:** ${stories.length}`,
    `- **Generated:** ${manifest.generatedAt}`,
    '',
    'Source of truth for the wave-completeness gate run at `/sprint-close`.',
    '',
    '```json',
    JSON.stringify({ stories }, null, 2),
    '```',
  ].join('\n');

  try {
    await upsertStructuredComment(
      provider,
      manifest.epicId,
      'dispatch-manifest',
      body,
    );
    return { posted: true };
  } catch (err) {
    process.stderr.write(
      `[Dispatcher] Failed to persist dispatch-manifest comment to Epic #${manifest.epicId}: ${err.message}\n`,
    );
    return { posted: false, reason: err.message };
  }
}

/**
 * Classify Stories under the Epic against the frozen dispatch manifest and
 * upsert a `parked-follow-ons` structured comment on the Epic. Idempotent.
 *
 * @param {object} manifest
 * @param {import('../ITicketingProvider.js').ITicketingProvider} provider
 * @returns {Promise<{ posted: boolean, recuts: number, parked: number, reason?: string }>}
 */
export async function postParkedFollowOnsComment(manifest, provider) {
  if (!manifest || manifest.type === 'story-execution' || !manifest.epicId) {
    return {
      posted: false,
      recuts: 0,
      parked: 0,
      reason: 'not-an-epic-manifest',
    };
  }
  if (!provider || typeof provider.postComment !== 'function') {
    return { posted: false, recuts: 0, parked: 0, reason: 'no-provider' };
  }

  const storyManifest = manifest.storyManifest ?? [];
  const manifestStoryIds = storyManifest
    .filter((s) => s.type !== 'feature' && s.storyId !== '__ungrouped__')
    .map((s) => Number(s.storyId))
    .filter((n) => Number.isFinite(n));

  let storiesUnderEpic = [];
  try {
    const all = await provider.getTickets(manifest.epicId);
    storiesUnderEpic = (all ?? []).filter((t) =>
      (t.labels ?? []).includes('type::story'),
    );
  } catch (err) {
    return { posted: false, recuts: 0, parked: 0, reason: err.message };
  }

  const classification = classifyStoriesAgainstManifest(
    manifestStoryIds,
    storiesUnderEpic,
  );
  const body = renderParkedFollowOnsComment(manifest.epicId, classification);

  try {
    await upsertStructuredComment(
      provider,
      manifest.epicId,
      'parked-follow-ons',
      body,
    );
    return {
      posted: true,
      recuts: classification.recuts.length,
      parked: classification.parked.length,
    };
  } catch (err) {
    process.stderr.write(
      `[Dispatcher] Failed to persist parked-follow-ons comment to Epic #${manifest.epicId}: ${err.message}\n`,
    );
    return {
      posted: false,
      recuts: classification.recuts.length,
      parked: classification.parked.length,
      reason: err.message,
    };
  }
}
