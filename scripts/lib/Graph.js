/**
 * Graph.js
 * Extracted mathematical DAG logic for topological sorting, cycle detection,
 * and transitive reduction.
 */

/**
 * Builds an adjacency list from the manifest tasks.
 * Returns { adjacency: Map<id, id[]>, taskMap: Map<id, task> }
 */
export function buildGraph(tasks) {
  const adjacency = new Map();
  const taskMap = new Map();

  for (const task of tasks) {
    adjacency.set(task.id, [...task.dependsOn]);
    taskMap.set(task.id, task);
  }

  return { adjacency, taskMap };
}

/**
 * Detects cycles using DFS. Returns the first cycle found as an array of ids,
 * or null if the graph is acyclic.
 */
export function detectCycle(adjacency) {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  const parent = new Map();

  for (const id of adjacency.keys()) {
    color.set(id, WHITE);
  }

  for (const id of adjacency.keys()) {
    if (color.get(id) === WHITE) {
      const cycle = dfsVisit(id, adjacency, color, parent);
      if (cycle) return cycle;
    }
  }

  return null;
}

function dfsVisit(u, adjacency, color, parent) {
  color.set(u, 1); // GRAY

  for (const v of adjacency.get(u) || []) {
    if (color.get(v) === 1) {
      // Back edge → cycle. Reconstruct.
      const cycle = [v, u];
      let cur = u;
      while (parent.has(cur) && parent.get(cur) !== v) {
        cur = parent.get(cur);
        cycle.push(cur);
      }
      return cycle.reverse();
    }
    if (color.get(v) === 0) {
      parent.set(v, u);
      const cycle = dfsVisit(v, adjacency, color, parent);
      if (cycle) return cycle;
    }
  }

  color.set(u, 2); // BLACK
  return null;
}

/**
 * Assigns each task a layer (depth from root). Root tasks (no dependencies)
 * are layer 0. Returns Map<id, layer>.
 */
export function assignLayers(adjacency) {
  const layers = new Map();
  const memo = new Map();

  function getLayer(id) {
    if (memo.has(id)) return memo.get(id);

    const deps = adjacency.get(id) || [];
    if (deps.length === 0) {
      memo.set(id, 0);
      return 0;
    }

    const maxDepLayer = Math.max(...deps.map(getLayer));
    const layer = maxDepLayer + 1;
    memo.set(id, layer);
    return layer;
  }

  for (const id of adjacency.keys()) {
    layers.set(id, getLayer(id));
  }

  return layers;
}

/**
 * Performs transitive reduction on a DAG.
 * Removes edges (u, v) if there exists a path from u to v of length > 1.
 */
export function transitiveReduction(adjacency) {
  const reduced = new Map();
  const nodes = [...adjacency.keys()];
  
  // Initialize reduced graph with original edges
  for (const node of nodes) {
    reduced.set(node, new Set(adjacency.get(node) || []));
  }

  // Floyd-Warshall style transitive reduction
  for (const k of nodes) {
    for (const i of nodes) {
      if (reduced.get(i).has(k)) {
        for (const j of nodes) {
          if (reduced.get(k).has(j)) {
            // Path i -> k -> j exists, so direct edge i -> j is redundant
            reduced.get(i).delete(j);
          }
        }
      }
    }
  }

  // Convert back to Array format
  const result = new Map();
  for (const [node, deps] of reduced.entries()) {
    result.set(node, [...deps]);
  }
  return result;
}

/**
 * Computes which Chat Sessions each Chat Session depends on.
 * Returns a Map<chatNumber, chatNumber[]>.
 */
export function computeChatDependencies(chatSessions, adjacency) {
  // Build a reverse lookup: taskId → chatNumber
  const taskToChat = new Map();
  for (const session of chatSessions) {
    for (const task of session.tasks) {
      taskToChat.set(task.id, session.chatNumber);
    }
  }

  const chatDeps = new Map();
  for (const session of chatSessions) {
    const deps = new Set();
    for (const task of session.tasks) {
      for (const depId of task.dependsOn) {
        const depChat = taskToChat.get(depId);
        if (depChat !== undefined && depChat !== session.chatNumber) {
          deps.add(depChat);
        }
      }
    }
    chatDeps.set(session.chatNumber, [...deps].sort((a, b) => a - b));
  }

  // Apply transitive reduction to chat-level dependencies
  return transitiveReduction(chatDeps);
}

/**
 * Computes the transitive closure (reachability matrix) for the DAG.
 * Returns a Map<id, Set<id>> where each key maps to a set of all tasks it can reach.
 */
export function computeReachability(adjacency) {
  const reachable = new Map();
  const nodes = [...adjacency.keys()];
  
  for (const node of nodes) {
    reachable.set(node, new Set(adjacency.get(node) || []));
  }

  for (const k of nodes) {
    for (const i of nodes) {
      if (reachable.get(i).has(k)) {
        for (const j of nodes) {
          if (reachable.get(k).has(j)) {
            reachable.get(i).add(j);
          }
        }
      }
    }
  }

  return reachable;
}
