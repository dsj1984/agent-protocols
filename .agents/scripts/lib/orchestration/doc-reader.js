import fs from 'node:fs';
import path from 'node:path';

/**
 * Scrapes all eligible project markdown documentation files,
 * returning them concatenated into a single prompt string.
 */
export function scrapeProjectDocs(settings) {
  let docsContext = '';
  if (settings.docsRoot && fs.existsSync(settings.docsRoot)) {
    console.log(
      `[Epic Planner] Scraping project docs from ${settings.docsRoot}...`,
    );
    try {
      let targetFiles;
      if (
        Array.isArray(settings.docsContextFiles) &&
        settings.docsContextFiles.length > 0
      ) {
        targetFiles = settings.docsContextFiles.map((f) => ({
          name: f,
          full: path.join(settings.docsRoot, f),
        }));
      } else {
        const entries = fs.readdirSync(settings.docsRoot, {
          withFileTypes: true,
        });
        targetFiles = entries
          .filter((e) => e.isFile() && e.name.endsWith('.md'))
          .map((e) => ({
            name: e.name,
            full: path.join(settings.docsRoot, e.name),
          }));
      }

      for (const { name, full } of targetFiles) {
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          const content = fs.readFileSync(full, 'utf-8');
          docsContext += `\n\n--- Document: ${name} ---\n${content}`;
        }
      }
    } catch (err) {
      console.warn(
        `[Epic Planner] Warning: Failed to read docsRoot: ${err.message}`,
      );
    }
  }
  return docsContext;
}
