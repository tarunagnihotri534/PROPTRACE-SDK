import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Project, SyntaxKind } from "ts-morph";
import { findComponentByName } from "../utils/astUtils";
import { buildTraceGraph } from "../trace/buildTraceGraph";
import { analyzeDrillDepth } from "../analyzers/drillDepthAnalyzer";
import { analyzeSuggestions } from "../analyzers/suggestionAnalyzer";
import type { TraceInput, ExtensionToWebviewMessage } from "../types";

let activePanel: vscode.WebviewPanel | undefined = undefined;

interface CodeLensArgs {
  filePath: string;
  componentName: string;
  propNames: string[];
}

export async function tracePropCommand(
  context: vscode.ExtensionContext,
  args?: CodeLensArgs
): Promise<void> {
  let targetProp: string | undefined = undefined;
  let targetFile: string | undefined = undefined;
  let targetLine: number | undefined = undefined;
  let targetColumn: number | undefined = undefined;

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const workspaceRoot = workspaceFolder ? workspaceFolder.uri.fsPath : "";

  if (!workspaceRoot) {
    vscode.window.showErrorMessage("PropTrace: Please open a workspace first.");
    return;
  }

  // 1. Resolve target prop, line, column
  if (args && args.filePath && args.componentName && args.propNames) {
    targetFile = args.filePath;
    if (args.propNames.length === 1) {
      targetProp = args.propNames[0];
    } else {
      targetProp = await vscode.window.showQuickPick(args.propNames, {
        placeHolder: `Select a prop to trace in component "${args.componentName}"`,
      });
      if (!targetProp) {
        return; // User cancelled
      }
    }

    // Resolve coordinates of the selected prop within component parameter destructuring
    const coords = getPropCoords(targetFile, args.componentName, targetProp);
    if (coords) {
      targetLine = coords.line;
      targetColumn = coords.column;
    } else {
      // Fallback: use first line of file
      targetLine = 1;
      targetColumn = 1;
    }
  } else {
    // Interactive trigger (e.g. from editor context menu)
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage("PropTrace: No active text editor found.");
      return;
    }

    targetFile = editor.document.fileName;
    targetLine = editor.selection.active.line + 1;
    targetColumn = editor.selection.active.character + 1;
  }

  // Ensure webview panel exists and is visible
  const panel = getOrCreateWebviewPanel(context, workspaceRoot);
  panel.reveal(vscode.ViewColumn.Two);

  // Define the trace input
  const drillDepthThreshold = vscode.workspace
    .getConfiguration("proptrace")
    .get<number>("drillDepthThreshold", 3);

  const input: TraceInput = {
    filePath: targetFile,
    line: targetLine,
    column: targetColumn,
    workspaceRoot,
    drillDepthThreshold,
  };

  // Perform trace and post to webview
  runTraceAndSend(panel, input);
}

function getPropCoords(
  filePath: string,
  componentName: string,
  propName: string,
): { line: number; column: number } | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const project = new Project({ useInMemoryFileSystem: true });
    const content = fs.readFileSync(filePath, "utf8");
    const sf = project.createSourceFile("temp.tsx", content);
    const comp = findComponentByName(sf, componentName);
    if (!comp) return null;

    const params = comp.node.getParameters();
    const firstParam = params[0];
    if (!firstParam) return null;

    const identifiers = firstParam.getDescendantsOfKind(SyntaxKind.Identifier);
    const matched = identifiers.find((id) => id.getText() === propName);
    if (matched) {
      const pos = matched.getStart();
      const { line, character } = sf.getLineAndColumnAtPos(pos);
      return { line: line + 1, column: character + 1 };
    }
  } catch {
    // silent failure
  }
  return null;
}

