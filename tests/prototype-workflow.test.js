/**
 * tests/prototype-workflow.test.js — the `/prototype` command contract.
 *
 * `/prototype` is workflow prose interpreted by the host LLM, so — like the
 * `/plan` flag contract — this spec is a structural assertion over the authored
 * workflow source. Four things are load-bearing enough that nothing else fails
 * when they erode:
 *
 *   1. **Discovery is ordered first.** A prototype drawn before the consumer's
 *      design-system SSOT is located reviews an invented visual language.
 *   2. **Nothing reaches disk without a confirm**, and what does reach disk is
 *      exactly one self-contained HTML file under the gitignored temp tree.
 *   3. **The artifact of record never moves.** Host publishing is an upgrade of
 *      that same file; committing a prototype is opt-in; the default
 *      carry-through is a fold into the Story's `## Spec`, because delivery
 *      reads the Story body and never the temp tree.
 *   4. **`/plan` never invokes it.** The advisory `uiSurface` signal may name
 *      the command; an instruction to run it would make the operator-invocation
 *      design a fiction. That is the assertion most likely to erode by someone
 *      "finishing the wiring", so it is checked negatively and structurally.
 *
 * Prose claims go through `doc-assert.js` so a re-flowed 80-column paragraph
 * cannot turn a correct edit red — and so a forbidden phrase cannot hide by
 * straddling a line break.
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertDocMentions,
  assertDocOmits,
  readDoc,
} from './helpers/doc-assert.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const WORKFLOWS = path.join(REPO_ROOT, '.agents', 'workflows');

const PROTOTYPE = path.join(WORKFLOWS, 'prototype.md');
const PLAN = path.join(WORKFLOWS, 'plan.md');
const PLAN_REF = path.join(WORKFLOWS, 'helpers', 'plan-reference.md');
const WORKFLOW_INDEX = path.join(REPO_ROOT, '.agents', 'docs', 'workflows.md');

describe('/prototype is an operator-invocable top-level command', () => {
  it('lives at the top level, not under helpers/', () => {
    // Top level is structural, not cosmetic: helpers are non-invocable, which
    // would leave "the operator asks for it" resting on prose alone.
    assert.equal(
      existsSync(PROTOTYPE),
      true,
      '.agents/workflows/prototype.md must exist so /prototype projects as a command',
    );
    assert.equal(
      existsSync(path.join(WORKFLOWS, 'helpers', 'prototype.md')),
      false,
      'a helpers/prototype.md would not project a slash command',
    );
  });

  it('carries the front-matter description the generated index is built from', () => {
    const md = readDoc(PROTOTYPE);
    assert.match(
      md,
      /^---\n[\s\S]*?\bdescription:/,
      'the command index is generated from front-matter `description:`',
    );
  });

  it('appears in the generated workflow index', () => {
    assertDocMentions(
      readDoc(WORKFLOW_INDEX),
      /\| `\/prototype` \|/,
      'the generated index must list the new command — regenerate with npm run docs:gen',
    );
  });
});

describe('/prototype orders SSOT discovery before any artifact is drawn', () => {
  const md = readDoc(PROTOTYPE);

  it('runs design-system discovery as the first procedure step', () => {
    const discoveryIdx = md.indexOf('### Step 0 —');
    const writeIdx = md.indexOf('### Step 2 —');
    assert.ok(discoveryIdx > -1, 'prototype.md must carry a Step 0');
    assert.ok(writeIdx > -1, 'prototype.md must carry the write step');
    assert.ok(
      discoveryIdx < writeIdx,
      'SSOT discovery must precede the step that writes an artifact',
    );
    assertDocMentions(
      md,
      /No artifact is drawn until this step has run/i,
      'the ordering must be stated, not merely implied by heading order',
    );
  });

  it('names the three SSOT sources the ux-ui lens mandates', () => {
    assertDocMentions(md, /Design tokens/i, 'tokens/theme must be discovered');
    assertDocMentions(
      md,
      /Component roster/i,
      'the component roster must be discovered',
    );
    assertDocMentions(
      md,
      /`docs\/style-guide\.md`/,
      'the documented conventions the detectors cannot infer must be read',
    );
    assertDocMentions(
      md,
      /`docs\/web-routes\.md`/,
      'route surfaces must consult the routes doc when present',
    );
    assertDocMentions(
      md,
      /\(audit-ux-ui\.md\)/,
      'the discovery step must point at the lens whose Step 0 it mirrors',
    );
  });

  it('falls back to a low-fidelity frame rather than inventing a visual language', () => {
    assertDocMentions(
      md,
      /low-fidelity frame/i,
      'the no-SSOT fallback must emit a low-fidelity frame',
    );
    assertDocMentions(
      md,
      /Report the absence/i,
      'the absence of a design system must be reported, not papered over',
    );
    assertDocMentions(
      md,
      /Do \*\*not\*\* invent a visual language/i,
      'a prototype in an unadopted palette reviews the invention, not the layout',
    );
  });
});

describe('/prototype writes one file, and only after a confirm', () => {
  const md = readDoc(PROTOTYPE);

  it('gates every disk write behind an operator confirm', () => {
    assertDocMentions(
      md,
      /Nothing is written to disk until the operator confirms/i,
      'the confirm gate is the disk-write policy core/idea-refinement already sets',
    );
    assertDocMentions(
      md,
      /never write silently/i,
      'silent writes are the specific failure the policy names',
    );
    assertDocMentions(
      md,
      /idea-refinement/,
      'the confirm gate must cite the policy it inherits rather than re-deriving it',
    );
  });

  it('writes exactly one self-contained HTML file under the gitignored temp tree', () => {
    assertDocMentions(
      md,
      /\*\*exactly one\*\* self-contained `\.html` file/i,
      'one file, self-contained — it has to open from disk with no server',
    );
    assertDocMentions(
      md,
      /gitignored workspace-root temp tree/i,
      'the artifact must land in the gitignored workspace-root temp tree',
    );
    assertDocMentions(
      md,
      /`temp\/prototypes\/<slug>\.html`/,
      'the concrete path keeps "under temp/" from being interpreted loosely',
    );
  });
});

describe('/prototype keeps the artifact of record in one place', () => {
  const md = readDoc(PROTOTYPE);

  it('treats host publishing as an optional upgrade of the same file', () => {
    assertDocMentions(
      md,
      /optional upgrade of that same file/i,
      'publishing must not fork the artifact',
    );
    assertDocMentions(
      md,
      /never the artifact of record/i,
      'the temp-tree file stays authoritative',
    );
  });

  it('makes committing a prototype opt-in per Story', () => {
    assertDocMentions(
      md,
      /Committing a prototype is opt-in, per Story/i,
      'a committed prototype directory must never be the default',
    );
    assertDocOmits(
      md,
      /commit the prototype by default/i,
      'the default must not be a commit — a prototype is wrong once the UI ships',
    );
  });

  it('defaults the carry-through to a fold into the Story ## Spec', () => {
    assertDocMentions(
      md,
      /default carry-through is a fold into the Story's `## Spec`/i,
      'delivery reads the Story body, so the reviewed layout has to land there',
    );
    assertDocMentions(
      md,
      /reads the Story body and never the temp tree/i,
      'the reason the fold is the default must be stated, or it reads as bureaucracy',
    );
  });

  it('states the never-automatic invariant in its own constraints', () => {
    assertDocMentions(
      md,
      /Never invoked automatically/i,
      'the command must declare that nothing calls it',
    );
    assertDocMentions(
      md,
      /Operator-invoked only/i,
      'operator invocation is the whole design',
    );
  });
});

describe('/plan names the /prototype option but never invokes it', () => {
  const planMd = readDoc(PLAN);

  it('mentions the option for UI-touching plans', () => {
    assertDocMentions(
      planMd,
      /`complexitySignals\.uiSurface`/,
      'plan.md must name the signal that surfaces the offer',
    );
    assertDocMentions(
      planMd,
      /\[`\/prototype`\]\(prototype\.md\)/,
      'plan.md must link the command so the operator can find it',
    );
  });

  it('nowhere instructs the workflow to run it', () => {
    // The negative half is the load-bearing one: an imperative here would make
    // the operator-invocation design a fiction.
    for (const forbidden of [
      /(?:run|invoke|execute|dispatch|chain into|route into|hand off to)\s+(?:the\s+)?`?\/prototype/i,
      /Under `--yes`[^.]*\/prototype/i,
    ]) {
      assertDocOmits(
        planMd,
        forbidden,
        '/plan must never instruct itself to invoke /prototype',
      );
    }
    assertDocMentions(
      planMd,
      /never invoke it here/i,
      'the prohibition must be explicit at the point the option is named',
    );
  });

  it('never puts /prototype in a runnable command block', () => {
    // A fenced block is a copy-paste invitation, so this is a layout claim and
    // deliberately does not go through the whitespace-normalizing helper.
    const fenced = planMd.match(/```[\s\S]*?```/g) ?? [];
    for (const block of fenced) {
      assert.ok(
        !block.includes('/prototype'),
        'a fenced block naming /prototype is an instruction to run it',
      );
    }
  });
});

describe('plan-reference.md records the --yes handshake', () => {
  const md = readDoc(PLAN_REF);

  it('records the offer and proceeds with planning, with no reroute', () => {
    assertDocMentions(
      md,
      /Under `--yes` the offer is recorded and planning proceeds/i,
      'an unattended run has nobody to review an artifact — record and proceed',
    );
    assertDocMentions(
      md,
      /no reroute/i,
      'recording must be distinguished from rerouting',
    );
  });

  it('states that the signal carries no routing authority and adds no gate', () => {
    assertDocMentions(
      md,
      /no routing authority and adds no gate/i,
      'the signal must not become a gate by documentation drift',
    );
    assertDocMentions(
      md,
      /`hasWebSurface`/,
      'the reference must name the shipped predicate the signal reuses',
    );
    assertDocMentions(
      md,
      /a project with no rendered frontend resolves falsey/i,
      'the self-disabling fail direction is why no config key exists',
    );
  });
});
