// tests/lib/source-text/strip-js-comments.test.js
/**
 * Unit tests for the one JavaScript comment stripper. Four guards now share
 * this implementation, and each of them previously carried its own copy with
 * subtly different behaviour — so the edge cases that used to be pinned (or
 * silently unpinned) per copy are pinned once here.
 *
 * The load-bearing property is that comment bodies become equivalent
 * whitespace: guards report `file:line` positions against the original source,
 * so anything that shifts line or column numbers is a defect, not a detail.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { stripJsComments } from '../../../.agents/scripts/lib/source-text/strip-js-comments.js';

describe('stripJsComments — comment removal', () => {
  it('removes line-comment bodies', () => {
    const out = stripJsComments('const a = 1; // trailing secret');
    assert.match(out, /const a = 1;/);
    assert.ok(!out.includes('trailing secret'));
  });

  it('removes block-comment bodies, including multi-line JSDoc', () => {
    const src = ['/**', ' * names foo.js', ' */', 'run();'].join('\n');
    const out = stripJsComments(src);
    assert.ok(!out.includes('names foo.js'));
    assert.match(out, /run\(\);/);
  });

  it('removes a block comment that opens and closes mid-line', () => {
    const out = stripJsComments('a /* gone */ b');
    assert.ok(!out.includes('gone'));
    assert.match(out, /^a\s+b$/);
  });
});

describe('stripJsComments — position preservation', () => {
  it('preserves the line count across a multi-line block comment', () => {
    const src = 'line1\n/*\nblock\n*/\nline5';
    const out = stripJsComments(src);
    assert.equal(out.split('\n').length, src.split('\n').length);
    assert.equal(out.split('\n')[4], 'line5');
  });

  it('preserves total length, so byte offsets survive', () => {
    const src = "const u = 'x'; // a comment\n/* another */\ncode();";
    assert.equal(stripJsComments(src).length, src.length);
  });

  it('preserves the column of code following a stripped block comment', () => {
    const src = '/* nine */code();';
    const out = stripJsComments(src);
    assert.equal(out.indexOf('code();'), src.indexOf('code();'));
  });
});

describe('stripJsComments — string and template literals', () => {
  it('does not treat // inside a string as a comment', () => {
    const out = stripJsComments("const url = 'https://example.com/x';");
    assert.match(out, /https:\/\/example\.com\/x/);
  });

  it('does not treat /* inside a string as a comment opener', () => {
    const out = stripJsComments(`const s = "/* still not */"; const t = 1;`);
    assert.match(out, /"\/\* still not \*\/"/);
    assert.match(out, /const t = 1;/);
  });

  it('handles // inside a template literal', () => {
    const out = stripJsComments('const t = `a//b`; // gone');
    assert.match(out, /a\/\/b/);
    assert.ok(!out.includes('gone'));
  });

  it('honours an escaped quote rather than ending the literal early', () => {
    const src = `const s = 'it\\'s // not a comment'; const after = 2;`;
    const out = stripJsComments(src);
    assert.match(out, /\/\/ not a comment/);
    assert.match(out, /const after = 2;/);
  });

  it('honours a trailing backslash inside a literal without overrunning', () => {
    const out = stripJsComments(`const s = 'a\\\\'; // gone`);
    assert.ok(!out.includes('gone'));
    assert.match(out, /const s = /);
  });
});

describe('stripJsComments — malformed input runs to end rather than throwing', () => {
  it('treats an unterminated block comment as comment to end of input', () => {
    const out = stripJsComments('code();\n/* never closed\nmore text');
    assert.match(out, /code\(\);/);
    assert.ok(!out.includes('never closed'));
    assert.ok(!out.includes('more text'));
  });

  it('treats an unterminated string as literal to end of input', () => {
    assert.doesNotThrow(() => stripJsComments("const s = 'unclosed"));
  });

  it('handles a line comment with no trailing newline', () => {
    assert.equal(stripJsComments('// only').includes('only'), false);
  });
});

describe('stripJsComments — input coercion', () => {
  it('treats nullish input as empty', () => {
    assert.equal(stripJsComments(undefined), '');
    assert.equal(stripJsComments(null), '');
  });

  it('returns empty for empty input', () => {
    assert.equal(stripJsComments(''), '');
  });

  it('returns comment-free source unchanged', () => {
    const src = 'const a = 1;\nconst b = 2;\n';
    assert.equal(stripJsComments(src), src);
  });
});
