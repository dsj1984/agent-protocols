import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  __testing,
  carryProvenanceFooters,
  fingerprintFinding,
  fingerprintFooter,
  parseFingerprintFooter,
  routeFinding,
  semanticKeyFooter,
} from '../../../.agents/scripts/lib/findings/route-finding.js';

// Internal helper: the module's three call sites reach it directly, so it is
// exposed through `__testing` rather than widening the public surface.
const { parseSemanticKeyFooter } = __testing;

const baseFinding = {
  title: 'Unparameterised SQL query in login handler',
  area: 'injection',
  primaryFile: 'src/routes/auth/login.js',
  severity: 'high',
  labels: ['security', 'sql'],
};

test('fingerprintFinding produces a stable sha1 for identical inputs', () => {
  const a = fingerprintFinding(baseFinding);
  const b = fingerprintFinding({ ...baseFinding });
  assert.equal(a.full, b.full);
  assert.equal(a.full.length, 40);
  assert.equal(a.short.length, 12);
  assert.equal(a.short, a.full.slice(0, 12));
});

test('fingerprintFinding is order-independent in labels', () => {
  const a = fingerprintFinding(baseFinding);
  const b = fingerprintFinding({ ...baseFinding, labels: ['sql', 'security'] });
  assert.equal(a.full, b.full);
});

test('fingerprintFinding is case- and whitespace-insensitive', () => {
  const a = fingerprintFinding(baseFinding);
  const b = fingerprintFinding({
    ...baseFinding,
    title: '  UNPARAMETERISED SQL QUERY IN LOGIN HANDLER  ',
    severity: 'High',
  });
  assert.equal(a.full, b.full);
});

test('fingerprintFinding differs when title differs', () => {
  const a = fingerprintFinding(baseFinding);
  const b = fingerprintFinding({ ...baseFinding, title: 'SQLi in signup' });
  assert.notEqual(a.full, b.full);
});

test('fingerprintFinding differs when severity differs', () => {
  const a = fingerprintFinding(baseFinding);
  const b = fingerprintFinding({ ...baseFinding, severity: 'low' });
  assert.notEqual(a.full, b.full);
});

test('fingerprintFinding differs when primaryFile differs', () => {
  const a = fingerprintFinding(baseFinding);
  const b = fingerprintFinding({ ...baseFinding, primaryFile: 'src/x.js' });
  assert.notEqual(a.full, b.full);
});

test('fingerprintFinding tolerates missing fields', () => {
  const fp = fingerprintFinding({ title: 'only a title' });
  assert.equal(fp.full.length, 40);
  assert.equal(fp.components.area, '');
  assert.equal(fp.components.labels, '');
  assert.equal(fp.components.primaryFile, '');
});

test('fingerprintFinding tolerates a null finding', () => {
  const fp = fingerprintFinding(null);
  assert.equal(fp.full.length, 40);
});

test('fingerprintFooter round-trips through parseFingerprintFooter (AC #4)', () => {
  const { full: sha } = fingerprintFinding(baseFinding);
  const footer = fingerprintFooter(sha);
  const body = `Some issue body.\n\n${footer}\n`;
  assert.deepEqual(parseFingerprintFooter(body), [sha]);
});

test('fingerprintFooter rejects a non-sha argument', () => {
  assert.throws(() => fingerprintFooter('not-a-sha'));
  assert.throws(() => fingerprintFooter(null));
});

test('parseFingerprintFooter returns empty array when marker absent', () => {
  assert.deepEqual(parseFingerprintFooter('hello world'), []);
});

test('parseFingerprintFooter ignores malformed sha entries', () => {
  const body =
    '<!-- audit-fingerprints: notasha, abc, 0123456789abcdef0123456789abcdef01234567 -->';
  assert.deepEqual(parseFingerprintFooter(body), [
    '0123456789abcdef0123456789abcdef01234567',
  ]);
});

test('parseFingerprintFooter tolerates non-string input', () => {
  assert.deepEqual(parseFingerprintFooter(null), []);
  assert.deepEqual(parseFingerprintFooter(undefined), []);
});

