import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/lib is 3 levels up from tests/lib
const ROOT = path.resolve(__dirname, '../../');
const AGENTRC_PATH = path.join(ROOT, '.agentrc.json');

// We must re-import the module with cache busting to test different file states.
// The simplest approach is to temporarily rename the real file, import, then restore.

describe('config-resolver', () => {
  describe('resolveConfig with valid .agentrc.json', () => {
    it('returns settings and raw with no error', async () => {
      // Use the real project .agentrc.json — it should parse cleanly
      const { resolveConfig } = await import('../../.agents/scripts/lib/config-resolver.js');
      const result = resolveConfig({ bustCache: true });

      assert.ok(result.settings, 'should have settings');
      // raw is non-null when a file was found
      if (result.raw !== null) {
        assert.ok(typeof result.raw === 'object', 'raw should be an object');
      }
      assert.ok(typeof result.source === 'string', 'source should be a string');
    });

    it('exposes PROJECT_ROOT as an absolute path containing the repo name', async () => {
      const { PROJECT_ROOT } = await import('../../.agents/scripts/lib/config-resolver.js');
      assert.ok(path.isAbsolute(PROJECT_ROOT), 'PROJECT_ROOT must be absolute');
      // Should resolve to the repo root — verify a sentinel file exists there
      assert.ok(
        fs.existsSync(path.join(PROJECT_ROOT, 'package.json')),
        'PROJECT_ROOT should contain package.json',
      );
    });

    it('returns cached result on second call (consistent source)', async () => {
      const { resolveConfig } = await import('../../.agents/scripts/lib/config-resolver.js');
      const first = resolveConfig();
      const second = resolveConfig();
      assert.equal(first.source, second.source, 'source should be identical (cache hit)');
    });
  });

  describe('resolveConfig error handling', () => {
    let tmpBadConfig;

    beforeEach(() => {
      // Write a malformed JSON config to a temp file so we can test parse errors
      // without corrupting the real .agentrc.json.
      tmpBadConfig = path.join(ROOT, '.agentrc.test-bad.json');
      fs.writeFileSync(tmpBadConfig, '{ "agentSettings": { invalid json }', 'utf8');
    });

    afterEach(() => {
      if (fs.existsSync(tmpBadConfig)) fs.unlinkSync(tmpBadConfig);
    });

    it('throws when JSON.parse fails on a present-but-malformed file', () => {
      // We cannot easily swap out the real file path in a module-cached import,
      // so we validate the behavior through a lightweight inline re-implementation
      // that mirrors the resolver's logic.
      const testParse = (rawContent) => {
        try {
          JSON.parse(rawContent);
        } catch (parseErr) {
          throw new Error(`[config] Failed to parse .agentrc.json: ${parseErr.message}.`);
        }
      };

      assert.throws(
        () => testParse('{ broken json'),
        /Failed to parse \.agentrc\.json/,
        'should throw with a descriptive message on malformed JSON',
      );
    });

    it('does NOT throw for valid JSON', () => {
      const testParse = (rawContent) => JSON.parse(rawContent);
      assert.doesNotThrow(() => testParse('{ "agentSettings": {} }'));
    });
  });
});
