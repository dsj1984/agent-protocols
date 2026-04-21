/**
 * WaveScheduler — iterates the wave DAG returned by `Graph.computeWaves()`.
 *
 * Tracks progress (current wave index, waves completed) but never spawns
 * workers. The `story-launcher` consumes the stories it yields.
 */

export class WaveScheduler {
  /**
   * @param {object[][]} waves - Array of waves, each a list of story objects.
   */
  constructor(waves) {
    if (!Array.isArray(waves)) {
      throw new TypeError('WaveScheduler expects a waves array');
    }
    this.waves = waves;
    this.currentIndex = 0;
    this.completed = new Set();
  }

  get totalWaves() {
    return this.waves.length;
  }

  get currentWave() {
    return this.currentIndex;
  }

  hasMoreWaves() {
    return this.currentIndex < this.waves.length;
  }

  /**
   * Returns the next wave to dispatch and advances the pointer. Returns null
   * if no waves remain.
   *
   * @returns {{ index: number, stories: object[] } | null}
   */
  nextWave() {
    if (!this.hasMoreWaves()) return null;
    const index = this.currentIndex;
    const stories = this.waves[index];
    this.currentIndex += 1;
    return { index, stories };
  }

  /**
   * Marks a previously-yielded wave as complete. Idempotent. Throws if the
   * index is out of range or refers to a wave not yet yielded.
   *
   * @param {number} index
   */
  markWaveComplete(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.waves.length) {
      throw new RangeError(`Wave index ${index} is out of range`);
    }
    if (index >= this.currentIndex) {
      throw new Error(`Wave ${index} has not been yielded yet`);
    }
    this.completed.add(index);
  }

  completedWaves() {
    return [...this.completed].sort((a, b) => a - b);
  }
}
