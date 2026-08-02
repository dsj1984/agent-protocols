/**
 * Unit tests for `lib/observability/source-classifier.js`
 * (Epic #2547 / Story #2553 / Task #2556).
 *
 * Pure-function tests: no I/O, no temp dirs. Each case asserts the
 * classifier returns the documented `"framework"` / `"consumer"` tag for
 * a representative input shape.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { RUNTIME_FRICTION_CATEGORIES } from '../../../.agents/scripts/lib/observability/runtime-friction.js';
import {
  __testing,
  classifyPathSource,
  classifySignalSource,
} from '../../../.agents/scripts/lib/observability/source-classifier.js';

describe('source-classifier — framework classification by failingPath', () => {
  it('tags paths under .agents/ as framework', () => {
    assert.equal(
      classifyPathSource('.agents/scripts/story-init.js', ''),
      'framework',
    );
    assert.equal(
      classifyPathSource('repo/.agents/rules/security-baseline.md', ''),
      'framework',
    );
  });

  it('tags .agentrc.json as framework', () => {
    assert.equal(classifyPathSource('.agentrc.json', ''), 'framework');
    assert.equal(
      classifyPathSource('subproject/.agentrc.json', ''),
      'framework',
    );
  });

  it('tags paths under .claude/ as framework', () => {
    assert.equal(classifyPathSource('.claude/settings.json', ''), 'framework');
    assert.equal(
      classifyPathSource('host/.claude/hooks/post-commit', ''),
      'framework',
    );
  });
});

describe('source-classifier — framework classification by command', () => {
  it('tags commands invoking node .agents/scripts/ as framework', () => {
    assert.equal(
      classifyPathSource('', 'node .agents/scripts/story-init.js --story 2553'),
      'framework',
    );
  });

  it('tags commands that reference any framework prefix as framework', () => {
    assert.equal(classifyPathSource('', 'ls .agents/scripts'), 'framework');
    assert.equal(classifyPathSource('', 'cat .agentrc.json'), 'framework');
    assert.equal(classifyPathSource('', 'rg foo .claude/'), 'framework');
  });
});

describe('source-classifier — consumer classification', () => {
  it('tags ordinary repo paths as consumer', () => {
    assert.equal(
      classifyPathSource('src/components/Button.tsx', ''),
      'consumer',
    );
    assert.equal(
      classifyPathSource('tests/integration/checkout.test.ts', ''),
      'consumer',
    );
    assert.equal(classifyPathSource('package.json', ''), 'consumer');
  });

  it('tags ordinary commands as consumer', () => {
    assert.equal(classifyPathSource('', 'npm run test'), 'consumer');
    assert.equal(classifyPathSource('', 'pnpm install'), 'consumer');
  });

  it('does NOT confuse `agents` substrings without the dot prefix', () => {
    // Critical: only the dot-prefixed framework directory should match,
    // not a regular folder called "agents" inside the consumer.
    assert.equal(
      classifyPathSource('src/agents/orchestrator.ts', ''),
      'consumer',
    );
    assert.equal(classifyPathSource('docs/agents-overview.md', ''), 'consumer');
  });
});

describe('source-classifier — defaults & coercion', () => {
  it('returns consumer when both inputs are empty strings', () => {
    assert.equal(classifyPathSource('', ''), 'consumer');
  });

  it('returns consumer when both inputs are undefined / null', () => {
    assert.equal(classifyPathSource(undefined, undefined), 'consumer');
    assert.equal(classifyPathSource(null, null), 'consumer');
  });

  it('returns consumer when called with no arguments at all', () => {
    assert.equal(classifyPathSource(), 'consumer');
  });

  it('coerces non-string inputs without throwing', () => {
    assert.equal(classifyPathSource(42, { not: 'a string' }), 'consumer');
    assert.equal(classifyPathSource([], []), 'consumer');
  });
});

describe('source-classifier — framework-wins on mixed inputs', () => {
  it('framework path beats consumer command', () => {
    assert.equal(
      classifyPathSource('.agents/scripts/foo.js', 'npm run test'),
      'framework',
    );
  });

  it('framework command beats consumer path', () => {
    assert.equal(
      classifyPathSource(
        'src/checkout/index.ts',
        'node .agents/scripts/story-init.js',
      ),
      'framework',
    );
  });

  it('both framework still resolves to framework', () => {
    assert.equal(
      classifyPathSource(
        '.agents/scripts/foo.js',
        'node .agents/scripts/foo.js',
      ),
      'framework',
    );
  });
});

/**
 * Story #4824 — the record-level entry point.
 *
 * The defect: every runtime-emitted friction record populates neither
 * `failingPath` nor `command`, so `classifyPathSource`'s "positive evidence
 * of a framework prefix" requirement could never be met and the `consumer`
 * default always won. The framework limb of the feedback loop was dead code.
 *
 * The repair is NOT "runtime-emitted means framework" — that is measurably
 * wrong, and the `close-failed` cases below are why: those records carry
 * consumer-owned failures through a framework gate, and tagging them
 * `framework` would flood the framework repo with consumer test failures.
 */
