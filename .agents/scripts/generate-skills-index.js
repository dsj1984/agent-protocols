#!/usr/bin/env node
// .agents/scripts/generate-skills-index.js
//
// Walk `.agents/skills/{core,stack}/**/SKILL.md` via the shared parser
// helper, project each parsed result into an index entry, and write the
// aggregated manifest to `.agents/skills/skills.index.json`. Supports a
// `--check` mode that compares the on-disk manifest against fresh
// generator output (ignoring the volatile `generatedAt` field) and exits
// non-zero with a diff-style message if they diverge.
//
// Two indexes, never one (Story #5135). The shipped manifest above is a
// committed payload file that `mandrel doctor` / `mandrel sync-agents`
// compare byte-for-byte against the installed package, so consumer-authored
// skills under the `.agents/local/skills/` zone MUST NOT be folded into it —
// a merged index would read as payload drift in every consumer that authored
// a skill, and those commands would refuse. Local skills are therefore
// indexed into their own `.agents/local/skills/skills.index.json`, inside
// the zone sync never prunes and drift never walks.
//
// CLI surface:
//
//   node generate-skills-index.js [--check] [--root <dir>] [--out <file>]
//
//   --check        Read the on-disk manifest, compare to generator output
//                  modulo `generatedAt`. Exit 0 on match, non-zero on
//                  drift. Does not write.
//   --root <dir>   Use <dir> as the repo root (defaults to the project
//                  root containing `.agents/skills`). Useful for tests
//                  staging fixture trees outside the real repo.
//   --out <file>   Override the manifest output path (defaults to
//                  `<root>/.agents/skills/skills.index.json`).
//
// Written output is passed through the project formatter (Biome) so that
// regenerating on a clean tree leaves no format drift behind; the step is
// best-effort and degrades to plain `JSON.stringify` output where Biome is
// not installed. See `lib/format-generated-json.js`.
//
// Honors AGENT_LOG_LEVEL via the shared `Logger`. Stdout is reserved for
// the diff text in --check failure mode; informational progress goes to
// stderr.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStandardCliArgs } from './lib/cli/standard-args.js';
import { runAsCli } from './lib/cli-utils.js';
import { formatGeneratedJson } from './lib/format-generated-json.js';
import { Logger } from './lib/Logger.js';
import { parseSkill } from './lib/skills/parse-skill.js';
import {
  diffManifests,
  INDEX_FILENAME,
  indexPathFor,
  readManifest,
} from './lib/skills/skills-index.js';
import {
  collectLocalSkillFiles,
  collectSkillFiles,
  LOCAL_SKILLS_SEGMENTS,
  PAYLOAD_SKILLS_SEGMENTS,
} from './lib/skills/walk-skill-files.js';

const GENERATOR_ID = 'generate-skills-index.js@1';

/**
 * Resolve the default repo root: the directory two levels up from this
 * script (i.e. `<repo>/.agents/scripts/generate-skills-index.js` →
 * `<repo>`).
 */
function defaultRepoRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..');
}

/**
 * Parse CLI flags. Returns `{ check, root, out }`. Unknown flags trigger
 * a thrown Error (from the shared parser) so the runAsCli boundary can
 * surface a clean message.
 */
export function parseArgs(argv) {
  if (argv.some((t) => t === '--help' || t === '-h')) {
    return { check: false, root: null, out: null, help: true };
  }
  const { values } = parseStandardCliArgs({
    argv,
    extras: {
      check: { type: 'boolean' },
      root: { type: 'string' },
      out: { type: 'string' },
    },
  });
  return { check: values.check, root: values.root, out: values.out };
}

/**
 * Project a parseSkill result into an index entry shaped by
 * `.agents/schemas/skills-index.schema.json`.
 *
 * Post-Wave-2 every SKILL.md carries a 5–12-bullet Policy Capsule.
 * `policyCapsuleBullets` records that count for the manifest entry.
 * A value of `0` means the parser did not find the capsule section and
 * is a validator-rejected condition (see validate-skills.js).
 */
function projectEntry(parsed) {
  return {
    name: parsed.name,
    tier: parsed.tier,
    category: parsed.category,
    path: parsed.path,
    description: parsed.frontmatter.description,
    policyCapsuleBullets: parsed.policyCapsule.bulletCount,
    allowedTools: Array.isArray(parsed.frontmatter.allowed_tools)
      ? [...parsed.frontmatter.allowed_tools]
      : null,
    vendor:
      typeof parsed.frontmatter.vendor === 'string'
        ? parsed.frontmatter.vendor
        : null,
  };
}

/**
 * Build the manifest object (without `generatedAt`) by walking the tree
 * and projecting each parsed SKILL.md into an index entry.
 */
export function buildManifestBody(repoRoot, collect = collectSkillFiles) {
  const skillFiles = collect(repoRoot);
  const skills = skillFiles.map((absPath) =>
    projectEntry(parseSkill(absPath, { repoRoot })),
  );
  return {
    generator: GENERATOR_ID,
    skills,
  };
}

/**
 * Build the full manifest with `generatedAt`. `nowIso` is injected so
 * tests can pin the timestamp deterministically.
 */
export function buildManifest(repoRoot, { nowIso, collect } = {}) {
  const body = buildManifestBody(repoRoot, collect);
  return {
    generatedAt: nowIso ?? new Date().toISOString(),
    generator: body.generator,
    skills: body.skills,
  };
}

