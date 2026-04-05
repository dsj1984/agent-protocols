import { fileURLToPath } from 'node:url';
import path from 'node:path';

console.log('import.meta.url:', import.meta.url);
console.log('process.argv[1]:', process.argv[1]);
console.log('path.resolve(process.argv[1]):', path.resolve(process.argv[1]));
console.log('fileURLToPath(import.meta.url):', fileURLToPath(import.meta.url));

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log('MATCH!');
} else {
  console.log('NO MATCH!');
}
