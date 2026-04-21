/**
 * lib/orchestration/telemetry.js
 * Extracted telemetry gathering to avoid duplication and excessive API hits.
 */

export async function fetchTelemetry(provider, tasks) {
  let totalFriction = 0;
  const recentFriction = [];
  try {
    const comments = await provider.getRecentComments(100);
    const taskIds = new Set(tasks.map((t) => t.id));
    for (const c of comments) {
      const issueUrlMatch = c.issue_url?.match(/\/issues\/(\d+)$/);
      if (issueUrlMatch) {
        const issueId = Number.parseInt(issueUrlMatch[1], 10);
        if (taskIds.has(issueId)) {
          const body = c.body || '';
          if (
            body.includes('⚠️ **Friction**') ||
            body.includes('[FRICTION]') ||
            body.includes('type: friction') ||
            body.includes('"eventId":')
          ) {
            totalFriction++;
            if (recentFriction.length < 5) {
              const msg = body
                .replace('⚠️ **Friction**', '')
                .replace('[FRICTION]', '')
                .trim();
              recentFriction.push({
                taskId: issueId,
                message:
                  msg.substring(0, 150) + (msg.length > 150 ? '...' : ''),
              });
            }
          }
        }
      }
    }
  } catch (_err) {
    // If not supported by provider, swallow gracefully
  }

  return { totalFriction, recentFriction };
}
