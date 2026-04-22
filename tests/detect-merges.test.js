import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  isTemplatePath,
  scanForConflicts,
  TEMPLATE_PATH_PREFIXES,
} from '../.agents/scripts/detect-merges.js';

const MARKED = '<<<<<<< HEAD\nfoo\n=======\nbar\n>>>>>>> other\n';

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'detect-merges-'));
  mkdirSync(join(root, '.agents/workflows'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  return root;
}

test('detect-merges', async (t) => {
  await t.test('TEMPLATE_PATH_PREFIXES includes the workflow template dir', () => {
    assert.ok(TEMPLATE_PATH_PREFIXES.includes('.agents/workflows/'));
  });

  await t.test('isTemplatePath matches workflow files by prefix', () => {
    assert.equal(isTemplatePath('.agents/workflows/git-merge-pr.md'), true);
    assert.equal(isTemplatePath('.agents/workflows/nested/x.md'), true);
    assert.equal(isTemplatePath('src/foo.js'), false);
  });

  await t.test(
    'workflow template containing conflict markers does NOT flag',
    async () => {
      const root = makeRepo();
      try {
        const file = '.agents/workflows/git-merge-pr.md';
        writeFileSync(join(root, file), MARKED);
        const hits = await scanForConflicts([file], root);
        assert.deepEqual(hits, []);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  await t.test(
    'non-template file with the same markers still flags',
    async () => {
      const root = makeRepo();
      try {
        const file = 'src/broken.js';
        writeFileSync(join(root, file), MARKED);
        const hits = await scanForConflicts([file], root);
        assert.equal(hits.length, 1);
        assert.equal(hits[0].file, file);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
