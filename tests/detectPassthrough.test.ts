/**
 * Unit tests for detectPassthrough.ts
 *
 * Tests all three classification outcomes: passthrough, consumption,
 * spread-boundary — using in-memory source files via ts-morph.
 */

import { describe, it, expect } from "vitest";
import { Project, Node } from "ts-morph";
import { classifyPropUsage } from "../src/trace/detectPassthrough";
import type { ComponentNode } from "../src/utils/astUtils";

// ---------------------------------------------------------------------------
// Helper: parse a single component source and return its function node
// ---------------------------------------------------------------------------

function parseComponent(source: string): ComponentNode {
  const project = new Project({
    compilerOptions: { jsx: 4, allowJs: true, strict: false },
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: true,
  });
  const sf = project.createSourceFile("Test.tsx", source);

  // Find first arrow function or function declaration
  const fn = sf.getFunctions()[0];
  if (fn) return fn;

  const varDecls = sf.getVariableDeclarations();
  for (const vd of varDecls) {
    const init = vd.getInitializer();
    if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
      return init;
    }
  }
  throw new Error("No function node found in source");
}

// ---------------------------------------------------------------------------
// Passthrough
// ---------------------------------------------------------------------------

describe("classifyPropUsage — passthrough", () => {
  it("returns passthrough when prop is only forwarded as a JSX attribute value", () => {
    const src = `
      function Parent({ title }: { title: string }) {
        return <Child title={title} />;
      }
    `;
    const fn = parseComponent(src);
    const result = classifyPropUsage(fn, "title");
    expect(result.kind).toBe("passthrough");
  });

  it("returns passthrough for renamed forwarding", () => {
    const src = `
      function Parent({ name }: { name: string }) {
        return <Child label={name} />;
      }
    `;
    const fn = parseComponent(src);
    const result = classifyPropUsage(fn, "name");
    expect(result.kind).toBe("passthrough");
  });
});

// ---------------------------------------------------------------------------
// Consumption
// ---------------------------------------------------------------------------

describe("classifyPropUsage — consumption", () => {
  it("returns consumption when prop is rendered in JSX content", () => {
    const src = `
      function Child({ title }: { title: string }) {
        return <h1>{title}</h1>;
      }
    `;
    const fn = parseComponent(src);
    const result = classifyPropUsage(fn, "title");
    expect(result.kind).toBe("consumption");
    expect((result as { kind: string; reason: string }).reason).toMatch(/JSX/i);
  });

  it("returns consumption when prop is used in a condition", () => {
    const src = `
      function Toggle({ isOpen }: { isOpen: boolean }) {
        return <div>{isOpen ? "open" : "closed"}</div>;
      }
    `;
    const fn = parseComponent(src);
    const result = classifyPropUsage(fn, "isOpen");
    expect(result.kind).toBe("consumption");
  });

  it("returns consumption when prop is passed to a hook", () => {
    const src = `
      function Fetcher({ url }: { url: string }) {
        const data = useFetch(url);
        return <div>{data}</div>;
      }
    `;
    const fn = parseComponent(src);
    const result = classifyPropUsage(fn, "url");
    expect(result.kind).toBe("consumption");
  });

  it("returns consumption when prop is passed to a regular function call", () => {
    const src = `
      function Logger({ message }: { message: string }) {
        console.log(message);
        return <div />;
      }
    `;
    const fn = parseComponent(src);
    const result = classifyPropUsage(fn, "message");
    expect(result.kind).toBe("consumption");
  });
});

// ---------------------------------------------------------------------------
// Spread boundary
// ---------------------------------------------------------------------------

describe("classifyPropUsage — spread-boundary", () => {
  it("returns spread-boundary when props object is spread into JSX", () => {
    const src = `
      function Wrapper(props: { label: string }) {
        return <Inner {...props} />;
      }
    `;
    const fn = parseComponent(src);
    const result = classifyPropUsage(fn, "props");
    expect(result.kind).toBe("spread-boundary");
  });
});
