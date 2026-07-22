import * as vscode from "vscode";
import { Project } from "ts-morph";
import { findComponentsInFile, extractPropNames } from "../utils/astUtils";

export class PropTraceCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor() {
    vscode.workspace.onDidChangeConfiguration(() => {
      this._onDidChangeCodeLenses.fire();
    });
  }

  public provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    const enableCodeLens = vscode.workspace
      .getConfiguration("proptrace")
      .get<boolean>("enableCodeLens", true);

    if (!enableCodeLens) {
      return [];
    }

    // Only TSX/JSX and TS/JS files
    if (
      !document.fileName.endsWith(".tsx") &&
      !document.fileName.endsWith(".jsx") &&
      !document.fileName.endsWith(".ts") &&
      !document.fileName.endsWith(".js")
    ) {
      return [];
    }

    try {
      const project = new Project({ useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile("temp.tsx", document.getText());
      const components = findComponentsInFile(sourceFile);
      const lenses: vscode.CodeLens[] = [];

      for (const comp of components) {
        const propNames = extractPropNames(comp.node);
        if (propNames.length === 0) continue;

        // If the first parameter is just "props" without destructuring, we might not know individual keys easily.
        // But we can check if it's destructured. If it is destructured, we show CodeLens for those keys.
        // Let's pass the parameters name or destructured keys.
        const start = comp.node.getStart();
        const position = document.positionAt(start);
        const range = new vscode.Range(position, position);

        lenses.push(
          new vscode.CodeLens(range, {
            title: `🔍 Trace props (${propNames.join(", ")})`,
            command: "proptrace.traceProp",
            arguments: [
              {
                filePath: document.fileName,
                componentName: comp.name,
                propNames,
              },
            ],
          }),
        );
      }

      return lenses;
    } catch {
      // Return empty if parsing fails (fail silently to not disrupt the editor)
      return [];
    }
  }
}
