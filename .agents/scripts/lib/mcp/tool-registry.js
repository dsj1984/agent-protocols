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

// Shared field schemas — inlining these would repeat the same shape seven
// times. Declaring once keeps the per-tool entries focused on the fields
// that actually differ between tools.
const INTEGER_ID = { type: 'integer', minimum: 1 };
const NONEMPTY_STRING = { type: 'string', minLength: 1 };
const GITHUB_TOKEN_FIELD = {
  ...NONEMPTY_STRING,
  description: 'Optional GitHub PAT. Overrides environment variables.',
};
const NEW_STATE_FIELD = {
  type: 'string',
  enum: [
    AGENT_LABELS.READY,
    AGENT_LABELS.EXECUTING,
    AGENT_LABELS.REVIEW,
    AGENT_LABELS.DONE,
  ],
  description: 'Target state label.',
};

function dispatchWaveTool(sdk, getProvider) {
  return {
    name: 'dispatch_wave',
    description:
      'Dispatch the next ready wave of Tasks for an Epic, OR execute tasks for a Story. Automatically detects ticket type from labels. Set dryRun=true for a status view without side-effects.',
    inputSchema: {
      properties: {
        epicId: {
          ...INTEGER_ID,
          description:
            'The GitHub issue number of the Epic or Story to process.',
        },
        dryRun: {
          type: 'boolean',
          description:
            'If true, compute and return the manifest without transitioning ticket states.',
        },
        githubToken: GITHUB_TOKEN_FIELD,
      },
      required: ['epicId'],
      additionalProperties: false,
    },
    outputSchemaRef: '.agents/schemas/dispatch-manifest.json',
    handler: async ({ epicId, dryRun = false, githubToken }) => {
      const provider = getProvider(githubToken);
      return sdk.resolveAndDispatch({ ticketId: epicId, dryRun, provider });
    },
  };
}

function hydrateContextTool(sdk, getProvider) {
  return {
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
            id: INTEGER_ID,
            title: NONEMPTY_STRING,
          },
          required: ['id', 'title'],
        },
        epicBranch: {
          ...NONEMPTY_STRING,
          description: 'The Epic base branch name, e.g. "epic/71".',
        },
        taskBranch: {
          ...NONEMPTY_STRING,
          description:
            'The task/story branch name, e.g. "story/epic-71/my-story".',
        },
        epicId: { ...INTEGER_ID, description: 'The Epic issue number.' },
        githubToken: GITHUB_TOKEN_FIELD,
      },
      required: ['task', 'epicId'],
      additionalProperties: false,
    },
    outputSchemaRef: null,
    handler: async ({ task, epicBranch, taskBranch, epicId, githubToken }) => {
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
  };
}

function transitionTicketStateTool(sdk, getProvider) {
  return {
    name: 'transition_ticket_state',
    description:
      'Transition a ticket to a new agent state label (agent::ready, agent::executing, agent::review, agent::done). Automatically closes/reopens the issue to match.',
    inputSchema: {
      properties: {
        ticketId: {
          ...INTEGER_ID,
          description: 'The GitHub issue number to update.',
        },
        newState: NEW_STATE_FIELD,
        githubToken: GITHUB_TOKEN_FIELD,
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
  };
}

function cascadeCompletionTool(sdk, getProvider) {
  return {
    name: 'cascade_completion',
    description:
      'Recursively propagate ticket completion upward through the hierarchy. If all children of a parent are done, the parent is also marked done and the cascade continues.',
    inputSchema: {
      properties: {
        ticketId: {
          ...INTEGER_ID,
          description: 'The completed ticket to cascade from.',
        },
        githubToken: GITHUB_TOKEN_FIELD,
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
  };
}

function postStructuredCommentTool(sdk, getProvider) {
  const enumeratedTypes = [...sdk.STRUCTURED_COMMENT_TYPES];
  const joinedTypes = enumeratedTypes.join(', ');
  const wavePatternRe = sdk.WAVE_TYPE_PATTERN;
  return {
    name: 'post_structured_comment',
    description:
      'Idempotently upsert a structured comment on a ticket. Accepted types: ' +
      `${joinedTypes}, or any value matching the wave pattern ${wavePatternRe} ` +
      '(e.g. wave-0-start, wave-1-end). Existing comments with the same type ' +
      'marker are replaced, so repeated calls never create duplicates.',
    inputSchema: {
      properties: {
        ticketId: {
          ...INTEGER_ID,
          description: 'The GitHub issue number to comment on.',
        },
        type: {
          type: 'string',
          description: `Structured-comment type. Must be one of the enumerated types (${joinedTypes}) or match the wave pattern ${wavePatternRe}.`,
          oneOf: [{ enum: enumeratedTypes }, { pattern: wavePatternRe.source }],
        },
        payload: {
          ...NONEMPTY_STRING,
          description: 'The comment body text (markdown).',
        },
        githubToken: GITHUB_TOKEN_FIELD,
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
  };
}

function selectAuditsTool(getProvider, selectAudits) {
  return {
    name: 'select_audits',
    description:
      'Analyzes ticket content and file changes to determine which audits to run based on audit-rules.schema.json.',
    inputSchema: {
      properties: {
        ticketId: {
          ...INTEGER_ID,
          description: 'The GitHub issue number to evaluate.',
        },
        gate: {
          ...NONEMPTY_STRING,
          description:
            'The current audit gate (e.g. gate1, gate2, gate3, gate4).',
        },
        githubToken: GITHUB_TOKEN_FIELD,
        baseBranch: {
          ...NONEMPTY_STRING,
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
  };
}

function runAuditSuiteTool(runAuditSuite) {
  return {
    name: 'run_audit_suite',
    description:
      'Executes a list of audit workflows and aggregates their results into a standard JSON format.',
    inputSchema: {
      properties: {
        auditWorkflows: {
          type: 'array',
          minItems: 1,
          items: NONEMPTY_STRING,
          description:
            'List of audit workflow names to execute (e.g. ["audit-clean-code"]).',
        },
        substitutions: {
          type: 'object',
          description:
            'Optional map of template placeholders ({{key}}) to values applied to each workflow body. Allowed keys are the built-ins (auditOutputDir, ticketId, baseBranch) plus any substitutionKeys declared on the requested audits in audit-rules.schema.json. Unknown keys are rejected.',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['auditWorkflows'],
      additionalProperties: false,
    },
    outputSchemaRef: '.agents/schemas/audit-results.schema.json',
    handler: async ({ auditWorkflows, substitutions }) => {
      return runAuditSuite({ auditWorkflows, substitutions });
    },
  };
}

export async function getToolRegistry(sdk, getProvider) {
  const { selectAudits } = await import('../../mcp/select-audits.js');
  const { runAuditSuite } = await import('../../mcp/run-audit-suite.js');

  return [
    dispatchWaveTool(sdk, getProvider),
    hydrateContextTool(sdk, getProvider),
    transitionTicketStateTool(sdk, getProvider),
    cascadeCompletionTool(sdk, getProvider),
    postStructuredCommentTool(sdk, getProvider),
    selectAuditsTool(getProvider, selectAudits),
    runAuditSuiteTool(runAuditSuite),
  ];
}