describe('classifySignalSource — step 3: tool-degraded is framework (Story #4824)', () => {
  /**
   * The exact record `review-providers/native.js` appends when the scoped
   * lint runner cannot execute — no `failingPath`, no `command`, only a
   * category, an emitter tool, and a free-text reason.
   */
  const nativeReviewLintDegradation = {
    kind: 'friction',
    category: 'tool-degraded',
    emitter: { tool: 'native-review-lint' },
    details: {
      surface: 'scoped-lint',
      reason:
        'lint runner produced no parseable output (binary missing, parse failure, or environment issue)',
    },
  };

  it('classifies a native-review-lint degradation as framework', () => {
    assert.equal(
      classifySignalSource(nativeReviewLintDegradation),
      'framework',
    );
  });

  it('classifies a local-lens-review degradation as framework', () => {
    assert.equal(
      classifySignalSource({
        category: 'tool-degraded',
        emitter: { tool: 'local-lens-review' },
        details: { surface: 'lens-materialization', reason: 'ENOENT' },
      }),
      'framework',
    );
  });

  it('reads the same category literal the emitters use', () => {
    // The classifier keeps a local copy of the literal to avoid an import
    // cycle through runtime-friction → signals-writer → source-classifier.
    // This is the pin that stops the two spellings drifting apart.
    assert.equal(
      __testing.TOOL_DEGRADED_CATEGORY,
      RUNTIME_FRICTION_CATEGORIES.TOOL_DEGRADED,
    );
  });
});

describe('classifySignalSource — step 4: consumer-owned runtime failures stay consumer', () => {
  it('keeps a consumer base-sync conflict consumer', () => {
    // Observed on real data: `single-story-close` emits this, but the failure
    // is the consumer's own source tree conflicting.
    assert.equal(
      classifySignalSource({
        category: 'close-failed',
        emitter: { tool: 'single-story-close' },
        details: {
          phase: 'base-sync',
          reason:
            'conflicting files = apps/web/src/components/nav/Sidebar.astro',
        },
      }),
      'consumer',
    );
  });

  it('keeps a consumer coverage-gate failure consumer', () => {
    assert.equal(
      classifySignalSource({
        category: 'close-failed',
        emitter: { tool: 'single-story-close' },
        details: {
          phase: 'close-validation',
          reason: 'npm run test:coverage exited non-zero',
        },
      }),
      'consumer',
    );
  });

  it('keeps a story-blocked record consumer absent other evidence', () => {
    assert.equal(
      classifySignalSource({
        category: 'story-blocked',
        emitter: { tool: 'transitionTicketState' },
        details: { toState: 'agent::blocked' },
      }),
      'consumer',
    );
  });
});

describe('classifySignalSource — step 1: an operator-supplied field still wins', () => {
  it('routes through the unchanged prefix scan for a supplied command', () => {
    assert.equal(
      classifySignalSource({
        category: 'tool-degraded',
        emitter: { tool: 'native-review-lint', command: 'npm run lint' },
      }),
      'consumer',
      'a supplied consumer command beats the tool-degraded limb',
    );
  });

  it('classifies a supplied framework command as framework', () => {
    assert.equal(
      classifySignalSource({
        category: 'Execution Error',
        emitter: {
          tool: 'diagnose-friction',
          command: 'node .agents/scripts/single-story-init.js --story 1',
        },
      }),
      'framework',
    );
  });

  it('classifies a supplied consumer failingPath as consumer', () => {
    assert.equal(
      classifySignalSource({
        category: 'tool-degraded',
        failingPath: 'src/components/Button.tsx',
        emitter: { tool: 'native-review-lint' },
      }),
      'consumer',
    );
  });

  it('treats a blank supplied field as absent, not as evidence', () => {
    assert.equal(
      classifySignalSource({
        category: 'tool-degraded',
        failingPath: '   ',
        command: '',
        emitter: { tool: 'native-review-lint' },
      }),
      'framework',
    );
  });
});