/**
 * Serialize a manifest object as canonical JSON: 2-space indent,
 * trailing newline. Two runs against an unchanged corpus produce
 * byte-identical output modulo `generatedAt`.
 *
 * This is the *pre-format* shape. `JSON.stringify` expands every array
 * across multiple lines, while Biome collapses short ones that fit
 * inside `lineWidth` (`"allowedTools": ["Read", "Bash"]`). Writing this
 * text verbatim therefore leaves the tree format-dirty on every run —
 * see `lib/format-generated-json.js`, which reconciles the two.
 */
export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Resolve the manifest output path given (root, optional explicit
 * override).
 */
function resolveOutPath(root, override) {
  return override
    ? path.resolve(override)
    : indexPathFor(root, PAYLOAD_SKILLS_SEGMENTS);
}

/**
 * Resolve the local-zone manifest path. Deliberately NOT overridable by
 * `--out`: that flag redirects the payload manifest (tests stage fixture
 * trees with it), and letting it also move the local manifest would let one
 * invocation write both indexes to the same file.
 */
function resolveLocalOutPath(root) {
  return indexPathFor(root, LOCAL_SKILLS_SEGMENTS);
}

/**
 * Write one manifest through the project formatter so a regeneration on a
 * clean tree leaves no format drift behind.
 */
function writeManifest(manifest, outPath, root) {
  const serialized = serializeManifest(manifest);
  const opts = { cwd: root, filename: INDEX_FILENAME };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    formatGeneratedJson(serialized, opts) ?? serialized,
  );
}

/**
 * Write (or reap) the local-zone manifest. A consumer who deletes their last
 * local skill would otherwise be left with a stale index reporting skills
 * that no longer exist, so an emptied zone removes the artifact rather than
 * leaving it behind.
 */
function writeLocalManifest(localFresh, localOutPath, root) {
  const rel = path.relative(root, localOutPath).split(path.sep).join('/');
  if (localFresh === null) {
    if (fs.existsSync(localOutPath)) {
      fs.rmSync(localOutPath);
      Logger.info(`removed ${rel} (no local skills remain)`);
    }
    return;
  }
  writeManifest(localFresh, localOutPath, root);
  Logger.info(`wrote ${rel} (${localFresh.skills.length} entries)`);
}

/**
 * Compare the local-zone manifest against fresh generator output. Returns
 * null when in sync (including the common case of no local skills and no
 * artifact), or a diff-style message.
 */
function checkLocalManifest(localFresh, localOutPath) {
  const exists = fs.existsSync(localOutPath);
  if (localFresh === null) {
    return exists
      ? 'local skills.index.json drift detected: the local skills zone is ' +
          'empty but .agents/local/skills/skills.index.json still exists — ' +
          "run 'node .agents/scripts/generate-skills-index.js' to reap it"
      : null;
  }
  if (!exists) {
    return (
      'local skills.index.json drift detected: missing — run ' +
      "'node .agents/scripts/generate-skills-index.js' to write it"
    );
  }
  const { manifest: disk } = readManifest(localOutPath);
  return diffManifests(disk, localFresh, 'local skills.index.json');
}

/**
 * Pure entry point used by tests. Returns `{ status, output }` where
 * `output` is a stdout string to print (may be empty) and `status` is
 * the exit code.
 */
export function run({ argv = [], now = new Date(), repoRoot } = {}) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    return {
      status: 0,
      output: [
        'Usage: generate-skills-index.js [--check] [--root <dir>] [--out <file>]',
      ].join('\n'),
    };
  }
  const root = parsed.root
    ? path.resolve(parsed.root)
    : (repoRoot ?? defaultRepoRoot());
  const outPath = resolveOutPath(root, parsed.out);
  const fresh = buildManifest(root, { nowIso: now.toISOString() });

  // The local zone's manifest is built from its own collector, so the
  // payload manifest above stays payload-only whatever a consumer authors.
  const localFiles = collectLocalSkillFiles(root);
  const localOutPath = resolveLocalOutPath(root);
  const localFresh =
    localFiles.length > 0
      ? buildManifest(root, {
          nowIso: now.toISOString(),
          collect: collectLocalSkillFiles,
        })
      : null;

  if (parsed.check) {
    const { manifest: disk, reason } = readManifest(outPath);
    if (disk === null) {
      return {
        status: 1,
        output: `${INDEX_FILENAME} drift detected: ${reason}`,
      };
    }
    const diff = diffManifests(disk, fresh, INDEX_FILENAME);
    if (diff !== null) {
      return { status: 1, output: diff };
    }
    const localDiff = checkLocalManifest(localFresh, localOutPath);
    if (localDiff !== null) {
      return { status: 1, output: localDiff };
    }
    Logger.info(
      `skills.index.json is fresh (${fresh.skills.length} entries${
        localFresh ? `, ${localFresh.skills.length} local` : ''
      })`,
    );
    return { status: 0, output: '' };
  }

  writeManifest(fresh, outPath, root);
  Logger.info(
    `wrote ${path.relative(root, outPath).split(path.sep).join('/')} (${fresh.skills.length} entries)`,
  );
  writeLocalManifest(localFresh, localOutPath, root);
  return { status: 0, output: '' };
}

async function main() {
  const result = run({ argv: process.argv.slice(2) });
  if (result.output) {
    process.stdout.write(`${result.output}\n`);
  }
  process.exit(result.status);
}

runAsCli(import.meta.url, main, { source: 'generate-skills-index' });
