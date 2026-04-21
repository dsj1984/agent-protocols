/**
 * BookendChainer — chains `/sprint-code-review` → `/sprint-retro` →
 * `/sprint-close` when the run began with `epic::auto-close`.
 *
 * Authorization is a snapshot: the `autoClose` boolean is captured at
 * dispatch time (recorded in the `epic-run-state` checkpoint) and passed in
 * here. Applying the `epic::auto-close` label mid-run is ignored; removing
 * it mid-run is also ignored. This prevents post-hoc authorization of a
 * merge-to-main that includes unexamined work.
 *
 * When `autoClose=false` the chainer posts a hand-off comment listing the
 * remaining skills the operator must drive manually, then exits cleanly.
 *
 * When `autoClose=true` the chainer invokes each skill via a caller-supplied
 * `runSkill` adapter so the engine stays agnostic to whether skills are run
 * via the Claude Agent tool or a local subprocess.
 */

const HANDOFF_STEPS = ['/sprint-code-review', '/sprint-retro', '/sprint-close'];

export class BookendChainer {
  /**
   * @param {{
   *   autoClose: boolean,
   *   epicId: number,
   *   runSkill?: (skill: string, args: { epicId: number }) => Promise<{ status: 'ok'|'failed', detail?: string }>,
   *   postComment?: (ticketId: number, payload: object) => Promise<unknown>,
   *   logger?: { info: Function, warn: Function },
   * }} opts
   */
  constructor({ autoClose, epicId, runSkill, postComment, logger }) {
    if (!Number.isInteger(epicId)) {
      throw new TypeError('BookendChainer requires a numeric epicId');
    }
    this.autoClose = Boolean(autoClose);
    this.epicId = epicId;
    this.runSkill = runSkill;
    this.postComment = postComment;
    this.logger = logger ?? console;
  }

  async run() {
    if (!this.autoClose) {
      await this.#postHandoff();
      return { executed: false, reason: 'autoClose-disabled' };
    }

    if (typeof this.runSkill !== 'function') {
      this.logger.warn?.(
        '[BookendChainer] autoClose=true but no runSkill adapter was provided — ' +
          'bookends skipped. Operator must drive them manually.',
      );
      await this.#postHandoff('missing-runSkill');
      return { executed: false, reason: 'no-runSkill' };
    }

    const results = [];
    for (const skill of HANDOFF_STEPS) {
      this.logger.info?.(`[BookendChainer] running ${skill} for Epic #${this.epicId}`);
      let outcome;
      try {
        outcome = await this.runSkill(skill, { epicId: this.epicId });
      } catch (err) {
        outcome = { status: 'failed', detail: err?.message ?? String(err) };
      }
      results.push({ skill, ...outcome });
      if (outcome.status !== 'ok') {
        this.logger.warn?.(
          `[BookendChainer] ${skill} halted the chain: ${outcome.detail ?? 'unknown error'}`,
        );
        await this.#postFailure(skill, outcome, results);
        return { executed: true, completed: false, results };
      }
    }
    return { executed: true, completed: true, results };
  }

  async #postHandoff(extra) {
    if (typeof this.postComment !== 'function') return;
    const lines = [
      '### ✅ Epic reached `agent::review`',
      '',
      'Autonomous bookend chain not authorized — operator must drive:',
      ...HANDOFF_STEPS.map((s) => `- \`${s}\``),
    ];
    if (extra) lines.push('', `_Note: ${extra}_`);
    try {
      await this.postComment(this.epicId, {
        type: 'notification',
        body: lines.join('\n'),
      });
    } catch (err) {
      this.logger.warn?.(
        `[BookendChainer] hand-off comment failed: ${err?.message ?? err}`,
      );
    }
  }

  async #postFailure(skill, outcome, results) {
    if (typeof this.postComment !== 'function') return;
    const body = [
      `### ⚠️ Autonomous bookend chain halted at \`${skill}\``,
      '',
      outcome.detail ? `Reason: \`${outcome.detail}\`` : 'Reason: unknown',
      '',
      '**Completed steps:**',
      ...results
        .filter((r) => r.status === 'ok')
        .map((r) => `- \`${r.skill}\``),
      '',
      'Operator should inspect the failure and re-run the remaining skills manually.',
    ];
    try {
      await this.postComment(this.epicId, {
        type: 'friction',
        body: body.join('\n'),
      });
    } catch (err) {
      this.logger.warn?.(
        `[BookendChainer] failure comment post failed: ${err?.message ?? err}`,
      );
    }
  }
}
