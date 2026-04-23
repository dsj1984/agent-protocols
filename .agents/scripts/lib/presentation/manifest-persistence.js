/**
 * manifest-persistence.js
 *
 * File I/O for dispatch / story manifests. All fs writes land in `temp/`
 * (relative to the project root). The formatter is injected so this module is
 * testable against a tmpdir without touching the real filesystem layout.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from '../config-resolver.js';
import {
  formatManifestMarkdown,
  formatStoryManifestMarkdown,
} from './manifest-formatter.js';

function getProjectRoot() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(__dirname, '../../../..');
}

/**
 * Atomic write-then-rename. On any failure, best-effort remove the `.tmp`
 * file and rethrow so the caller can surface a structured result.
 */
function atomicWrite(finalPath, content) {
  const tmpPath = `${finalPath}.tmp`;
  try {
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, finalPath);
  } catch (err) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // best-effort; original error is what the caller needs
    }
    throw err;
  }
}

/**
 * Persist a manifest to `temp/`. Story-execution manifests write a
 * `story-manifest-<key>.{json,md}` pair keyed on story IDs; Epic manifests
 * write a `dispatch-manifest-<epicId>.{json,md}` pair. Each file is written
 * via an atomic write-then-rename sequence. On failure the caller receives
 * the error string and the `.tmp` residue is removed — the final path is
 * left untouched.
 *
 * @param {object} manifest
 * @param {{ projectRoot?: string, settings?: object }} [opts]
 * @returns {{ persisted: boolean, path: string|null, error: string|null }}
 */
export function persistManifest(manifest, opts = {}) {
  const projectRoot = opts.projectRoot ?? getProjectRoot();
  const manifestDir = path.join(projectRoot, 'temp');

  let jsonPath = null;
  let mdPath = null;

  if (manifest.type === 'story-execution') {
    const key = (manifest.stories ?? []).map((s) => s.storyId).join('-');
    jsonPath = path.join(manifestDir, `story-manifest-${key}.json`);
    mdPath = path.join(manifestDir, `story-manifest-${key}.md`);
  } else if (manifest.epicId) {
    const epicId = manifest.epicId;
    jsonPath = path.join(manifestDir, `dispatch-manifest-${epicId}.json`);
    mdPath = path.join(manifestDir, `dispatch-manifest-${epicId}.md`);
  } else {
    return { persisted: false, path: null, error: null };
  }

  try {
    const jsonContent = JSON.stringify(manifest, null, 2);
    const mdContent =
      manifest.type === 'story-execution'
        ? formatStoryManifestMarkdown(manifest, {
            settings:
              opts.settings ?? resolveConfig({ cwd: projectRoot }).settings,
          })
        : formatManifestMarkdown(manifest);

    if (!fs.existsSync(manifestDir)) {
      fs.mkdirSync(manifestDir, { recursive: true });
    }
    atomicWrite(jsonPath, jsonContent);
    atomicWrite(mdPath, mdContent);
    return { persisted: true, path: jsonPath, error: null };
  } catch (err) {
    return { persisted: false, path: jsonPath, error: err.message };
  }
}
