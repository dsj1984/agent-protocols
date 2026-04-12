import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { Logger } from './lib/Logger.js';

export async function main() {
  try {
    // Get all tracked files using git ls-files
    const filesOutput = execFileSync('git', ['ls-files']).toString();
    const files = filesOutput.split('\n').filter(Boolean);
    let foundConflicts = false;

    // Standard git conflict markers
    // Adding '\n' before '=======' correctly avoids matching simple line separators
    const markers = ['<<<<<<< ', '\n=======', '>>>>>>> '];

    await Promise.all(
      files.map(async (file) => {
        // Exclude self and workflow docs that contain valid examples of conflict markers
        if (
          file === '.agents/scripts/detect-merges.js' ||
          file === '.agents/workflows/git-merge-pr.md'
        )
          return;
        try {
          const content = await fs.promises.readFile(file, 'utf8');
          for (const marker of markers) {
            if (content.includes(marker)) {
              console.error(
                `Conflict marker '${marker.trim()}' found in tracked file: ${file}`,
              );
              foundConflicts = true;
              break;
            }
          }
        } catch (_readErr) {
          // Ignore files that can't be read as utf8 (e.g., binaries or missing files)
        }
      }),
    );

    if (foundConflicts) {
      Logger.fatal(
        '\nERROR: Merge conflicts detected. Please resolve them before proceeding.',
      );
    } else {
      console.log('No conflict markers found in tracked files.');
      process.exit(0);
    }
  } catch (err) {
    Logger.fatal(`Error detecting merges: ${err.message}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    Logger.fatal(`Fatal error: ${err.message}`);
  });
}
