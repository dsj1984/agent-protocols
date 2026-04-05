/**
 * PlaybookOrchestrator.js
 *
 * Implements the Factory/Builder pattern for playbook generation.
 * Separates the four distinct phases of playbook generation:
 *   1. Parse  — Read & JSON-parse the task manifest from disk
 *   2. Validate — Enrich, validate schema, and check assets
 *   3. Build   — Compute the dependency graph, layers, and sessions
 *   4. Render  — Produce the final Markdown playbook string
 *
 * The CLI entry point in generate-playbook.js delegates entirely to this
 * class, keeping the executable free of business logic.
 */

import fs from 'node:fs';
import path from 'node:path';

import { buildGraph, detectCycle, assignLayers, transitiveReduction, computeChatDependencies, computeReachability } from './Graph.js';
import { renderPlaybook } from './Renderer.js';
import { ensureDirSync } from './fs-utils.js';
import { Logger } from './Logger.js';
import { analyzeAndSplit, loadComplexityConfig } from './ComplexityEstimator.js';

export class PlaybookOrchestrator {
  /**
   * @param {object} deps - Injected dependencies & configuration defaults.
   * @param {Function} deps.validateManifest
   * @param {Function} deps.enrichManifest
   * @param {Function} deps.validateAssets
   * @param {Function} deps.groupIntoChatSessions
   * @param {object}   deps.options - Runtime options (paths, padding, etc.)
   */
  constructor({ validateManifest, enrichManifest, validateAssets, groupIntoChatSessions, options = {} }) {
    this.validateManifest = validateManifest;
    this.enrichManifest = enrichManifest;
    this.validateAssets = validateAssets;
    this.groupIntoChatSessions = groupIntoChatSessions;
    this.options = options;
  }

  // -------------------------------------------------------------------------
  // Phase 1: Parse
  // -------------------------------------------------------------------------

