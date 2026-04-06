import fs from 'node:fs';
import fsPromises from 'node:fs/promises';

/**
 * Global filesystem stubbing utility for full memfs sandbox isolation.
 * Safely redirects node:fs and node:fs/promises methods to memfs.
 *
 * @param {import('node:test').TestContext} t - The node:test test context
 * @param {import('memfs').IFs} memfsVol - The memfs volume to use
 */
export function setupFsMock(t, memfsVol) {
  // Sync methods
  t.mock.method(fs, 'existsSync', (pathStr) => {
    return memfsVol.existsSync(pathStr);
  });

  t.mock.method(fs, 'readFileSync', (pathStr, options) => {
    return memfsVol.readFileSync(pathStr, options);
  });

  t.mock.method(fs, 'writeFileSync', (pathStr, data, options) => {
    return memfsVol.writeFileSync(pathStr, data, options);
  });

  t.mock.method(fs, 'mkdirSync', (pathStr, options) => {
    return memfsVol.mkdirSync(pathStr, options);
  });

  t.mock.method(fs, 'accessSync', (pathStr, mode) => {
    return memfsVol.accessSync(pathStr, mode);
  });

  // Async methods
  t.mock.method(fsPromises, 'access', async (pathStr, mode) => {
    return memfsVol.promises.access(pathStr, mode);
  });

  t.mock.method(fsPromises, 'readFile', async (pathStr, options) => {
    return memfsVol.promises.readFile(pathStr, options);
  });

  t.mock.method(fsPromises, 'writeFile', async (pathStr, data, options) => {
    return memfsVol.promises.writeFile(pathStr, data, options);
  });

  t.mock.method(fsPromises, 'mkdir', async (pathStr, options) => {
    return memfsVol.promises.mkdir(pathStr, options);
  });
}
