/**
 * signal-validator.js — write-time validation of NDJSON signal records
 * against the canonical `signal-event.schema.json` (Epic #4406 /
 * Story #4413).
 *
 * The signals writer calls {@link validateSignal} before appending a
 * record so a schema-invalid line is dropped with a `Logger.warn` naming
 * the violating field rather than polluting the stream (and defeating the
 * downstream consumers that assume the canonical shape). Validation is
 * best-effort: the writer contract (Tech Spec #1032) is preserved —
 * observability MUST NOT throw into the runner, so every helper here
 * swallows its own faults and degrades to "treat as valid" only when the
 * validator itself cannot be constructed.
 *
 * The AJV instance compiles the on-disk schema **once** at module load so
 * the writer and the contract test validate against the exact same
 * document (no hand-rolled drift). `strict: false` matches the repo's
 * other draft-07 validators (see `tests/schemas/signal-schemas.test.js`).
 *
 * Story #5003 deleted the persisted per-Epic reject tally
 * (`temp/run-<eid>/signal-rejects.json`) and its `readSignalRejectCount`
 * reader: the tally was keyed on a positive `epicId`, and v2 Stories are
 * standalone, so nothing ever wrote a row and nothing could ever read one.
 * Write-time validation itself is untouched.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import { Logger } from '../Logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'schemas',
  'signal-event.schema.json',
);

/**
 * Compile the signal-event schema once. Returns `null` when the schema
 * cannot be read or compiled — the caller then treats every record as
 * valid (fail-open) so a packaging error never silently drops all
 * signals.
 *
 * @returns {import('ajv').ValidateFunction | null}
 */
function buildValidator() {
  try {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    return ajv.compile(schema);
  } catch (err) {
    Logger.warn(
      `signal-validator: failed to compile signal-event schema (${
        err instanceof Error ? err.message : String(err)
      }); write-time validation disabled for this process.`,
    );
    return null;
  }
}

const _validate = buildValidator();

/**
 * Derive a human-readable "violating field" label from the first AJV
 * error. Prefers the missing property name (required errors) or the
 * instance path, falling back to the raw message.
 *
 * @param {import('ajv').ErrorObject[] | null | undefined} errors
 * @returns {string}
 */
function violatingFieldOf(errors) {
  const first = Array.isArray(errors) && errors.length > 0 ? errors[0] : null;
  if (!first) return 'unknown';
  if (first.keyword === 'required' && first.params?.missingProperty) {
    return String(first.params.missingProperty);
  }
  if (typeof first.instancePath === 'string' && first.instancePath.length > 0) {
    return first.instancePath.replace(/^\//, '').replace(/\//g, '.');
  }
  if (
    first.keyword === 'additionalProperties' &&
    first.params?.additionalProperty
  ) {
    return String(first.params.additionalProperty);
  }
  return first.message ?? 'unknown';
}

/**
 * Validate a signal record against the canonical schema.
 *
 * Fail-open: when the validator could not be compiled the record is
 * reported valid (the writer keeps working). A non-object record is
 * reported invalid without invoking AJV.
 *
 * @param {unknown} record
 * @returns {{ valid: boolean, violatingField: string|null, message: string|null }}
 */
export function validateSignal(record) {
  if (_validate === null) {
    return { valid: true, violatingField: null, message: null };
  }
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return {
      valid: false,
      violatingField: 'record',
      message: 'signal record must be a plain object',
    };
  }
  const valid = _validate(record);
  if (valid) return { valid: true, violatingField: null, message: null };
  const field = violatingFieldOf(_validate.errors);
  const message = _validate.errors?.[0]?.message ?? 'schema validation failed';
  return { valid: false, violatingField: field, message };
}
