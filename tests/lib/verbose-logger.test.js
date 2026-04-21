import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { VerboseLogger } from '../../.agents/scripts/lib/VerboseLogger.js';

describe('VerboseLogger', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verbose-logger-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    // Reset singleton if possible, or just ignore for these tests
  });

  it('initialized with enabled=false does not write files', () => {
    const logger = new VerboseLogger({ enabled: false, logDir: tmpDir });
    logger.info('test', 'cat', { some: 'data' });

    const files = fs.readdirSync(tmpDir);
    assert.strictEqual(files.length, 0);
  });

  it('writes JSONL entries when enabled', () => {
    const logger = new VerboseLogger({
      enabled: true,
      logDir: tmpDir,
      sprint: '99',
      source: 'test-src',
      flushIntervalMs: 0,
    });

    logger.info('category-A', 'Msg 1', { key: 'val' });
    logger.info('general', 'Msg 2');
    logger.flush();

    const logFile = path.join(tmpDir, 'sprint-99.jsonl');
    assert.ok(fs.existsSync(logFile), 'Log file should exist');

    const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
    assert.strictEqual(lines.length, 2);

    const entry1 = JSON.parse(lines[0]);
    assert.strictEqual(entry1.message, 'Msg 1');
    assert.strictEqual(entry1.category, 'category-A');
    assert.strictEqual(entry1.data.key, 'val');
    assert.strictEqual(entry1.source, 'test-src');
    assert.strictEqual(entry1.sprint, '99');
    assert.ok(entry1.timestamp);
  });

  it('uses session filename if no sprint is provided', () => {
    const logger = new VerboseLogger({
      enabled: true,
      logDir: tmpDir,
      flushIntervalMs: 0,
    });
    logger.info('general', 'Hello');
    logger.flush();

    const files = fs.readdirSync(tmpDir);
    assert.ok(files.find((f) => f.startsWith('session-')));
  });

  it('convenience methods delegate correctly to file system', () => {
    const logger = new VerboseLogger({
      enabled: true,
      logDir: tmpDir,
      sprint: 'test',
      flushIntervalMs: 0,
    });
    const logFile = path.join(tmpDir, 'sprint-test.jsonl');

    logger.debug('sys', 'Debug msg');
    logger.flush();
    let lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
    let lastLog = JSON.parse(lines[lines.length - 1]);
    assert.strictEqual(lastLog.level, 'debug');

    logger.warn('sys', 'Warn msg');
    logger.flush();
    lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
    lastLog = JSON.parse(lines[lines.length - 1]);
    assert.strictEqual(lastLog.level, 'warn');

    logger.error('sys', 'Error msg', { err: 'boom' });
    logger.flush();
    lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
    lastLog = JSON.parse(lines[lines.length - 1]);
    assert.strictEqual(lastLog.level, 'error');
    assert.strictEqual(lastLog.message, 'Error msg');
    assert.strictEqual(lastLog.data.err, 'boom');
  });

  // --------------------------------------------------------------------- //
  // Batched writer behaviour                                              //
  // --------------------------------------------------------------------- //

  it('buffers below threshold and waits for flush()', () => {
    const logger = new VerboseLogger({
      enabled: true,
      logDir: tmpDir,
      sprint: 'batch-1',
      flushThreshold: 10,
      flushIntervalMs: 0,
    });
    for (let i = 0; i < 9; i++) logger.info('system', `msg ${i}`);
    const logFile = path.join(tmpDir, 'sprint-batch-1.jsonl');
    // File is created lazily on first flush; not present yet.
    assert.equal(fs.existsSync(logFile), false);
    logger.flush();
    assert.equal(
      fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).length,
      9,
    );
  });

  it('auto-flushes when threshold is reached', () => {
    const logger = new VerboseLogger({
      enabled: true,
      logDir: tmpDir,
      sprint: 'batch-2',
      flushThreshold: 5,
      flushIntervalMs: 0,
    });
    for (let i = 0; i < 5; i++) logger.info('system', `msg ${i}`);
    const logFile = path.join(tmpDir, 'sprint-batch-2.jsonl');
    assert.equal(
      fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).length,
      5,
    );
  });

  it('caps the in-memory buffer when flushing cannot keep up', () => {
    // flushThreshold=1000 and flushIntervalMs=0 means auto-flush never fires
    // for our small write count; maxBufferSize=10 means the 40 extra log
    // calls must be dropped rather than accumulated unbounded.
    const logger = new VerboseLogger({
      enabled: true,
      logDir: tmpDir,
      sprint: 'cap',
      flushThreshold: 1000,
      flushIntervalMs: 0,
      maxBufferSize: 10,
    });

    for (let i = 0; i < 50; i++) logger.info('system', `msg ${i}`);

    const s = logger.stats();
    assert.equal(
      s.bufferSize,
      10,
      `buffer should be capped at maxBufferSize (got ${s.bufferSize})`,
    );
    assert.equal(s.droppedEntries, 40);
  });

  it('auto-flushes after the configured interval', async () => {
    const logger = new VerboseLogger({
      enabled: true,
      logDir: tmpDir,
      sprint: 'batch-3',
      flushThreshold: 100,
      flushIntervalMs: 20,
    });
    logger.info('system', 'pending');
    // Give the unref'd timer a chance to fire.
    await new Promise((resolve) => setTimeout(resolve, 60));
    const logFile = path.join(tmpDir, 'sprint-batch-3.jsonl');
    assert.equal(
      fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).length,
      1,
    );
  });
});
