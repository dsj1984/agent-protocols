/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  // ─── Runner ──────────────────────────────────────────────────────────────
  testRunner: 'tap',
  // node:test emits TAP when --test-reporter=tap is passed as a node arg.
  // The tap-runner plugin picks these up at top level (not nested).
  testFiles: ['tests/*.test.js', 'tests/lib/*.test.js'],
  testRunnerNodeArgs: ['--test-reporter=tap'],

  // ─── Source files to mutate ───────────────────────────────────────────────
  // Scope to the core SDK library only. CLI entry points, providers, and
  // integration tools are excluded because they are not unit-tested and
  // would produce misleading "survived" counts.
  mutate: [
    '.agents/scripts/lib/**/*.js',
    // Exclude the ITicketingProvider interface stubs — they always throw and
    // are never mutated in a meaningful way.
    '!.agents/scripts/lib/ITicketingProvider.js',
    // Exclude generated / pure-data files.
    '!.agents/scripts/lib/label-taxonomy.js',
    '!.agents/scripts/lib/templates/**',
  ],

  // ─── Mutators ────────────────────────────────────────────────────────────
  // Default mutator set covers: ArithmeticOperator, ArrayDeclaration,
  // BlockStatement, BooleanLiteral, ConditionalExpression, EqualityOperator,
  // LogicalOperator, StringLiteral, etc.
  // No additional configuration needed for JavaScript projects.

  // ─── Thresholds ──────────────────────────────────────────────────────────
  thresholds: {
    high: 75,
    low: 60,
    break: null, // warn but don't fail — mutation score is advisory
  },

  // ─── Reporters ───────────────────────────────────────────────────────────
  reporters: ['html', 'json', 'progress'],
  htmlReporter: {
    fileName: 'reports/mutation/index.html',
  },
  jsonReporter: {
    fileName: 'reports/mutation/mutation.json',
  },

  // ─── Performance ─────────────────────────────────────────────────────────
  // Keep concurrency modest — node:test child processes share the same
  // file system and don't need aggressive parallelism.
  concurrency: 4,

  // ─── Incremental ─────────────────────────────────────────────────────────
  // Save the incremental result so subsequent runs only test changed mutants.
  incremental: true,
  incrementalFile: 'reports/mutation/stryker-incremental.json',

  // ─── Coverage analysis ───────────────────────────────────────────────────
  // 'perTest' maps which tests kill which mutants; requires test isolation.
  coverageAnalysis: 'off',

  // ─── Misc ─────────────────────────────────────────────────────────────────
  cleanTempDir: 'always',
  tempDirName: '.stryker-tmp',
  // Don't time out unit test suites aggressively — some integration helpers
  // are slow on cold start.
  timeoutMS: 10000,
  timeoutFactor: 2.0,
};
