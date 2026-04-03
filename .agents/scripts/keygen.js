import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';import { Logger } from "./lib/Logger.js";


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const KEYS_DIR = path.join(PROJECT_ROOT, '.agents', 'keys');

if (!fs.existsSync(KEYS_DIR)) {
  fs.mkdirSync(KEYS_DIR, { recursive: true });
}

console.log('[System] Generating autonomous Ed25519 Asymmetric Key Pair...');
try {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

  const pubPath = path.join(KEYS_DIR, 'public.pem');
  const privPath = path.join(KEYS_DIR, 'private.pem');

  fs.writeFileSync(pubPath, pubPem, 'utf8');
  fs.writeFileSync(privPath, privPem, { encoding: 'utf8', mode: 0o600 }); // restrict read rights

  console.log(`✅ Success: Public key written to ${pubPath}`);
  console.log(`✅ Success: Private key written securely to ${privPath}`);
  console.log(`⚠️  WARNING: Do not commit private.pem to version control.`);
} catch (err) {
  Logger.fatal(`❌ Failed to generate key pair: ${err.message}`);
  
}
