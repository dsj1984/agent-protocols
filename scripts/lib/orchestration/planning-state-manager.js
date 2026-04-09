/**
 * @file planning-state-manager.js
 * Extracted state-healing and artifact idempotency logic for epic planning.
 */

export class PlanningStateManager {
  constructor(provider) {
    this.provider = provider;
  }

  /**
   * Resolves existing planning artifacts and heals links if needed.
   * Returns the IDs of the PRD and Tech Spec, cleaning up redundant ones.
   */
  async healAndCleanupArtifacts(epic, force = false) {
    const epicId = epic.id;
    const relatedTickets = await this.provider.getTickets(epicId);
    const existingPrds = relatedTickets.filter(
      (t) => t.labels.includes('context::prd') && t.state === 'open',
    );
    const existingSpecs = relatedTickets.filter(
      (t) => t.labels.includes('context::tech-spec') && t.state === 'open',
    );

    // Heal linkedIssues if empty but tickets exist
    if (!epic.linkedIssues.prd && existingPrds.length > 0) {
      epic.linkedIssues.prd = existingPrds[0].id;
      console.log(
        `[Epic Planner] Healed dangling PRD reference: #${epic.linkedIssues.prd}`,
      );
    }
    if (!epic.linkedIssues.techSpec && existingSpecs.length > 0) {
      epic.linkedIssues.techSpec = existingSpecs[0].id;
      console.log(
        `[Epic Planner] Healed dangling Tech Spec reference: #${epic.linkedIssues.techSpec}`,
      );
    }

    // Cleanup duplicates (redundant open PRDs/Specs)
    const redundant = [
      ...existingPrds.slice(epic.linkedIssues.prd ? 1 : 0),
      ...existingSpecs.slice(epic.linkedIssues.techSpec ? 1 : 0),
    ];

    for (const t of redundant) {
      const successorId = t.labels.includes('context::prd')
        ? epic.linkedIssues.prd
        : epic.linkedIssues.techSpec;
      console.log(
        `[Epic Planner] Closing redundant duplicate artifact #${t.id} (superseded by #${successorId})...`,
      );
      try {
        await this.provider.postComment(t.id, {
          type: 'notification',
          body: `⚠️ **Audit Trace**: This planning artifact was created during an interrupted or failed orchestration run and is now **superseded by #${successorId}**. \n\nClosing this issue to maintain a single source of truth for Epic #${epicId}.`,
        });
      } catch (_err) {
        // Ignore comment failures
      }
      await this.provider.updateTicket(t.id, {
        state: 'closed',
        state_reason: 'not_planned',
      });
    }

    // Persist healed references to the body if needed.
    if (
      !force &&
      epic.linkedIssues.prd &&
      epic.linkedIssues.techSpec &&
      !epic.body.includes('## Planning Artifacts')
    ) {
      console.log(
        `[Epic Planner] Persisting healed references to Epic body...`,
      );
      const appendBody = `\n\n## Planning Artifacts\n- [ ] PRD: #${epic.linkedIssues.prd}\n- [ ] Tech Spec: #${epic.linkedIssues.techSpec}\n`;
      await this.provider.updateTicket(epicId, {
        body: epic.body + appendBody,
      });
      epic.body += appendBody;
    }

    // Force re-plan: close ALL old planning artifacts and strip body
    if (force) {
      const idsToClose = new Set(
        [epic.linkedIssues.prd, epic.linkedIssues.techSpec].filter(Boolean),
      );
      for (const t of [...existingPrds, ...existingSpecs]) {
        idsToClose.add(t.id);
      }

      if (idsToClose.size > 0) {
        console.log(
          '[Epic Planner] --force: Closing old planning artifacts...',
        );
        for (const oldId of idsToClose) {
          try {
            await this.provider.updateTicket(oldId, {
              state: 'closed',
              state_reason: 'not_planned',
            });
            console.log(`[Epic Planner]   Closed old artifact #${oldId}`);
          } catch (err) {
            if (err.message.includes('404') || err.message.includes('410')) {
              console.log(
                `[Epic Planner]   Old artifact #${oldId} was already removed or is inaccessible. Skipping.`,
              );
            } else {
              throw err;
            }
          }
        }
      }

      const stripped = epic.body.replace(
        /\n*## Planning Artifacts[\s\S]*$/,
        '',
      );
      if (stripped !== epic.body) {
        await this.provider.updateTicket(epicId, { body: stripped });
        epic.body = stripped;
        console.log(
          '[Epic Planner]   Stripped old Planning Artifacts section from Epic body.',
        );
      }

      epic.linkedIssues.prd = null;
      epic.linkedIssues.techSpec = null;
    }
  }
}
