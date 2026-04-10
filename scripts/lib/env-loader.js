import fs from 'node:fs';
import path from 'node:path';

/**
 * Auto-load .env from the project root if it exists
 */
export function loadEnv(projectRoot) {
  try {
    const envPath = path.resolve(projectRoot, '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      envContent.split('\n').forEach((line) => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
          const key = match[1];
          let value = (match[2] || '').trim();
          // Remove quotes if present
          if (
            value.length > 0 &&
            value.charAt(0) === '"' &&
            value.charAt(value.length - 1) === '"'
          ) {
            value = value.substring(1, value.length - 1);
          } else if (
            value.length > 0 &&
            value.charAt(0) === "'" &&
            value.charAt(value.length - 1) === "'"
          ) {
            value = value.substring(1, value.length - 1);
          }
          process.env[key] = value;
        }
      });
    }
  } catch (_err) {
    // Silent fail - environment may be provided via other means
  }
}
