/**
 * detectPassthrough.ts
 *
 * Given a component function node and a prop (local variable name inside that
 * component), classify whether the component:
 *
 *   - "passthrough"      — only re-passes the prop, never uses it directly
 *   - "consumption"      — uses the prop directly (JSX render, hook, condition…)
 *   - "spread-boundary"  — passes the prop (or props object) via a spread
 *
 * No vscode imports.
 */

import { Node, SyntaxKind, Identifier } from "ts-morph";
import type { ComponentNode } from "../utils/astUtils";
import { isUsedInJsx, isUsedInHookCall } from "../utils/astUtils";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type ClassificationResult =
  | { kind: "consumption"; reason: string }
  | { kind: "passthrough" }
  | { kind: "spread-boundary"; spreadText: string };

/**
 * Classify how `propLocalName` is used inside `fnNode`.
 *
 * @param fnNode        The function-like node of the component.
 * @param propLocalName The local variable name of the prop inside the component
 *                      body (may differ from the prop name if it was renamed in
 *                      destructuring, e.g. `{ foo: myFoo }` → localName is `myFoo`).
 */
export function classifyPropUsage(
  fnNode: ComponentNode,
  propLocalName: string,
): ClassificationResult {
  // Collect all identifier references to `propLocalName` inside the function body
  const identifiers = fnNode
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .filter((id) => id.getText() === propLocalName);

  if (identifiers.length === 0) {
    // The prop is not referenced at all in the body.
    // This can happen with spread props — check for that separately.
    const spread = findSpreadBoundary(fnNode, propLocalName);
    if (spread) return { kind: "spread-boundary", spreadText: spread };
    return { kind: "passthrough" };
  }

  // Check each reference
  for (const id of identifiers) {
    const classification = classifySingleReference(id, propLocalName);
    if (classification.kind !== "passthrough") return classification;
  }

  // All references are pass-forward only — check spread
  const spread = findSpreadBoundary(fnNode, propLocalName);
  if (spread) return { kind: "spread-boundary", spreadText: spread };

  return { kind: "passthrough" };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Classify a single identifier reference.
 */
function classifySingleReference(id: Identifier, propLocalName: string): ClassificationResult {
  const parent = id.getParent();
  if (!parent) return { kind: "passthrough" };

  // ---- Spread ----
  if (isInsideSpread(id)) {
    return {
      kind: "spread-boundary",
      spreadText: `{...${propLocalName}}`,
    };
  }

  // ---- Used directly in JSX content / attributes ----
  if (isUsedInJsx(id)) {
    // Is it being passed as a prop VALUE in a JSX attribute?  That's passthrough.
    // E.g. `<Child foo={myProp} />` — the identifier is the value of a JSX attr.
    if (isJsxAttributeValue(id)) {
      return { kind: "passthrough" };
    }
    // Otherwise it's rendered in JSX: `<div>{myProp}</div>` — consumption.
    return { kind: "consumption", reason: "rendered in JSX" };
  }

  // ---- Passed into a hook call ----
  if (isUsedInHookCall(id)) {
    return { kind: "consumption", reason: "passed to a hook" };
  }

  // ---- Used in a condition / calculation ----
  if (isUsedInConditionOrCalculation(id)) {
    return { kind: "consumption", reason: "used in condition or calculation" };
  }

  // ---- Passed to a non-component, non-hook function call ----
  if (isPassedToNonComponentFunction(id)) {
    return { kind: "consumption", reason: "passed to a function call" };
  }

  // ---- Used in a return statement directly (not JSX) ----
  if (isDirectlyReturned(id)) {
    return { kind: "consumption", reason: "directly returned" };
  }

  // Default: treat as passthrough (being forwarded as a prop value)
  return { kind: "passthrough" };
}

/**
 * Returns true if the identifier is used as the VALUE of a JSX attribute
 * (not the attribute name).
 * E.g. `<Child foo={myProp} />` — `myProp` is the value of attribute `foo`.
 */
function isJsxAttributeValue(id: Identifier): boolean {
  // Walk up: Identifier → JsxExpression → JsxAttribute
  const parent = id.getParent();
  if (!parent) return false;

  if (Node.isJsxExpression(parent)) {
    const grandParent = parent.getParent();
    if (grandParent && Node.isJsxAttribute(grandParent)) {
      return true;
    }
  }

  // Direct string literal value (no braces) — less common but possible
  if (Node.isJsxAttribute(parent)) {
    return true;
  }

  return false;
}

/**
 * Returns true if the identifier is used inside a binary expression, ternary,
 * logical operator, or unary expression — i.e. it's being *evaluated*.
 */
function isUsedInConditionOrCalculation(id: Identifier): boolean {
  let current: Node | undefined = id.getParent();
  while (current) {
    const kind = current.getKind();
    if (
      kind === SyntaxKind.BinaryExpression ||
      kind === SyntaxKind.ConditionalExpression ||
      kind === SyntaxKind.PrefixUnaryExpression ||
      kind === SyntaxKind.PostfixUnaryExpression ||
      kind === SyntaxKind.IfStatement ||
      kind === SyntaxKind.WhileStatement ||
      kind === SyntaxKind.SwitchStatement ||
      kind === SyntaxKind.TemplateExpression ||
      kind === SyntaxKind.TaggedTemplateExpression
    ) {
      return true;
    }
    // Stop when we reach something that clearly wraps us (function, JSX attr)
    if (
      kind === SyntaxKind.JsxAttribute ||
      kind === SyntaxKind.ArrowFunction ||
      kind === SyntaxKind.FunctionDeclaration ||
      kind === SyntaxKind.FunctionExpression
    ) {
      break;
    }
    current = current.getParent();
  }
  return false;
}

/**
 * Returns true if the identifier is passed as an argument to a function whose
 * name does NOT look like a React component (PascalCase) and is NOT a hook.
 */
function isPassedToNonComponentFunction(id: Identifier): boolean {
  const parent = id.getParent();
  if (!parent) return false;

  // Inside a call expression's arguments
  if (!Node.isCallExpression(parent)) return false;

  const callArgs = parent.getArguments();
  const isArg = callArgs.some((a) => a === id);
  if (!isArg) return false;

  const calleeName = parent.getExpression().getText();
  // Skip hook calls (handled separately) and component-like calls
  if (/^use[A-Z]/.test(calleeName)) return false;
  if (/^[A-Z]/.test(calleeName)) return false; // component instantiation

  return true;
}

/**
 * Returns true if the identifier is directly in a return statement
 * (not inside JSX, and not inside another expression).
 */
function isDirectlyReturned(id: Identifier): boolean {
  const parent = id.getParent();
  if (!parent) return false;
  return parent.getKind() === SyntaxKind.ReturnStatement;
}

/**
 * Returns true if the identifier is inside a spread element:
 * `{ ...myProp }` or `[...myProp]`.
 */
function isInsideSpread(id: Identifier): boolean {
  let current: Node | undefined = id.getParent();
  while (current) {
    if (
      current.getKind() === SyntaxKind.SpreadElement ||
      current.getKind() === SyntaxKind.SpreadAssignment ||
      current.getKind() === SyntaxKind.JsxSpreadAttribute
    ) {
      return true;
    }
    // Stop at boundaries
    if (
      current.getKind() === SyntaxKind.JsxAttribute ||
      Node.isArrowFunction(current) ||
      Node.isFunctionDeclaration(current)
    ) {
      break;
    }
    current = current.getParent();
  }
  return false;
}

/**
 * Scan for spread usages of the whole `props` object, or explicit
 * spread of the prop.  E.g. `<Child {...props} />` when `propLocalName`
 * is `"props"` (non-destructured param case).
 */
function findSpreadBoundary(fnNode: ComponentNode, propLocalName: string): string | null {
  // Look for JsxSpreadAttribute containing propLocalName
  const spreads = fnNode.getDescendantsOfKind(SyntaxKind.JsxSpreadAttribute);
  for (const spread of spreads) {
    const expr = spread.getExpression();
    if (expr.getText().includes(propLocalName)) {
      return `{...${expr.getText()}}`;
    }
  }

  // Also look for object spread in calls: `foo({ ...props })`
  const spreadAssignments = fnNode.getDescendantsOfKind(SyntaxKind.SpreadAssignment);
  for (const sa of spreadAssignments) {
    if (sa.getExpression().getText().includes(propLocalName)) {
      return `{...${sa.getExpression().getText()}}`;
    }
  }

  // Trace through intermediate variable assignments: const rest = { prop } -> {...rest}
  const varDecls = fnNode.getDescendantsOfKind(SyntaxKind.VariableDeclaration);
  for (const vd of varDecls) {
    const init = vd.getInitializer();
    if (init) {
      const hasProp = init
        .getDescendantsOfKind(SyntaxKind.Identifier)
        .some((id) => id.getText() === propLocalName);
      if (hasProp) {
        const varName = vd.getName();
        const spread = findSpreadBoundary(fnNode, varName);
        if (spread) return spread;
      }
    }
  }

  return null;
}
