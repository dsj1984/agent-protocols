/**
 * task-utils.js
 *
 * Shared utilities for inspecting task objects throughout the pipeline.
 * Centralises the bookend-detection predicate so that any future addition of a
 * new bookend type only requires a change in one place.
 */

/**
 * Returns true when the given task is a bookend (lifecycle-management) task.
 *
 * Bookend tasks are distinguished from regular development tasks by one of the
 * following flags being truthy:
 *   - isIntegration  — merge + verify phase
 *   - isQA           — automated testing phase
 *   - isCodeReview   — architectural review phase
 *   - isRetro        — retrospective phase
 *   - isCloseSprint  — sprint close-out + tagging phase
 *
 * @param {object} task - A task object from the sprint manifest.
 * @returns {boolean}
 */
export function isBookendTask(task) {
  return Boolean(
    task.isIntegration ||
      task.isQA ||
      task.isCodeReview ||
      task.isRetro ||
      task.isCloseSprint,
  );
}
