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
 * Performs transitive reduction on a DAG using DFS.
 * Removes edge (u→v) if v is reachable from u via an alternate path of length > 1.
 * Complexity: O(V·(V+E)) — significantly faster than Floyd-Warshall for sparse graphs.
 */
export function transitiveReduction(adjacency) {
  const result = new Map();

  for (const [node, deps] of adjacency.entries()) {
    // Early-return: nodes with zero or one dependency cannot have redundant edges
    if (deps.length <= 1) {
      result.set(node, [...deps]);
      continue;
    }

    const kept = [];
    for (const dep of deps) {
      // Check if dep is reachable from node via any neighbour other than dep itself
      const isRedundant = deps.some((other) => {
        if (other === dep) return false;
        return _dfsReaches(other, dep, adjacency, new Set([node]));
      });
      if (!isRedundant) kept.push(dep);
    }
    result.set(node, kept);
  }

  return result;
}

/**
 * DFS helper: returns true if `target` is reachable from `start`,
 * skipping nodes in the `visited` set to avoid revisiting.
 */
function _dfsReaches(start, target, adjacency, visited) {
  if (start === target) return true;
  visited.add(start);
  for (const neighbour of adjacency.get(start) || []) {
    if (!visited.has(neighbour)) {
      if (_dfsReaches(neighbour, target, adjacency, visited)) return true;
    }
  }
  return false;
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
  // Memoized DFS: each node's reachable set is computed once and cached.
  // Complexity: O(V·(V+E)) — avoids the O(N³) Floyd-Warshall triple loop.
  const memo = new Map();

  function reach(id) {
    if (memo.has(id)) return memo.get(id);
    // Seed with a placeholder to handle cycles defensively
    const set = new Set();
    memo.set(id, set);
    for (const neighbour of adjacency.get(id) || []) {
      set.add(neighbour);
      for (const transitive of reach(neighbour)) {
        set.add(transitive);
      }
    }
    return set;
  }

  const reachable = new Map();
  for (const id of adjacency.keys()) {
    reachable.set(id, reach(id));
  }
  return reachable;
}
