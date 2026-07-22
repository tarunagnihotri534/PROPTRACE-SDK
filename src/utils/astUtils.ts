/**
 * Shared AST utility helpers built on top of ts-morph.
 *
 * No vscode imports. Pure ts-morph + TypeScript.
 */

import {
  Project,
  SourceFile,
  Node,
  SyntaxKind,
  FunctionDeclaration,
  ArrowFunction,
  FunctionExpression,
  JsxAttribute,
  JsxSpreadAttribute,
  ParameterDeclaration,
  Identifier,
  CallExpression,
  ts,
} from "ts-morph";
import * as path from "path";
import * as fs from "fs";

// ---------------------------------------------------------------------------
// Project / file helpers
// ---------------------------------------------------------------------------

/**
 * Create a ts-morph Project configured to resolve files relative to
 * `workspaceRoot`.  We skip type-checking libs that are irrelevant to static
 * prop tracing to keep startup fast.
 */
export function createProject(workspaceRoot: string): Project {
  return new Project({
    tsConfigFilePath: findTsConfig(workspaceRoot),
    skipAddingFilesFromTsConfig: false,
    skipFileDependencyResolution: false,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      allowJs: true,
      checkJs: false,
      noEmit: true,
    },
  });
}

function findTsConfig(workspaceRoot: string): string | undefined {
  const candidates = [
    path.join(workspaceRoot, "tsconfig.json"),
    path.join(workspaceRoot, "jsconfig.json"),
  ];
  for (const candidate of candidates) {
    try {
      // ts-morph will throw if the file doesn't exist
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }
  return undefined;
}

/**
 * Add a file to the project if it isn't already tracked, then return it.
 * Throws a descriptive error if the file cannot be found on disk.
 */
export function getOrAddSourceFile(project: Project, filePath: string): SourceFile {
  const existing = project.getSourceFile(filePath);
  if (existing) return existing;
  return project.addSourceFileAtPath(filePath);
}

// ---------------------------------------------------------------------------
// React component detection
// ---------------------------------------------------------------------------

/** Names that conventionally signal hooks, not components. */
const HOOK_PREFIX = /^use[A-Z]/;

/**
 * Returns true if `name` looks like a React component name
 * (PascalCase and not a hook).
 */
export function looksLikeComponent(name: string): boolean {
  return /^[A-Z]/.test(name) && !HOOK_PREFIX.test(name);
}

// ---------------------------------------------------------------------------
// Prop parameter extraction
// ---------------------------------------------------------------------------

export type ComponentNode = FunctionDeclaration | ArrowFunction | FunctionExpression;

/**
 * Given a function-like node that represents a React component, return the
 * list of prop names it receives via its first parameter.
 *
 * Handles:
 *   - Destructured parameter:  `({ foo, bar }: Props) => …`
 *   - Identifier parameter:    `(props) => …`  → returns `["props"]`
 *   - No parameters            → returns `[]`
 */
export function extractPropNames(fn: ComponentNode): string[] {
  const params = fn.getParameters();
  if (params.length === 0) return [];

  const firstParam = params[0];
  const nameNode = firstParam.getNameNode();

  if (Node.isObjectBindingPattern(nameNode)) {
    return nameNode
      .getElements()
      .map((el) => {
        // `{ foo: renamedFoo }` — the *binding name* (renamedFoo) is local;
        // the prop name is the property name (foo).
        const propNameNode = el.getPropertyNameNode();
        if (propNameNode) {
          return Node.isIdentifier(propNameNode) ? propNameNode.getText() : null;
        }
        // `{ foo }` — same name
        const nameN = el.getNameNode();
        return Node.isIdentifier(nameN) ? nameN.getText() : null;
      })
      .filter((n): n is string => n !== null);
  }

  if (Node.isIdentifier(nameNode)) {
    return [nameNode.getText()];
  }

  return [];
}

/**
 * Resolve the local variable name for a given prop in a destructured
 * parameter.  E.g. `{ foo: myFoo }` → `extractLocalName(param, "foo")` → `"myFoo"`.
 * Returns the prop name itself when no alias is used.
 */
export function extractLocalName(firstParam: ParameterDeclaration, propName: string): string {
  const nameNode = firstParam.getNameNode();
  if (Node.isObjectBindingPattern(nameNode)) {
    for (const el of nameNode.getElements()) {
      const propNameNode = el.getPropertyNameNode();
      const bindingName = el.getNameNode();
      if (propNameNode) {
        if (Node.isIdentifier(propNameNode) && propNameNode.getText() === propName) {
          return Node.isIdentifier(bindingName) ? bindingName.getText() : propName;
        }
      } else {
        // `{ foo }` shorthand
        if (Node.isIdentifier(bindingName) && bindingName.getText() === propName) {
          return propName;
        }
      }
    }
  }
  return propName;
}

// ---------------------------------------------------------------------------
// Finding component function nodes
// ---------------------------------------------------------------------------

/**
 * Find ALL component-like function nodes in a source file.
 * Returns tuples of [componentName, functionNode].
 */
export function findComponentsInFile(
  sourceFile: SourceFile,
): Array<{ name: string; node: ComponentNode }> {
  const results: Array<{ name: string; node: ComponentNode }> = [];

  // Named function declarations: `function MyComp(…) {…}`
  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (name && looksLikeComponent(name)) {
      results.push({ name, node: fn });
    }
  }

  // Variable declarations: `const MyComp = (…) => …` / `= function(…) {…}`
  for (const varDecl of sourceFile.getVariableDeclarations()) {
    const name = varDecl.getName();
    if (!looksLikeComponent(name)) continue;

    const init = varDecl.getInitializer();
    if (!init) continue;

    if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
      results.push({ name, node: init });
    }
  }

  return results;
}

