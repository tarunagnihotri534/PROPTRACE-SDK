import { describe, it, expect } from "vitest";
import * as path from "path";
import { buildTraceGraph } from "../src/trace/buildTraceGraph";
import { analyzeDrillDepth } from "../src/analyzers/drillDepthAnalyzer";
import { analyzeSuggestions } from "../src/analyzers/suggestionAnalyzer";
import type { TraceInput } from "../src/types";

describe("PropTrace — Analyzers", () => {
  const workspaceRoot = path.resolve(__dirname, "..");

  it("computes correct metrics and recommendations for simple-drill", () => {
    const parentFile = path.join(workspaceRoot, "test-fixtures", "simple-drill", "Parent.tsx");
    const input: TraceInput = {
      filePath: parentFile,
      line: 8,
      column: 27,
      workspaceRoot,
      drillDepthThreshold: 2, // Threshold of 2 so that depth 2 triggers suggestion
    };

    const traceResult = buildTraceGraph(input);
    const metrics = analyzeDrillDepth(traceResult);

    expect(metrics.drillDepth).toBe(2); // GrandParent -> Parent -> Child (2 edges)
    expect(metrics.passthroughCount).toBe(1); // Parent
    expect(metrics.passthroughRatio).toBe(0.5);

    const suggestions = analyzeSuggestions(traceResult, metrics, 2);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].type).toBe("use-context");
    expect(suggestions[0].title).toBe("Consider React Context");
  });

  it("handles callbacks consecutive passthroughs recommendation", () => {
    // Create a mock TraceResult representing a callback drilled through 3 levels
    const mockTraceResult = {
      propName: "onDelete", // starts with "on[A-Z]" -> callback
      startComponentName: "Comp2",
      nodes: {
        "origin:1:1": {
          id: "origin:1:1",
          label: "origin",
          kind: "origin" as const,
          location: { filePath: "Origin.tsx", line: 1, column: 1 },
          propName: "onDelete",
          children: ["pass1:2:2"],
          isPurePassthrough: false,
        },
        "pass1:2:2": {
          id: "pass1:2:2",
          label: "Pass1",
          kind: "passthrough" as const,
          location: { filePath: "Pass1.tsx", line: 2, column: 2 },
          propName: "onDelete",
          children: ["pass2:3:3"],
          isPurePassthrough: true,
        },
        "pass2:3:3": {
          id: "pass2:3:3",
          label: "Pass2",
          kind: "passthrough" as const,
          location: { filePath: "Pass2.tsx", line: 3, column: 3 },
          propName: "onDelete",
          children: ["consume:4:4"],
          isPurePassthrough: true,
        },
        "consume:4:4": {
          id: "consume:4:4",
          label: "Consume",
          kind: "consumption" as const,
          location: { filePath: "Consume.tsx", line: 4, column: 4 },
          propName: "onDelete",
          children: [],
          isPurePassthrough: false,
        },
      },
      rootNodeId: "origin:1:1",
      longestPath: ["origin:1:1", "pass1:2:2", "pass2:3:3", "consume:4:4"],
      hasSpreadBoundary: false,
      warnings: [],
    };

    const metrics = analyzeDrillDepth(mockTraceResult);
    expect(metrics.drillDepth).toBe(3);
    expect(metrics.passthroughCount).toBe(2);

    const suggestions = analyzeSuggestions(mockTraceResult, metrics, 3);
    // Should trigger callback co-location suggest
    const callbackSuggest = suggestions.find((s) => s.type === "co-locate");
    expect(callbackSuggest).toBeDefined();
    expect(callbackSuggest!.title).toContain("Co-locate");
  });

  it("handles fan-out compositions", () => {
    // Create a mock TraceResult representing fan-out to 2 child nodes
    const mockTraceResult = {
      propName: "theme",
      startComponentName: "Root",
      nodes: {
        "origin:1:1": {
          id: "origin:1:1",
          label: "Root",
          kind: "origin" as const,
          location: { filePath: "Root.tsx", line: 1, column: 1 },
          propName: "theme",
          children: ["consume1:2:2", "consume2:3:3"],
          isPurePassthrough: false,
        },
        "consume1:2:2": {
          id: "consume1:2:2",
          label: "Consume1",
          kind: "consumption" as const,
          location: { filePath: "Consume1.tsx", line: 2, column: 2 },
          propName: "theme",
          children: [],
          isPurePassthrough: false,
        },
        "consume2:3:3": {
          id: "consume2:3:3",
          label: "Consume2",
          kind: "consumption" as const,
          location: { filePath: "Consume2.tsx", line: 3, column: 3 },
          propName: "theme",
          children: [],
          isPurePassthrough: false,
        },
      },
      rootNodeId: "origin:1:1",
      longestPath: ["origin:1:1", "consume1:2:2"],
      hasSpreadBoundary: false,
      warnings: [],
    };

    const metrics = analyzeDrillDepth(mockTraceResult);
    const suggestions = analyzeSuggestions(mockTraceResult, metrics, 3);

    const compositionSuggest = suggestions.find((s) => s.type === "use-composition");
    expect(compositionSuggest).toBeDefined();
    expect(compositionSuggest!.title).toContain("composition");
  });
});
