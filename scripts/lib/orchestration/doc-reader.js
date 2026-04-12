import fs from 'node:fs';
import path from 'node:path';

/**
 * Scrapes all eligible project markdown documentation files,
 * returning them concatenated into a single prompt string.
 */
export async function scrapeProjectDocs(settings) {
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

      const readPromises = targetFiles.map(async ({ name, full }) => {
        try {
          const stat = await fs.promises.stat(full);
          if (stat.isFile()) {
            const content = await fs.promises.readFile(full, 'utf-8');
            return { name, content };
          }
        } catch (_e) {
          // ignore missing or unreadable files
        }
        return null;
      });

      const results = await Promise.all(readPromises);
      for (const result of results) {
        if (result) {
          docsContext += `\n\n--- Document: ${result.name} ---\n${result.content}`;
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
