/**
 * Central source of truth for all GitHub label names used by the orchestrator.
 *
 * Every other module (label-taxonomy, dispatch-engine, sprint-story-close,
 * etc.) should import from here rather than using string literals. Renames
 * land in one place.
 */

export const AGENT_LABELS = {
  READY: 'agent::ready',
  EXECUTING: 'agent::executing',
  REVIEW: 'agent::review',
  DONE: 'agent::done',
};

export const TYPE_LABELS = {
  EPIC: 'type::epic',
  FEATURE: 'type::feature',
  STORY: 'type::story',
  TASK: 'type::task',
};

export const STATUS_LABELS = {
  BLOCKED: 'status::blocked',
};

export const RISK_LABELS = {
  HIGH: 'risk::high',
  MEDIUM: 'risk::medium',
};

export const PERSONA_LABELS = {
  FULLSTACK: 'persona::fullstack',
  ARCHITECT: 'persona::architect',
  QA: 'persona::qa',
};

export const CONTEXT_LABELS = {
  PRD: 'context::prd',
  TECH_SPEC: 'context::tech-spec',
};

export const EXECUTION_LABELS = {
  SEQUENTIAL: 'execution::sequential',
  CONCURRENT: 'execution::concurrent',
};

export const FOCUS_LABELS = {
  CORE: 'focus::core',
  SCRIPTS: 'focus::scripts',
  DOCS: 'focus::docs',
  CI: 'focus::ci',
  TESTS: 'focus::tests',
};

/** Palette for the taxonomy; consumed by label-taxonomy.js. */
export const LABEL_COLORS = {
  TYPE: '#7057FF',
  AGENT: '#0E8A16',
  STATUS_BLOCKED: '#D93F0B',
  RISK: '#FBCA04',
  PERSONA: '#C5DEF5',
  CONTEXT: '#D4C5F9',
  EXECUTION: '#F9D0C4',
  FOCUS: '#BFD4F2',
};
