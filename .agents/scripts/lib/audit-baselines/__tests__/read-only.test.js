/**
 * read-only.test.js — the invariant the whole engine rests on (Story #4902).
 *
 * A hotspot engine that refreshed a baseline while measuring it would destroy
 * the evidence it was asked to gather: the ratchet's whole value is that the
 * committed number was produced by a deliberate, reviewed refresh. So the
 * engine reads `baselines/` and writes nothing there — not a reformat, not a
 * timestamp bump — and never runs a test, coverage, or mutation suite to
 * "get a current number".
 *
 * The check hashes every file under `baselines/` in the live repository
 * before and after a full CLI run, and pins the envelope against its shipped
 * schema in the same pass.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertEnvelope, runCli } from '../../../audit-baselines.js';
import { makeTempDir } from '../../test-temp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// __tests__ → audit-baselines → lib → scripts → .agents → repo root
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const BASELINES_DIR = path.join(REPO_ROOT, 'baselines');

/**
 * SHA-256 of every file under `baselines/`, keyed by relative path.
 *
 * @returns {Map<string, string>}
 */
function hashBaselines() {
  const hashes = new Map();
  for (const name of fs.readdirSync(BASELINES_DIR).sort()) {
    const abs = path.join(BASELINES_DIR, name);
    if (!fs.statSync(abs).isFile()) continue;
    hashes.set(
      name,
      createHash('sha256').update(fs.readFileSync(abs)).digest('hex'),
    );
  }
  return hashes;
}

describe('read-only invariant over baselines/', () => {
  const outPath = path.join(makeTempDir('audit-baselines-ro-'), 'env.json');
  let before_;
  let after;
  let exitCode;
  let envelope;

  before(async () => {
    before_ = hashBaselines();
    exitCode = await runCli({
      argv: ['--out', outPath, '--cwd', REPO_ROOT],
      stdout: { write: () => {} },
    });
    after = hashBaselines();
    envelope = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  });

  it('leaves every file under baselines/ byte-identical', () => {
    assert.ok(before_.size > 0, 'no baseline files were hashed');
    assert.deepEqual([...after.keys()], [...before_.keys()]);
    for (const [name, digest] of before_) {
      assert.equal(after.get(name), digest, `${name} changed during the run`);
    }
  });

  it('exits 0 and writes an envelope that validates against the shipped schema', () => {
    assert.equal(exitCode, 0);
    assert.doesNotThrow(() => assertEnvelope(envelope));
    assert.equal(envelope.kind, 'audit-baselines-envelope');
  });

  it('bounds the envelope well below the size of the baselines it reads', () => {
    // crap.json alone is ~650KB of per-method rows; embedding a baseline
    // wholesale is the failure mode the topN bound exists to prevent.
    const envelopeBytes = fs.statSync(outPath).size;
    const crapBytes = fs.statSync(path.join(BASELINES_DIR, 'crap.json')).size;
    assert.ok(
      envelopeBytes < crapBytes,
      `envelope ${envelopeBytes}B is not smaller than crap.json ${crapBytes}B`,
    );
    for (const entry of envelope.gateSurface) {
      const emitted = envelope.hotspots.flatMap((h) =>
        h.gates.filter((g) => g.kind === entry.kind),
      );
      assert.ok(
        emitted.length <= envelope.topN,
        `${entry.kind} emitted ${emitted.length} rows above topN ${envelope.topN}`,
      );
    }
  });

  it('rejects a malformed envelope rather than writing it', () => {
    assert.throws(
      () => assertEnvelope({ ...envelope, hotspots: 'not-an-array' }),
      /failed schema validation/,
    );
  });
});
