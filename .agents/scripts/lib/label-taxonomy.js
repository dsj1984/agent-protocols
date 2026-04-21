/**
 * Shared data structures for GitHub labels and custom fields.
 * Used by the bootstrap script to idempotently configure the project.
 *
 * All label names are sourced from `label-constants.js` so renames only need
 * to happen in one place. Colors come from `LABEL_COLORS` in the same module.
 */

import {
  AGENT_LABELS,
  CONTEXT_LABELS,
  EPIC_LABELS,
  EXECUTION_LABELS,
  LABEL_COLORS,
  PERSONA_LABELS,
  RISK_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
} from './label-constants.js';

/** @type {Array<{ name: string, color: string, description: string }>} */
export const LABEL_TAXONOMY = [
  // Type
  {
    name: TYPE_LABELS.EPIC,
    color: LABEL_COLORS.TYPE,
    description: 'Epic-level work item',
  },
  {
    name: TYPE_LABELS.FEATURE,
    color: LABEL_COLORS.TYPE,
    description: 'Feature under an Epic',
  },
  {
    name: TYPE_LABELS.STORY,
    color: LABEL_COLORS.TYPE,
    description: 'User story under a Feature',
  },
  {
    name: TYPE_LABELS.TASK,
    color: LABEL_COLORS.TYPE,
    description: 'Implementable task',
  },

  // Agent State
  {
    name: AGENT_LABELS.READY,
    color: LABEL_COLORS.AGENT,
    description: 'Ready for agent pickup',
  },
  {
    name: AGENT_LABELS.EXECUTING,
    color: LABEL_COLORS.AGENT,
    description: 'Agent is working on this',
  },
  {
    name: AGENT_LABELS.REVIEW,
    color: LABEL_COLORS.AGENT,
    description: 'Awaiting human review',
  },
  {
    name: AGENT_LABELS.DONE,
    color: LABEL_COLORS.AGENT,
    description: 'Agent work completed',
  },
  {
    name: AGENT_LABELS.DISPATCHING,
    color: LABEL_COLORS.AGENT,
    description:
      'Trigger — remote orchestrator picks up and flips to executing',
  },

  // Epic modifiers
  {
    name: EPIC_LABELS.AUTO_CLOSE,
    color: LABEL_COLORS.EPIC,
    description: 'Opt-in — autonomous review → retro → close + merge-to-main',
  },

  // Status
  {
    name: STATUS_LABELS.BLOCKED,
    color: LABEL_COLORS.STATUS_BLOCKED,
    description: 'Blocked by a dependency',
  },

  // Risk
  {
    name: RISK_LABELS.HIGH,
    color: LABEL_COLORS.RISK,
    description: 'High-risk change',
  },
  {
    name: RISK_LABELS.MEDIUM,
    color: LABEL_COLORS.RISK,
    description: 'Medium-risk change',
  },

  // Persona
  {
    name: PERSONA_LABELS.FULLSTACK,
    color: LABEL_COLORS.PERSONA,
    description: 'Fullstack engineer persona',
  },
  {
    name: PERSONA_LABELS.ARCHITECT,
    color: LABEL_COLORS.PERSONA,
    description: 'Architect persona',
  },
  {
    name: PERSONA_LABELS.QA,
    color: LABEL_COLORS.PERSONA,
    description: 'QA engineer persona',
  },

  // Context
  {
    name: CONTEXT_LABELS.PRD,
    color: LABEL_COLORS.CONTEXT,
    description: 'Product Requirements Document',
  },
  {
    name: CONTEXT_LABELS.TECH_SPEC,
    color: LABEL_COLORS.CONTEXT,
    description: 'Technical Specification',
  },

  // Execution
  {
    name: EXECUTION_LABELS.SEQUENTIAL,
    color: LABEL_COLORS.EXECUTION,
    description: 'Must execute sequentially',
  },
  {
    name: EXECUTION_LABELS.CONCURRENT,
    color: LABEL_COLORS.EXECUTION,
    description: 'Can execute concurrently',
  },
];

/** @type {Array<{ name: string, type: 'iteration'|'single_select', options?: string[] }>} */
export const PROJECT_FIELD_DEFS = [
  { name: 'Sprint', type: 'iteration' },
  {
    name: 'Execution',
    type: 'single_select',
    options: ['sequential', 'concurrent'],
  },
];