export function getOrCreateWebviewPanel(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
): vscode.WebviewPanel {
  if (activePanel) {
    return activePanel;
  }

  const panel = vscode.window.createWebviewPanel(
    "proptraceVisualizer",
    "PropTrace Visualizer",
    vscode.ViewColumn.Two,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, "dist"))],
    },
  );

  activePanel = panel;

  panel.onDidDispose(() => {
    activePanel = undefined;
  });

  // Setup HTML
  panel.webview.html = getWebviewHtml(context, panel.webview);

  // Message Handler
  panel.webview.onDidReceiveMessage(async (message) => {
    switch (message.type) {
      case "ready":
        // Webview is loaded, but wait, usually we run the trace on activation.
        // We'll let the initiator send the trace.
        break;

      case "jumpToSource": {
        const { location } = message.payload;
        try {
          if (!fs.existsSync(location.filePath)) {
            vscode.window.showErrorMessage(`File not found: ${location.filePath}`);
            return;
          }
          const doc = await vscode.workspace.openTextDocument(location.filePath);
          const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
          const pos = new vscode.Position(location.line - 1, location.column - 1);
          editor.selection = new vscode.Selection(pos, pos);
          editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        } catch (err: unknown) {
          vscode.window.showErrorMessage(`Failed to open source: ${err instanceof Error ? err.message : String(err)}`);
        }
        break;
      }

      case "retrace": {
        const { filePath, line, column } = message.payload;
        const drillDepthThreshold = vscode.workspace
          .getConfiguration("proptrace")
          .get<number>("drillDepthThreshold", 3);
        const input: TraceInput = {
          filePath,
          line,
          column,
          workspaceRoot,
          drillDepthThreshold,
        };
        runTraceAndSend(panel, input);
        break;
      }
    }
  });

  return panel;
}

export function runTraceAndSend(panel: vscode.WebviewPanel, input: TraceInput): void {
  // Post loading state
  panel.webview.postMessage({
    type: "loading",
    payload: { message: `Tracing prop at line ${input.line}...` },
  });

  // Perform trace inside a timeout to allow loading spinner to render
  setTimeout(() => {
    try {
      const result = buildTraceGraph(input);

      // Check if the result represents a failure
      const firstNode = Object.values(result.nodes)[0];
      if (firstNode && firstNode.label === "Trace failed") {
        panel.webview.postMessage({
          type: "error",
          payload: { message: result.warnings.join("\n") || "Trace failed" },
        });
        return;
      }

      const metrics = analyzeDrillDepth(result);
      const suggestions = analyzeSuggestions(result, metrics, input.drillDepthThreshold);

      const message: ExtensionToWebviewMessage = {
        type: "traceResult",
        payload: {
          result,
          metrics,
          suggestions,
        },
      };

      panel.webview.postMessage(message);
    } catch (err: unknown) {
      panel.webview.postMessage({
        type: "error",
        payload: { message: `Trace failed: ${err instanceof Error ? err.message : String(err)}` },
      });
    }
  }, 50);
}

function getWebviewHtml(context: vscode.ExtensionContext, webview: vscode.Webview): string {
  const scriptPath = vscode.Uri.file(path.join(context.extensionPath, "dist", "webview.js"));
  const scriptUri = webview.asWebviewUri(scriptPath);

  const cssPath = vscode.Uri.file(path.join(context.extensionPath, "dist", "webview.css"));
  const cssUri = webview.asWebviewUri(cssPath);

  // Check if webview.css exists (only link it if it's generated by esbuild)
  const hasCss = fs.existsSync(cssPath.fsPath);
  const cssLink = hasCss ? `<link rel="stylesheet" href="${cssUri}">` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PropTrace Visualizer</title>
  ${cssLink}
  <style>
    body {
      margin: 0;
      padding: 0;
      overflow: hidden;
      background-color: var(--vscode-editor-backgroundColor, #1e1e1e);
      color: var(--vscode-editor-foregroundColor, #cccccc);
      font-family: var(--vscode-font-family, sans-serif);
      font-size: var(--vscode-font-size, 13px);
    }
    #root {
      height: 100vh;
      width: 100vw;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}