test('routeFinding returns new when no existing issue matches (AC #1)', async () => {
  const result = await routeFinding(baseFinding, {
    searchIssues: async () => [],
  });
  assert.equal(result.decision, 'new');
  assert.equal(result.matchedIssue, null);
});

test('routeFinding returns update-existing for a single open match (AC #2)', async () => {
  const { full: sha } = fingerprintFinding(baseFinding);
  const result = await routeFinding(baseFinding, {
    searchIssues: async () => [
      { number: 42, state: 'open', body: fingerprintFooter(sha) },
    ],
  });
  assert.equal(result.decision, 'update-existing');
  assert.equal(result.matchedIssue.number, 42);
});

test('routeFinding returns duplicate for multiple open matches (AC #2)', async () => {
  const { full: sha } = fingerprintFinding(baseFinding);
  const footer = fingerprintFooter(sha);
  const result = await routeFinding(baseFinding, {
    searchIssues: async () => [
      { number: 42, state: 'open', body: footer },
      { number: 43, state: 'open', body: footer },
    ],
  });
  assert.equal(result.decision, 'duplicate');
  assert.equal(result.matchedIssue.number, 42);
});

test('routeFinding returns regression-of-closed for a closed match (AC #3)', async () => {
  const { full: sha } = fingerprintFinding(baseFinding);
  const result = await routeFinding(baseFinding, {
    searchIssues: async () => [
      { number: 99, state: 'closed', body: fingerprintFooter(sha) },
    ],
  });
  assert.equal(result.decision, 'regression-of-closed');
  assert.equal(result.matchedIssue.number, 99);
});

test('routeFinding prefers an open match over a closed one', async () => {
  const { full: sha } = fingerprintFinding(baseFinding);
  const footer = fingerprintFooter(sha);
  const result = await routeFinding(baseFinding, {
    searchIssues: async () => [
      { number: 99, state: 'closed', body: footer },
      { number: 42, state: 'open', body: footer },
    ],
  });
  assert.equal(result.decision, 'update-existing');
  assert.equal(result.matchedIssue.number, 42);
});

test('routeFinding ignores a search hit whose body lacks the footer', async () => {
  const { full: sha } = fingerprintFinding(baseFinding);
  const result = await routeFinding(baseFinding, {
    searchIssues: async () => [
      { number: 7, state: 'open', body: `mentions ${sha} in prose only` },
    ],
  });
  assert.equal(result.decision, 'new');
  assert.equal(result.matchedIssue, null);
});

test('routeFinding accepts a hit with no body (search-only confirmation)', async () => {
  const result = await routeFinding(baseFinding, {
    searchIssues: async () => [{ number: 5, state: 'open' }],
  });
  assert.equal(result.decision, 'update-existing');
  assert.equal(result.matchedIssue.number, 5);
});

test('routeFinding throws when searchIssues port is missing', async () => {
  await assert.rejects(() => routeFinding(baseFinding, {}));
});

test('routeFinding exposes the fingerprint it routed on', async () => {
  const { full: sha } = fingerprintFinding(baseFinding);
  const result = await routeFinding(baseFinding, {
    searchIssues: async () => [],
  });
  assert.equal(result.fingerprint, sha);
});

// --- Two-stage routing: semantic candidate pass FIRST, fingerprint SECOND ---

test('routeFinding runs the semantic candidate pass first when a searchCandidates port is supplied', async () => {
  const calls = [];
  const { full: sha } = fingerprintFinding(baseFinding);
  const result = await routeFinding(baseFinding, {
    searchCandidates: async (finding) => {
      calls.push('semantic');
      assert.equal(finding.title, baseFinding.title);
      return [{ number: 42, state: 'open', body: fingerprintFooter(sha) }];
    },
    searchIssues: async () => {
      calls.push('fingerprint');
      return [];
    },
  });
  // Semantic port ran; the fingerprint-only lookup did NOT (candidates came
  // from the semantic pass, then were confirmed by footer in-process).
  assert.deepEqual(calls, ['semantic']);
  assert.equal(result.decision, 'update-existing');
  assert.equal(result.matchedIssue.number, 42);
});

