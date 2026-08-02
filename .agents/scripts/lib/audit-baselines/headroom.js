/**
 * headroom.js — how much slack sits between each configured floor and the
 * number actually measured (Story #4902).
 *
 * A floor set far from reality is a gate that cannot fail. Headroom is the
 * distance the measurement could still drift before the gate notices, and it
 * is the direct input to the only remediation this lens ever recommends:
 * tighten the floor to what the repo already achieves.
 *
 * Both sides come from the repository, never from this module: the floor
 * from `resolveQuality()` over `.agentrc.json` (so a consumer's own floors
 * are the ones reported), and the measurement from the committed baseline's
 * whole-repo rollup. Polarity comes from `axisDirection` in the gate's own
 * floors phase, so "better" always means the same thing here as it does when
 * `check-baselines.js` decides pass or fail.
 *
 * @module lib/audit-baselines/headroom
 */

import { axisDirection } from '../orchestration/check-baselines/phases/floors.js';
import { rollupOf } from './kinds.js';

/**
 * Signed distance from the floor, positive when the measurement sits on the
 * good side of it. Null when the baseline carries no value for the axis.
 *
 * @param {number | undefined} measured
 * @param {number} floor
 * @param {'gte' | 'lte'} direction
 * @returns {number | null}
 */
function headroomFor(measured, floor, direction) {
  if (typeof measured !== 'number') return null;
  return direction === 'gte' ? measured - floor : floor - measured;
}

/**
 * Build the `headroom[]` section across every configured gate kind.
 *
 * @param {{
 *   kinds: string[],
 *   quality: object,
 *   baselines: Map<string, object | null>,
 * }} args
 * @returns {Array<object>}
 */
export function buildHeadroom({ kinds, quality, baselines }) {
  const out = [];
  for (const kind of kinds) {
    const floors = quality?.gates?.[kind]?.floors?.['*'];
    if (!floors || typeof floors !== 'object') continue;
    const rollup = rollupOf(baselines.get(kind) ?? null);
    for (const [axis, floor] of Object.entries(floors)) {
      if (typeof floor !== 'number' || !Number.isFinite(floor)) continue;
      const measured = rollup?.[axis];
      const direction = axisDirection(kind, axis);
      out.push({
        kind,
        axis,
        floor,
        measured: typeof measured === 'number' ? measured : null,
        direction,
        // Positive headroom = the measurement is on the good side of the
        // floor by this much; negative = the floor is already breached.
        headroom: headroomFor(measured, floor, direction),
      });
    }
  }
  return out.sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.axis.localeCompare(b.axis),
  );
}
