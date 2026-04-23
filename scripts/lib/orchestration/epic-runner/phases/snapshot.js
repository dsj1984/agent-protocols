/**
 * Epic snapshot phase — fetch Epic ticket and snapshot `autoClose` label.
 *
 * The `epic::auto-close` label is read once here. Adding it mid-run is
 * ignored; removing it mid-run is ignored. The authoritative value is
 * re-read from the checkpoint on resume in `iterate-waves`.
 */

const AUTO_CLOSE_LABEL = 'epic::auto-close';

export async function runSnapshotPhase(ctx, _collaborators, state) {
  const { epicId, provider } = ctx;
  const epic = await provider.getTicket(epicId);
  const epicLabels = new Set(epic.labels ?? []);
  const autoClose = epicLabels.has(AUTO_CLOSE_LABEL);
  return { ...state, epic, autoClose };
}