describe('classifySignalSource — step 2: the details payload names the surface', () => {
  it('classifies framework when reason names a framework path', () => {
    assert.equal(
      classifySignalSource({
        category: 'close-failed',
        emitter: { tool: 'single-story-close' },
        details: {
          phase: 'close-validation',
          reason: 'conflicting files = .agents/scripts/single-story-close.js',
        },
      }),
      'framework',
    );
  });

  it('classifies framework when surface names a framework path', () => {
    assert.equal(
      classifySignalSource({
        category: 'story-blocked',
        emitter: { tool: 'transitionTicketState' },
        details: { surface: '.agentrc.json' },
      }),
      'framework',
    );
  });

  it('ignores non-string and unlisted detail keys', () => {
    assert.equal(
      classifySignalSource({
        category: 'close-failed',
        details: { note: '.agents/scripts/foo.js', reason: 42 },
      }),
      'consumer',
      'only reason / surface / phase are scanned',
    );
  });
});

describe('classifySignalSource — defaults & coercion', () => {
  it('returns consumer for non-object input', () => {
    assert.equal(classifySignalSource(null), 'consumer');
    assert.equal(classifySignalSource(undefined), 'consumer');
    assert.equal(classifySignalSource('tool-degraded'), 'consumer');
    assert.equal(classifySignalSource([]), 'consumer');
  });

  it('returns consumer for a record with no usable fields', () => {
    assert.equal(classifySignalSource({}), 'consumer');
  });

  it('tolerates a non-object emitter and details', () => {
    assert.equal(
      classifySignalSource({
        category: 'tool-degraded',
        emitter: 'native-review-lint',
        details: 'boom',
      }),
      'framework',
    );
  });
});

/**
 * Story #4916 — recognition must not depend on how the caller spelled the
 * reference.
 *
 * `node .agents/scripts/acceptance-eval.js --story 4901` classified
 * `framework` while `acceptance-eval.js --story 4901` classified `consumer`,
 * so two signals of otherwise identical shape carried different `source`
 * values and a real framework defect was routed as consumer-actionable and
 * discarded.
 */
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const SCRIPTS_DIR = path.join(REPO_ROOT, '.agents/scripts');
const CLASSIFIER_PATH = path.join(
  SCRIPTS_DIR,
  'lib/observability/source-classifier.js',
);

describe('classifySignalSource — a bare framework-script basename is framework (Story #4916)', () => {
  it('classifies the two live shapes measured on main as framework', () => {
    // Both were measured returning `consumer` before this Story.
    assert.equal(
      classifySignalSource({
        category: 'Execution Error',
        emitter: {
          tool: 'diagnose-friction',
          command: 'single-story-close.js --story 4906',
        },
      }),
      'framework',
    );
    assert.equal(
      classifySignalSource({
        category: 'Execution Error',
        emitter: {
          tool: 'diagnose-friction',
          command: 'acceptance-eval.js --story 4901',
        },
      }),
      'framework',
    );
  });

  it('recognises the basename wherever it sits on the command line', () => {
    assert.equal(classifyPathSource('', 'node run-tests.js'), 'framework');
    assert.equal(
      classifyPathSource('', 'npx --no-install plan-persist.js --dry-run'),
      'framework',
    );
    assert.equal(
      classifyPathSource('', 'sh -c "check-baselines.js"'),
      'framework',
      'surrounding quotes are stripped before the membership test',
    );
  });

  it('recognises a bare basename supplied as the failingPath', () => {
    assert.equal(classifyPathSource('update-ticket-state.js', ''), 'framework');
  });

  it('is spelling-independent: the pathed and bare forms agree', () => {
    for (const basename of __testing.FRAMEWORK_SCRIPT_BASENAMES) {
      assert.equal(
        classifyPathSource('', `node ${basename} --story 4916`),
        classifyPathSource('', `node .agents/scripts/${basename} --story 4916`),
        `${basename}: bare and pathed spellings must classify alike`,
      );
    }
  });
});

describe('classifySignalSource — the widening does not collapse into always-framework (Story #4916)', () => {
  it('keeps a plain tool invocation consumer', () => {
    assert.equal(classifyPathSource('', 'npm test'), 'consumer');
    assert.equal(
      classifyPathSource('', 'npm run build --workspace web'),
      'consumer',
    );
    assert.equal(classifyPathSource('', 'pytest -k checkout'), 'consumer');
  });

  it('keeps a script basename that is not shipped under .agents/scripts/ consumer', () => {
    assert.equal(classifyPathSource('', 'node seed-database.js'), 'consumer');
    assert.equal(
      classifyPathSource('', 'node scripts/deploy.js --env prod'),
      'consumer',
    );
  });

  it('does not match a basename carrying a consumer path segment', () => {
    // The consumer's own `notify.js` is not the framework's.
    assert.equal(classifyPathSource('', 'node ./tools/notify.js'), 'consumer');
    assert.equal(classifyPathSource('tools/notify.js', ''), 'consumer');
  });

  it('matches whole tokens only, never a substring', () => {
    assert.equal(classifyPathSource('', 'node my-notify.js'), 'consumer');
    assert.equal(classifyPathSource('', 'node run-tests.js.bak'), 'consumer');
  });
});

