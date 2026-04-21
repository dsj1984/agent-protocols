/**
 * BookendChainer — chains `/sprint-code-review` → `/sprint-retro` →
 * `/sprint-close` when the run began with `epic::auto-close`.
 *
 * Stubbed in this Story. Implementation lands with the autonomous-bookend
 * Story on tech spec #323. Until then, `run()` simply logs that bookends
 * are pending and returns `{ executed: false, reason: 'stub' }`.
 *
 * The `autoClose` snapshot is captured at orchestrator startup by the
 * coordinator and passed in here; mid-run changes are intentionally
 * ignored.
 */

export class BookendChainer {
  /**
   * @param {{
   *   autoClose: boolean,
   *   logger?: { info: Function, warn: Function },
   *   runChain?: (steps: string[]) => Promise<{ executed: true, results: unknown[] }>,
   * }} opts
   */
  constructor({ autoClose, logger, runChain }) {
    this.autoClose = Boolean(autoClose);
    this.logger = logger ?? console;
    this.runChain = runChain;
  }

  async run() {
    if (!this.autoClose) {
      this.logger.info?.(
        '[BookendChainer] autoClose=false — leaving bookends to the operator.',
      );
      return { executed: false, reason: 'autoClose-disabled' };
    }
    if (typeof this.runChain !== 'function') {
      this.logger.info?.(
        '[BookendChainer] autoClose=true but engine is stubbed — bookends skipped.',
      );
      return { executed: false, reason: 'stub' };
    }
    const results = await this.runChain([
      '/sprint-code-review',
      '/sprint-retro',
      '/sprint-close',
    ]);
    return { executed: true, ...results };
  }
}
