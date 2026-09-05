// .agents/scripts/lib/skills/skills-index.js
//
// Shared I/O for the two skills manifests (Story #5135).
//
// Each skills root carries its own `skills.index.json`: the package payload's
// at `.agents/skills/`, and the consumer-writable zone's at
// `.agents/local/skills/`. The shipped one is a committed payload file that
// `mandrel doctor` / `mandrel sync-agents` compare byte-for-byte against the
// installed package, so the two manifests must never be merged — but they are
// read, compared and reported identically, and both CLIs need that logic.
// Before this module `generate-skills-index.js` and `validate-skills.js`
// each carried their own near-identical reader.

import fs from 'node:fs';
import path from 'node:path';

/** Manifest filename, shared by both roots. */
export const INDEX_FILENAME = 'skills.index.json';

/**
 * Absolute path of the manifest for one skills root.
 *
 * @param {string} repoRoot
 * @param {readonly string[]} rootSegments From `walk-skill-files.js`.
 * @returns {string}
 */
export function indexPathFor(repoRoot, rootSegments) {
  return path.join(repoRoot, ...rootSegments, INDEX_FILENAME);
}

/**
 * Read a manifest from disk. Distinguishes "missing" from "unparseable" via
 * the `reason` channel so callers can report which drift they hit rather than
 * collapsing both into "not fresh".
 *
 * @param {string} indexPath
 * @returns {{ manifest: object | null, reason: string | null }}
 */
export function readManifest(indexPath) {
  if (!fs.existsSync(indexPath)) {
    return { manifest: null, reason: 'missing' };
  }
  let src;
  try {
    src = fs.readFileSync(indexPath, 'utf8');
  } catch (err) {
    return { manifest: null, reason: `read-error: ${err.message}` };
  }
  try {
    return { manifest: JSON.parse(src), reason: null };
  } catch (err) {
    return { manifest: null, reason: `parse-error: ${err.message}` };
  }
}

/**
 * Read a manifest and project its entry paths into a Set, the shape the
 * validator's membership check consumes.
 *
 * @param {string} indexPath
 * @returns {{ exists: boolean, paths: Set<string> | null, manifest: object | null, indexPath: string, parseError?: string }}
 */
export function readIndexPaths(indexPath) {
  const { manifest, reason } = readManifest(indexPath);
  if (reason === 'missing') {
    return { exists: false, paths: null, manifest: null, indexPath };
  }
  if (manifest === null) {
    return {
      exists: true,
      paths: null,
      manifest: null,
      indexPath,
      parseError: reason,
    };
  }
  const paths = new Set(
    Array.isArray(manifest.skills)
      ? manifest.skills.map((s) => s.path).filter((p) => typeof p === 'string')
      : [],
  );
  return { exists: true, paths, manifest, indexPath };
}

/**
 * Compare two manifests ignoring `generatedAt` — the one volatile field, which
 * changes on every write and is not content. Returns null when they match, or
 * a diff-style message naming the entry counts.
 *
 * @param {object | null} diskManifest
 * @param {object} freshManifest
 * @param {string} label Manifest name for the message.
 * @returns {string | null}
 */
export function diffManifests(diskManifest, freshManifest, label) {
  if (diskManifest === null) {
    return `${label}: on-disk manifest is missing or unreadable`;
  }
  const a = { ...diskManifest };
  const b = { ...freshManifest };
  a.generatedAt = undefined;
  b.generatedAt = undefined;
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  const count = (m) => (Array.isArray(m.skills) ? m.skills.length : 'n/a');
  return [
    `${label} drift detected:`,
    `  on-disk entries:  ${count(diskManifest)}`,
    `  generated entries: ${count(freshManifest)}`,
    "  run 'node .agents/scripts/generate-skills-index.js' to refresh",
  ].join('\n');
}

/**
 * Render a manifest's schema violations as field-named findings. The compiled
 * AJV validator is passed in so this module stays free of the schema-loading
 * side effects the validator CLI owns.
 *
 * @param {object} manifest
 * @param {string} indexRelPath Repo-relative manifest path, for the message.
 * @param {(m: object) => boolean} validateManifest Compiled AJV validator.
 * @returns {string[]}
 */
function validateManifestSchema(manifest, indexRelPath, validateManifest) {
  const findings = [];
  if (validateManifest(manifest)) return findings;
  for (const err of validateManifest.errors ?? []) {
    const where = err.instancePath || '(root)';
    findings.push(
      `${indexRelPath}: manifest-schema: schema violation at ${where}: ${err.message}`,
    );
  }
  return findings;
}

/**
 * Audit one root's manifest: present, parseable, and schema-valid. Shared by
 * both skills roots so a consumer-authored index is held to the same bar as
 * the shipped one.
 *
 * @param {{ exists: boolean, paths: Set<string> | null, manifest: object | null, parseError?: string }} indexInfo
 * @param {string} indexRelPath
 * @param {(m: object) => boolean} validateManifest
 * @param {{ required: boolean }} options
 * @returns {string[]}
 */
export function auditIndex(
  indexInfo,
  indexRelPath,
  validateManifest,
  { required },
) {
  if (!indexInfo.exists) {
    return required
      ? [
          `index missing: ${indexRelPath} not found — run 'node .agents/scripts/generate-skills-index.js'`,
        ]
      : [];
  }
  if (indexInfo.paths === null) {
    return [`index unparseable: ${indexRelPath} — ${indexInfo.parseError}`];
  }
  if (indexInfo.manifest === null) return [];
  return validateManifestSchema(
    indexInfo.manifest,
    indexRelPath,
    validateManifest,
  );
}
