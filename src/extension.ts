import * as vscode from "vscode";
import { tracePropCommand } from "./commands/tracePropCommand";
import { showAllDrilledPropsCommand } from "./commands/showAllDrilledPropsCommand";
import { PropTraceCodeLensProvider } from "./commands/codeLensProvider";

export function activate(context: vscode.ExtensionContext) {
  console.log('Extension "proptrace" is now active.');

  // 1. Register CodeLens Provider
  const codeLensProvider = new PropTraceCodeLensProvider();
  const selector: vscode.DocumentSelector = [
    { scheme: "file", language: "typescriptreact" },
    { scheme: "file", language: "javascriptreact" },
    { scheme: "file", language: "typescript" },
    { scheme: "file", language: "javascript" },
  ];

  context.subscriptions.push(vscode.languages.registerCodeLensProvider(selector, codeLensProvider));

  // 2. Register Trace Prop Command
  context.subscriptions.push(
    vscode.commands.registerCommand("proptrace.traceProp", async (args) => {
      await tracePropCommand(context, args);
    }),
  );

  // 3. Register Show All Drilled Props Command
  context.subscriptions.push(
    vscode.commands.registerCommand("proptrace.showAllDrilledProps", async () => {
      await showAllDrilledPropsCommand(context);
    }),
  );
}

export function deactivate() {
  // cleanup
}
