/**
 * Shared data structures for GitHub labels and custom fields.
 * Used by the bootstrap script to idempotently configure the project.
 */

/** @type {Array<{ name: string, color: string, description: string }>} */
export const LABEL_TAXONOMY = [
  // Type
  { name: 'type::epic', color: '#7057FF', description: 'Epic-level work item' },
  {
    name: 'type::feature',
    color: '#7057FF',
    description: 'Feature under an Epic',
  },
  {
    name: 'type::story',
    color: '#7057FF',
    description: 'User story under a Feature',
  },
  { name: 'type::task', color: '#7057FF', description: 'Implementable task' },

  // Agent State
  {
    name: 'agent::ready',
    color: '#0E8A16',
    description: 'Ready for agent pickup',
  },
  {
    name: 'agent::executing',
    color: '#0E8A16',
    description: 'Agent is working on this',
  },
  {
    name: 'agent::review',
    color: '#0E8A16',
    description: 'Awaiting human review',
  },
  {
    name: 'agent::done',
    color: '#0E8A16',
    description: 'Agent work completed',
  },

  // Status
  {
    name: 'status::blocked',
    color: '#D93F0B',
    description: 'Blocked by a dependency',
  },

  // Risk
  { name: 'risk::high', color: '#FBCA04', description: 'High-risk change' },
  { name: 'risk::medium', color: '#FBCA04', description: 'Medium-risk change' },

  // Persona
  {
    name: 'persona::fullstack',
    color: '#C5DEF5',
    description: 'Fullstack engineer persona',
  },
  {
    name: 'persona::architect',
    color: '#C5DEF5',
    description: 'Architect persona',
  },
  { name: 'persona::qa', color: '#C5DEF5', description: 'QA engineer persona' },

  // Context
  {
    name: 'context::prd',
    color: '#D4C5F9',
    description: 'Product Requirements Document',
  },
  {
    name: 'context::tech-spec',
    color: '#D4C5F9',
    description: 'Technical Specification',
  },

  // Execution
  {
    name: 'execution::sequential',
    color: '#F9D0C4',
    description: 'Must execute sequentially',
  },
  {
    name: 'execution::concurrent',
    color: '#F9D0C4',
    description: 'Can execute concurrently',
  },

  // Focus Area
  {
    name: 'focus::core',
    color: '#BFD4F2',
    description: 'Core library changes',
  },
  {
    name: 'focus::scripts',
    color: '#BFD4F2',
    description: 'Script/tooling changes',
  },
  {
    name: 'focus::docs',
    color: '#BFD4F2',
    description: 'Documentation changes',
  },
  {
    name: 'focus::ci',
    color: '#BFD4F2',
    description: 'CI/CD pipeline changes',
  },
  { name: 'focus::tests', color: '#BFD4F2', description: 'Test suite changes' },

  // Visibility
  {
    name: 'roadmap-exclude',
    color: '#000000',
    description: 'Exclude from automated roadmap',
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
  {
    name: 'Focus Area',
    type: 'single_select',
    options: ['core', 'scripts', 'docs', 'ci', 'tests'],
  },
];
