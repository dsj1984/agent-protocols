/**
 * Unit tests for `.agents/scripts/providers/github/labels.js`.
 *
 * Covers idempotent label creation (created/skipped split), the
 * already-exists detector across CLI / API / test-mock shapes, and the
 * post-loop reconcile path that promotes silently-missing labels into
 * the `missing[]` envelope.
 *
 * Story #2462 / Task #2478 — LabelGateway is the fourth slice of the
 * seven-gateway split.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  classifyGithubError,
  TRANSIENT_RETRY_DEFAULTS,
  withTransientRetry,
} from '../../../.agents/scripts/providers/github/errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');

const labelsMod = await import(
  pathToFileURL(
    path.join(ROOT, '.agents', 'scripts', 'providers', 'github', 'labels.js'),
  ).href
);

const { LabelGateway, isLabelAlreadyExistsError } = labelsMod;

/**
 * GitHub's published cap on a label description. Pinned here as a literal
 * rather than imported: it is an external API constraint, so a test that
 * read it back off our own constant could never catch us moving it.
 */
const LABEL_DESCRIPTION_MAX_LENGTH = 100;

/**
 * Minimal gh-exec stand-in exposing only the surfaces `LabelGateway`
 * reaches for: `gh.label.create(name, args)` and `gh.label.list(args, jsonFields)`.
 */
function makeFakeGh({ onCreate, listResult }) {
  return {
    label: {
      create: async (name, args) => onCreate?.(name, args),
      list: async () => listResult ?? { stdout: '[]' },
    },
  };
}

describe('providers/github/labels.js — isLabelAlreadyExistsError', () => {
  it('matches the CLI stderr shape', () => {
    const err = new Error('cli failed');
    err.stderr = '! Label "type::task" already exists';
    assert.equal(isLabelAlreadyExistsError(err), true);
  });

  it('matches the REST 422 already_exists body', () => {
    const err = new Error('label create failed: already_exists');
    assert.equal(isLabelAlreadyExistsError(err), true);
  });

  it('matches the test-mock legacy code-422 shape', () => {
    const err = new Error('label create failed code 422 already exists');
    assert.equal(isLabelAlreadyExistsError(err), true);
  });

  it('does not match unrelated stderr lines that happen to say already exists', () => {
    const err = new Error('unrelated');
    err.stderr = 'protection: webhook already exists';
    assert.equal(isLabelAlreadyExistsError(err), false);
  });

  it('returns false on null', () => {
    assert.equal(isLabelAlreadyExistsError(null), false);
  });
});

