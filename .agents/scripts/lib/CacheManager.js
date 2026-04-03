import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// Default config path
const CONFIG_PATH = path.join(PROJECT_ROOT, '.agents/config/config.json');

export class CacheManager {
  constructor() {
    // 1. Load configuration from global config.json
    let globalConfig = {};
    if (fs.existsSync(CONFIG_PATH)) {
      try {
        globalConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      } catch (e) {
        console.warn(`[CacheManager] Failed to load config: ${e.message}`);
      }
    }

    const settings = globalConfig?.properties?.apcCacheSettings?.default || {
      strictHashing: true,
      ttlDays: 30,
      enableSpeculativeExecution: true,
      cacheDir: 'temp/apc-cache'
    };

    this.config = settings;
    
    // 2. Resolve final cache directory
    this.cacheDir = path.resolve(PROJECT_ROOT, this.config.cacheDir);
    
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Computes a deterministic semantic fingerpint given a task's intent and scope.
   */
  computeHash(instructions, focusAreas = [], scope = 'root') {
    const normalize = (str) => String(str).toLowerCase().replace(/\s+/g, ' ').trim();
    const intentPayload = normalize(instructions);
    const scopePayload = focusAreas.slice().sort().join(',') + ':' + scope;
    
    // Hash the intent and scope to form a lookup key
    const hash = crypto.createHash('sha256');
    hash.update(intentPayload + '|' + scopePayload);
    return hash.digest('hex').substring(0, 16); // 16-char short hash
  }

  getCache(hashKey) {
    const cacheFile = path.join(this.cacheDir, `${hashKey}.json`);
    if (fs.existsSync(cacheFile)) {
      try {
        return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      } catch (e) {
        console.warn(`Failed to parse cache file: ${cacheFile}`);
        return null;
      }
    }
    return null;
  }

  setCache(hashKey, payload) {
    const cacheFile = path.join(this.cacheDir, `${hashKey}.json`);
    const data = {
        metadata: {
            createdAt: new Date().toISOString(),
            version: '1.0'
        },
        payload
    };
    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), 'utf8');
  }

  hasMatch(instructions, focusAreas = [], scope = 'root') {
      const hash = this.computeHash(instructions, focusAreas, scope);
      const data = this.getCache(hash);
      return data ? { hash, payload: data.payload } : null;
  }
}

export const instance = new CacheManager();
