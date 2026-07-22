/**
 * drillDepthAnalyzer.ts
 *
 * Computes drilling metrics from a completed TraceResult:
 *   - drillDepth        — number of component layers from origin to deepest leaf
 *   - passthroughCount  — nodes classified as pure passthrough
 *   - passthroughRatio  — passthroughCount / drillDepth
 *   - passthroughNodeIds / consumptionNodeIds — for UI highlighting
 *
 * No vscode imports.
 */

import type { TraceResult, DrillMetrics, PropTraceNode } from "../types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute DrillMetrics from a completed TraceResult.
 *
 * The "drill depth" is the length of the *longest* root-to-leaf path minus 1
 * (so a single origin node with one consumption child has depth 1).
 *
 * The origin node itself is excluded from passthrough/consumption counts
 * because it is neither — it is the definition site.
 */
export function analyzeDrillDepth(result: TraceResult): DrillMetrics {
  const allNodes = Object.values(result.nodes);

  // Nodes that are neither the root nor spread-boundaries
  const nonOriginNodes = allNodes.filter(
    (n) => n.id !== result.rootNodeId && n.kind !== "spread-boundary",
  );

  const passthroughNodes = nonOriginNodes.filter((n) => n.isPurePassthrough);
  const consumptionNodes = nonOriginNodes.filter((n) => n.kind === "consumption");

  // Drill depth = length of longest path - 1
  // longestPath includes the root; subtract 1 to count *edges*, not nodes.
  const drillDepth = Math.max(0, result.longestPath.length - 1);

  const passthroughCount = passthroughNodes.length;
  const passthroughRatio = drillDepth > 0 ? passthroughCount / drillDepth : 0;

  return {
    drillDepth,
    passthroughCount,
    passthroughRatio: parseFloat(passthroughRatio.toFixed(3)),
    passthroughNodeIds: passthroughNodes.map((n) => n.id),
    consumptionNodeIds: consumptionNodes.map((n) => n.id),
  };
}

// ---------------------------------------------------------------------------
// Helpers used by the suggestion analyzer
// ---------------------------------------------------------------------------

/**
 * Returns the set of nodes that appear on the *longest* root-to-leaf path.
 * Useful for distinguishing "the main drilling chain" from side branches.
 */
export function getMainPathNodes(result: TraceResult): PropTraceNode[] {
  return result.longestPath
    .map((id) => result.nodes[id])
    .filter((n): n is PropTraceNode => n !== undefined);
}

/**
 * Count how many *distinct* leaf components consume the prop (fan-out).
 * Fan-out > 1 indicates multiple sibling branches and may suggest composition.
 */
export function countConsumptionLeaves(result: TraceResult): number {
  return Object.values(result.nodes).filter((n) => n.kind === "consumption").length;
}

/**
 * Returns true if the prop is a callback (function type) based on its name
 * heuristic: starts with "on" followed by a capital letter.
 * E.g. `onSubmit`, `onChange`, `onClick`.
 */
export function looksLikeCallback(propName: string): boolean {
  return /^on[A-Z]/.test(propName);
}

/**
 * Count how many consecutive passthrough-only nodes appear on the main
 * (longest) path.  Used to detect "callback passed through N layers" scenario.
 */
export function consecutivePassthroughsOnMainPath(result: TraceResult): number {
  const mainPath = getMainPathNodes(result);
  // Skip the origin node (index 0)
  let count = 0;
  for (let i = 1; i < mainPath.length; i++) {
    if (mainPath[i].isPurePassthrough) {
      count++;
    } else {
      break; // only count leading consecutive run from the top
    }
  }
  return count;
}
