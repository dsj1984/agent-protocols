import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isSafeBranchComponent,
  parseBlockedBy,
  parseBlocks,
  parseTaskMetadata,
} from '../../.agents/scripts/lib/dependency-parser.js';

describe('dependency-parser', () => {
  describe('parseBlockedBy', () => {
    it('returns empty array for falsy input', () => {
      assert.deepEqual(parseBlockedBy(null), []);
      assert.deepEqual(parseBlockedBy(undefined), []);
      assert.deepEqual(parseBlockedBy(''), []);
    });

    it('parses "blocked by #NNN"', () => {
      assert.deepEqual(parseBlockedBy('This is blocked by #123.'), [123]);
      assert.deepEqual(parseBlockedBy('blocked by #456'), [456]);
    });

    it('parses "depends on #NNN"', () => {
      assert.deepEqual(parseBlockedBy('depends on #789'), [789]);
    });

    it('handles colons', () => {
      assert.deepEqual(parseBlockedBy('Blocked by: #111'), [111]);
      assert.deepEqual(parseBlockedBy('Depends on: #222'), [222]);
    });

    it('is case-insensitive', () => {
      assert.deepEqual(parseBlockedBy('BLOCKED BY #333'), [333]);
      assert.deepEqual(parseBlockedBy('DePeNdS oN #444'), [444]);
    });

    it('extracts multiple dependencies', () => {
      assert.deepEqual(
        parseBlockedBy('blocked by #1\nBlocked by: #2\ndepends on #3'),
        [1, 2, 3],
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
