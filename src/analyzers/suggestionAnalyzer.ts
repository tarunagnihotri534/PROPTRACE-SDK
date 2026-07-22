/**
 * suggestionAnalyzer.ts
 *
 * Produces actionable refactoring suggestions from a TraceResult + DrillMetrics,
 * based on the heuristics specified in §3.5 of the build instructions:
 *
 *   1. Depth ≥ threshold AND high passthrough ratio → suggest React Context
 *   2. Prop is a callback re-passed unchanged through 2+ layers → suggest
 *      co-location or Context; note missing useCallback (informational only)
 *   3. Prop fans out to multiple sibling branches from one ancestor → suggest
 *      composition (children/slots) over prop drilling
 *
 * No vscode imports.
 */

import type { TraceResult, DrillMetrics, Suggestion } from "../types";
import {
  countConsumptionLeaves,
  looksLikeCallback,
  consecutivePassthroughsOnMainPath,
} from "./drillDepthAnalyzer";

// ---------------------------------------------------------------------------
// Thresholds & constants
// ---------------------------------------------------------------------------

/** Minimum passthroughRatio to trigger a Context suggestion. */
const HIGH_PASSTHROUGH_RATIO = 0.5;

/** Minimum consecutive callback passthrough layers to trigger callback advice. */
const CALLBACK_PASSTHROUGH_MIN = 2;

/** Minimum number of consumption leaves to trigger a composition suggestion. */
const FAN_OUT_MIN = 2;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate all applicable suggestions for a traced prop.
 *
 * @param result           The completed TraceResult.
 * @param metrics          Drill metrics computed by drillDepthAnalyzer.
 * @param drillThreshold   The user-configured depth threshold (default 3).
 */
export function analyzeSuggestions(
  result: TraceResult,
  metrics: DrillMetrics,
  drillThreshold: number = 3,
): Suggestion[] {
  const suggestions: Suggestion[] = [];

  // ------------------------------------------------------------------
  // Heuristic 1: Deep drilling with high passthrough ratio → Context
  // ------------------------------------------------------------------
  if (metrics.drillDepth >= drillThreshold && metrics.passthroughRatio >= HIGH_PASSTHROUGH_RATIO) {
    suggestions.push(buildContextSuggestion(result, metrics));
  }

  // ------------------------------------------------------------------
  // Heuristic 2: Callback re-passed through 2+ layers → co-location / Context
  // ------------------------------------------------------------------
  if (looksLikeCallback(result.propName)) {
    const consecutivePassthroughs = consecutivePassthroughsOnMainPath(result);
    if (consecutivePassthroughs >= CALLBACK_PASSTHROUGH_MIN) {
      suggestions.push(buildCallbackSuggestion(result, consecutivePassthroughs));
    }
  }

  // ------------------------------------------------------------------
  // Heuristic 3: Fan-out to multiple sibling branches → composition
  // ------------------------------------------------------------------
  const leafCount = countConsumptionLeaves(result);
  if (leafCount >= FAN_OUT_MIN) {
    suggestions.push(buildCompositionSuggestion(result, leafCount));
  }

  // Deduplicate by type (a prop could trigger multiple paths to the same type)
  return deduplicateSuggestions(suggestions);
}

// ---------------------------------------------------------------------------
// Individual suggestion builders
// ---------------------------------------------------------------------------

function buildContextSuggestion(result: TraceResult, metrics: DrillMetrics): Suggestion {
  const depth = metrics.drillDepth;
  const ratio = Math.round(metrics.passthroughRatio * 100);
  const passCount = metrics.passthroughCount;

  return {
    type: "use-context",
    title: "Consider React Context",
    detail:
      `"${result.propName}" passes through ${depth} component layer${depth === 1 ? "" : "s"}, ` +
      `with ${passCount} pure passthrough${passCount === 1 ? "" : "s"} (${ratio}% passthrough ratio). ` +
      `Moving this value into a React Context and consuming it directly in ` +
      `${result.longestPath.length > 0 ? "the leaf component" : "the consumer"} ` +
      `would eliminate the intermediate prop forwarding.\n\n` +
      `Pattern:\n` +
      `  1. Create a Context: const MyContext = React.createContext<T>(defaultValue)\n` +
      `  2. Wrap the ancestor with <MyContext.Provider value={${result.propName}}>\n` +
      `  3. Replace the drilled prop with useContext(MyContext) in each consumer.`,
    docUrl: "https://react.dev/learn/passing-data-deeply-with-context",
  };
}

function buildCallbackSuggestion(result: TraceResult, passthroughLayers: number): Suggestion {
  return {
    type: "co-locate",
    title: "Co-locate or use Context for callback prop",
    detail:
      `"${result.propName}" is a callback prop that passes through ${passthroughLayers} ` +
      `layer${passthroughLayers === 1 ? "" : "s"} without being called. ` +
      `Two options:\n\n` +
      `Option A — Co-location: Move the state and the handler closer to where they are ` +
      `actually used. If the leaf component is the only consumer, the state can live there.\n\n` +
      `Option B — Context: Place the callback in a Context so the consumer can call it ` +
      `directly without prop forwarding.\n\n` +
      `Also consider wrapping the handler in useCallback() at the definition site to ` +
      `avoid unnecessary re-renders (informational — verify with a profiler first).`,
    docUrl: "https://react.dev/reference/react/useCallback",
  };
}

function buildCompositionSuggestion(result: TraceResult, leafCount: number): Suggestion {
  return {
    type: "use-composition",
    title: "Consider composition (children/slots) over prop drilling",
    detail:
      `"${result.propName}" fans out to ${leafCount} separate consumption point${leafCount === 1 ? "" : "s"}. ` +
      `When the same prop must reach multiple sibling subtrees, restructuring with ` +
      `React composition patterns can eliminate the need to thread the prop through ` +
      `every intermediate layer.\n\n` +
      `Pattern — children prop:\n` +
      `  <Layout sidebar={<Sidebar data={data} />}>\n` +
      `    <Main data={data} />\n` +
      `  </Layout>\n\n` +
      `Pattern — render props / slots:\n` +
      `  <DataProvider render={(data) => <Consumer data={data} />} />\n\n` +
      `This moves prop ownership to the call site that knows about the data, ` +
      `rather than threading it through unrelated intermediaries.`,
    docUrl: "https://react.dev/learn/passing-props-to-a-component#passing-jsx-as-children",
  };
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function deduplicateSuggestions(suggestions: Suggestion[]): Suggestion[] {
  const seen = new Set<string>();
  return suggestions.filter((s) => {
    if (seen.has(s.type)) return false;
    seen.add(s.type);
    return true;
  });
}
