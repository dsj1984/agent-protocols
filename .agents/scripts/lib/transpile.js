import fs from 'node:fs';
import { createRequire, SourceMap } from 'node:module';
import path from 'node:path';
import { Logger } from './Logger.js';

const require = createRequire(import.meta.url);

const TS_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts']);

let _ts = null;
let _tsLoadFailed = false;

function loadTypeScript() {
  if (_ts) return _ts;
  if (_tsLoadFailed) return null;
  try {
    _ts = require('typescript');
    return _ts;
  } catch {
    _tsLoadFailed = true;
    return null;
  }
}

/**
 * Resolve the `typescript` package version, used to stamp baselines so
 * consumers can detect transpiler drift. Returns `'0.0.0'` when the
 * dependency is unresolvable — callers treat that sentinel as "unknown
 * environment" and may refuse to persist a baseline that includes TS rows.
 *
 * @returns {string}
 */
export function resolveTsTranspilerVersion() {
  const ts = loadTypeScript();
  if (ts && typeof ts.version === 'string') return ts.version;
  return '0.0.0';
}

function isTypeScriptPath(filePath) {
  return TS_EXTS.has(path.extname(String(filePath)).toLowerCase());
}

/**
 * Trailing `//# sourceMappingURL=…` comment `ts.transpileModule` appends
 * when `sourceMap: true` is requested. Stripping it makes the emitted code
 * byte-identical to the `sourceMap: false` emit, which is what keeps the
 * maintainability path — and every MI score in the committed baseline —
 * untouched by the CRAP path opting into a map.
 */
const SOURCE_MAPPING_URL_RE = /\n?\/\/# sourceMappingURL=[^\n]*\n?$/;

/**
 * Build a `transpiledLine → originalLine` resolver over a raw
 * `sourceMapText` payload, using Node's built-in `SourceMap` (no new
 * runtime dependency).
 *
 * `SourceMap#findEntry(line, column)` is 0-based and returns the mapping at
 * or before the requested position, so a bare `findEntry(line, 0)` can
 * silently answer with a *previous* line's mapping when the requested line
 * carries no mapping at column 0. The resolver therefore walks the columns
 * of the generated line and accepts only an entry that actually originates
 * on that generated line; a line with no mapping at all resolves to `null`
 * and the caller falls back to the un-remapped coordinate.
 *
 * Results are memoised per generated line — a file's methods are looked up
 * once each, but the same line is often probed by several callers.
 *
 * @param {string} sourceMapText Raw JSON source map emitted by TypeScript.
 * @param {string} code The generated (transpiled) code the map describes.
 * @returns {((line: number) => number|null)|null}
 */
function buildLineMapper(sourceMapText, code) {
  let sourceMap;
  try {
    sourceMap = new SourceMap(JSON.parse(sourceMapText));
  } catch {
    return null;
  }
  const lines = String(code).split('\n');
  const memo = new Map();
  return function mapLine(generatedLine) {
    if (typeof generatedLine !== 'number' || generatedLine < 1) return null;
    if (memo.has(generatedLine)) return memo.get(generatedLine);
    const zeroBased = generatedLine - 1;
    const lineText = lines[zeroBased] ?? '';
    let resolved = null;
    for (let column = 0; column <= lineText.length; column += 1) {
      let entry;
      try {
        entry = sourceMap.findEntry(zeroBased, column);
      } catch {
        break;
      }
      if (
        entry &&
        entry.generatedLine === zeroBased &&
        typeof entry.originalLine === 'number'
      ) {
        resolved = entry.originalLine + 1;
        break;
      }
    }
    memo.set(generatedLine, resolved);
    return resolved;
  };
}

