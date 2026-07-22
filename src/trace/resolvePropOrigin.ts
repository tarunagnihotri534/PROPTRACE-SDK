/**
 * resolvePropOrigin.ts
 *
 * Traces a prop BACKWARD from a given component to the point where it is
 * first defined/created.  Handles:
 *
 *   - Prop comes from a parent component (recurse upward through the call site)
 *   - Prop comes from useState / useReducer / useContext
 *   - Prop is a literal / constant passed directly at the call site
 *
 * No vscode imports.
 */

import { Project, Node, SyntaxKind } from "ts-morph";
import {
  getOrAddSourceFile,
  findComponentByName,
  extractLocalName,
  nodeToLocation,
  makeNodeId,
  looksLikeComponent,
  extractJsxProps,
} from "../utils/astUtils";
import type { PropTraceNode, SourceLocation } from "../types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface OriginResult {
  /** The origin node (kind === "origin"). */
  originNode: PropTraceNode;
  /**
   * Any intermediate passthrough nodes discovered while tracing backward,
   * listed parent-first (closest to origin first).
   */
  intermediateNodes: PropTraceNode[];
  warnings: string[];
}

/**
 * Resolve where `propName` in `componentName` ultimately originates.
 *
 * @param project       A ts-morph Project with the workspace files loaded.
 * @param filePath      Absolute path to the file containing `componentName`.
 * @param componentName The component whose prop we're tracing backward.
 * @param propName      The prop to trace.
 * @param visited       Cycle-break set (file:component:prop strings).
 */
