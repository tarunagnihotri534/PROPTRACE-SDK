import * as vscode from "vscode";
import { scanFileForDrilledProps, buildTraceGraph } from "../trace/buildTraceGraph";
import { analyzeDrillDepth } from "../analyzers/drillDepthAnalyzer";
import { getOrCreateWebviewPanel } from "./tracePropCommand";
import type { DrilledPropSummary, TraceInput, ExtensionToWebviewMessage } from "../types";

export async function showAllDrilledPropsCommand(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage("PropTrace: No active text editor found.");
    return;
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const workspaceRoot = workspaceFolder ? workspaceFolder.uri.fsPath : "";

  if (!workspaceRoot) {
    vscode.window.showErrorMessage("PropTrace: Please open a workspace first.");
    return;
  }

  const filePath = editor.document.fileName;

  // Reveal webview and show loading
  const panel = getOrCreateWebviewPanel(context, workspaceRoot);
  panel.reveal(vscode.ViewColumn.Two);

  panel.webview.postMessage({
    type: "loading",
    payload: { message: `Scanning file for drilled props...` },
  });

  // Run async scan
  setTimeout(() => {
    try {
      const scans = scanFileForDrilledProps(workspaceRoot, filePath);
      const drillDepthThreshold = vscode.workspace
        .getConfiguration("proptrace")
        .get<number>("drillDepthThreshold", 3);

      const summaries: DrilledPropSummary[] = [];

      for (const scan of scans) {
        const input: TraceInput = {
          filePath: scan.filePath,
          line: scan.line,
          column: scan.column,
          workspaceRoot,
          drillDepthThreshold,
        };

        try {
          const result = buildTraceGraph(input);
          const metrics = analyzeDrillDepth(result);

          summaries.push({
            propName: scan.propName,
            componentName: scan.componentName,
            drillDepth: metrics.drillDepth,
            location: {
              filePath: scan.filePath,
              line: scan.line,
              column: scan.column,
            },
          });
        } catch {
          // skip if trace fails for an individual prop
        }
      }

      const message: ExtensionToWebviewMessage = {
        type: "allDrilledProps",
        payload: {
          props: summaries,
          filePath,
        },
      };

      panel.webview.postMessage(message);
    } catch (err: unknown) {
      panel.webview.postMessage({
        type: "error",
        payload: { message: `Scan failed: ${err instanceof Error ? err.message : String(err)}` },
      });
    }
  }, 50);
}
