/**
 * tracePropForward.ts
 *
 * Traces a prop FORWARD from a starting component, following every child
 * component it is passed into.  Builds the flat node map that `buildTraceGraph`
 * will assemble into the final TraceResult.
 *
 * Handles:
 *   - Direct prop forwarding: `<Child foo={foo} />`
 *   - Renamed forwarding:     `<Child title={name} />`
 *   - Spread boundary:        `<Child {...props} />`
 *   - Multiple children receiving the same prop (fan-out)
 *   - Cycle detection (a component appearing more than once on the same path)
 *
 * No vscode imports.
 */

import { Project, Node, SyntaxKind } from "ts-morph";
import {
  getOrAddSourceFile,
  findComponentByName,
  extractLocalName,
  extractJsxProps,
  nodeToLocation,
  makeNodeId,
  looksLikeComponent,
  resolveImportPath,
} from "../utils/astUtils";
import { classifyPropUsage } from "./detectPassthrough";
import type { PropTraceNode, NodeKind } from "../types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ForwardTraceAccumulator {
  /** All discovered nodes, keyed by id. */
  nodes: Record<string, PropTraceNode>;
  /** Warnings accumulated during the forward trace. */
  warnings: string[];
  /** True if any spread boundary was encountered. */
  hasSpreadBoundary: boolean;
}

/**
 * Trace `propName` forward from `componentName` in `filePath`.
 *
 * Mutates and returns `acc` (accumulator pattern avoids re-creating objects on
 * every recursive call).
 *
 * @param project           ts-morph project
 * @param filePath          Absolute path to the file containing `componentName`
 * @param componentName     The component to start forward-tracing from
 * @param propName          The prop name AS RECEIVED by `componentName`
 * @param parentNodeId      ID of the parent PropTraceNode (for linking children)
 * @param acc               Accumulator (mutated in place)
 * @param visitedOnPath     Cycle guard — set of `file::component::prop` strings
 *                          representing the current recursion path
 */