export function resolvePropOrigin(
  project: Project,
  filePath: string,
  componentName: string,
  propName: string,
  visited: Set<string> = new Set(),
): OriginResult {
  const key = `${filePath}::${componentName}::${propName}`;
  if (visited.has(key)) {
    // Circular reference — return a best-effort origin node
    return makeUnresolvableOrigin(filePath, componentName, propName, "Circular reference detected");
  }
  visited.add(key);

  const warnings: string[] = [];

  let sourceFile;
  try {
    sourceFile = getOrAddSourceFile(project, filePath);
  } catch {
    return makeUnresolvableOrigin(
      filePath,
      componentName,
      propName,
      `Could not open file: ${filePath}`,
    );
  }

  const comp = findComponentByName(sourceFile, componentName);
  if (!comp) {
    return makeUnresolvableOrigin(
      filePath,
      componentName,
      propName,
      `Could not find component "${componentName}" in ${filePath}`,
    );
  }

  const params = comp.node.getParameters();
  const firstParam = params[0];

  // Local name of the prop inside this component body
  const localName = firstParam ? extractLocalName(firstParam, propName) : propName;

  // -------------------------------------------------------------------------
  // Case B: Check if the prop is derived from a hook inside THIS component
  //         (useState / useReducer / useContext).
  // -------------------------------------------------------------------------
  const hookOrigin = tryFindHookOrigin(comp.node, localName, filePath, componentName);
  if (hookOrigin) {
    return { originNode: hookOrigin, intermediateNodes: [], warnings };
  }

  // -------------------------------------------------------------------------
  // Case A: No first parameter and no hook origin -> unresolvable or entry
  // -------------------------------------------------------------------------
  if (!firstParam) {
    const loc = nodeToLocation(comp.node, filePath);
    const id = makeNodeId(componentName, propName, loc.line, loc.column);
    const originNode: PropTraceNode = {
      id,
      label: `${componentName} (entry)`,
      kind: "origin",
      location: loc,
      propName,
      children: [],
      isPurePassthrough: false,
    };
    return { originNode, intermediateNodes: [], warnings };
  }

  // -------------------------------------------------------------------------
  // Case C: Prop comes from a parent — search the whole project for JSX
  //         usages of `componentName` and inspect what value is passed.
  // -------------------------------------------------------------------------
  const callSites = findJsxCallSites(project, componentName, propName);

  if (callSites.length === 0) {
    // No call sites found — this component is the origin (or entry point)
    const loc = nodeToLocation(firstParam, filePath);
    const id = makeNodeId(componentName, propName, loc.line, loc.column);
    const originNode: PropTraceNode = {
      id,
      label: `${componentName} (entry)`,
      kind: "origin",
      location: loc,
      propName,
      children: [],
      isPurePassthrough: false,
    };
    return { originNode, intermediateNodes: [], warnings };
  }

  // Use the first call site found (heuristic for single-parent cases).
  // Multi-parent cases are handled by the forward tracer building a full graph.
  const site = callSites[0];

  // -------------------------------------------------------------------------
  // Case D: Value passed at call site is a literal / constant
  // -------------------------------------------------------------------------
  if (isLiteralOrConstant(site.valueText)) {
    const loc: SourceLocation = {
      filePath: site.filePath,
      line: site.line,
      column: site.column,
    };
    const id = makeNodeId("literal", propName, loc.line, loc.column);
    const originNode: PropTraceNode = {
      id,
      label: `literal: ${site.valueText.slice(0, 40)}`,
      kind: "origin",
      location: loc,
      propName,
      children: [],
      isPurePassthrough: false,
    };
    return { originNode, intermediateNodes: [], warnings };
  }

  // -------------------------------------------------------------------------
  // Case E: Value is itself a prop of the parent → recurse upward
  // -------------------------------------------------------------------------
  const parentResult = resolvePropOrigin(
    project,
    site.filePath,
    site.parentComponentName,
    site.valueText, // the prop name in the parent
    visited,
  );

  const isParentOrigin = parentResult.originNode.id.startsWith(`${site.parentComponentName}:`);
  const intermediateNodes = [...parentResult.intermediateNodes];

  if (!isParentOrigin) {
    // Build a passthrough node for the parent component
    const parentLoc: SourceLocation = {
      filePath: site.filePath,
      line: site.line,
      column: site.column,
    };
    const parentId = makeNodeId(site.parentComponentName, site.valueText, site.line, site.column);
    const parentNode: PropTraceNode = {
      id: parentId,
      label: site.parentComponentName,
      kind: "passthrough",
      location: parentLoc,
      propName: site.valueText,
      children: [],
      isPurePassthrough: true,
      rename:
        site.valueText !== propName ? { fromName: site.valueText, toName: propName } : undefined,
    };
    intermediateNodes.push(parentNode);
  }

  return {
    originNode: parentResult.originNode,
    intermediateNodes,
    warnings: [...parentResult.warnings, ...warnings],
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface CallSiteInfo {
  filePath: string;
  parentComponentName: string;
  propName: string;
  /** The text of the value passed, e.g. `"myVar"`, `"42"`, `"'hello'"`. */
  valueText: string;
  line: number;
  column: number;
}

/**
 * Search the project for all JSX usages of `componentName` that pass `propName`.
 */
function findJsxCallSites(
  project: Project,
  componentName: string,
  propName: string,
): CallSiteInfo[] {
  const results: CallSiteInfo[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    // Skip node_modules
    if (sourceFile.getFilePath().includes("node_modules")) continue;

    const filePath = sourceFile.getFilePath();

    // Find all JSX opening / self-closing elements
    const jsxElements = [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ];

    for (const jsxEl of jsxElements) {
      // Get tag name
      let tagName: string;
      if (Node.isJsxOpeningElement(jsxEl)) {
        tagName = jsxEl.getTagNameNode().getText();
      } else if (Node.isJsxSelfClosingElement(jsxEl)) {
        tagName = jsxEl.getTagNameNode().getText();
      } else {
        continue;
      }

      if (tagName !== componentName) continue;

      // Extract props from this JSX element
      const props = extractJsxProps(jsxEl);
      const matchedProp = props.find((p) => p.propName === propName);
      if (!matchedProp) continue;

      // Determine which component *contains* this JSX (the parent)
      const enclosingFn = findEnclosingComponent(jsxEl);
      if (!enclosingFn) continue;

      // Clean value text (strip JSX expression braces `{ }`)
      let valueText = matchedProp.valueText.trim();
      if (valueText.startsWith("{") && valueText.endsWith("}")) {
        valueText = valueText.slice(1, -1).trim();
      }

      const pos = jsxEl.getStart();
      const { line, character } = sourceFile.getLineAndColumnAtPos(pos);

      results.push({
        filePath,
        parentComponentName: enclosingFn,
        propName,
        valueText,
        line: line + 1,
        column: character + 1,
      });
    }
  }

  return results;
}

/**
 * Walk up from a node to find the enclosing React component name.
 */
function findEnclosingComponent(node: Node): string | null {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (Node.isFunctionDeclaration(current)) {
      const name = current.getName();
      if (name && looksLikeComponent(name)) return name;
    }
    if (Node.isVariableDeclaration(current)) {
      const name = current.getName();
      if (looksLikeComponent(name)) return name;
    }
    if (Node.isArrowFunction(current) || Node.isFunctionExpression(current)) {
      // Check if assigned to a PascalCase variable
      const parent = current.getParent();
      if (Node.isVariableDeclaration(parent)) {
        const name = parent.getName();
        if (looksLikeComponent(name)) return name;
      }
    }
    current = current.getParent();
  }
  return null;
}

/**
 * Check if a component body contains a hook (useState / useReducer / useContext)
 * that produces the local variable `localName`.
 */
function tryFindHookOrigin(
  fnNode: Node,
  localName: string,
  filePath: string,
  componentName: string,
): PropTraceNode | null {
  const hookCalls = fnNode.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const call of hookCalls) {
    const callText = call.getExpression().getText();
    if (callText !== "useState" && callText !== "useReducer" && callText !== "useContext") {
      continue;
    }

    // `const [value, setValue] = useState(…)` or `const value = useContext(…)`
    const varDecl = call.getParent();
    if (!varDecl) continue;

    if (Node.isVariableDeclaration(varDecl)) {
      const nameNode = varDecl.getNameNode();

      // Case 1: Array binding pattern (e.g. const [value, setValue] = useState(…))
      if (Node.isArrayBindingPattern(nameNode)) {
        const elements = nameNode.getElements();
        if (elements[0]) {
          const bindingName = elements[0].getNameNode();
          if (Node.isIdentifier(bindingName) && bindingName.getText() === localName) {
            const sf = fnNode.getSourceFile();
            const pos = call.getStart();
            const { line, character } = sf.getLineAndColumnAtPos(pos);
            const loc: SourceLocation = { filePath, line: line + 1, column: character + 1 };
            return {
              id: makeNodeId(`${componentName}:hook`, localName, loc.line, loc.column),
              label: `${componentName} — ${callText}(${call
                .getArguments()
                .map((a) => a.getText())
                .join(", ")})`,
              kind: "origin",
              location: loc,
              propName: localName,
              children: [],
              isPurePassthrough: false,
            };
          }
        }
      }

      // Case 2: Object binding pattern (e.g. const { value } = useContext(…))
      if (Node.isObjectBindingPattern(nameNode)) {
        for (const el of nameNode.getElements()) {
          const bindingName = el.getNameNode();
          if (Node.isIdentifier(bindingName) && bindingName.getText() === localName) {
            const sf = fnNode.getSourceFile();
            const pos = call.getStart();
            const { line, character } = sf.getLineAndColumnAtPos(pos);
            const loc: SourceLocation = { filePath, line: line + 1, column: character + 1 };
            return {
              id: makeNodeId(`${componentName}:hook`, localName, loc.line, loc.column),
              label: `${componentName} — ${callText}(${call
                .getArguments()
                .map((a) => a.getText())
                .join(", ")})`,
              kind: "origin",
              location: loc,
              propName: localName,
              children: [],
              isPurePassthrough: false,
            };
          }
        }
      }

      // Case 3: Identifier (e.g. const value = useContext(…))
      if (Node.isIdentifier(nameNode) && nameNode.getText() === localName) {
        const sf = fnNode.getSourceFile();
        const pos = call.getStart();
        const { line, character } = sf.getLineAndColumnAtPos(pos);
        const loc: SourceLocation = { filePath, line: line + 1, column: character + 1 };
        return {
          id: makeNodeId(`${componentName}:hook`, localName, loc.line, loc.column),
          label: `${componentName} — ${callText}(${call
            .getArguments()
            .map((a) => a.getText())
            .join(", ")})`,
          kind: "origin",
          location: loc,
          propName: localName,
          children: [],
          isPurePassthrough: false,
        };
      }
    }
  }

  return null;
}

/**
 * Heuristic: is the value text a literal or constant (not a prop identifier)?
 */
function isLiteralOrConstant(valueText: string): boolean {
  if (
    valueText === "true" ||
    valueText === "false" ||
    valueText === "null" ||
    valueText === "undefined"
  ) {
    return true;
  }
  if (/^".*"$/.test(valueText) || /^'.*'$/.test(valueText) || /^`.*`$/.test(valueText)) {
    return true;
  }
  if (/^\d/.test(valueText)) return true;
  return false;
}

/** Fallback when we cannot resolve. */
function makeUnresolvableOrigin(
  filePath: string,
  componentName: string,
  propName: string,
  warning: string,
): OriginResult {
  const loc: SourceLocation = { filePath, line: 1, column: 1 };
  return {
    originNode: {
      id: makeNodeId("unresolved", propName, 1, 1),
      label: `${componentName} (origin unresolved)`,
      kind: "origin",
      location: loc,
      propName,
      children: [],
      isPurePassthrough: false,
    },
    intermediateNodes: [],
    warnings: [warning],
  };
}
