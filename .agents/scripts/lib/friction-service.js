// friction-service.js
import { Logger } from './Logger.js';

export class FrictionService {
  /**
   * @param {import('./ITicketingProvider.js').ITicketingProvider} provider
   */
  constructor(provider) {
    this.provider = provider;
  }

  /**
   * Ingest structured friction log comments from completed task issues.
   *
   * @param {number} epicId - Limit ingestion to a specific Epic's tasks.
   * @returns {Promise<Array<object>>}
   */
  async ingestFrictionLogs(epicId) {
    Logger.debug(`[FrictionService] Fetching tasks for Epic #${epicId}...`);
    const tasks = await this.provider.getTickets(epicId, {
      label: 'type::task',
    });

    // We analyze friction only for tasks that actually encountered friction.
    Logger.debug(
      `[FrictionService] Found ${tasks.length} tasks in Epic #${epicId}. Fetching comments...`,
    );

    const frictionLogs = await this.parseFrictionLogsForTasks(tasks);

    for (const log of frictionLogs) {
      if (!log.sprintId) log.sprintId = epicId.toString();
    }

    Logger.info(
      `[FrictionService] Ingested ${frictionLogs.length} friction events.`,
    );
    return frictionLogs;
  }

  /**
   * Parse structured friction logs from a given array of tasks.
   *
   * @param {Array<{id: number}>} tasks
   * @returns {Promise<Array<object>>}
   */
  async parseFrictionLogsForTasks(tasks) {
    const frictionLogs = [];

    // Fetch comments concurrently for all tasks to optimize network I/O
    const tasksWithComments = await Promise.all(
      tasks.map(async (task) => {
        const comments = await this.provider.getTicketComments(task.id);
        return { task, comments };
      }),
    );

    for (const { task, comments } of tasksWithComments) {
      for (const comment of comments) {
        if (!comment.body) continue;

        // Structured comments look like: <!-- structured-comment{"type":"friction"} -->\n```json\n{...}\n```
        if (
          comment.body.includes(
            '<!-- structured-comment{"type":"friction"} -->',
          )
        ) {
          const jsonMatch = comment.body.match(/```json\s*\n([\s\S]+?)\n```/);
          if (jsonMatch?.[1]) {
            try {
              const parsed = JSON.parse(jsonMatch[1]);
              // Add some extra context if missing
              if (!parsed.taskId) parsed.taskId = task.id;
              frictionLogs.push(parsed);
            } catch (err) {
              Logger.warn(
                `[FrictionService] Failed to parse friction log on task #${task.id}: ${err.message}`,
              );
            }
          }
        }
      }
    }

    return frictionLogs;
  }

  /**
   * Classify ingested friction logs into actionable patterns.
   * Heuristics: Group by category and protocolFile context.
   *
   * @param {Array<object>} frictionLogs
   * @returns {Array<{
   *   patternId: string,
   *   category: string,
   *   protocolFile: string | null,
   *   eventCount: number,
   *   events: Array<object>,
   *   summary: string
   * }>}
   */
  classifyPatterns(frictionLogs) {
    const patternsMap = new Map();

    for (const log of frictionLogs) {
      const category = log.category || 'Unknown';
      const protocolFile = log.context?.protocolFile || null;

      // Use category and protocolFile as the grouping key
      const key = `${category}::${protocolFile || 'global'}`;

      if (!patternsMap.has(key)) {
        patternsMap.set(key, {
          patternId: key,
          category,
          protocolFile,
          eventCount: 0,
          events: [],
          summary:
            `Recurring friction pattern in category: ${category}` +
            (protocolFile ? ` related to protocol file: ${protocolFile}` : ''),
        });
      }

      const pattern = patternsMap.get(key);
      pattern.events.push(log);
      pattern.eventCount++;
    }

    // Sort patterns by frequency descending
    const patterns = Array.from(patternsMap.values());
    patterns.sort((a, b) => b.eventCount - a.eventCount);

    Logger.info(
      `[FrictionService] Classified into ${patterns.length} unique friction patterns.`,
    );

    return patterns;
  }
}