export function tracePropForward(
  project: Project,
  filePath: string,
  componentName: string,
  propName: string,
  parentNodeId: string | null,
  acc: ForwardTraceAccumulator,
  visitedOnPath: Set<string> = new Set(),
): void {
  const key = `${filePath}::${componentName}::${propName}`;

  if (visitedOnPath.has(key)) {
    acc.warnings.push(
      `Cycle detected: ${componentName}.${propName} in ${filePath} — stopping recursion.`,
    );
    return;
  }
  visitedOnPath.add(key);

  // ------------------------------------------------------------------
  // Load source file and find component
  // ------------------------------------------------------------------
  let sourceFile;
  try {
    sourceFile = getOrAddSourceFile(project, filePath);
  } catch {
    acc.warnings.push(`Could not open file: ${filePath}`);
    visitedOnPath.delete(key);
    return;
  }

  const comp = findComponentByName(sourceFile, componentName);
  if (!comp) {
    acc.warnings.push(`Component "${componentName}" not found in ${filePath}`);
    visitedOnPath.delete(key);
    return;
  }

  const params = comp.node.getParameters();
  const firstParam = params[0];
  const localName = firstParam ? extractLocalName(firstParam, propName) : propName;

  // ------------------------------------------------------------------
  // Classify how this component uses the prop
  // ------------------------------------------------------------------
  const classification = classifyPropUsage(comp.node, localName);

  // Build a location for this node (use the parameter / function start)
  const nodeLoc = firstParam
    ? nodeToLocation(firstParam, filePath)
    : nodeToLocation(comp.node, filePath);

  const nodeId = makeNodeId(componentName, propName, nodeLoc.line, nodeLoc.column);

  let kind: NodeKind;
  let isPurePassthrough = false;

  switch (classification.kind) {
    case "spread-boundary":
      kind = "spread-boundary";
      acc.hasSpreadBoundary = true;
      break;
    case "consumption":
      kind = "consumption";
      break;
    case "passthrough":
    default:
      kind = "passthrough";
      isPurePassthrough = true;
      break;
  }

  const existingNode = acc.nodes[nodeId];
  const finalKind =
    existingNode && existingNode.kind === "origin" && kind !== "spread-boundary" ? "origin" : kind;
  const thisNode: PropTraceNode = {
    id: nodeId,
    label:
      existingNode && existingNode.kind === "origin" && finalKind === "origin"
        ? existingNode.label
        : componentName,
    kind: finalKind,
    location: nodeLoc,
    propName,
    children: existingNode ? existingNode.children : [],
    isPurePassthrough:
      existingNode && existingNode.kind === "origin" && finalKind === "origin"
        ? false
        : isPurePassthrough,
  };

  // Register node
  acc.nodes[nodeId] = thisNode;

  // Link to parent
  if (parentNodeId && parentNodeId !== nodeId && acc.nodes[parentNodeId]) {
    if (!acc.nodes[parentNodeId].children.includes(nodeId)) {
      acc.nodes[parentNodeId].children.push(nodeId);
    }
  }

  // Leaf node — stop recursion
  if (kind === "consumption" || kind === "spread-boundary") {
    visitedOnPath.delete(key);
    return;
  }

  // ------------------------------------------------------------------
  // Passthrough — find child JSX usages of the prop
  // ------------------------------------------------------------------
  const childPasses = findPropPassesToChildren(comp.node, localName, filePath, project);

  for (const pass of childPasses) {
    tracePropForward(
      project,
      pass.childFilePath,
      pass.childComponentName,
      pass.childPropName,
      nodeId,
      acc,
      new Set(visitedOnPath), // clone so sibling branches don't share state
    );
  }

  visitedOnPath.delete(key);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ChildPassInfo {
  childComponentName: string;
  childFilePath: string;
  /** The prop name as it will appear in the child component. */
  childPropName: string;
  /** True if forwarded via spread `{...props}`. */
  isSpread: boolean;
}

/**
 * Scan the function body of `fnNode` for JSX elements where `localPropName`
 * is passed as a prop value — and return info about those child components.
 */
function findPropPassesToChildren(
  fnNode: Node,
  localPropName: string,
  currentFilePath: string,
  project: Project,
): ChildPassInfo[] {
  const results: ChildPassInfo[] = [];

  // Gather all JSX open/self-closing elements in this function body
  const jsxOpenings = [
    ...fnNode.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...fnNode.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];

  for (const jsxEl of jsxOpenings) {
    let tagName: string;
    if (Node.isJsxOpeningElement(jsxEl)) {
      tagName = jsxEl.getTagNameNode().getText();
    } else if (Node.isJsxSelfClosingElement(jsxEl)) {
      tagName = jsxEl.getTagNameNode().getText();
    } else {
      continue;
    }

    // Only trace into PascalCase (component) tags, not intrinsic HTML tags
    if (!looksLikeComponent(tagName)) continue;

    const props = extractJsxProps(jsxEl);

    for (const prop of props) {
      if (prop.isSpread) {
        // `{...props}` or `{...rest}` — check if our local name is part of it
        const spreadText = prop.valueText;
        if (spreadText === localPropName || spreadText.includes(localPropName)) {
          const resolvedPath = resolveChildFilePath(tagName, currentFilePath, project);
          results.push({
            childComponentName: tagName,
            childFilePath: resolvedPath ?? currentFilePath,
            childPropName: localPropName, // best-effort for spread
            isSpread: true,
          });
        }
        continue;
      }

      // Is the value of this prop our local variable?
      let valueText = (prop.valueText ?? "").trim();
      // Strip JSX expression braces
      if (valueText.startsWith("{") && valueText.endsWith("}")) {
        valueText = valueText.slice(1, -1).trim();
      }

      if (valueText === localPropName) {
        const resolvedPath = resolveChildFilePath(tagName, currentFilePath, project);
        results.push({
          childComponentName: tagName,
          childFilePath: resolvedPath ?? currentFilePath,
          childPropName: prop.propName ?? localPropName,
          isSpread: false,
        });
      }
    }
  }

  return results;
}

/**
 * Attempt to resolve the file path for a child component by searching imports
 * in the current file.
 */
function resolveChildFilePath(
  componentName: string,
  currentFilePath: string,
  project: Project,
): string | null {
  let sourceFile;
  try {
    sourceFile = project.getSourceFile(currentFilePath);
    if (!sourceFile) return null;
  } catch {
    return null;
  }

  // Look through import declarations for the component name
  for (const importDecl of sourceFile.getImportDeclarations()) {
    const namedImports = importDecl.getNamedImports();
    const defaultImport = importDecl.getDefaultImport();

    const matchesNamed = namedImports.some((ni) => ni.getName() === componentName);
    const matchesDefault = defaultImport?.getText() === componentName;

    if (matchesNamed || matchesDefault) {
      const moduleSpecifier = importDecl.getModuleSpecifierValue();
      const resolved = resolveImportPath(moduleSpecifier, currentFilePath);
      if (resolved) return resolved;
    }
  }

  return null;
}
