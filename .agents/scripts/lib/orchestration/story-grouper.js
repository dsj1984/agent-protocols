/**
 * lib/orchestration/story-grouper.js — Story Grouping Helpers
 */

import { TYPE_LABELS } from '../label-constants.js';

/**
 * Parse the direct parent ID from a ticket body.
 *
 * @param {string} body
 * @returns {number|null}
 */
export function parseParentId(body) {
  const match = (body ?? '').match(/^parent:\s*#(\d+)/m);
  return match ? Number.parseInt(match[1], 10) : null;
}

/**
 * Group tasks by their parent Story or Feature.
 *
 * @param {object[]} tasks
 * @param {object[]} allTickets
 * @param {number}   _epicId
 * @returns {Map}
 */
export function groupTasksByStory(tasks, allTickets, _epicId) {
  const ticketById = new Map(allTickets.map((t) => [t.id, t]));
  const groups = new Map();

  for (const task of tasks) {
    const parentId = parseParentId(task.body);
    const parentTicket = parentId != null ? ticketById.get(parentId) : null;
    const labels = parentTicket?.labels ?? [];

    // STRICT TYPE CHECKING
    const isStory = labels.includes(TYPE_LABELS.STORY);
    const isFeature = labels.includes(TYPE_LABELS.FEATURE);

    // Determine the grouping key and type
    let key = '__ungrouped__';
    let type = 'ungrouped';
    let title = '(Ungrouped Tasks)';

    if (isStory) {
      key = parentId;
      type = 'story';
      title = parentTicket.title;
    } else if (isFeature) {
      // NOTE: Tasks SHOULD belong to Stories, which belong to Features.
      // If a task belongs directly to a Feature, we group it as a Feature.
      key = parentId;
      type = 'feature';
      title = parentTicket.title;
    }

    if (!groups.has(key)) {
      groups.set(key, {
        storyId: key,
        storyTitle: title,
        storyLabels: isStory || isFeature ? labels : [],
        type,
        tasks: [],
      });
    }
    groups.get(key).tasks.push(task);
  }

  return groups;
}
