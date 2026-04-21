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
 * Persist a manifest to `temp/`. Story-execution manifests write a
 * `story-manifest-<key>.{json,md}` pair keyed on story IDs; Epic manifests
 * write a `dispatch-manifest-<epicId>.{json,md}` pair. Failures are logged
 * to stderr but never throw — persistence is best-effort.
 *
 * @param {object} manifest
 * @param {{ projectRoot?: string, settings?: object }} [opts]
 */
export function persistManifest(manifest, opts = {}) {
  try {
    const projectRoot = opts.projectRoot ?? getProjectRoot();
    const manifestDir = path.join(projectRoot, 'temp');
    if (!fs.existsSync(manifestDir)) {
      fs.mkdirSync(manifestDir, { recursive: true });
    }

    if (manifest.type === 'story-execution') {
      const settings = opts.settings ?? resolveConfig({ cwd: projectRoot }).settings;
      const key = manifest.stories.map((s) => s.storyId).join('-');
      fs.writeFileSync(
        path.join(manifestDir, `story-manifest-${key}.json`),
        JSON.stringify(manifest, null, 2),
        'utf8',
      );
      fs.writeFileSync(
        path.join(manifestDir, `story-manifest-${key}.md`),
        formatStoryManifestMarkdown(manifest, { settings }),
        'utf8',
      );
    } else if (manifest.epicId) {
      const epicId = manifest.epicId;
      fs.writeFileSync(
        path.join(manifestDir, `dispatch-manifest-${epicId}.json`),
        JSON.stringify(manifest, null, 2),
        'utf8',
      );
      fs.writeFileSync(
        path.join(manifestDir, `dispatch-manifest-${epicId}.md`),
        formatManifestMarkdown(manifest),
        'utf8',
      );
    }
  } catch (persistErr) {
    process.stderr.write(
      `[MCP/Dispatcher] Failed to persist manifest to temp/: ${persistErr.message}\n`,
    );
  }
}
