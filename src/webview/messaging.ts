import type { WebviewToExtensionMessage, SourceLocation } from "../types";

declare function acquireVsCodeApi(): {
  postMessage(message: WebviewToExtensionMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};

// Access the VS Code Webview API (singleton)
let vscode: ReturnType<typeof acquireVsCodeApi> | undefined = undefined;

try {
  vscode = acquireVsCodeApi();
} catch {
  // Silent fallback for browser development environment (outside VS Code)
  console.warn("VS Code API not found. Running in browser mode.");
}

export const messaging = {
  /** Post a message to the extension host. */
  postMessage(message: WebviewToExtensionMessage): void {
    if (vscode) {
      vscode.postMessage(message);
    } else {
      console.log("[Webview -> Extension Message]", message);
    }
  },

  /** Jump to a specific source location in the editor. */
  jumpToSource(location: SourceLocation): void {
    this.postMessage({
      type: "jumpToSource",
      payload: { location },
    });
  },

  /** Notify the extension that the webview is ready. */
  notifyReady(): void {
    this.postMessage({
      type: "ready",
    });
  },

  /** Retrace a prop. */
  retrace(propName: string, filePath: string, line: number, column: number): void {
    this.postMessage({
      type: "retrace",
      payload: { propName, filePath, line, column },
    });
  },
};
