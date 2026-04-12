💡 **What:**
Combined the `inDegree` calculation and the `reverseAdj` construction into a single traversal of `adjacency.entries()` inside `topologicalSort`.

🎯 **Why:**
Previously, the `topologicalSort` function looped over all edges twice: once to calculate the `inDegree` for active dependencies, and a second time to construct the `reverseAdj` map. By combining these into a single pass, we reduce unnecessary redundant iteration over the edges of the graph, lowering overhead especially for denser or larger dependency graphs.

📊 **Measured Improvement:**
A benchmark simulating a graph with 100,000 nodes and maximum of 5 edges per node (for 10 iterations) was constructed to test `topologicalSort`.
- **Baseline:** ~2700 ms
- **Optimized:** ~2170 ms
- **Change:** ~19.6% reduction in execution time for this code path.