describe('source-classifier — widening is one-directional (Story #4916)', () => {
  it('still returns framework for each of the four FRAMEWORK_PREFIXES forms', () => {
    assert.deepEqual(__testing.FRAMEWORK_PREFIXES, [
      '.agents/',
      '.agentrc.json',
      '.claude/',
      'node .agents/scripts/',
    ]);
    for (const prefix of __testing.FRAMEWORK_PREFIXES) {
      assert.equal(
        classifyPathSource('', `host ${prefix} tail`),
        'framework',
        `${prefix} must still classify framework via the command route`,
      );
      assert.equal(
        classifyPathSource(`host/${prefix}tail`, ''),
        'framework',
        `${prefix} must still classify framework via the failingPath route`,
      );
    }
  });

  it('still returns framework for the details-scan and tool-degraded tiers', () => {
    assert.equal(
      classifySignalSource({
        category: 'close-failed',
        details: { reason: 'conflicting files = .agents/scripts/foo.js' },
      }),
      'framework',
      'details-scan tier unchanged',
    );
    assert.equal(
      classifySignalSource({
        category: 'tool-degraded',
        emitter: { tool: 'native-review-lint' },
      }),
      'framework',
      'tool-degraded tier unchanged',
    );
  });

  it('reclassifies nothing from framework to consumer', () => {
    // Every input the suite asserts as framework is re-asserted here as a set,
    // so a future narrowing of the scan cannot pass by editing one case.
    const frameworkInputs = [
      ['.agents/scripts/story-init.js', ''],
      ['repo/.agents/rules/security-baseline.md', ''],
      ['.agentrc.json', ''],
      ['subproject/.agentrc.json', ''],
      ['.claude/settings.json', ''],
      ['host/.claude/hooks/post-commit', ''],
      ['', 'node .agents/scripts/story-init.js --story 2553'],
      ['', 'ls .agents/scripts'],
      ['', 'cat .agentrc.json'],
      ['', 'rg foo .claude/'],
      ['.agents/scripts/foo.js', 'npm run test'],
      ['src/checkout/index.ts', 'node .agents/scripts/story-init.js'],
    ];
    for (const [failingPath, command] of frameworkInputs) {
      assert.equal(
        classifyPathSource(failingPath, command),
        'framework',
        `(${failingPath}, ${command}) must stay framework`,
      );
    }
  });
});

describe('source-classifier — the recognized basename set cannot go stale (Story #4916)', () => {
  it('matches the scripts actually shipped at the top level of .agents/scripts/', () => {
    const shipped = fs
      .readdirSync(SCRIPTS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(
      [...__testing.FRAMEWORK_SCRIPT_BASENAMES].sort(),
      shipped,
      'a script was added, renamed, or removed without updating ' +
        'FRAMEWORK_SCRIPT_BASENAMES in source-classifier.js — update the list, ' +
        'or the classifier silently mis-routes that script’s friction signals',
    );
  });
});

describe('source-classifier — classification performs no filesystem access (Story #4916)', () => {
  it('reads nothing while classifying', (t) => {
    const readMethods = [
      'readFileSync',
      'readdirSync',
      'existsSync',
      'statSync',
      'openSync',
      'realpathSync',
    ];
    for (const method of readMethods) {
      t.mock.method(fs, method, () => {
        throw new Error(`source-classifier must not call fs.${method}`);
      });
    }
    for (const basename of __testing.FRAMEWORK_SCRIPT_BASENAMES) {
      classifySignalSource({
        category: 'Execution Error',
        emitter: {
          tool: 'diagnose-friction',
          command: `${basename} --story 1`,
        },
      });
    }
    classifySignalSource({ category: 'close-failed' });
    for (const method of readMethods) {
      assert.equal(
        fs[method].mock.callCount(),
        0,
        `fs.${method} was called during classification`,
      );
    }
  });

  it('imports nothing from node:fs — the set is static data', () => {
    // Belt-and-braces over the runtime mock above: a named `import { readdirSync }
    // from 'node:fs'` would bind past the mocked property, so pin the source too.
    const source = fs.readFileSync(CLASSIFIER_PATH, 'utf8');
    assert.equal(
      /from\s+'(node:)?fs(\/promises)?'/.test(source),
      false,
      'source-classifier.js must not import node:fs — it is called per signal ' +
        'and stays pure',
    );
  });
});