/**
 * Find a specific named component inside a source file.
 * Returns `undefined` if not found.
 */
export function findComponentByName(
  sourceFile: SourceFile,
  componentName: string,
): { name: string; node: ComponentNode } | undefined {
  return findComponentsInFile(sourceFile).find((c) => c.name === componentName);
}

// ---------------------------------------------------------------------------
// JSX attribute helpers
// ---------------------------------------------------------------------------

/**
 * Given a JSX element (or self-closing), extract all prop name→value mappings.
 * Returns an array of { propName, valueText, isSpread }.
 */
export interface JsxPropInfo {
  propName: string | null; // null for spread `{...x}`
  valueText: string;
  isSpread: boolean;
  attributeNode: JsxAttribute | JsxSpreadAttribute;
}

export function extractJsxProps(jsxOpeningOrSelf: Node): JsxPropInfo[] {
  const results: JsxPropInfo[] = [];

  // Collect attributes from JsxOpeningElement or JsxSelfClosingElement
  let attrs: Node[] = [];
  if (
    Node.isJsxOpeningElement(jsxOpeningOrSelf) ||
    Node.isJsxSelfClosingElement(jsxOpeningOrSelf)
  ) {
    attrs = jsxOpeningOrSelf.getAttributes();
  }

  for (const attr of attrs) {
    if (Node.isJsxSpreadAttribute(attr)) {
      results.push({
        propName: null,
        valueText: attr.getExpression().getText(),
        isSpread: true,
        attributeNode: attr,
      });
    } else if (Node.isJsxAttribute(attr)) {
      const nameNode = attr.getNameNode();
      const propName = nameNode.getText();
      const initializer = attr.getInitializer();
      const valueText = initializer ? initializer.getText() : "true"; // boolean shorthand
      results.push({
        propName,
        valueText,
        isSpread: false,
        attributeNode: attr,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Import resolution
// ---------------------------------------------------------------------------

/**
 * Given an import path (e.g. `"../components/Button"`) and the file it
 * appears in, return the resolved absolute file path (with extension).
 * Returns `null` if the path cannot be resolved (e.g. node_modules import).
 */
export function resolveImportPath(importPath: string, importingFilePath: string): string | null {
  // Skip node_modules / bare specifiers
  if (!importPath.startsWith(".") && !importPath.startsWith("/")) return null;

  const dir = path.dirname(importingFilePath);
  const resolved = path.resolve(dir, importPath);

  const extensions = [
    ".tsx",
    ".ts",
    ".jsx",
    ".js",
    "/index.tsx",
    "/index.ts",
    "/index.jsx",
    "/index.js",
  ];

  // Try each extension
  for (const ext of extensions) {
    const candidate = resolved + ext;
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }

  // Already has extension?
  try {
    if (fs.existsSync(resolved)) return resolved;
  } catch {
    // ignore
  }

  return null;
}

// ---------------------------------------------------------------------------
// Node location helpers
// ---------------------------------------------------------------------------

/** Convert a ts-morph Node's start position into a 1-based SourceLocation. */
export function nodeToLocation(node: Node, filePath: string): import("../types").SourceLocation {
  const pos = node.getStart();
  const sf = node.getSourceFile();
  const { line, character } = sf.getLineAndColumnAtPos(pos);
  return {
    filePath,
    line: line + 1, // ts-morph returns 0-based line
    column: character + 1,
  };
}

// ---------------------------------------------------------------------------
// Identifier helpers
// ---------------------------------------------------------------------------

/**
 * Walk up the ancestor chain and return the first ancestor matching any of
 * the given syntax kinds. Returns `undefined` if none found.
 */
export function findAncestor<T extends Node>(
  node: Node,
  guard: (n: Node) => n is T,
): T | undefined {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (guard(current)) return current;
    current = current.getParent();
  }
  return undefined;
}

/**
 * Return true if `identifier` is used inside a JSX expression context
 * (e.g. `<div>{myProp}</div>` or `<Comp foo={myProp} />`).
 */
export function isUsedInJsx(identifier: Identifier): boolean {
  let current: Node | undefined = identifier.getParent();
  while (current) {
    const kind = current.getKind();
    if (
      kind === SyntaxKind.JsxElement ||
      kind === SyntaxKind.JsxSelfClosingElement ||
      kind === SyntaxKind.JsxExpression
    ) {
      return true;
    }
    current = current.getParent();
  }
  return false;
}

/**
 * Return true if `identifier` appears as an argument to a hook call
 * (i.e. a function call whose name starts with `use`).
 */
export function isUsedInHookCall(identifier: Identifier): boolean {
  const callExpr = findAncestor<CallExpression>(identifier, Node.isCallExpression);
  if (!callExpr) return false;
  const exprText = callExpr.getExpression().getText();
  return HOOK_PREFIX.test(exprText);
}

/**
 * Stable node ID generator: `ComponentName:propName:line:col`.
 */
export function makeNodeId(component: string, prop: string, line: number, col: number): string {
  return `${component}:${prop}:${line}:${col}`;
}
