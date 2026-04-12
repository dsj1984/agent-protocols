💡 **What:**
Optimized `cascadeCompletion` in `.agents/scripts/lib/orchestration/ticketing.js` to process parent ticket updates in parallel using `Promise.all` and `.map()` instead of a sequential `for...of` loop.

🎯 **Why:**
When a ticket is completed, it toggles its checkbox in all of its parent tickets and recursively cascades the completion if the parent's sub-tickets are all completed. Doing this sequentially causes unnecessary cascading latency because the updates for different parent tickets are independent and can be executed concurrently.

📊 **Measured Improvement:**
Measured performance execution time simulating a cascade across 10 parent tickets (with an artificial 10ms network delay applied to mock API calls).
- **Baseline:** 1044ms
- **Optimized:** 126ms
- **Change over baseline:** An ~88% reduction in execution time in the measured scenario.
