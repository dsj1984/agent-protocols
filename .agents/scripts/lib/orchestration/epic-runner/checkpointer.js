/**
 * Checkpointer — reads and writes the `epic-run-state` structured comment.
 *
 * The comment is identified by a stable HTML marker so it can be overwritten
 * idempotently across orchestrator restarts. The body is a fenced JSON block
 * following the schema in tech spec #323.
 */

import {
  findStructuredComment,
  upsertStructuredComment,
} from '../ticketing.js';

export const EPIC_RUN_STATE_TYPE = 'epic-run-state';
export const CHECKPOINT_SCHEMA_VERSION = 1;

const JSON_FENCE_RE = /```json\s*\n([\s\S]*?)\n```/;

export class Checkpointer {
  /**
   * @param {{ provider: import('../../ITicketingProvider.js').ITicketingProvider, epicId: number }} opts
   */
  constructor({ provider, epicId }) {
    if (!provider) throw new TypeError('Checkpointer requires a provider');
    if (!Number.isInteger(epicId)) {
      throw new TypeError('Checkpointer requires a numeric epicId');
    }
    this.provider = provider;
    this.epicId = epicId;
  }

  /**
   * Read and parse the checkpoint. Returns null if the comment is missing or
   * unparseable (callers treat null as "start fresh").
   *
   * @returns {Promise<object | null>}
   */
  async read() {
    const comment = await findStructuredComment(
      this.provider,
      this.epicId,
      EPIC_RUN_STATE_TYPE,
    );
    if (!comment?.body) return null;
    const match = comment.body.match(JSON_FENCE_RE);
    if (!match) return null;
    try {
      return JSON.parse(match[1]);
    } catch (_err) {
      return null;
    }
  }

  /**
   * Overwrite the checkpoint with `state`. Idempotent — callers may invoke
   * freely per wave; the marker-scoped upsert deletes the prior comment.
   *
   * @param {object} state
   */
  async write(state) {
    const payload = {
      version: CHECKPOINT_SCHEMA_VERSION,
      ...state,
      lastUpdatedAt: new Date().toISOString(),
    };
    const body = `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
    await upsertStructuredComment(
      this.provider,
      this.epicId,
      EPIC_RUN_STATE_TYPE,
      body,
    );
    return payload;
  }

  /**
   * Initial checkpoint for a brand-new run. Idempotent against re-dispatch —
   * if a checkpoint already exists it is returned unchanged.
   *
   * @param {{ totalWaves: number, concurrencyCap: number, autoClose: boolean }} opts
   */
  async initialize({ totalWaves, concurrencyCap, autoClose }) {
    const existing = await this.read();
    if (existing) return existing;
    return this.write({
      epicId: this.epicId,
      startedAt: new Date().toISOString(),
      autoClose: Boolean(autoClose),
      currentWave: 0,
      totalWaves,
      concurrencyCap,
      waves: [],
      blockerHistory: [],
    });
  }
}
