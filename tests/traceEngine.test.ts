import { describe, it, expect } from "vitest";
import * as path from "path";
import { buildTraceGraph } from "../src/trace/buildTraceGraph";
import { resolvePropOrigin } from "../src/trace/resolvePropOrigin";
import { FIXTURES, createFixtureProject } from "./helpers";
import type { TraceInput } from "../src/types";

describe("PropTrace — Trace Engine", () => {
  const workspaceRoot = path.resolve(__dirname, "..");

  describe("resolvePropOrigin & tracePropForward (simple-drill)", () => {
    it("traces backward from Parent.title to GrandParent's state hook and forward to Child", () => {
      const project = createFixtureProject(FIXTURES.simpleDrill);
      const parentFile = path.join(FIXTURES.simpleDrill, "Parent.tsx");

      // Resolve origin
      const originResult = resolvePropOrigin(project, parentFile, "Parent", "title");

      expect(originResult.warnings).toHaveLength(0);
      expect(originResult.originNode.kind).toBe("origin");
      expect(originResult.originNode.label).toContain("useState");
      expect(originResult.originNode.propName).toBe("title");
      expect(originResult.intermediateNodes).toHaveLength(0); // Parent is the start component, so its parent (GrandParent) is traversed backward but since it's the state hook it resolves immediately without intermediates in backward trace from Parent (the call site is Parent, and we trace parent → grandparent. Wait, Parent's parent is GrandParent. GrandParent passes title={title}. In resolvePropOrigin, parentResult runs on GrandParent. GrandParent's title is from useState. So useState is origin, Parent is a passthrough in resolvePropOrigin, but it is the start component. Wait, let's verify.)
    });
  });

  describe("buildTraceGraph", () => {
    it("builds a complete trace graph for simple-drill", () => {
      const parentFile = path.join(FIXTURES.simpleDrill, "Parent.tsx");
      const input: TraceInput = {
        filePath: parentFile,
        line: 8, // line where "title" is declared in Parent({ title })
        column: 27, // column of "title"
        workspaceRoot,
        drillDepthThreshold: 3,
      };

      const result = buildTraceGraph(input);

      expect(result.warnings).toHaveLength(0);
      expect(result.propName).toBe("title");
      expect(result.startComponentName).toBe("Parent");
      expect(result.rootNodeId).toBeDefined();

      const nodes = Object.values(result.nodes);
      expect(nodes.length).toBeGreaterThanOrEqual(3);

      const origin = nodes.find((n) => n.kind === "origin");
      const passthrough = nodes.find((n) => n.kind === "passthrough");
      const consumption = nodes.find((n) => n.kind === "consumption");

      expect(origin).toBeDefined();
      expect(origin!.label).toContain("GrandParent");
      expect(passthrough).toBeDefined();
      expect(passthrough!.label).toBe("Parent");
      expect(consumption).toBeDefined();
      expect(consumption!.label).toBe("Child");
    });

    it("handles no-drill components appropriately", () => {
      const file = path.join(FIXTURES.noDrill, "Standalone.tsx");
      const input: TraceInput = {
        filePath: file,
        line: 7,
        column: 30, // Standalone({ message })
        workspaceRoot,
        drillDepthThreshold: 3,
      };

      const result = buildTraceGraph(input);
      expect(result.warnings).toHaveLength(0);
      expect(result.propName).toBe("message");
      expect(result.startComponentName).toBe("Standalone");

      const nodes = Object.values(result.nodes);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].kind).toBe("origin"); // entry component is treated as origin
      expect(nodes[0].label).toContain("Standalone (entry)");
    });

    it("detects spread-boundaries", () => {
      const file = path.join(FIXTURES.spreadBoundary, "Container.tsx");
      const input: TraceInput = {
        filePath: file,
        line: 9,
        column: 29, // Container({ label, extra }) -> label
        workspaceRoot,
        drillDepthThreshold: 3,
      };

      const result = buildTraceGraph(input);
      expect(result.propName).toBe("label");
      expect(result.hasSpreadBoundary).toBe(true);

      const nodes = Object.values(result.nodes);
      const boundaryNode = nodes.find((n) => n.kind === "spread-boundary");
      expect(boundaryNode).toBeDefined();
      expect(boundaryNode!.label).toBe("Container");
    });
  });
});
