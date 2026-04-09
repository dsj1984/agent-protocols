import { detectCycle } from '../Graph.js';

/**
 * Validates the generated ticket hierarchy and handles lifting cross-story dependencies.
 *
 * @param {object[]} tickets - Array of ticket objects parsed from LLM output.
 * @returns {object[]} Validated tickets with normalized dependencies.
 */
export function validateAndNormalizeTickets(tickets) {
  const ticketBySlug = new Map(tickets.map((t) => [t.slug, t]));
  const features = tickets.filter((t) => t.type === 'feature');
  const stories = tickets.filter((t) => t.type === 'story');
  const tasks = tickets.filter((t) => t.type === 'task');

  if (features.length === 0)
    throw new Error(
      'Cross-Validation Failed: Backlog must contain at least one Feature.',
    );
  if (stories.length === 0)
    throw new Error(
      'Cross-Validation Failed: Backlog must contain at least one Story.',
    );
  if (tasks.length === 0)
    throw new Error(
      'Cross-Validation Failed: Backlog must contain at least one Task.',
    );

  // Validate hierarchy
  for (const story of stories) {
    if (!story.parent_slug)
      throw new Error(
        `Cross-Validation Failed: Story "${story.title}" must have a parent_slug.`,
      );
    const parent = ticketBySlug.get(story.parent_slug);
    if (!parent || parent.type !== 'feature')
      throw new Error(
        `Cross-Validation Failed: Story "${story.title}" parent must be a Feature.`,
      );

    // Complexity validation (New in Story-Level Branching)
    const hasComplexity = (story.labels || []).some((l) =>
      l.startsWith('complexity::'),
    );
    if (!hasComplexity) {
      throw new Error(
        `Cross-Validation Failed: Story "${story.title}" is missing a complexity label (complexity::high|fast).`,
      );
    }
  }

  for (const task of tasks) {
    if (!task.parent_slug)
      throw new Error(
        `Cross-Validation Failed: Task "${task.title}" must have a parent_slug.`,
      );
    const parent = ticketBySlug.get(task.parent_slug);
    if (!parent || parent.type !== 'story') {
      throw new Error(
        `Cross-Validation Failed: Task "${task.title}" parent must be a Story.`,
      );
    }
  }

  // ── Cross-story task dependency validation ─────────────────────────────
  // Tasks must only depend on other tasks within the same story.
  // If a cross-story task dep is found, auto-lift it to a story-level dep.
  const crossStoryLifted = [];
  for (const task of tasks) {
    if (!task.depends_on || task.depends_on.length === 0) continue;
    const taskStory = task.parent_slug;

    const keptDeps = [];
    for (const depSlug of task.depends_on) {
      const depTicket = ticketBySlug.get(depSlug);
      if (!depTicket) {
        keptDeps.push(depSlug); // unknown slug, keep and let cycle check handle
        continue;
      }

      // Only check task→task cross-story deps
      if (depTicket.type !== 'task') {
        keptDeps.push(depSlug);
        continue;
      }

      const depStory = depTicket.parent_slug;
      if (depStory !== taskStory) {
        // Cross-story task dep found — lift to story-level
        const myStory = ticketBySlug.get(taskStory);
        if (myStory) {
          if (!myStory.depends_on) myStory.depends_on = [];
          if (!myStory.depends_on.includes(depStory)) {
            myStory.depends_on.push(depStory);
            crossStoryLifted.push({
              task: task.slug,
              dep: depSlug,
              fromStory: taskStory,
              toStory: depStory,
            });
          }
        }
        // Remove the cross-story task dep (don't keep it)
      } else {
        keptDeps.push(depSlug);
      }
    }
    task.depends_on = keptDeps;
  }

  if (crossStoryLifted.length > 0) {
    console.warn(
      `[Decomposer] ⚠️  Lifted ${crossStoryLifted.length} cross-story task dep(s) to story-level:`,
    );
    for (const lift of crossStoryLifted) {
      console.warn(
        `  Task "${lift.task}" → dep "${lift.dep}" lifted to Story "${lift.fromStory}" → Story "${lift.toStory}"`,
      );
    }
  }

  // Acyclic dependency check
  const slugAdjacency = new Map(
    tickets.map((t) => [t.slug, t.depends_on ?? []]),
  );
  const cycle = detectCycle(slugAdjacency);
  if (cycle) {
    throw new Error(
      `Cross-Validation Failed: Circular dependency detected: ${cycle.join(' → ')}.`,
    );
  }

  return tickets;
}
