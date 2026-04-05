/**
 * AgentLoopRunner.js
 *
 * Wraps the Perception-Action REPL mechanism (previously top-level global
 * state in run-agent-loop.js) in a dedicated class.
 *
 * Benefits:
 *  - Eliminates global variable pollution — each instance owns its own state.
 *  - Enables multiple concurrent event-streams in the same process if needed.
 *  - Makes the loop unit-testable: instantiate, call start(stdin), inspect ledger.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync, exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
import { ensureDirSync } from './fs-utils.js';

export class AgentLoopRunner {
  /**
   * @param {object}  opts
   * @param {string}  opts.taskId       - Unique task identifier.
   * @param {string}  opts.projectRoot  - Absolute path to the repository root.
   * @param {string}  [opts.branch]     - Git branch to check out via worktree.
   * @param {string}  [opts.pattern]    - Execution pattern label (default: 'default').
   * @param {string}  [opts.streamDir]  - Directory for JSONL ledger files.
   * @param {string}  [opts.workspacesDir] - Directory for temporary worktrees.
   * @param {number}  [opts.executionTimeoutMs] - Command timeout in ms.
   * @param {number}  [opts.executionMaxBuffer] - Command max buffer in bytes.
   */
  constructor({ taskId, projectRoot, branch = null, pattern = 'default', streamDir, workspacesDir, executionTimeoutMs, executionMaxBuffer }) {
    this.taskId = taskId;
    this.projectRoot = projectRoot;
    this.branch = branch;
    this.pattern = pattern;
    this.streamDir = streamDir || path.join(projectRoot, 'temp/event-streams');
    this.workspacesDir = workspacesDir || path.join(projectRoot, 'temp/workspaces');
    this.workingDir = projectRoot;
    this.ledgerPath = path.join(this.streamDir, `${taskId}.jsonl`);
    this.executionTimeoutMs = executionTimeoutMs || 300000;
    this.executionMaxBuffer = executionMaxBuffer || 10485760;
  }

  // -------------------------------------------------------------------------
  // Workspace Initialization
  // -------------------------------------------------------------------------

  /**
   * Sets up the isolated git worktree for the task branch (if requested).
   * If worktree setup fails, falls back silently to the project root.
   */
  initWorkspace() {
    ensureDirSync(this.streamDir);

    if (this.branch) {
      const workspacesDir = this.workspacesDir;
      ensureDirSync(workspacesDir);

      const worktreePath = path.join(workspacesDir, this.taskId);

      if (!fs.existsSync(worktreePath)) {
        console.log(`[System] Initializing isolated Worktree workspace for ${this.branch}...`);
        try {
          execFileSync('git', ['worktree', 'add', worktreePath, this.branch], {
            cwd: this.projectRoot, stdio: 'pipe'
          });
        } catch {
          try {
            execFileSync('git', ['worktree', 'add', '-b', this.branch, worktreePath, 'main'], {
              cwd: this.projectRoot, stdio: 'pipe'
            });
          } catch (err) {
            console.warn(`[System] Failed to initialize worktree cleanly: ${err.message}. Proceeding with standard execution root.`);
            return; // leave this.workingDir as projectRoot
          }
        }
      }

      this.workingDir = worktreePath;
    }
  }

  // -------------------------------------------------------------------------
  // Event Ledger
  // -------------------------------------------------------------------------

  /**
   * Appends a structured JSON event to the task's JSONL ledger file.
   * @param {object} event
   */
  appendEvent(event) {
    const stamped = { ...event, timestamp: new Date().toISOString() };
    fs.appendFileSync(this.ledgerPath, JSON.stringify(stamped) + '\n', 'utf8');
  }

  /**
   * Initializes the ledger file if it doesn't exist yet.
   */
  initLedger() {
    if (!fs.existsSync(this.ledgerPath)) {
      this.appendEvent({ type: 'System', message: `Initialized Perception-Action Ledger for Task: ${this.taskId}` });
      console.log(`[System] Initialized new event ledger at ${this.ledgerPath}`);
      console.log(`[System] Pattern Mode: ${this.pattern}`);
      console.log(`[System] Working Directory: ${this.workingDir}`);
    }
  }

  // -------------------------------------------------------------------------
  // Action Dispatch
  // -------------------------------------------------------------------------

  /**
   * Dispatches a validated action object and returns the observation result.
   * @param {object} action - Parsed action payload from stdin.
   * @returns {{ type: string, result?: string, message?: string }}
   */
  async dispatch(action) {
    switch (action.action) {
      case 'ReadFile': {
        const targetPath = path.join(this.workingDir, action.path);
        if (!fs.existsSync(targetPath)) {
          throw new Error(`File not found: ${action.path}`);
        }
        return { type: 'EnvironmentObservation', result: fs.readFileSync(targetPath, 'utf8') };
      }

      case 'WriteFile': {
        const writePath = path.join(this.workingDir, action.path);
        ensureDirSync(path.dirname(writePath));
        fs.writeFileSync(writePath, action.content, 'utf8');
        return { type: 'EnvironmentObservation', result: `Successfully wrote ${action.path}` };
      }

      case 'ExecuteSafeCommand': {
        // Use async exec so the Node event loop remains unblocked during long-running
        // commands. This is critical for the v5 REST-service context where synchronous
        // execution would stall all in-flight HTTP routes and heartbeat connections.
        const { stdout } = await execAsync(action.command, {
          cwd: this.workingDir,
          timeout: this.executionTimeoutMs,
          maxBuffer: this.executionMaxBuffer,
        });
        return { type: 'EnvironmentObservation', result: stdout };
      }

      case 'ConcludeTask': {
        // Ledger the conclusion
        this.appendEvent({ type: 'System', message: `Task Concluded successfully. Final state: ${action.status}` });
        console.log(JSON.stringify({ status: 'Task Concluded', finalState: action.status }));

        // Tear down isolated worktree if applicable
        if (this.workingDir !== this.projectRoot) {
          console.log('[System] Tearing down isolated Worktree workspace...');
          try {
            execFileSync('git', ['worktree', 'remove', '--force', this.workingDir], {
              cwd: this.projectRoot, stdio: 'pipe'
            });
          } catch (e) {
            console.error(`[Error] Failed to remove worktree: ${e.message}`);
          }
        }
        process.exit(0);
        break; // unreachable — satisfies linter
      }

      default:
        throw new Error(`Unknown action type: ${action.action}`);
    }
  }

  // -------------------------------------------------------------------------
  // REPL Loop
  // -------------------------------------------------------------------------

  /**
   * Starts the readline REPL, reading JSON action payloads from the given
   * readable stream (defaults to process.stdin).
   * @param {NodeJS.ReadableStream} [input=process.stdin]
   */
  start(input = process.stdin) {
    this.initWorkspace();
    this.initLedger();

    console.log('[Event Stream Active] Awaiting JSON action payloads via stdin. To exit, emit \'ConcludeTask\'.');

    const rl = readline.createInterface({ input, output: process.stdout, terminal: false });

    rl.on('line', (line) => {
      // Wrap in async IIFE so we can await the async dispatch() without blocking
      // the readline interface or preventing subsequent lines from being queued.
      (async () => {
        if (!line.trim()) return;

        let action;
        try {
          action = JSON.parse(line);
        } catch (e) {
          console.error(JSON.stringify({ error: 'Invalid JSON format', detail: e.message }));
          return;
        }

        if (!action.action || !action.reasoning) {
          console.error(JSON.stringify({ error: "Missing required fields 'action' or 'reasoning'" }));
          return;
        }

        this.appendEvent({ type: 'AgentAction', data: action });

        try {
          const observation = await this.dispatch(action);
          if (observation) {
            this.appendEvent(observation);
            console.log(JSON.stringify(observation));
          }
        } catch (err) {
          const errorObservation = { type: 'EnvironmentError', message: err.message };
          this.appendEvent(errorObservation);
          console.log(JSON.stringify(errorObservation));
        }
      })();
    });
  }
}
