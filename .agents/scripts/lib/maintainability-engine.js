import fs from "fs";
import escomplex from "typhonjs-escomplex";

/**
 * Calculates the maintainability score of a JavaScript source file or string.
 * Uses `typhonjs-escomplex` internally, which provides a maintainability index
 * based on the Halstead Volume, Cyclomatic Complexity, and Lines of Code.
 */
/**
 * Calculate score for a raw string of source code.
 * @param {string} sourceCode The JavaScript source code.
 * @returns {number} Score between 0 and 171. Higher is better.
 */
export function calculateForSource(sourceCode) {
  try {
    const result = escomplex.analyzeModule(sourceCode);
    return result.maintainability;
  } catch (_err) {
    // Return 0 if the parser fails (e.g. invalid syntax)
    return 0;
  }
}

/**
 * Calculate score for a given file.
 * @param {string} filePath Path to the JavaScript file.
 * @returns {number} Maintainability index.
 */
export function calculateForFile(filePath) {
  try {
    const sourceCode = fs.readFileSync(filePath, "utf-8");
    return calculateForSource(sourceCode);
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`File not found: ${filePath}`);
    }
    throw err;
  }
}

