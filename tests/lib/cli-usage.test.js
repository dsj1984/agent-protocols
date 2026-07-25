/**
 * Unit coverage for `.agents/scripts/lib/cli-usage.js` (Story #4750) and for
 * the `usage` short-circuit it gives `runAsCli`.
 *
 * The load-bearing claim is the **ordering**: help is answered before `main`
 * runs at all. That is what makes "`--help` performs no GitHub write, acquires
 * no lease, and mutates no working tree" true for every adopting script
 * without each one re-implementing the guard — so it gets a direct test rather
 * than being inferred from a subprocess's stdout.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatUsage,
  HELP_FLAGS,
  renderUsage,
  respondToHelp,
  wantsHelp,
} from '../../.agents/scripts/lib/cli-usage.js';
import { runAsCli } from '../../.agents/scripts/lib/cli-utils.js';

/** Collecting stdout stand-in. */
function sink() {
  const chunks = [];
  return { chunks, write: (s) => chunks.push(s), text: () => chunks.join('') };
}

describe('wantsHelp', () => {
  it('recognizes every documented help flag', () => {
    for (const flag of HELP_FLAGS) {
      assert.equal(wantsHelp([flag]), true, `${flag} should request help`);
    }
  });

  it('finds the flag anywhere in the argv', () => {
    assert.equal(wantsHelp(['--story', '42', '--help']), true);
  });

  it('is false for an argv with no help flag', () => {
    assert.equal(wantsHelp(['--story', '42']), false);
    assert.equal(wantsHelp([]), false);
  });

  it('ignores a help-shaped positional after the `--` separator', () => {
    // `--cmd -- npm test --help` must run the command, not print usage.
    assert.equal(wantsHelp(['--cmd', '--', 'npm', 'test', '--help']), false);
  });

  it('is false rather than throwing on a non-array argv', () => {
    assert.equal(wantsHelp(undefined), false);
    assert.equal(wantsHelp('--help'), false);
  });
});

describe('formatUsage', () => {
  const spec = {
    invocation: 'node .agents/scripts/demo.js --story <id> [--json]',
    summary: 'Do the demo thing.',
    flags: [
      ['--story <id>', 'GitHub issue number (required).'],
      ['--json', 'Emit JSON.'],
    ],
    notes: ['Exit codes:\n  0  ok'],
  };

  it('renders the invocation, summary, flag table and notes', () => {
    const text = formatUsage(spec);
    assert.match(text, /^Usage: node \.agents\/scripts\/demo\.js /);
    assert.match(text, /Do the demo thing\./);
    assert.match(
      text,
      /^ {2}--story <id> {10}GitHub issue number \(required\)\.$/m,
    );
    assert.match(text, /Exit codes:/);
  });

  it('documents --help itself so the block is self-describing', () => {
    assert.match(formatUsage(spec), /^ {2}--help {16}Show this message\.$/m);
  });

  it('does not duplicate a --help row the caller already supplied', () => {
    const text = formatUsage({
      invocation: 'node demo.js',
      flags: [['--help', 'Print usage.']],
    });
    assert.equal(text.match(/--help/g).length, 1);
    assert.match(text, /Print usage\./);
  });

  it('wraps a flag wider than the column onto its own line', () => {
    const text = formatUsage({
      invocation: 'node demo.js',
      flags: [['--a-very-long-flag-name <value>', 'Described below.']],
    });
    assert.match(
      text,
      /--a-very-long-flag-name <value>\n {24}Described below\./,
    );
  });

  it('renders a flagless script as a --help-only table', () => {
    const text = formatUsage({ invocation: 'node demo.js', summary: 'Runs.' });
    assert.match(text, /Flags:\n {2}--help/);
  });

  it('always terminates with a newline', () => {
    assert.ok(formatUsage(spec).endsWith('\n'));
  });
});

describe('renderUsage', () => {
  it('passes a pre-rendered string through unchanged', () => {
    assert.equal(renderUsage('Usage: demo\n'), 'Usage: demo\n');
  });

  it('newline-terminates a pre-rendered string that lacks one', () => {
    assert.equal(renderUsage('Usage: demo'), 'Usage: demo\n');
  });

  it('formats a spec object', () => {
    assert.match(
      renderUsage({ invocation: 'node demo.js' }),
      /^Usage: node demo\.js/,
    );
  });
});

describe('respondToHelp', () => {
  it('writes the usage text and reports handled when help was asked for', () => {
    const out = sink();
    assert.equal(respondToHelp(['--help'], 'Usage: demo\n', out), true);
    assert.equal(out.text(), 'Usage: demo\n');
  });

  it('writes nothing and reports unhandled when help was not asked for', () => {
    const out = sink();
    assert.equal(respondToHelp(['--story', '1'], 'Usage: demo\n', out), false);
    assert.equal(out.text(), '');
  });

  it('still emits non-empty text when the spec renders blank', () => {
    const out = sink();
    respondToHelp(['--help'], '', out);
    assert.ok(out.text().trim().length > 0);
  });
});

describe('runAsCli — the usage short-circuit', () => {
  const SELF = import.meta.url;

  /** Run `runAsCli` as if this module were the direct CLI entry. */
  function withArgv(argv, fn) {
    const savedArgv = process.argv;
    const savedWrite = process.stdout.write;
    const written = [];
    process.argv = [savedArgv[0], new URL(SELF).pathname, ...argv];
    process.stdout.write = (chunk) => {
      written.push(String(chunk));
      return true;
    };
    try {
      fn();
    } finally {
      process.stdout.write = savedWrite;
      process.argv = savedArgv;
    }
    return written.join('');
  }

  it('answers --help without ever invoking main', () => {
    let mainRuns = 0;
    const out = withArgv(['--help'], () => {
      runAsCli(
        SELF,
        async () => {
          mainRuns += 1;
        },
        { source: 'demo', usage: { invocation: 'node demo.js --story <id>' } },
      );
    });
    assert.equal(mainRuns, 0, 'main must not run on the help path');
    assert.match(out, /^Usage: node demo\.js --story <id>/);
  });

  it('runs main normally when no help flag is present', async () => {
    let mainRuns = 0;
    const out = withArgv(['--story', '1'], () => {
      runAsCli(
        SELF,
        async () => {
          mainRuns += 1;
        },
        { source: 'demo', usage: { invocation: 'node demo.js' } },
      );
    });
    assert.equal(mainRuns, 1);
    assert.equal(out, '');
  });

  it('runs main when the caller declared no usage at all', () => {
    let mainRuns = 0;
    withArgv(['--help'], () => {
      runAsCli(
        SELF,
        async () => {
          mainRuns += 1;
        },
        { source: 'demo' },
      );
    });
    assert.equal(
      mainRuns,
      1,
      'a script without a usage spec keeps old behavior',
    );
  });
});
