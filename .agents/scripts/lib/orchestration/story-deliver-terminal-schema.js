/**
 * story-deliver-terminal-schema.js — load `story-deliver-terminal.schema.json`
 * and validate envelopes against it.
 *
 * Split out of `story-deliver-terminal.js` so the envelope WRITER holds only
 * the contract's shape and vocabulary, and this module holds the one thing
 * the writer must never depend on at call time: the filesystem.
 *
 * That separation is the fix, not just tidiness. `single-story-close.js`
 * invoked by a *worktree-relative* path runs the Story worktree's own copy of
 * the script and then **reaps that worktree** as one of its phases. The schema
 * used to be read lazily, on the first envelope build — which happens after
 * the reap — so the read hit a path that no longer existed. The throw landed
 * inside the close CLI's error path, so a Story whose PR had merged, whose
 * label was `agent::done`, and whose post-land tail was green exited non-zero
 * emitting NO envelope at all: the delivery engine's documented return
 * contract lost to a success, recoverable only by a second close run from the
 * main checkout.
 *
 * Two guarantees close that, and both live here:
 *
 *   1. The schema is read and parsed ONCE, at module load. The parsed schema
 *      outlives the file, so what happens to the directory afterwards is
 *      irrelevant. Compilation stays lazy — it needs no filesystem — so an
 *      import costs one small read and nothing else.
 *   2. An unreadable schema DEGRADES validation rather than throwing. A
 *      schema violation still fails loudly; see {@link validateTerminalEnvelope}.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the shipped schema — the SSOT this module reads.
 *
 * Module-private, like every other `SCHEMA_PATH` in the tree
 * (`validation-evidence.js`, `signal-validator.js`): the path is an
 * implementation detail of loading, and callers want the verdict, not the
 * location.
 */
const SCHEMA_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'schemas',
  'story-deliver-terminal.schema.json',
);

/**
 * Read and parse the shipped schema. Never throws: a read failure is recorded
 * on the returned source and degrades validation downstream, because importing
 * this module must never be what breaks a delivery.
 *
 * @returns {{ schema: object|null, error: string|null }}
 */
function loadSchemaSource() {
  try {
    return {
      schema: JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8')),
      error: null,
    };
  } catch (err) {
    return { schema: null, error: err?.message ?? String(err) };
  }
}

/**
 * The schema, read and parsed at module load. Deliberately eager — see the
 * module header for the failure that made it so.
 *
 * @type {{ schema: object|null, error: string|null }}
 */
const SCHEMA_SOURCE = loadSchemaSource();

/**
 * Compiled validators keyed by the source object they came from.
 *
 * A `WeakMap` rather than one module-level slot so an injected `schemaSource`
 * (the test seam) can never poison the validator the production path memoizes.
 *
 * @type {WeakMap<object, Function>}
 */
const VALIDATORS = new WeakMap();

/**
 * Compile (once per source) and return the terminal-envelope validator, or
 * `null` when the source carries no usable schema.
 *
 * @param {{ schema: object|null }} source
 * @returns {Function|null}
 */
function getValidator(source) {
  if (!source?.schema) return null;
  const cached = VALIDATORS.get(source);
  if (cached) return cached;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(source.schema);
  VALIDATORS.set(source, validate);
  return validate;
}

let _unvalidatedWarned = false;

/**
 * Announce — once per process — that an envelope is going out unvalidated.
 *
 * Written straight to stderr rather than through `Logger.warn` for the same
 * reason `emitTerminalEnvelope` bypasses `Logger.info`: the envelope itself is
 * unsuppressible, so the notice that one was not checked has to be too. Under
 * `AGENT_LOG_LEVEL=silent` a level-gated warning would vanish and the degrade
 * would be invisible.
 *
 * @param {string|null|undefined} error
 * @returns {void}
 */
function warnUnvalidated(error) {
  if (_unvalidatedWarned) return;
  _unvalidatedWarned = true;
  process.stderr.write(
    `[story-deliver-terminal] ⚠️ terminal-envelope schema unavailable (${error ?? 'unknown'}) — ` +
      `emitting the envelope UNVALIDATED. The return contract is preserved; its shape is not checked. ` +
      `Expected at: ${SCHEMA_PATH}\n`,
  );
}

/**
 * Validate a candidate envelope against the shipped schema.
 *
 * When the schema is unavailable the result reports `validated: false` and
 * `valid: true` — a **deliberate degrade**, not an oversight. Losing the shape
 * check costs a guard against a malformed envelope; throwing here costs the
 * envelope entirely, and the envelope is the documented return contract of the
 * delivery engine. An unvalidated terminal a caller can act on beats no
 * terminal at all, so the unreadable-schema case degrades and says so on
 * stderr while a schema *violation* still fails loudly at the writer.
 *
 * @param {object} envelope
 * @param {{ schemaSource?: { schema: object|null, error: string|null } }} [opts]
 *   `schemaSource` is a test seam — production always uses the eagerly loaded
 *   module-level source.
 * @returns {{ valid: boolean, errors: string[], validated: boolean }}
 */
export function validateTerminalEnvelope(
  envelope,
  { schemaSource = SCHEMA_SOURCE } = {},
) {
  const validate = getValidator(schemaSource);
  if (!validate) {
    warnUnvalidated(schemaSource?.error);
    return { valid: true, errors: [], validated: false };
  }
  const valid = validate(envelope);
  if (valid) return { valid: true, errors: [], validated: true };
  const errors = (validate.errors ?? []).map(
    (e) => `${e.instancePath || '/'} ${e.message}`,
  );
  return { valid: false, errors, validated: true };
}