describe('providers/github/labels.js — LabelGateway', () => {
  it('ensureLabels: creates net-new labels and reports them in created[]', async () => {
    const createCalls = [];
    const gh = makeFakeGh({
      onCreate: (name, args) => {
        createCalls.push({ name, args });
      },
      listResult: {
        stdout: JSON.stringify([
          { name: 'area::docs' },
          { name: 'type::story' },
        ]),
      },
    });
    const gw = new LabelGateway({ gh, owner: 'o', repo: 'r' });
    const out = await gw.ensureLabels([
      { name: 'area::docs', color: '#abcdef', description: 'docs' },
      { name: 'type::story', color: 'fedcba', description: 'story' },
    ]);
    assert.deepEqual(out.created.sort(), ['area::docs', 'type::story']);
    assert.deepEqual(out.skipped, []);
    assert.deepEqual(out.missing, []);
    assert.equal(createCalls.length, 2);
    // Hex prefix is stripped before passing to the CLI.
    assert.equal(createCalls[0].args[1], 'abcdef');
  });

  it('ensureLabels: classifies "already exists" errors as skipped', async () => {
    const gh = makeFakeGh({
      onCreate: (name) => {
        if (name === 'area::docs') {
          const err = new Error('already_exists');
          err.stderr = 'Label "area::docs" already exists';
          throw err;
        }
      },
      listResult: {
        stdout: JSON.stringify([
          { name: 'area::docs' },
          { name: 'type::story' },
        ]),
      },
    });
    const gw = new LabelGateway({ gh, owner: 'o', repo: 'r' });
    const out = await gw.ensureLabels([
      { name: 'area::docs', color: '#aaaaaa' },
      { name: 'type::story', color: '#bbbbbb' },
    ]);
    assert.deepEqual(out.created, ['type::story']);
    assert.deepEqual(out.skipped, ['area::docs']);
    assert.deepEqual(out.missing, []);
  });

  it('ensureLabels: promotes silently-missing labels to missing[]', async () => {
    const gh = makeFakeGh({
      onCreate: () => {
        // Claims success but the live label set proves otherwise.
      },
      listResult: { stdout: JSON.stringify([{ name: 'type::story' }]) },
    });
    const gw = new LabelGateway({ gh, owner: 'o', repo: 'r' });
    const out = await gw.ensureLabels([
      { name: 'type::task', color: '#aaaaaa' },
      { name: 'type::story', color: '#bbbbbb' },
    ]);
    // The honest math: task isn't on the remote, so it leaves created[]
    // and lands in missing[].
    assert.deepEqual(out.created, ['type::story']);
    assert.deepEqual(out.skipped, []);
    assert.deepEqual(out.missing, ['type::task']);
  });

  it('ensureLabels: returns missing=[] when list-call fails (verification unavailable)', async () => {
    const gh = {
      label: {
        create: async () => {},
        list: async () => {
          throw new Error('list failed');
        },
      },
    };
    const gw = new LabelGateway({ gh, owner: 'o', repo: 'r' });
    const out = await gw.ensureLabels([
      { name: 'type::task', color: '#aaaaaa' },
    ]);
    assert.deepEqual(out.created, ['type::task']);
    assert.deepEqual(out.missing, []);
  });

  it('ensureLabels: refuses an over-long description before gh is spawned', async () => {
    // Story #5201: GitHub caps a label description at 100 characters and
    // answers a longer one with an HTTP 422 that `gh label create` surfaces
    // as a bare exit 1. Catching it here — before the spawn — is what makes
    // the length the message instead of an exit status.
    let spawned = 0;
    const gh = makeFakeGh({
      onCreate: () => {
        spawned += 1;
      },
    });
    const gw = new LabelGateway({ gh, owner: 'o', repo: 'r' });
    const tooLong = 'x'.repeat(LABEL_DESCRIPTION_MAX_LENGTH + 8);
    await assert.rejects(
      () =>
        gw.ensureLabels([
          { name: 'plan-run::abc', color: '#C5DEF5', description: tooLong },
        ]),
      (err) => {
        assert.match(err.message, /plan-run::abc/, 'names the label');
        assert.match(
          err.message,
          new RegExp(String(LABEL_DESCRIPTION_MAX_LENGTH + 8)),
          'names the actual length',
        );
        assert.match(err.message, /100/, 'names the cap');
        return true;
      },
    );
    assert.equal(spawned, 0, 'no gh process is spawned for a doomed create');
  });

  it('ensureLabels: a description exactly at the cap still creates', async () => {
    // The boundary is inclusive — 100 is legal, 101 is not — so a def sitting
    // exactly on it must not be refused by an off-by-one guard.
    const gh = makeFakeGh({
      onCreate: () => {},
      listResult: { stdout: JSON.stringify([{ name: 'area::docs' }]) },
    });
    const gw = new LabelGateway({ gh, owner: 'o', repo: 'r' });
    const out = await gw.ensureLabels([
      {
        name: 'area::docs',
        color: '#abcdef',
        description: 'x'.repeat(LABEL_DESCRIPTION_MAX_LENGTH),
      },
    ]);
    assert.deepEqual(out.created, ['area::docs']);
  });

  it('ensureLabels: a def with no description is accepted', async () => {
    // `description` is optional on the def shape (the loop already defaults
    // it to ''), so the guard must not turn an absent one into a rejection.
    const gh = makeFakeGh({
      onCreate: () => {},
      listResult: { stdout: JSON.stringify([{ name: 'x' }]) },
    });
    const gw = new LabelGateway({ gh, owner: 'o', repo: 'r' });
    const out = await gw.ensureLabels([{ name: 'x', color: '#fff' }]);
    assert.deepEqual(out.created, ['x']);
  });

  it('ensureLabels: rethrows non-"already exists" errors', async () => {
    // Deliberately a *permanent* failure shape. `ensureLabels` wraps each
    // create in `withTransientRetry`, so a transient message here ("rate
    // limited") bought six attempts of real 0.5s→8s backoff — ~16 seconds of
    // a held worker slot to assert one rethrow. The retry behaviour itself is
    // covered below, on the injected clock; this test owns the rethrow.
    const err = new Error('validation failed: color is invalid');
    const gh = makeFakeGh({
      onCreate: () => {
        throw err;
      },
    });
    assert.equal(
      classifyGithubError(err),
      'permanent',
      'this fixture must not enter the retry loop',
    );
    const gw = new LabelGateway({ gh, owner: 'o', repo: 'r' });
    await assert.rejects(
      () => gw.ensureLabels([{ name: 'x', color: '#fff' }]),
      /validation failed/,
    );
  });

  it('ensureLabels: a transient create failure is retried, then propagates', async () => {
    // The retry half of the test above, driven through the `sleep` seam
    // `withTransientRetry` already exposes rather than through the wall
    // clock. `ensureLabels` calls that primitive with no options, so this
    // exercises the exact defaults it inherits — asserted here, not
    // redefined.
    const err = new Error('rate limited');
    assert.equal(
      classifyGithubError(err),
      'transient',
      'a rate-limit message is what makes the create retry-eligible',
    );

    const slept = [];
    const retries = [];
    let attempts = 0;
    await assert.rejects(
      () =>
        withTransientRetry(
          async () => {
            attempts += 1;
            throw err;
          },
          {
            sleep: async (ms) => {
              slept.push(ms);
            },
            random: () => 0,
            onRetry: (info) => retries.push(info),
          },
        ),
      /rate limited/,
    );

    assert.equal(attempts, TRANSIENT_RETRY_DEFAULTS.maxAttempts);
    assert.equal(retries.length, TRANSIENT_RETRY_DEFAULTS.maxAttempts - 1);
    assert.equal(slept.length, TRANSIENT_RETRY_DEFAULTS.maxAttempts - 1);
    // Exponential, capped — the defaults are read, never re-stated.
    assert.deepEqual(
      slept,
      retries.map((_, i) =>
        Math.min(
          TRANSIENT_RETRY_DEFAULTS.capMs,
          TRANSIENT_RETRY_DEFAULTS.baseDelayMs * 2 ** i,
        ),
      ),
    );
  });

  it('_normalizeLabelListResult: handles Array, stdout-string, and garbage shapes', () => {
    const gw = new LabelGateway({
      gh: makeFakeGh({}),
      owner: 'o',
      repo: 'r',
    });
    assert.deepEqual(gw._normalizeLabelListResult([{ name: 'a' }]), [
      { name: 'a' },
    ]);
    assert.deepEqual(
      gw._normalizeLabelListResult({ stdout: '[{"name":"b"}]' }),
      [{ name: 'b' }],
    );
    assert.deepEqual(gw._normalizeLabelListResult({ stdout: 'not-json' }), []);
    assert.deepEqual(gw._normalizeLabelListResult(null), []);
  });
});
