/**
 * buildTraceGraph.ts
 *
 * Entry-point for the entire trace pipeline.  Given a TraceInput, it:
 *
 *   1. Identifies the prop name and component at the cursor position.
 *   2. Resolves the prop's origin backward (resolvePropOrigin).
 *   3. Traces the prop forward from the origin through all passthrough layers
 *      to every consumption point (tracePropForward).
 *   4. Assembles a TraceResult with a stable node map, root id, and longest
 *      path.
 *
 * No vscode imports.
 */

import { Project, Node, SyntaxKind } from "ts-morph";
import {
  getOrAddSourceFile,
  findComponentsInFile,
  extractLocalName,
  makeNodeId,
  looksLikeComponent,
  createProject,
} from "../utils/astUtils";
import { resolvePropOrigin } from "./resolvePropOrigin";
import { tracePropForward, ForwardTraceAccumulator } from "./tracePropForward";
import type { TraceInput, TraceResult, PropTraceNode } from "../types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the full trace graph for a prop at the given cursor position.
 *
 * Returns a `TraceResult` ready for the extension host to send to the Webview.
 */
export function buildTraceGraph(input: TraceInput): TraceResult {
  const project = createProject(input.workspaceRoot);

  // Ensure the triggering file is loaded
  try {
    getOrAddSourceFile(project, input.filePath);
  } catch {
    return makeErrorResult(input, `Could not open file: ${input.filePath}`);
  }

  // ------------------------------------------------------------------
  // Step 1: Identify the prop + component at the cursor
  // ------------------------------------------------------------------
  const identification = identifyPropAtCursor(project, input);
  if (!identification) {
    return makeErrorResult(input, "Could not identify a prop at the cursor position.");
  }

  const { propName, componentName, componentFilePath } = identification;

  // ------------------------------------------------------------------
  // Step 2: Resolve the origin backward
  // ------------------------------------------------------------------
  const originResult = resolvePropOrigin(project, componentFilePath, componentName, propName);

  const warnings: string[] = [...originResult.warnings];

  // ------------------------------------------------------------------
  // Step 3: Trace forward from origin
  // ------------------------------------------------------------------
  const acc: ForwardTraceAccumulator = {
    nodes: {},
    warnings: [],
    hasSpreadBoundary: false,
  };

  // Add origin node to the accumulator
  const originNode = originResult.originNode;
  acc.nodes[originNode.id] = originNode;

  // Add backward intermediate nodes
  for (const n of originResult.intermediateNodes) {
    acc.nodes[n.id] = n;
  }

  // Build the chain: origin → first intermediate → … → start component
  // Link them so the graph is connected
  linkChain([originNode, ...originResult.intermediateNodes], componentName, componentFilePath, acc);

  // Now trace forward from the start component
  tracePropForward(
    project,
    componentFilePath,
    componentName,
    propName,
    getLastChainNodeId([originNode, ...originResult.intermediateNodes]),
    acc,
    new Set(),
  );

  warnings.push(...acc.warnings);

  // ------------------------------------------------------------------
  // Step 4: Compute longest path
  // ------------------------------------------------------------------
  const longestPath = computeLongestPath(acc.nodes, originNode.id);

  return {
    propName,
    startComponentName: componentName,
    nodes: acc.nodes,
    rootNodeId: originNode.id,
    longestPath,
    hasSpreadBoundary: acc.hasSpreadBoundary,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Prop identification at cursor
// ---------------------------------------------------------------------------

interface CursorIdentification {
  propName: string;
  componentName: string;
  componentFilePath: string;
}

/**
 * Given cursor position (line, column) inside a file, find:
 *   - The prop name the cursor is on
 *   - The component function that contains the cursor
 */
function identifyPropAtCursor(project: Project, input: TraceInput): CursorIdentification | null {
  let sourceFile;
  try {
    sourceFile = getOrAddSourceFile(project, input.filePath);
  } catch {
    return null;
  }

  // Convert 1-based line/column to 0-based file offset
  const pos = sourceFile.compilerNode.getPositionOfLineAndCharacter(
    input.line - 1,
    input.column - 1,
  );

  // Find the innermost node at this position
  const nodeAtPos = sourceFile.getDescendantAtPos(pos);
  if (!nodeAtPos) return null;

  // Walk up to find an identifier
  let identifierNode: Node | undefined = nodeAtPos;
  while (identifierNode && !Node.isIdentifier(identifierNode)) {
    identifierNode = identifierNode.getParent();
  }
  if (!identifierNode || !Node.isIdentifier(identifierNode)) return null;

  const identifierText = identifierNode.getText();

  // Find the enclosing component function
  const components = findComponentsInFile(sourceFile);
  const enclosing = findEnclosingComponent(
    identifierNode,
    components.map((c) => c.name),
  );
  if (!enclosing) return null;

  // Verify the identifier is actually a prop of this component
  const comp = components.find((c) => c.name === enclosing);
  if (!comp) return null;

  const params = comp.node.getParameters();
  const firstParam = params[0];
  if (!firstParam) return null;

  // Determine the prop name (handle destructuring aliases)
  const propName = resolveIdentifierToPropName(firstParam, identifierText);
  if (!propName) return null;

  return {
    propName,
    componentName: enclosing,
    componentFilePath: input.filePath,
  };
}

/**
 * Walk up from `node` to find the name of the enclosing React component.
 */
function findEnclosingComponent(node: Node, componentNames: string[]): string | null {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (Node.isFunctionDeclaration(current)) {
      const name = current.getName();
      if (name && componentNames.includes(name)) return name;
    }
    if (Node.isVariableDeclaration(current)) {
      const name = current.getName();
      if (componentNames.includes(name)) return name;
    }
    if (Node.isArrowFunction(current) || Node.isFunctionExpression(current)) {
      const parent = current.getParent();
      if (parent && Node.isVariableDeclaration(parent)) {
        const name = parent.getName();
        if (componentNames.includes(name)) return name;
      }
    }
    current = current.getParent();
  }
  return null;
}

/**
 * Given the first parameter of a component and an identifier text found at the
 * cursor, determine the original prop name.
 * Handles destructuring aliases: `{ foo: myFoo }` → cursor on `myFoo` → prop is `foo`.
 */
function resolveIdentifierToPropName(
  firstParam: import("ts-morph").ParameterDeclaration,
  identifierText: string,
): string | null {
  const nameNode = firstParam.getNameNode();

  // Non-destructured: `(props)` — the identifier IS the prop container
  if (Node.isIdentifier(nameNode)) {
    if (nameNode.getText() === identifierText) return identifierText;
    // Access pattern: `props.foo` — identifier is `foo`
    // In this case the identifier is a property access; return it directly
    return identifierText;
  }

  // Destructured: `{ foo, bar: myBar }`
  if (Node.isObjectBindingPattern(nameNode)) {
    for (const el of nameNode.getElements()) {
      const bindingName = el.getNameNode();
      const propNameNode = el.getPropertyNameNode();

      const localName = Node.isIdentifier(bindingName) ? bindingName.getText() : null;
      const propName =
        propNameNode && Node.isIdentifier(propNameNode) ? propNameNode.getText() : localName;

      if (localName === identifierText) return propName ?? identifierText;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Chain linking helpers
// ---------------------------------------------------------------------------

/**
 * Link an array of nodes into a parent→child chain (each node's children array
 * gets the next node's id appended).
 */
function linkChain(
  nodes: PropTraceNode[],
  _startComponent: string,
  _startFilePath: string,
  acc: ForwardTraceAccumulator,
): void {
  for (let i = 0; i < nodes.length - 1; i++) {
    const current = nodes[i];
    const next = nodes[i + 1];
    if (!current.children.includes(next.id)) {
      current.children.push(next.id);
    }
  }
  // Ensure all nodes are in acc
  for (const n of nodes) {
    if (!acc.nodes[n.id]) acc.nodes[n.id] = n;
  }
}

function getLastChainNodeId(nodes: PropTraceNode[]): string | null {
  if (nodes.length === 0) return null;
  return nodes[nodes.length - 1].id;
}

// ---------------------------------------------------------------------------
// Longest path computation (BFS)
// ---------------------------------------------------------------------------

/**
 * Compute the longest root-to-leaf path in the node graph.
 * Uses a simple iterative DFS with path tracking.
 */
function computeLongestPath(nodes: Record<string, PropTraceNode>, rootId: string): string[] {
  let longest: string[] = [];

  function dfs(nodeId: string, currentPath: string[]): void {
    if (!nodes[nodeId]) return;
    const path = [...currentPath, nodeId];
    const node = nodes[nodeId];

    if (node.children.length === 0) {
      if (path.length > longest.length) longest = path;
      return;
    }

    for (const childId of node.children) {
      dfs(childId, path);
    }
  }

  dfs(rootId, []);
  return longest;
}

// ---------------------------------------------------------------------------
// Error result helper
// ---------------------------------------------------------------------------

function makeErrorResult(input: TraceInput, warning: string): TraceResult {
  const loc = { filePath: input.filePath, line: input.line, column: input.column };
  const id = makeNodeId("error", "unknown", input.line, input.column);
  return {
    propName: "unknown",
    startComponentName: "unknown",
    nodes: {
      [id]: {
        id,
        label: "Trace failed",
        kind: "origin",
        location: loc,
        propName: "unknown",
        children: [],
        isPurePassthrough: false,
      },
    },
    rootNodeId: id,
    longestPath: [id],
    hasSpreadBoundary: false,
    warnings: [warning],
  };
}

// ---------------------------------------------------------------------------
// Whole-file scan (used by showAllDrilledProps)
// ---------------------------------------------------------------------------

/**
 * Scan an entire file for props that are drilled (passed forward at least once).
 * Returns a flat list of {componentName, propName, filePath, location}.
 */
export interface FilePropScan {
  componentName: string;
  propName: string;
  filePath: string;
  line: number;
  column: number;
}

export function scanFileForDrilledProps(workspaceRoot: string, filePath: string): FilePropScan[] {
  const project = createProject(workspaceRoot);
  let sourceFile;
  try {
    sourceFile = getOrAddSourceFile(project, filePath);
  } catch {
    return [];
  }

  const results: FilePropScan[] = [];
  const components = findComponentsInFile(sourceFile);

  for (const { name: componentName, node: fnNode } of components) {
    const params = fnNode.getParameters();
    const firstParam = params[0];
    if (!firstParam) continue;

    const nameNode = firstParam.getNameNode();
    let propNames: string[] = [];

    if (Node.isObjectBindingPattern(nameNode)) {
      propNames = nameNode
        .getElements()
        .map((el) => {
          const pn = el.getPropertyNameNode();
          if (pn && Node.isIdentifier(pn)) return pn.getText();
          const bn = el.getNameNode();
          return Node.isIdentifier(bn) ? bn.getText() : "";
        })
        .filter(Boolean);
    } else if (Node.isIdentifier(nameNode)) {
      // Can't enumerate individual props without type info — skip for now
      continue;
    }

    for (const propName of propNames) {
      // Check if this prop is passed to any child component in the JSX
      const localName = extractLocalName(firstParam, propName);
      const isDrilled = isPropDrilled(fnNode, localName);
      if (isDrilled) {
        const pos = firstParam.getStart();
        const sf = fnNode.getSourceFile();
        const { line, character } = sf.getLineAndColumnAtPos(pos);
        results.push({
          componentName,
          propName,
          filePath,
          line: line + 1,
          column: character + 1,
        });
      }
    }
  }

  return results;
}

/**
 * Returns true if `localName` is passed into at least one child JSX component
 * as a prop value.
 */
function isPropDrilled(fnNode: Node, localName: string): boolean {
  const jsxElements = [
    ...fnNode.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...fnNode.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];

  for (const jsxEl of jsxElements) {
    let tagName: string;
    if (Node.isJsxOpeningElement(jsxEl)) {
      tagName = jsxEl.getTagNameNode().getText();
    } else if (Node.isJsxSelfClosingElement(jsxEl)) {
      tagName = jsxEl.getTagNameNode().getText();
    } else {
      continue;
    }

    if (!looksLikeComponent(tagName)) continue;

    const attrs = jsxEl.getAttributes();
    for (const attr of attrs) {
      if (Node.isJsxSpreadAttribute(attr)) {
        if (attr.getExpression().getText().includes(localName)) return true;
        continue;
      }
      if (Node.isJsxAttribute(attr)) {
        const init = attr.getInitializer();
        if (!init) continue;
        let valueText = init.getText().trim();
        if (valueText.startsWith("{") && valueText.endsWith("}")) {
          valueText = valueText.slice(1, -1).trim();
        }
        if (valueText === localName) return true;
      }
    }
  }

  return false;
}
