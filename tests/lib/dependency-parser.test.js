import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractEpicIdFromBody,
  isSafeBranchComponent,
  parseBlockedBy,
  parseBlocks,
  parseTaskMetadata,
} from '../../.agents/scripts/lib/dependency-parser.js';

describe('dependency-parser', () => {
  describe('parseBlockedBy — footer-scoped and strict (Story #5046)', () => {
    // A declared edge lives on its own line inside the `---` footer block.
    // The unanchored predecessor scanned the whole body, so any prose
    // mentioning a blocker minted a real dispatch gate.
    const footer = (...lines) =>
      ['## Goal', 'Do the thing.', '', '---', ...lines].join('\n');

    it('returns empty array for falsy input', () => {
      assert.deepEqual(parseBlockedBy(null), []);
      assert.deepEqual(parseBlockedBy(undefined), []);
      assert.deepEqual(parseBlockedBy(''), []);
    });

    it('parses a footer "blocked by #NNN" line', () => {
      assert.deepEqual(parseBlockedBy(footer('blocked by #123')), [123]);
    });

    it('is case-insensitive within the footer', () => {
      assert.deepEqual(parseBlockedBy(footer('BLOCKED BY #333')), [333]);
    });

    it('extracts and dedupes multiple footer dependencies', () => {
      assert.deepEqual(
        parseBlockedBy(
          footer('blocked by #1', 'blocked by #2', 'blocked by #1'),
        ),
        [1, 2],
      );
    });

    it('reads a footer alongside the other recognised footer keys', () => {
      assert.deepEqual(
        parseBlockedBy(footer('parent: #900', 'blocked by #901')),
        [901],
      );
    });

    it('does NOT mint a gate from prose outside the footer', () => {
      // The live reproduction: Story #5046's own acceptance text contained
      // the phrase below as an EXAMPLE, and the old parser turned it into a
      // real dispatch edge on #123.
      assert.deepEqual(parseBlockedBy('This is blocked by #123.'), []);
      assert.deepEqual(parseBlockedBy('blocked by #456'), []);
      assert.deepEqual(
        parseBlockedBy('## Goal\nA body mentioning blocked by #123 in prose.'),
        [],
      );
    });

    it('does NOT accept the loose "depends on" / colon spellings', () => {
      // Only the canonical footer form declares. `plan-persist` has always
      // serialized that form, so no machine-authored body is affected.
      assert.deepEqual(parseBlockedBy(footer('depends on #789')), []);
      assert.deepEqual(parseBlockedBy(footer('Blocked by: #111')), []);
    });

    it('does NOT accept a footer line carrying trailing prose', () => {
      assert.deepEqual(
        parseBlockedBy(footer('blocked by #123 once the API lands')),
        [],
      );
    });

    it('ignores a `---` rule that opens no footer block', () => {
      // A thematic break mid-body is not a footer separator: the lines after
      // it must start with a recognised footer key.
      assert.deepEqual(
        parseBlockedBy('## Goal\n\n---\n\nSome prose. blocked by #123'),
        [],
      );
    });

    it('ignores non-matching text', () => {
      assert.deepEqual(parseBlockedBy('Fixes #999, related to #888'), []);
    });
  });

  describe('parseBlocks', () => {
    it('returns empty array for falsy input', () => {
      assert.deepEqual(parseBlocks(null), []);
      assert.deepEqual(parseBlocks(undefined), []);
      assert.deepEqual(parseBlocks(''), []);
    });

    it('parses "blocks #NNN"', () => {
      assert.deepEqual(parseBlocks('This blocks #123.'), [123]);
    });

    it('is case-insensitive', () => {
      assert.deepEqual(parseBlocks('BLOCKS #456'), [456]);
      assert.deepEqual(parseBlocks('Blocks #789'), [789]);
    });

    it('extracts multiple blocks', () => {
      assert.deepEqual(parseBlocks('blocks #1\nblocks #2'), [1, 2]);
    });

    it('ignores non-matching text', () => {
      assert.deepEqual(parseBlocks('Fixes #999, blocked by #888'), []);
    });
  });

  describe('extractEpicIdFromBody', () => {
    it('returns null for falsy input', () => {
      assert.equal(extractEpicIdFromBody(null), null);
      assert.equal(extractEpicIdFromBody(undefined), null);
      assert.equal(extractEpicIdFromBody(''), null);
    });

    it('extracts the epic id from a line-anchored marker', () => {
      assert.equal(extractEpicIdFromBody('Epic: #702'), 702);
      assert.equal(
        extractEpicIdFromBody('## Header\n\nEpic: #441\n\nBody'),
        441,
      );
    });

    it('is case-insensitive on the keyword', () => {
      assert.equal(extractEpicIdFromBody('epic: #123'), 123);
      assert.equal(extractEpicIdFromBody('EPIC: #456'), 456);
    });

    it('tolerates whitespace variation between keyword and id', () => {
      assert.equal(extractEpicIdFromBody('Epic:#789'), 789);
      assert.equal(extractEpicIdFromBody('Epic:   #321'), 321);
    });

    it('does not match prose mentions of "epic" mid-line', () => {
      assert.equal(
        extractEpicIdFromBody('This relates to Epic: #999 in passing'),
        null,
      );
    });

    it('returns the first line-anchored match when multiple exist', () => {
      assert.equal(extractEpicIdFromBody('Epic: #1\nEpic: #2\nEpic: #3'), 1);
    });
  });

  describe('isSafeBranchComponent', () => {
    it('returns true for safe components', () => {
      assert.equal(isSafeBranchComponent('feature/my-branch_name.123'), true);
      assert.equal(isSafeBranchComponent('a-b-c'), true);
      assert.equal(isSafeBranchComponent('a/b/c'), true);
      assert.equal(isSafeBranchComponent('a.b.c'), true);
      assert.equal(isSafeBranchComponent('a_b_c'), true);
    });

    it('returns false for unsafe components', () => {
      assert.equal(isSafeBranchComponent('feature my branch'), false);
      assert.equal(isSafeBranchComponent('branch?name'), false);
      assert.equal(isSafeBranchComponent('branch*name'), false);
      assert.equal(isSafeBranchComponent('branch$name'), false);
      assert.equal(isSafeBranchComponent('branch&name'), false);
      assert.equal(isSafeBranchComponent('branch|name'), false);
      assert.equal(isSafeBranchComponent('branch;name'), false);
      assert.equal(isSafeBranchComponent('branch>name'), false);
      assert.equal(isSafeBranchComponent('branch<name'), false);
      assert.equal(isSafeBranchComponent('branch`name'), false);
      assert.equal(isSafeBranchComponent('branch!name'), false);
      assert.equal(isSafeBranchComponent(''), false);
    });
  });

  describe('parseTaskMetadata', () => {
    const defaultExpected = {
      persona: 'engineer',
      mode: 'fast',
      skills: [],
      focusAreas: [],
      protocolVersion: '',
    };

    it('returns defaults for falsy input', () => {
      assert.deepEqual(parseTaskMetadata(null), defaultExpected);
      assert.deepEqual(parseTaskMetadata(undefined), defaultExpected);
      assert.deepEqual(parseTaskMetadata(''), defaultExpected);
    });

    it('returns defaults if no metadata block', () => {
      const body = 'This is a test task without metadata.';
      assert.deepEqual(parseTaskMetadata(body), defaultExpected);
    });

    it('parses basic fields', () => {
      const body = `
## Metadata
**Persona**: security
**Mode**: comprehensive
**Protocol Version**: 1.2.3
      `;
      const expected = {
        ...defaultExpected,
        persona: 'security',
        mode: 'comprehensive',
        protocolVersion: '1.2.3',
      };
      assert.deepEqual(parseTaskMetadata(body), expected);
    });

    it('parses list fields', () => {
      const body = `
## Metadata
**Skills**: node, testing, git
**Focus Areas**: backend, security
      `;
      const expected = {
        ...defaultExpected,
        skills: ['node', 'testing', 'git'],
        focusAreas: ['backend', 'security'],
      };
      assert.deepEqual(parseTaskMetadata(body), expected);
    });

    it('is case-insensitive for field names', () => {
      const body = `
## Metadata
**persona**: QA
**MODE**: slow
**skills**: manual testing
**focus areas**: UI
**PROTOCOL VERSION**: 2.0
      `;
      const expected = {
        persona: 'QA',
        mode: 'slow',
        skills: ['manual testing'],
        focusAreas: ['UI'],
        protocolVersion: '2.0',
      };
      assert.deepEqual(parseTaskMetadata(body), expected);
    });

    it('ignores extra fields', () => {
      const body = `
## Metadata
**Persona**: engineer
**Extra Field**: some value
      `;
      assert.deepEqual(parseTaskMetadata(body), defaultExpected);
    });

    it('stops parsing at next heading', () => {
      const body = `
## Metadata
**Persona**: tester

## Next Section
**Mode**: should-be-ignored
      `;
      assert.deepEqual(parseTaskMetadata(body), {
        ...defaultExpected,
        persona: 'tester',
      });
    });
  });
});