  /**
   * Reads and parses a task-manifest.json from disk.
   * @param {string} manifestPath - Absolute path to task-manifest.json.
   * @returns {object} The parsed manifest object.
   */
  parse(manifestPath) {
    if (!fs.existsSync(manifestPath)) {
      Logger.fatal(`Manifest not found: ${manifestPath}\nCreate the task-manifest.json first, then run this script.`);
    }
    const raw = fs.readFileSync(manifestPath, 'utf8');
    try {
      return JSON.parse(raw);
    } catch (e) {
      Logger.fatal(`Failed to parse ${manifestPath}: ${e.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Phase 2: Validate
  // -------------------------------------------------------------------------

  /**
   * Enriches the manifest with defaults, validates the schema,
   * and emits asset warnings.
   * @param {object} manifest
   */
  validate(manifest) {
    // Inject protocol version if not already set
    if (!this.options.protocolVersion) {
      const versionPath = path.resolve(this.options.agentsDir || '', 'VERSION');
      try {
        this.options.protocolVersion = fs.readFileSync(versionPath, 'utf8').trim();
      } catch {
        this.options.protocolVersion = 'Unknown';
      }
    }

    this.enrichManifest(manifest);

    // Verify manifest version matches system version
    if (manifest.protocolVersion && this.options.protocolVersion !== 'Unknown' && manifest.protocolVersion !== this.options.protocolVersion) {
      console.warn(`\u26A0\uFE0F  Protocol version mismatch: Manifest uses v${manifest.protocolVersion}, but the system is running v${this.options.protocolVersion}.`);
      console.warn(`   Ensure all artifacts (PRD, Tech Spec) were generated with the correct version.`);
    }

    // Complexity analysis & auto-split
    const complexityConfig = loadComplexityConfig();
    const { splits, warnings: complexityWarnings } = analyzeAndSplit(manifest, complexityConfig);
    for (const msg of splits) {
      console.log(`\u{1F500} ${msg}`);
    }
    for (const msg of complexityWarnings) {
      console.warn(`\u26A0\uFE0F  ${msg}`);
    }

    const errors = this.validateManifest(manifest);
    if (errors.length > 0) {
      throw new Error(`Task manifest validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`);
    }

    if (this.options.agentsDir) {
      const warnings = this.validateAssets(manifest, this.options.agentsDir);
      for (const w of warnings) {
        console.warn(`⚠️  ${w}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Phase 3: Build Graph
  // -------------------------------------------------------------------------

  /**
   * Builds the dependency DAG, handles auto-serialization of overlapping tasks,
   * computes layers, groups sessions, applies transitive reduction, and resolves
   * cross-chat dependencies.
   * @param {object} manifest
   * @returns {{ chatSessions, chatDeps }}
   */
  build(manifest) {
    // Initial graph + cycle check
    const { adjacency } = buildGraph(manifest.tasks);
    const cycle = detectCycle(adjacency);
    if (cycle) {
      throw new Error(`Dependency cycle detected: ${cycle.join(' → ')}`);
    }

    // Auto-serialize concurrent overlapping focus areas
    // Phase A: scan all pairs and collect new edges — O(N²), no graph rebuilds inside.
    // Convert each task's focusAreas to a Set for O(1) intersection checks.
    const focusSets = new Map(
      manifest.tasks.map((t) => [
        t.id,
        new Set(Array.isArray(t.focusAreas) ? t.focusAreas : []),
      ])
    );

    let reachable = computeReachability(adjacency);
    const pendingEdges = []; // [ [fromId, toId], ... ]

    for (let i = 0; i < manifest.tasks.length; i++) {
      for (let j = i + 1; j < manifest.tasks.length; j++) {
        const taskA = manifest.tasks[i];
        const taskB = manifest.tasks[j];

        const setA = focusSets.get(taskA.id);
        const setB = focusSets.get(taskB.id);

        const isGlobalA = taskA.scope === 'root' || setA.has('*');
        const isGlobalB = taskB.scope === 'root' || setB.has('*');
        const overlap = isGlobalA || isGlobalB || [...setA].some((a) => setB.has(a));

        if (overlap) {
          const aReachesB = reachable.get(taskA.id)?.has(taskB.id);
          const bReachesA = reachable.get(taskB.id)?.has(taskA.id);

          if (!aReachesB && !bReachesA) {
            pendingEdges.push([taskA.id, taskB.id]);
          }
        }
      }
    }

    // Phase B: apply all collected edges in a single pass & rebuild once.
    let graphMutated = pendingEdges.length > 0;
    if (graphMutated) {
      for (const [fromId, toId] of pendingEdges) {
        const taskB = manifest.tasks.find((t) => t.id === toId);
        if (taskB) {
          if (!taskB.dependsOn) taskB.dependsOn = [];
          if (!taskB.dependsOn.includes(fromId)) taskB.dependsOn.push(fromId);
        }
      }
    }

    // Re-build after mutation and check for induced cycles
    let finalAdjacency = adjacency;
    if (graphMutated) {
      const updatedGraph = buildGraph(manifest.tasks);
      finalAdjacency = updatedGraph.adjacency;
      const cycle2 = detectCycle(finalAdjacency);
      if (cycle2) {
        throw new Error(`Dependency cycle detected after auto-serialization: ${cycle2.join(' → ')}`);
      }
    }


    // Layer assignment → session grouping
    const layers = assignLayers(finalAdjacency);
    const chatSessions = this.groupIntoChatSessions(manifest.tasks, layers, finalAdjacency);

    // Rebuild after grouping mutations, then apply transitive reduction
    const { adjacency: groupedAdjacency } = buildGraph(manifest.tasks);
    const reducedAdjacency = transitiveReduction(groupedAdjacency);
    for (const task of manifest.tasks) {
      task.dependsOn = reducedAdjacency.get(task.id) || [];
    }

    // Cross-chat dependencies
    const chatDeps = computeChatDependencies(chatSessions, groupedAdjacency);

    // Warn for any missing bookend types
    const bookendTypes = ['isIntegration', 'isCodeReview', 'isQA', 'isRetro', 'isCloseSprint'];
    for (const type of bookendTypes) {
      if (!manifest.tasks.some(t => t[type])) {
        console.warn(`⚠️  Manifest is missing a mandatory bookend task: ${type}. The playbook may be incomplete.`);
      }
    }

    return { chatSessions, chatDeps };
  }

  // -------------------------------------------------------------------------
  // Phase 4: Render
  // -------------------------------------------------------------------------

  /**
   * Renders the full Markdown playbook string from the session graph.
   * @param {object} manifest
   * @param {Array}  chatSessions
   * @param {Map}    chatDeps
   * @returns {string} The complete playbook Markdown.
   */
  render(manifest, chatSessions, chatDeps) {
    return renderPlaybook(manifest, chatSessions, chatDeps, this.options);
  }

  // -------------------------------------------------------------------------
  // Convenience: run all phases end-to-end from a manifest object
  // -------------------------------------------------------------------------

  /**
   * Orchestrates all four phases for an already-parsed manifest object.
   * @param {object} manifest
   * @returns {{ markdown: string, chatSessions: Array, chatDeps: Map }}
   */
  run(manifest) {
    this.validate(manifest);
    const { chatSessions, chatDeps } = this.build(manifest);
    const markdown = this.render(manifest, chatSessions, chatDeps);
    return { markdown, chatSessions, chatDeps };
  }

  // -------------------------------------------------------------------------
  // Convenience: run all phases end-to-end from a file path
  // -------------------------------------------------------------------------

  /**
   * Parses a manifest from disk then runs the full pipeline.
   * @param {string} manifestPath
   * @param {string} outputPath   - Where to write playbook.md
   */
  runFromFile(manifestPath, outputPath) {
    const manifest = this.parse(manifestPath);
    const { markdown } = this.run(manifest);
    ensureDirSync(path.dirname(outputPath));
    fs.writeFileSync(outputPath, markdown, 'utf8');
    console.log(`✅ Playbook generated: ${outputPath}`);
    return markdown;
  }
}