test('routeFinding fingerprint-confirms the semantic candidate pool (drops a similar-but-unrelated hit)', async () => {
  const result = await routeFinding(baseFinding, {
    searchCandidates: async () => [
      // Semantically similar title, but the body carries no fingerprint footer.
      { number: 7, state: 'open', title: 'SQL injection in login', body: '' },
    ],
  });
  assert.equal(result.decision, 'new');
  assert.equal(result.matchedIssue, null);
});

test('routeFinding routes a closed semantic candidate to regression-of-closed', async () => {
  const { full: sha } = fingerprintFinding(baseFinding);
  const result = await routeFinding(baseFinding, {
    searchCandidates: async () => [
      { number: 99, state: 'closed', body: fingerprintFooter(sha) },
    ],
  });
  assert.equal(result.decision, 'regression-of-closed');
  assert.equal(result.matchedIssue.number, 99);
});

test('routeFinding preserves the decision enum across both ports', async () => {
  const { full: sha } = fingerprintFinding(baseFinding);
  const footer = fingerprintFooter(sha);
  const viaSemantic = await routeFinding(baseFinding, {
    searchCandidates: async () => [
      { number: 1, state: 'open', body: footer },
      { number: 2, state: 'open', body: footer },
    ],
  });
  const viaFingerprint = await routeFinding(baseFinding, {
    searchIssues: async () => [
      { number: 1, state: 'open', body: footer },
      { number: 2, state: 'open', body: footer },
    ],
  });
  assert.equal(viaSemantic.decision, 'duplicate');
  assert.equal(viaFingerprint.decision, 'duplicate');
});

test('routeFinding throws when neither a searchCandidates nor a searchIssues port is supplied', async () => {
  await assert.rejects(() => routeFinding(baseFinding, {}));
  await assert.rejects(() => routeFinding(baseFinding));
});

// ---------------------------------------------------------------------------
// Story #4877 — multi-footer parsing and the mechanical provenance carry.
// ---------------------------------------------------------------------------

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);

test('parseFingerprintFooter reads EVERY footer occurrence, not just the first', () => {
  // The audit Single-plan seed stamps one footer pair per MVP Scope bullet, so a
  // multi-group seed carries several. A first-match-only parse silently dropped
  // every group but the first — which would make the carry below look wired
  // while leaking most of the provenance.
  const seed = [
    '## MVP Scope',
    '',
    `1. **Group one** — architecture`,
    `   ${fingerprintFooter(SHA_A)}`,
    `2. **Group two** — quality`,
    `   ${fingerprintFooter([SHA_B, SHA_C])}`,
  ].join('\n');
  assert.deepEqual(parseFingerprintFooter(seed), [SHA_A, SHA_B, SHA_C]);
});

test('parseFingerprintFooter de-duplicates a sha repeated across footers', () => {
  const body = `${fingerprintFooter(SHA_A)}\n${fingerprintFooter([SHA_A, SHA_B])}`;
  assert.deepEqual(parseFingerprintFooter(body), [SHA_A, SHA_B]);
});

test('parseSemanticKeyFooter reads every footer occurrence', () => {
  const seed = [
    `   ${semanticKeyFooter('architecture␟lib/a.js')}`,
    `   ${semanticKeyFooter('quality␟lib/b.js')}`,
  ].join('\n');
  assert.deepEqual(parseSemanticKeyFooter(seed), [
    'architecture␟lib/a.js',
    'quality␟lib/b.js',
  ]);
});

test('carryProvenanceFooters copies both footers from the seed into the body (AC-5)', () => {
  const seed = [
    '# Idea Seed: Audit Remediation',
    '',
    '## MVP Scope',
    '',
    '1. **Fix the seam** — architecture',
    `   ${fingerprintFooter(SHA_A)}`,
    `   ${semanticKeyFooter('architecture␟lib/seam.js')}`,
  ].join('\n');
  const body = '## Goal\n\nRemediate the seam.\n';

  const result = carryProvenanceFooters({ from: seed, into: body });

  assert.equal(result.carried, true);
  assert.deepEqual(result.fingerprints, [SHA_A]);
  assert.deepEqual(result.semanticKeys, ['architecture␟lib/seam.js']);
  assert.ok(
    result.body.startsWith(body),
    'the authored body must be preserved verbatim ahead of the carried footers',
  );
  assert.deepEqual(parseFingerprintFooter(result.body), [SHA_A]);
  assert.deepEqual(parseSemanticKeyFooter(result.body), [
    'architecture␟lib/seam.js',
  ]);
});

