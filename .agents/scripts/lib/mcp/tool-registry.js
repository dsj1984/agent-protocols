/**
 * @file tool-registry.js
 * Definitions and handlers for MCP server tools.
 *
 * Each entry carries a tightened JSON Schema (AC-02) — required fields,
 * integer-with-minimum-1 for id fields, enums where the domain is finite,
 * and additionalProperties:false so stray keys are rejected with -32602
 * rather than silently ignored. Each entry also carries an
 * `outputSchemaRef` (AC-13) — either a repo-relative path to the schema
 * describing the tool's structured output, or `null` when the tool returns
 * free-form text / a trivial ack.
 */

import { AGENT_LABELS } from '../label-constants.js';

export async function getToolRegistry(sdk, getProvider) {
  const { selectAudits } = await import('../../mcp/select-audits.js');
  const { runAuditSuite } = await import('../../mcp/run-audit-suite.js');

  return [
    {
      name: 'dispatch_wave',
      description:
        'Dispatch the next ready wave of Tasks for an Epic, OR execute tasks for a Story. Automatically detects ticket type from labels. Set dryRun=true for a status view without side-effects.',
      inputSchema: {
        properties: {
          epicId: {
            type: 'integer',
            minimum: 1,
            description:
              'The GitHub issue number of the Epic or Story to process.',
          },
          dryRun: {
            type: 'boolean',
            description:
              'If true, compute and return the manifest without transitioning ticket states.',
          },
          githubToken: {
            type: 'string',
            minLength: 1,
            description:
              'Optional GitHub PAT. Overrides environment variables.',
          },
        },
        required: ['epicId'],
        additionalProperties: false,
      },
      outputSchemaRef: '.agents/schemas/dispatch-manifest.json',
      handler: async ({ epicId, dryRun = false, githubToken }) => {
        const provider = getProvider(githubToken);
        return sdk.resolveAndDispatch({ ticketId: epicId, dryRun, provider });
      },
    },
    {
      name: 'hydrate_context',
      description:
        'Build the full execution prompt for a Task by assembling persona, skills, hierarchy context, and the agent protocol template.',
      inputSchema: {
        properties: {
          task: {
            type: 'object',
            description:
              'The normalized task object (id, title, body, persona, skills, protocolVersion).',
            properties: {
              id: { type: 'integer', minimum: 1 },
              title: { type: 'string', minLength: 1 },
            },
            required: ['id', 'title'],
          },
          epicBranch: {
            type: 'string',
            minLength: 1,
            description: 'The Epic base branch name, e.g. "epic/71".',
          },
          taskBranch: {
            type: 'string',
            minLength: 1,
            description:
              'The task/story branch name, e.g. "story/epic-71/my-story".',
          },
          epicId: {
            type: 'integer',
            minimum: 1,
            description: 'The Epic issue number.',
          },
          githubToken: {
            type: 'string',
            minLength: 1,
            description:
              'Optional GitHub PAT. Overrides environment variables.',
          },
        },
        required: ['task', 'epicId'],
        additionalProperties: false,
      },
      outputSchemaRef: null,
      handler: async ({
        task,
        epicBranch,
        taskBranch,
        epicId,
        githubToken,
      }) => {
        const provider = getProvider(githubToken);
        const prompt = await sdk.hydrateContext(
          task,
          provider,
          epicBranch,
          taskBranch,
          epicId,
        );
        return { prompt };
      },
    },
    {
      name: 'transition_ticket_state',
      description:
        'Transition a ticket to a new agent state label (agent::ready, agent::executing, agent::review, agent::done). Automatically closes/reopens the issue to match.',
      inputSchema: {
        properties: {
          ticketId: {
            type: 'integer',
            minimum: 1,
            description: 'The GitHub issue number to update.',
          },
          newState: {
            type: 'string',
            enum: [
              AGENT_LABELS.READY,
              AGENT_LABELS.EXECUTING,
              AGENT_LABELS.REVIEW,
              AGENT_LABELS.DONE,
            ],
            description: 'Target state label.',
          },
          githubToken: {
            type: 'string',
            minLength: 1,
            description:
              'Optional GitHub PAT. Overrides environment variables.',
          },
        },
        required: ['ticketId', 'newState'],
        additionalProperties: false,
      },
      outputSchemaRef: null,
      handler: async ({ ticketId, newState, githubToken }) => {
        const provider = getProvider(githubToken);
        await sdk.transitionTicketState(provider, ticketId, newState);
        return { success: true, ticketId, newState };
      },
    },
    {
      name: 'cascade_completion',
      description:
        'Recursively propagate ticket completion upward through the hierarchy. If all children of a parent are done, the parent is also marked done and the cascade continues.',
      inputSchema: {
        properties: {
          ticketId: {
            type: 'integer',
            minimum: 1,
            description: 'The completed ticket to cascade from.',
          },
          githubToken: {
            type: 'string',
            minLength: 1,
            description:
              'Optional GitHub PAT. Overrides environment variables.',
          },
        },
        required: ['ticketId'],
        additionalProperties: false,
      },
      outputSchemaRef: null,
      handler: async ({ ticketId, githubToken }) => {
        const provider = getProvider(githubToken);
        await sdk.cascadeCompletion(provider, ticketId);
        return { success: true, ticketId };
      },
    },
    {
      name: 'post_structured_comment',
      description:
        'Idempotently upsert a structured comment on a ticket. Accepted types: ' +
        `${sdk.STRUCTURED_COMMENT_TYPES.join(', ')}, or any value matching the ` +
        `wave pattern ${sdk.WAVE_TYPE_PATTERN} (e.g. wave-0-start, wave-1-end). ` +
        'Existing comments with the same type marker are replaced, so repeated ' +
        'calls never create duplicates.',
      inputSchema: {
        properties: {
          ticketId: {
            type: 'integer',
            minimum: 1,
            description: 'The GitHub issue number to comment on.',
          },
          type: {
            type: 'string',
            description:
              'Structured-comment type. Must be one of the enumerated types ' +
              `(${sdk.STRUCTURED_COMMENT_TYPES.join(', ')}) or match the wave ` +
              `pattern ${sdk.WAVE_TYPE_PATTERN}.`,
            oneOf: [
              { enum: [...sdk.STRUCTURED_COMMENT_TYPES] },
              { pattern: sdk.WAVE_TYPE_PATTERN.source },
            ],
          },
          payload: {
            type: 'string',
            minLength: 1,
            description: 'The comment body text (markdown).',
          },
          githubToken: {
            type: 'string',
            minLength: 1,
            description:
              'Optional GitHub PAT. Overrides environment variables.',
          },
        },
        required: ['ticketId', 'type', 'payload'],
        additionalProperties: false,
      },
      outputSchemaRef: null,
      handler: async ({ ticketId, type, payload, githubToken }) => {
        sdk.assertValidStructuredCommentType(type);
        const provider = getProvider(githubToken);
        await sdk.upsertStructuredComment(provider, ticketId, type, payload);
        return { success: true, ticketId, type };
      },
    },
    {
      name: 'select_audits',
      description:
        'Analyzes ticket content and file changes to determine which audits to run based on audit-rules.schema.json.',
      inputSchema: {
        properties: {
          ticketId: {
            type: 'integer',
            minimum: 1,
            description: 'The GitHub issue number to evaluate.',
          },
          gate: {
            type: 'string',
            minLength: 1,
            description:
              'The current audit gate (e.g. gate1, gate2, gate3, gate4).',
          },
          githubToken: {
            type: 'string',
            minLength: 1,
            description:
              'Optional GitHub PAT. Overrides environment variables.',
          },
          baseBranch: {
            type: 'string',
            minLength: 1,
            description: 'The base branch to diff against, defaults to "main".',
          },
        },
        required: ['ticketId', 'gate'],
        additionalProperties: false,
      },
      outputSchemaRef: null,
      handler: async ({ ticketId, gate, githubToken, baseBranch = 'main' }) => {
        const provider = getProvider(githubToken);
        return selectAudits({ ticketId, gate, provider, baseBranch });
      },
    },
    {
      name: 'run_audit_suite',
      description:
        'Executes a list of audit workflows and aggregates their results into a standard JSON format.',
      inputSchema: {
        properties: {
          auditWorkflows: {
            type: 'array',
            minItems: 1,
            items: { type: 'string', minLength: 1 },
            description:
              'List of audit workflow names to execute (e.g. ["audit-clean-code"]).',
          },
        },
        required: ['auditWorkflows'],
        additionalProperties: false,
      },
      outputSchemaRef: '.agents/schemas/audit-results.schema.json',
      handler: async ({ auditWorkflows }) => {
        return runAuditSuite({ auditWorkflows });
      },
    },
  ];
}
