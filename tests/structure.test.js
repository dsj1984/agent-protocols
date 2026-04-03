import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AGENTS = path.join(ROOT, '.agents');

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function agentsPath(...parts) {
  return path.join(AGENTS, ...parts);
}

// ---------------------------------------------------------------------------
// Core file existence
// ---------------------------------------------------------------------------
describe('Core .agents/ files', () => {
  const coreRequired = [
    'default-agentrc.json',
    'instructions.md',
    'README.md',
  ];

  for (const file of coreRequired) {
    it(`${file} exists`, () => {
      assert.ok(
        fs.existsSync(agentsPath(file)),
        `Missing required file: .agents/${file}`,
      );
    });
  }

  it('rules/ directory exists', () => {
    assert.ok(
      fs.existsSync(agentsPath('rules')),
      'Missing .agents/rules/ directory',
    );
  });

  const personasDir = agentsPath('personas');
  if (fs.existsSync(personasDir)) {
    const personas = fs
      .readdirSync(personasDir)
      .filter((file) => file.endsWith('.md'));

    assert.ok(personas.length > 0, '.agents/personas/ contains no markdown files');

    for (const personaFile of personas) {
      it(`Persona ${personaFile} has structural integrity (# Role:)`, () => {
        const content = fs.readFileSync(agentsPath('personas', personaFile), 'utf8');
        assert.ok(
          content.includes('# Role:'),
          `Persona ${personaFile} is missing the required '# Role:' header`,
        );
      });
    }
  } else {
    it('personas/ directory exists', () => {
      assert.fail('Missing .agents/personas/ directory');
    });
  }
});

// ---------------------------------------------------------------------------
// Skills — every skill directory must contain a SKILL.md
// ---------------------------------------------------------------------------
describe('Skills — each directory must contain SKILL.md', () => {
  const skillsDir = agentsPath('skills');

  if (!fs.existsSync(skillsDir)) {
    it('skills/ directory exists', () => {
      assert.fail('Missing .agents/skills/ directory');
    });
  } else {
    const categories = fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    assert.ok(categories.length > 0, '.agents/skills/ contains no category directories');

    for (const category of categories) {
      const skills = fs
        .readdirSync(agentsPath('skills', category), { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name);

      for (const skill of skills) {
        it(`${category}/${skill}/SKILL.md exists`, () => {
          assert.ok(
            fs.existsSync(agentsPath('skills', category, skill, 'SKILL.md')),
            `Missing SKILL.md in .agents/skills/${category}/${skill}/`,
          );
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Workflows — every workflow file must contain the ## Constraint heading
// ---------------------------------------------------------------------------
describe('Workflows — each file must contain ## Constraint', () => {
  const workflowsDir = agentsPath('workflows');

  if (!fs.existsSync(workflowsDir)) {
    it('workflows/ directory exists', () => {
      assert.fail('Missing .agents/workflows/ directory');
    });
  } else {
    const workflows = fs
      .readdirSync(workflowsDir)
      .filter((filename) => filename.endsWith('.md'));

    assert.ok(workflows.length > 0, '.agents/workflows/ contains no markdown files');

    for (const workflow of workflows) {
      it(`${workflow} contains ## Constraint`, () => {
        const content = fs.readFileSync(agentsPath('workflows', workflow), 'utf8');
        assert.ok(
          content.includes('## Constraint'),
          `${workflow} is missing the required ## Constraint section`,
        );
      });
    }
  }
});
