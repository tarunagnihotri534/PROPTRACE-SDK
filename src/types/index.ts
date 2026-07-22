/**
 * PropTrace — Shared type definitions.
 *
 * These types are the contract between:
 *   - the trace engine  (src/trace/, src/analyzers/)
 *   - the extension host (src/extension.ts, src/commands/)
 *   - the Webview React app (src/webview/)
 *
 * No vscode imports allowed here.
 */

// ---------------------------------------------------------------------------
// Source location
// ---------------------------------------------------------------------------

/** A precise location inside a source file. */
export interface SourceLocation {
  /** Absolute path to the file on disk. */
  filePath: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column number (start of the identifier). */
  column: number;
}

// ---------------------------------------------------------------------------
// Prop trace node
// ---------------------------------------------------------------------------

/**
 * How a component relates to the traced prop at this node.
 *
 * - `"origin"`        – where the prop value is first created/defined
 *                       (useState, useReducer, useContext, literal, etc.)
 * - `"passthrough"`   – receives the prop and re-passes it to a child
 *                       without directly using it (the "smell")
 * - `"consumption"`   – actually uses the prop (JSX render, hook call,
 *                       condition/calculation, non-component function call)
 * - `"spread-boundary"` – prop is passed via `{...props}` / spread; static
 *                         tracing cannot safely continue past this point
 */
export type NodeKind = "origin" | "passthrough" | "consumption" | "spread-boundary";

/**
 * A single node in the prop trace graph.
 *
 * Represents one component (or the origin site) in the chain through which
 * the prop travels.
 */
export interface PropTraceNode {
  /** Stable unique ID for this node (used by the Webview graph renderer). */
  id: string;

  /** Human-readable component name (e.g. "UserCard", "App", "origin:useState"). */
  label: string;

  /** Classification of this node's relationship to the prop. */
  kind: NodeKind;

  /** Where in the source this node lives (the prop usage / declaration site). */
  location: SourceLocation;

  /**
   * The exact prop name at *this* node.
   * May differ from the root prop name if the prop was renamed during passing
   * (e.g. `<Child title={name} />` — at the child node the prop name is "title").
   */
  propName: string;

  /**
   * IDs of child nodes (components this node passes the prop into).
   * Empty for leaf nodes (consumption / spread-boundary).
   */
  children: string[];

  /**
   * True when this node receives the prop but *never* references it directly
   * in its own body — only re-passes it. Equivalent to `kind === "passthrough"`.
   * Kept as an explicit boolean for quick filtering in the UI.
   */
  isPurePassthrough: boolean;

  /**
   * Rename information — populated when a prop is renamed at this pass site.
   * E.g. `<Child foo={bar} />` renames `bar` → `foo`.
   */
  rename?: {
    /** Name the prop had in the *parent*. */
    fromName: string;
    /** Name it has in *this* component (or the child it's passed to). */
    toName: string;
  };
}

// ---------------------------------------------------------------------------
// Trace direction (for future bidirectional trace support)
// ---------------------------------------------------------------------------

export type TraceDirection = "forward" | "backward" | "both";

// ---------------------------------------------------------------------------
// Full trace result
// ---------------------------------------------------------------------------

/**
 * The complete result returned by the trace engine for one prop.
 */
export interface TraceResult {
  /** The prop name that was traced. */
  propName: string;

  /**
   * The component where tracing began (i.e. the component the user clicked
   * into), NOT necessarily the origin.
   */
  startComponentName: string;

  /** All nodes, keyed by their `id`. The Webview builds the graph from this. */
  nodes: Record<string, PropTraceNode>;

  /** ID of the root node (origin or the topmost traceable ancestor). */
  rootNodeId: string;

  /**
   * Ordered list of node IDs from root to deepest consumption leaf
   * (longest path, for depth computation).
   */
  longestPath: string[];

  /** True if tracing hit a spread boundary somewhere in the graph. */
  hasSpreadBoundary: boolean;

  /**
   * Any non-fatal warnings produced during tracing
   * (e.g. "could not resolve import", "ambiguous default export").
   */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Drill depth analysis
// ---------------------------------------------------------------------------

/**
 * Computed drilling metrics for a single traced prop.
 */
export interface DrillMetrics {
  /** Number of component layers from origin to deepest consumption. */
  drillDepth: number;

  /**
   * Number of nodes classified as pure passthrough
   * (received + re-passed, never directly used).
   */
  passthroughCount: number;

  /**
   * passthroughCount / (drillDepth || 1) — value between 0 and 1.
   * 1.0 means every intermediate layer is a pure passthrough.
   */
  passthroughRatio: number;

  /** IDs of all passthrough nodes, for highlighting in the UI. */
  passthroughNodeIds: string[];

  /** IDs of all consumption nodes. */
  consumptionNodeIds: string[];
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

export type SuggestionType = "use-context" | "use-composition" | "co-locate" | "add-use-callback";

/**
 * A single actionable suggestion produced by the suggestion analyzer.
 */
export interface Suggestion {
  type: SuggestionType;

  /** Short title shown in the Webview. */
  title: string;

  /** Full explanation shown on hover / expanded panel. */
  detail: string;

  /** Relevant documentation URL, if any. */
  docUrl?: string;
}

// ---------------------------------------------------------------------------
// Overview entry (Show All Drilled Props in File)
// ---------------------------------------------------------------------------

/**
 * Summary row produced by `showAllDrilledPropsCommand` for each drilled prop
 * found in a file.
 */
export interface DrilledPropSummary {
  /** Prop name. */
  propName: string;

  /** Component in this file where the prop enters (or originates). */
  componentName: string;

  /** How deep the drilling goes from this component. */
  drillDepth: number;

  /** Location of the prop's first usage in this file. */
  location: SourceLocation;
}

// ---------------------------------------------------------------------------
// Webview messaging contract
// ---------------------------------------------------------------------------

/**
 * Messages sent FROM the extension host TO the Webview.
 */
export type ExtensionToWebviewMessage =
  | {
      type: "traceResult";
      payload: {
        result: TraceResult;
        metrics: DrillMetrics;
        suggestions: Suggestion[];
      };
    }
  | {
      type: "loading";
      payload: { message: string };
    }
  | {
      type: "error";
      payload: { message: string };
    }
  | {
      type: "allDrilledProps";
      payload: { props: DrilledPropSummary[]; filePath: string };
    };

/**
 * Messages sent FROM the Webview TO the extension host.
 */
export type WebviewToExtensionMessage =
  | {
      type: "jumpToSource";
      payload: { location: SourceLocation };
    }
  | {
      type: "ready";
    }
  | {
      type: "retrace";
      payload: { propName: string; filePath: string; line: number; column: number };
    };

/** Union of all message directions — used for exhaustive switch helpers. */
export type WebviewMessage = ExtensionToWebviewMessage | WebviewToExtensionMessage;

// ---------------------------------------------------------------------------
// Input context passed into trace engine functions
// ---------------------------------------------------------------------------

/**
 * The minimal context the commands layer provides to the trace engine.
 * Contains no vscode types — only plain data.
 */
export interface TraceInput {
  /** Absolute path to the file the user invoked the command from. */
  filePath: string;
  /** 1-based line of the cursor / selected identifier. */
  line: number;
  /** 1-based column of the cursor / selected identifier. */
  column: number;
  /** Resolved workspace root (for resolving relative imports). */
  workspaceRoot: string;
  /** The configured drill-depth threshold (from workspace settings). */
  drillDepthThreshold: number;
}