/**
 * Pre-transpile TypeScript or TSX sources to JavaScript that the
 * Esprima-based escomplex kernel can parse. Returns the input unchanged
 * for `.js` / `.mjs` / `.cjs` paths.
 *
 * Type annotations introduce no control flow, so the transpiled output
 * scores identically to the original TS for cyclomatic complexity,
 * Halstead volume, and the maintainability index. `.tsx` uses the
 * `react-jsx` emit so JSX expressions become function calls escomplex
 * can read; `.preserve` would leave JSX in the output and Esprima would
 * choke on it.
 *
 * On transpile failure the helper returns `null` — callers treat that
 * as "skip this file" rather than crashing the scan.
 *
 * **Line coordinates (Story #4775).** The transpile does not preserve line
 * numbers: interface elision and the injected JSX-runtime import shift the
 * emitted code relative to the original source. escomplex then reports each
 * method's `lineStart` in *transpiled* coordinates while istanbul's `fnMap`
 * is in *original source* coordinates — so a per-method coverage join keyed
 * on the raw `lineStart` cannot match. Callers that need to join against
 * coverage pass `{ withLineMap: true }` and receive
 * `{ code, mapLine }`, where `mapLine(transpiledLine)` returns the original
 * source line (or `null` when the line has no mapping).
 *
 * `withLineMap` is opt-in precisely so the maintainability path — which is
 * module-level and never joins coverage — keeps paying nothing for a map it
 * would not read, and keeps emitting byte-identical scores. A JavaScript
 * input is a passthrough in both modes: `mapLine` is `null` because the
 * coordinates already *are* original-source coordinates, so no remap is
 * needed and none is computed.
 *
 * @param {string} filePath
 * @param {string} source
 * @param {{withLineMap?: boolean}} [opts]
 * @returns {string|null|{code: string, mapLine: ((line: number) => number|null)|null}}
 */
export function transpileIfNeeded(filePath, source, opts = {}) {
  const withLineMap = opts?.withLineMap === true;
  if (!isTypeScriptPath(filePath)) {
    return withLineMap ? { code: source, mapLine: null } : source;
  }
  const ts = loadTypeScript();
  if (!ts) {
    Logger.warn(
      `[Maintainability] ⚠ typescript package not resolvable; cannot score ${filePath}. ` +
        "Install with 'npm install --save-dev typescript' (peer dep, >=5.0.0).",
    );
    return null;
  }
  try {
    const result = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        isolatedModules: true,
        noEmitHelpers: true,
        importHelpers: false,
        removeComments: false,
        jsx: ts.JsxEmit.ReactJSX,
        sourceMap: withLineMap,
      },
      fileName: path.basename(filePath),
      reportDiagnostics: false,
    });
    if (!withLineMap) return result.outputText;
    const code = result.outputText.replace(SOURCE_MAPPING_URL_RE, '\n');
    const mapLine =
      typeof result.sourceMapText === 'string'
        ? buildLineMapper(result.sourceMapText, code)
        : null;
    return { code, mapLine };
  } catch (err) {
    Logger.warn(
      `[Maintainability] ⚠ TS transpile failed for ${filePath}: ${err?.message ?? err}; skipping.`,
    );
    return null;
  }
}

/**
 * Prepare a source file for scoring: read it, transpile TS/TSX with a
 * line map, and hand back the JavaScript escomplex will parse alongside the
 * transpiled → original-source line resolver the coverage join needs
 * (Story #4775).
 *
 * Failure is reported as `{error: 'read'}` or `{error: 'transpile'}` rather
 * than a bare null: CRAP drops the file either way, but the combined MI path
 * distinguishes them (a read failure drops the MI score, a transpile failure
 * scores it 0 — matching `calculateForFile`).
 *
 * @param {string} abs Absolute path of the source file.
 * @param {{readFile?: (p: string) => string, transpile?: Function}} [deps]
 * @returns {{code: string, mapLine: ((line: number) => number|null)|null}
 *   | {error: 'read'|'transpile'}}
 */
export function prepareSourceForScoring(abs, deps = {}) {
  const readFile = deps.readFile ?? ((p) => fs.readFileSync(p, 'utf-8'));
  const transpile = deps.transpile ?? transpileIfNeeded;
  let source;
  try {
    source = readFile(abs);
  } catch {
    return { error: 'read' };
  }
  const prepared = transpile(abs, source, { withLineMap: true });
  if (prepared === null || prepared === undefined)
    return { error: 'transpile' };
  // Tolerate a `deps.transpile` stub that still returns a bare string.
  if (typeof prepared === 'string') return { code: prepared, mapLine: null };
  if (typeof prepared.code !== 'string') return { error: 'transpile' };
  return { code: prepared.code, mapLine: prepared.mapLine ?? null };
}
