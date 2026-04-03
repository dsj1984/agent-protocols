import { Logger } from "./lib/Logger.js";
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
  // Get all tracked files using git ls-files
  const filesOutput = execSync('git ls-files').toString();
  const files = filesOutput.split('\n').filter(Boolean);
  let foundConflicts = false;

  // Standard git conflict markers
  const markers = [
    '<<<<<<< ',
    '=======',
    '>>>>>>> '
  ];

  for (const file of files) {
    if (fs.existsSync(file)) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        for (const marker of markers) {
          if (content.includes(marker)) {
            console.error(`Conflict marker '${marker.trim()}' found in tracked file: ${file}`);
            foundConflicts = true;
            break; // Move to the next file if one marker is found
          }
        }
      } catch (readErr) {
        // Ignore files that can't be read as utf8 (e.g., binaries)
      }
    }
  }

  if (foundConflicts) {
    Logger.fatal('\nERROR: Merge conflicts detected. Please resolve them before proceeding.');
    
  } else {
    console.log('No conflict markers found in tracked files.');
    process.exit(0);
  }
} catch (err) {
  Logger.fatal('Error detecting merges:', err.message);
  
}