test('carryProvenanceFooters carries every group of a multi-group seed', () => {
  const seed = [
    `1. **One**`,
    `   ${fingerprintFooter(SHA_A)}`,
    `2. **Two**`,
    `   ${fingerprintFooter(SHA_B)}`,
  ].join('\n');
  const result = carryProvenanceFooters({ from: seed, into: '## Goal\n' });
  assert.deepEqual(result.fingerprints, [SHA_A, SHA_B]);
  assert.deepEqual(parseFingerprintFooter(result.body), [SHA_A, SHA_B]);
});

test('carryProvenanceFooters is idempotent — a resumed persist cannot stack footers', () => {
  const seed = `${fingerprintFooter(SHA_A)}\n${semanticKeyFooter('architecture␟lib/a.js')}`;
  const once = carryProvenanceFooters({ from: seed, into: '## Goal\n' });
  const twice = carryProvenanceFooters({ from: seed, into: once.body });

  assert.equal(twice.carried, false);
  assert.equal(
    twice.body,
    once.body,
    're-running must not append a second footer',
  );
  assert.deepEqual(parseFingerprintFooter(twice.body), [SHA_A]);
});

test('carryProvenanceFooters preserves a hand-authored fingerprint and adds the union', () => {
  const body = `## Goal\n\nhi\n\n${fingerprintFooter(SHA_C)}\n`;
  const result = carryProvenanceFooters({
    from: fingerprintFooter([SHA_A, SHA_C]),
    into: body,
  });

  assert.deepEqual(
    result.fingerprints,
    [SHA_A],
    'only the shas the body was missing are carried',
  );
  assert.deepEqual(
    parseFingerprintFooter(result.body).sort(),
    [SHA_A, SHA_C].sort(),
    'the body ends up carrying the union of both sides',
  );
});

test('carryProvenanceFooters is a no-op for a seed with no provenance', () => {
  const body = '## Goal\n\nA plain non-audit plan.\n';
  const result = carryProvenanceFooters({
    from: '# Idea Seed\n\nNo footers here.\n',
    into: body,
  });
  assert.equal(result.carried, false);
  assert.equal(result.body, body);
  assert.deepEqual(result.fingerprints, []);
  assert.deepEqual(result.semanticKeys, []);
});

test('carryProvenanceFooters tolerates absent and non-string arguments', () => {
  assert.equal(carryProvenanceFooters().carried, false);
  assert.equal(carryProvenanceFooters({ from: null, into: null }).body, '');
  assert.equal(
    carryProvenanceFooters({ from: 42, into: '## Goal\n' }).carried,
    false,
  );
});

test('a Story carrying carried-through provenance dedupes on the next sweep (AC-6)', async () => {
  // End to end: the sweep plans a finding, the Story is persisted with the
  // provenance the carry copied in, and the NEXT sweep over the unchanged
  // finding recognises that Story instead of filing a duplicate.
  const finding = {
    title: 'Optional field nothing populates',
    area: 'architecture',
    primaryFile: 'lib/opts.js',
    severity: 'medium',
    labels: ['audit::architecture'],
  };
  const { full: sha } = fingerprintFinding(finding);

  const seed = `1. **Fix it**\n   ${fingerprintFooter(sha)}`;
  const persistedBody = carryProvenanceFooters({
    from: seed,
    into: '## Goal\n\nRemediate.\n',
  }).body;

  const issues = [{ number: 99, state: 'open', body: persistedBody }];
  const result = await routeFinding(finding, {
    searchIssues: async (queried) =>
      issues.filter((i) => i.body.includes(queried)),
  });

  assert.equal(
    result.decision,
    'update-existing',
    'the second sweep must recognise the planned Story, not re-file it',
  );
  assert.equal(result.matchedIssue.number, 99);
});
